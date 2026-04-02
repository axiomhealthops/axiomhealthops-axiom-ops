import React, { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
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
 
        setMessage('Uploading ' + data.length + ' records to Supabase...');
 
        // 1. Create batch record
        var batchRes = await supabase.from('upload_batches').insert([{
          batch_type: props.batchType,
          file_name: file.name,
          record_count: data.length,
        }]).select('id').single();
 
        if (batchRes.error) throw new Error('Batch create failed: ' + batchRes.error.message);
        var batchId = batchRes.data.id;
 
        // 2. Delete previous records for this batch type
        var table = props.batchType === 'visits' ? 'visit_schedule_data' : 'census_data';
        await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
 
        // 3. Insert new records in chunks of 200
        var rows = data.map(function(r) { return Object.assign({}, r, { batch_id: batchId }); });
        var chunkSize = 200;
        for (var i = 0; i < rows.length; i += chunkSize) {
          var chunk = rows.slice(i, i + chunkSize);
          var ins = await supabase.from(table).insert(chunk);
          if (ins.error) throw new Error('Insert failed: ' + ins.error.message);
          setMessage('Uploading... ' + Math.min(i + chunkSize, rows.length) + '/' + rows.length);
        }
 
        // 4. Also cache in localStorage for fast reads (visits page still uses it)
        localStorage.setItem(props.storageKey, JSON.stringify(data));
 
        setCount(data.length);
        setStatus('success');
        setMessage(data.length + ' records saved to Supabase');
        setLastUpload({ file_name: file.name, record_count: data.length, uploaded_at: new Date().toISOString() });
 
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
              {lastUpload.record_count} records in Supabase
            </div>
            <div style={{ fontSize: 10, color: 'var(--gray)' }}>
              {lastUpload.file_name} &middot; {new Date(lastUpload.uploaded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
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
          />
          <UploadCard
            title="Patient Census"
            description="Pariox patient census export (.xlsx). Columns: Patient, Address, Disc, Ref Source, Region, SOC, Insurance, Status."
            storageKey="axiom_census"
            batchType="census"
            parseType="census"
          />
        </div>
 
        {/* Upload History */}
        {uploadHistory.length > 0 && (
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--black)', marginBottom: 16 }}>Upload History</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {uploadHistory.map(function(batch) {
                return (
                  <div key={batch.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 16 }}>{batch.batch_type === 'visits' ? '📅' : '👥'}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--black)' }}>{batch.file_name || 'Unknown file'}</div>
                      <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>
                        {batch.batch_type === 'visits' ? 'Visit Schedule' : 'Patient Census'} &middot; {batch.record_count} records
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
 
