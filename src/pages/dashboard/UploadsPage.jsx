import React, { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { runAlertEngine } from '../../lib/alertEngine';
 
// ── XLSX → CSV ────────────────────────────────────────────────────────
function parseXLSXFile(arrayBuffer) {
  var wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true, cellFormula: false, raw: false });
  var ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('No sheet found');
  return XLSX.utils.sheet_to_csv(ws, { blankrows: false });
}
 
function parseCSVLine(line) {
  var cols = [], current = '', inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQuotes = !inQuotes; }
    else if (line[i] === ',' && !inQuotes) { cols.push(current.trim()); current = ''; }
    else { current += line[i]; }
  }
  cols.push(current.trim());
  return cols;
}
 
function normalizeParioxName(parioxName) {
  // Convert "LastName, FirstName" → "FirstName LastName"
  if (!parioxName) return '';
  const trimmed = parioxName.trim();
  if (!trimmed.includes(',')) return trimmed; // Already "FirstName LastName"
  const parts = trimmed.split(',');
  const lastName  = (parts[0] || '').trim();
  const firstName = (parts[1] || '').trim();
  return firstName + ' ' + lastName;
}

function normalizeStatus(raw) {
  if (!raw) return '';
  var lower = raw.trim().toLowerCase();
  if (lower.includes('missed') && lower.includes('active')) return 'Missed (Active)';
  if (lower.includes('missed')) return 'Missed';
  if (lower.includes('completed')) return 'Completed';
  if (lower.includes('scheduled')) return 'Scheduled';
  if (lower.includes('cancelled')) return 'Cancelled';
  if (lower.includes('attempted')) return 'Attempted';
  return raw.trim();
}
 
function extractRegion(colD) {
  if (!colD) return '';
  var s = colD.toString().trim().toUpperCase();
  if (/^[A-Z]$/.test(s)) return s;
  var last = s.slice(-1);
  if (/^[A-Z]$/.test(last)) return last;
  return s;
}
 
function parseVisitCSV(csv) {
  var lines = csv.split('\n').filter(function(l) { return l.trim(); });
  return lines.slice(1).map(function(line) {
    var c = parseCSVLine(line);
    var rawDate = (c[7] || '').trim();
    var visitDate = null;
    try {
      var d = new Date(rawDate);
      if (!isNaN(d.getTime())) visitDate = d.toISOString().split('T')[0];
    } catch(e) {}
    return {
      patient_name: (c[0] || '').trim(),
      address: (c[1] || '').trim(),
      ref_source: (c[2] || '').trim(),
      region: extractRegion(c[3]),
      discipline: (c[4] || '').trim(),
      staff_name: (c[5] || '').trim(),
      staff_name_normalized: normalizeParioxName((c[5] || '').trim()),
      event_type: (c[6] || '').trim(),
      raw_date: rawDate,
      visit_date: visitDate,
      visit_time: (c[8] || '').trim(),
      insurance: (c[9] || '').trim(),
      status: normalizeStatus(c[10]),
      notes: (c[11] || '').trim(),
    };
  }).filter(function(r) { return r.patient_name && r.patient_name.length > 0; });
}
 
function parseCensusCSV(csv) {
  var lines = csv.split('\n').filter(function(l) { return l.trim(); });
  return lines.slice(1).map(function(line) {
    var c = parseCSVLine(line);
    return {
      patient_name: (c[0] || '').trim(),
      address: (c[1] || '').trim(),
      discipline: (c[2] || '').trim(),
      ref_source: (c[3] || '').trim(),
      region: (c[4] || '').toUpperCase().trim(),
      insurance: (c[6] || '').trim(),
      status: (c[7] || 'active').trim(),
    };
  }).filter(function(r) { return r.patient_name && r.patient_name.trim(); });
}
 
// ── Upload Card ───────────────────────────────────────────────────────
function UploadCard(props) {
  var [status, setStatus] = useState('idle');
  var [message, setMessage] = useState('');
  var [count, setCount] = useState(0);
  var [lastUpload, setLastUpload] = useState(null);
  var inputRef = useRef();
 
  useEffect(function() {
    // Load last upload info from Supabase
    supabase.from('upload_batches')
      .select('*')
      .eq('batch_type', props.batchType)
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .then(function(res) {
        if (res.data && res.data.length > 0) setLastUpload(res.data[0]);
      });
  }, []);
 
  async function handleFile(file) {
    if (!file) return;
    setStatus('loading');
    setMessage('Parsing file...');

    var reader = new FileReader();
    reader.onerror = function() { setStatus('error'); setMessage('Failed to read file'); };
    reader.onload = async function(e) {
      try {
        var csv = parseXLSXFile(e.target.result);
        var data = props.parseType === 'visits' ? parseVisitCSV(csv) : parseCensusCSV(csv);

        setMessage('Processing ' + data.length + ' records...');

        // Create batch record for audit trail — includes who uploaded for accountability
        var uploaderName = props.profile?.full_name || props.profile?.email || 'Unknown';
        var batchRes = await supabase.from('upload_batches').insert([{
          batch_type: props.batchType,
          file_name: file.name,
          record_count: data.length,
          uploaded_by: uploaderName,
        }]).select('id').single();
        if (batchRes.error) throw new Error('Batch record failed: ' + batchRes.error.message);
        var batchId = batchRes.data.id;
        var now = new Date().toISOString();
        var today = now.slice(0, 10);

        // ── VISIT SCHEDULE ─────────────────────────────────────────────
        if (props.batchType === 'visits') {
          var rows = data.map(function(r) { return Object.assign({}, r, { batch_id: batchId, uploaded_at: now }); });
          var inserted = 0, updated = 0, errors = 0;

          for (var i = 0; i < rows.length; i += 100) {
            var chunk = rows.slice(i, i + 100);
            // Upsert: if same patient+date+event+staff exists, update status/notes
            // ON CONFLICT update mutable fields only (status can change day to day)
            var res = await supabase.from('visit_schedule_data').upsert(chunk, {
              onConflict: 'patient_name,visit_date,event_type,staff_name',
              ignoreDuplicates: false,
            });
            if (res.error) { errors++; console.warn('Upsert chunk error:', res.error.message); }
            else inserted += chunk.length;
            setMessage('Saving visits... ' + Math.min(i + 100, rows.length) + '/' + rows.length);
          }

          // Count totals in DB now
          var { count } = await supabase.from('visit_schedule_data').select('*', { count: 'exact', head: true });
          await supabase.from('data_freshness').upsert({
            data_type: 'visit_schedule',
            last_upload: now,
            last_batch_id: batchId,
            record_count: rows.length,
            updated_at: now,
          }, { onConflict: 'data_type' });
          setMessage('✓ Visits saved. ' + rows.length + ' in this upload · ' + (count || '?') + ' total in history.');
          setCount(rows.length);
        }

        // ── CENSUS DATA ────────────────────────────────────────────────
        else if (props.batchType === 'census') {
          setMessage('Comparing with previous census...');

          // Fetch existing records
          var { data: prevRecords } = await supabase.from('census_data').select('patient_name, status, region, insurance, first_seen_date');
          var prevMap = {};
          (prevRecords || []).forEach(function(r) {
            if (r.patient_name) prevMap[r.patient_name.toLowerCase().trim()] = r;
          });

          var statusChanges = [];
          var newHospitalizations = [];
          var newCount = 0, updatedCount = 0, unchangedCount = 0;

          var upsertRows = data.map(function(r) {
            var key = r.patient_name ? r.patient_name.toLowerCase().trim() : '';
            var prev = prevMap[key];
            var row = Object.assign({}, r, {
              batch_id: batchId,
              patient_key: key,
              last_seen_date: today,
              first_seen_date: prev ? (prev.first_seen_date || today) : today,
              uploaded_at: now,
            });

            if (!prev) {
              newCount++;
              if (r.status === 'Hospitalized') newHospitalizations.push(r);
            } else if (prev.status !== r.status) {
              updatedCount++;
              row.previous_status = prev.status;
              row.status_changed_at = now;
              statusChanges.push({
                patient_name: r.patient_name,
                patient_key: key,
                region: r.region,
                insurance: r.insurance,
                old_status: prev.status,
                new_status: r.status,
                batch_id: batchId,
                changed_at: now,
              });
              if (r.status === 'Hospitalized' && prev.status !== 'Hospitalized') {
                newHospitalizations.push(r);
              }
            } else {
              unchangedCount++;
            }
            return row;
          });

          // Upsert all — new patients get inserted, existing get updated
          for (var i = 0; i < upsertRows.length; i += 100) {
            var chunk = upsertRows.slice(i, i + 100);
            var res = await supabase.from('census_data').upsert(chunk, {
              onConflict: 'patient_name',
              ignoreDuplicates: false,
            });
            if (res.error) console.warn('Census upsert error:', res.error.message);
            setMessage('Saving census... ' + Math.min(i + 100, upsertRows.length) + '/' + upsertRows.length);
          }

          // Log status changes
          if (statusChanges.length > 0) {
            await supabase.from('census_status_log').insert(statusChanges);
          }

          // Auto-create hospitalization records
          for (var h of newHospitalizations) {
            var { data: existing } = await supabase.from('hospitalizations')
              .select('id').eq('patient_name', h.patient_name).is('discharge_date', null).limit(1);
            if (!existing || existing.length === 0) {
              await supabase.from('hospitalizations').insert({
                patient_name: h.patient_name, region: h.region, insurance: h.insurance,
                admission_date: today,
                admitting_diagnosis: 'Pending — auto-detected from census',
                cause_category: 'unknown', outcome: 'still_admitted',
                reported_by: 'System (census auto-detect)', reported_date: today,
                review_notes: 'Auto-created: patient status changed to Hospitalized. Add clinical details.',
              });
            }
          }

          // ── SYNC LAST VISIT DATES from visit history ─────────────────
          setMessage('Computing last visit dates...');
          // Build last-visit map from all completed visits in DB
          var { data: allVisits } = await supabase.from('visit_schedule_data')
            .select('patient_name, visit_date, staff_name, event_type, status')
            .ilike('status', '%completed%');
          var lastVisitMap = {};
          (allVisits || []).forEach(function(v) {
            var key = (v.patient_name || '').toLowerCase().trim();
            if (!lastVisitMap[key] || v.visit_date > lastVisitMap[key].visit_date) {
              lastVisitMap[key] = v;
            }
          });
          // Update census_data with computed last_visit_date
          var today = new Date().toISOString().slice(0,10);
          for (var pm of upsertRows) {
            var pKey = (pm.patient_name || '').toLowerCase().trim();
            var lv = lastVisitMap[pKey];
            if (lv) {
              var daysAgo = Math.floor((new Date() - new Date(lv.visit_date + 'T00:00:00')) / 86400000);
              await supabase.from('census_data').update({
                last_visit_date: lv.visit_date,
                last_visit_clinician: lv.staff_name_normalized || lv.staff_name,
                last_visit_type: lv.event_type,
                days_since_last_visit: daysAgo,
              }).eq('patient_name', pm.patient_name);
            }
          }

          // ── SYNC PATIENT MASTER ──────────────────────────────────────
          setMessage('Updating patient master registry...');
          for (var pm of upsertRows) {
            var pmKey = pm.patient_name ? pm.patient_name.toLowerCase().trim() : '';
            var prevPm = prevMap[pmKey];
            var isActive = /active/i.test(pm.status || '');
            var isDischarged = /discharge/i.test(pm.status || '');
            var masterPayload = {
              patient_name: pm.patient_name,
              patient_key: pmKey,
              region: pm.region,
              insurance: pm.insurance,
              current_status: pm.status,
              previous_status: prevPm ? prevPm.status : null,
              status_changed_at: (prevPm && prevPm.status !== pm.status) ? now : undefined,
              first_seen_date: pm.first_seen_date || today,
              is_new_patient: !prevPm,
              has_been_active: isActive || (prevPm ? /active/i.test(prevPm.status || '') : false),
              has_been_discharged: isDischarged,
              last_discharge_date: isDischarged ? today : undefined,
              last_active_date: isActive ? today : undefined,
              last_upload_batch: batchId,
              updated_at: now,
            };
            if (!prevPm) masterPayload.first_upload_batch = batchId;
            await supabase.from('patient_master').upsert(masterPayload, { onConflict: 'patient_name', ignoreDuplicates: false });
          }

          // ── UPDATE DATA FRESHNESS ─────────────────────────────────────
          await supabase.from('data_freshness').upsert({
            data_type: 'census',
            last_upload: now,
            last_batch_id: batchId,
            record_count: data.length,
            updated_at: now,
          }, { onConflict: 'data_type' });

          var { count: totalCensus } = await supabase.from('census_data').select('*', { count: 'exact', head: true });
          var { count: masterCount } = await supabase.from('patient_master').select('*', { count: 'exact', head: true });
          var msg = '✓ Census updated. ' + newCount + ' new · ' + updatedCount + ' changed · ' + unchangedCount + ' unchanged · ' + (totalCensus || '?') + ' current · ' + (masterCount || '?') + ' total historical patients.';
          if (newHospitalizations.length > 0) msg += ' ⚠ ' + newHospitalizations.length + ' new hospitalization(s) auto-logged.';
          if (statusChanges.length > 0) msg += ' ' + statusChanges.length + ' status change(s) recorded.';
          setMessage(msg);
          setCount(data.length);
        }

        localStorage.setItem(props.storageKey, JSON.stringify(data));
        setStatus('success');
        setLastUpload({ file_name: file.name, record_count: data.length, uploaded_at: now });
        if (props.onSuccess) props.onSuccess(data);

      } catch (err) {
        setStatus('error');
        setMessage('Error: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }
 
  function handleDrop(e) { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }
  function handleChange(e) { handleFile(e.target.files[0]); }
 
  var borderColor = status === 'loading' ? 'var(--blue)' : status === 'success' ? 'var(--green)' : status === 'error' ? 'var(--danger)' : 'var(--border)';
 
  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--black)', marginBottom: 4 }}>{props.title}</div>
          <div style={{ fontSize: 12, color: 'var(--gray)', lineHeight: 1.5, maxWidth: 320 }}>{props.description}</div>
        </div>
        {lastUpload && (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ background: '#ECFDF5', color: 'var(--green)', border: '1px solid #A7F3D0', borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
              {lastUpload.record_count} records in last upload
            </div>
            <div style={{ fontSize: 10, color: 'var(--gray)' }}>
              {lastUpload.file_name} · {new Date(lastUpload.uploaded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </div>
            <div style={{ fontSize: 10, color: '#1565C0', fontWeight: 600, marginTop: 2 }}>
              ✓ Historical data preserved — only changes updated
            </div>
          </div>
        )}
      </div>
      <div style={{ border: '2px dashed ' + borderColor, borderRadius: 10, padding: 32, textAlign: 'center', cursor: 'pointer', background: 'var(--bg)' }}
        onDrop={handleDrop} onDragOver={function(e) { e.preventDefault(); }}
        onClick={function() { if (inputRef.current && status !== 'loading') inputRef.current.click(); }}>
        <input ref={inputRef} type="file" accept=".xlsx,.xls" onChange={handleChange} style={{ display: 'none' }} />
        {status === 'loading'
          ? <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--black)', marginBottom: 4 }}>Processing...</div>
              <div style={{ fontSize: 12, color: 'var(--gray)' }}>{message}</div>
            </div>
          : status === 'success'
          ? <div style={{ color: 'var(--green)', fontWeight: 600 }}>✓ {message}</div>
          : status === 'error'
          ? <div style={{ color: 'var(--danger)' }}>{message}</div>
          : <div>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--black)', marginBottom: 4 }}>Drop .xlsx file here or click to browse</div>
              <div style={{ fontSize: 12, color: 'var(--gray)' }}>Pariox export &middot; saves permanently to Supabase</div>
            </div>
        }
      </div>
    </div>
  );
}
 
// ── Main Page ─────────────────────────────────────────────────────────
export default function UploadsPage() {
  const { profile } = useAuth();
  var [driveLink, setDriveLink] = useState(function() {
    try { return JSON.parse(localStorage.getItem('axiom_drive_links') || '{}').main || ''; }
    catch(e) { return ''; }
  });
  var [alertStatus, setAlertStatus] = useState('');
  var [uploadHistory, setUploadHistory] = useState([]);
 
  useEffect(function() {
    supabase.from('upload_batches')
      .select('*')
      .order('uploaded_at', { ascending: false })
      .limit(10)
      .then(function(res) { setUploadHistory(res.data || []); });
  }, []);
 
  function saveDriveLink() {
    localStorage.setItem('axiom_drive_links', JSON.stringify({ main: driveLink }));
    alert('Drive link saved.');
  }
 
  function handleVisitUpload(data) {
    setAlertStatus('Generating alerts...');
    runAlertEngine(data).then(function(result) {
      if (result.error) {
        setAlertStatus('Alert error: ' + result.error.message);
      } else {
        setAlertStatus(result.created + ' alerts generated from visit data.');
        setTimeout(function() { setAlertStatus(''); }, 5000);
        // Refresh history
        supabase.from('upload_batches').select('*').order('uploaded_at', { ascending: false }).limit(10)
          .then(function(res) { setUploadHistory(res.data || []); });
      }
    });
  }
 
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Data Uploads" subtitle="Pariox exports save permanently to Supabase" />
      <div style={{ padding: 28, flex: 1, overflow: 'auto' }}>
 
        {alertStatus && (
          <div style={{ background: '#EFF6FF', border: '1px solid #93C5FD', borderRadius: 8, padding: '10px 16px', marginBottom: 20, fontSize: 13, color: '#1E40AF', fontWeight: 500 }}>
            🔔 {alertStatus}
          </div>
        )}
 
        {/* Data Status Banner */}
        <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 10, padding: '12px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 18 }}>✅</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#065F46' }}>All uploads save permanently to Supabase</div>
            <div style={{ fontSize: 12, color: '#047857', marginTop: 2 }}>Visit data and census data no longer disappear on refresh. Historical uploads are tracked below.</div>
          </div>
        </div>
 
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20, marginBottom: 24 }}>
          <UploadCard
            title="Visit Schedule"
            description="Pariox visit schedule export (.xlsx). Columns: Patient, Address, Ref Source, Region, Discipline, Staff, Event, Date, Time, Insurance, Status, Notes."
            storageKey="axiom_pariox_data"
            batchType="visits"
            parseType="visits"
            onSuccess={handleVisitUpload}
            profile={profile}
          />
          <UploadCard
            title="Patient Census"
            description="Pariox patient census export (.xlsx). Columns: Patient, Address, Disc, Ref Source, Region, SOC, Insurance, Status."
            storageKey="axiom_census"
            batchType="census"
            parseType="census"
            profile={profile}
          />
        </div>
 
        {/* Upload History */}
        {uploadHistory.length > 0 && (
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--black)' }}>Upload History</div>
              <div style={{ fontSize: 11, color: '#1565C0', fontWeight: 600, background: '#EFF6FF', padding: '3px 10px', borderRadius: 999 }}>
                📚 Historical mode — each upload adds to cumulative data
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {uploadHistory.map(function(batch) {
                var typeIcon = batch.batch_type === 'visits' ? '📅'
                             : batch.batch_type === 'census' ? '👥'
                             : batch.batch_type === 'intake_referrals' ? '📥'
                             : '📄';
                var typeLabel = batch.batch_type === 'visits' ? 'Visit Schedule'
                              : batch.batch_type === 'census' ? 'Patient Census'
                              : batch.batch_type === 'intake_referrals' ? 'Monthly Intake Report'
                              : batch.batch_type;
                var byLine = batch.uploaded_by ? ' · by ' + batch.uploaded_by : '';
                return (
                  <div key={batch.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 16 }}>{typeIcon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--black)' }}>{batch.file_name || 'Unknown file'}</div>
                      <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>
                        {typeLabel} · {batch.record_count} records{byLine}
                      </div>
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--gray)', fontFamily: 'DM Mono, monospace' }}>
                      {new Date(batch.uploaded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
 
        {/* Google Drive Link */}
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--black)', marginBottom: 4 }}>Google Drive Link</div>
          <div style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 16 }}>Shared Google Drive folder for team document access.</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <input type="url" value={driveLink} onChange={function(e) { setDriveLink(e.target.value); }}
              placeholder="https://drive.google.com/drive/folders/..."
              style={{ flex: 1, padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--bg)', color: 'var(--black)', outline: 'none' }} />
            <button onClick={saveDriveLink}
              style={{ padding: '10px 20px', background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Save
            </button>
          </div>
          {driveLink && (
            <a href={driveLink} target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-block', marginTop: 12, fontSize: 13, color: 'var(--blue)', textDecoration: 'none' }}>
              Open Drive →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
 
