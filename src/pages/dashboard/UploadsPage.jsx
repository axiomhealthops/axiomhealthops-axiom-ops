import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import TopBar from '../../components/TopBar';
import { runAlertEngine } from '../../lib/alertEngine';
 
function parseXLSXFile(arrayBuffer) {
  var wb = XLSX.read(arrayBuffer, {
    type: 'array',
    cellDates: true,
    cellFormula: false,
    cellNF: false,
    sheetStubs: false,
    raw: false,
  });
  var ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('No sheet found');
  var ref = ws['!ref'];
  if (ref) {
    var range = XLSX.utils.decode_range(ref);
    for (var R = range.s.r; R <= range.e.r; R++) {
      for (var C = range.s.c; C <= range.e.c; C++) {
        var addr = XLSX.utils.encode_cell({ r: R, c: C });
        var cell = ws[addr];
        if (cell && cell.f) {
          ws[addr] = cell.v !== undefined ? { v: String(cell.v), t: 's' } : { v: '', t: 's' };
        }
      }
    }
  }
  return XLSX.utils.sheet_to_csv(ws, { blankrows: false });
}
 
function parseCSVLine(line) {
  var cols = [];
  var current = '';
  var inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQuotes = !inQuotes; }
    else if (line[i] === ',' && !inQuotes) { cols.push(current.trim()); current = ''; }
    else { current += line[i]; }
  }
  cols.push(current.trim());
  return cols;
}
 
// Normalize status: map all Pariox status variants to clean categories
function normalizeStatus(raw) {
  if (!raw) return '';
  var s = raw.trim();
  var lower = s.toLowerCase();
  if (lower.includes('missed') && lower.includes('active')) return 'Missed (Active)';
  if (lower.includes('missed')) return 'Missed';
  if (lower.includes('completed')) return 'Completed';
  if (lower.includes('scheduled')) return 'Scheduled';
  if (lower.includes('cancelled')) return 'Cancelled';
  if (lower.includes('attempted')) return 'Attempted';
  return s;
}
 
// Extract region — col D is now a direct single letter in the new format
function extractRegion(colD) {
  if (!colD) return '';
  var s = colD.toString().trim().toUpperCase();
  // Direct single letter
  if (/^[A-Z]$/.test(s)) return s;
  // Last character fallback
  var last = s.slice(-1);
  if (/^[A-Z]$/.test(last)) return last;
  return s;
}
 
function parseVisitCSV(csv) {
  var lines = csv.split('\n').filter(function(l) { return l.trim(); });
  var rows = lines.slice(1);
  var results = rows.map(function(line) {
    var cols = parseCSVLine(line);
    // Col A=Patient, B=Address, C=RefSource, D=Region, E=Disc, F=Staff, G=Event, H=Date, I=Time, J=Ins, K=Status, L=Notes
    return {
      patient_name: (cols[0] || '').trim(),
      address: (cols[1] || '').trim(),
      ref_source: (cols[2] || '').trim(),
      region: extractRegion(cols[3]),
      discipline: (cols[4] || '').trim(),
      staff_name: (cols[5] || '').trim(),
      event_type: (cols[6] || '').trim(),
      raw_date: (cols[7] || '').trim(),
      visit_time: (cols[8] || '').trim(),
      insurance: (cols[9] || '').trim(),
      status: normalizeStatus(cols[10]),
      notes: (cols[11] || '').trim(),
    };
  }).filter(function(r) { return r.patient_name && r.patient_name.length > 0; });
  return results;
}
 
function parseCensusCSV(csv) {
  var lines = csv.split('\n').filter(function(l) { return l.trim(); });
  var rows = lines.slice(1);
  return rows.map(function(line) {
    var cols = parseCSVLine(line);
    return {
      patient_name: (cols[0] || '').trim(),
      address: (cols[1] || '').trim(),
      discipline: (cols[2] || '').trim(),
      ref_source: (cols[3] || '').trim(),
      region: (cols[4] || '').toUpperCase().trim(),
      insurance: (cols[6] || '').trim(),
      status: (cols[7] || 'active').trim(),
    };
  }).filter(function(r) { return r.patient_name && r.patient_name.trim(); });
}
 
function UploadCard(props) {
  var [status, setStatus] = useState('idle');
  var [message, setMessage] = useState('');
  var [count, setCount] = useState(0);
  var inputRef = useRef();
 
  function handleFile(file) {
    if (!file) return;
    setStatus('loading');
    setMessage('');
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var csv = parseXLSXFile(e.target.result);
        var data = props.parseType === 'visits' ? parseVisitCSV(csv) : parseCensusCSV(csv);
        localStorage.setItem(props.storageKey, JSON.stringify(data));
        setCount(data.length);
        setStatus('success');
        setMessage(data.length + ' records loaded successfully');
        if (props.onSuccess) props.onSuccess(data);
      } catch (err) {
        setStatus('error');
        setMessage('Error: ' + err.message);
      }
    };
    reader.onerror = function() { setStatus('error'); setMessage('Failed to read file'); };
    reader.readAsArrayBuffer(file);
  }
 
  function handleDrop(e) { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }
  function handleChange(e) { handleFile(e.target.files[0]); }
  function clearData() {
    localStorage.removeItem(props.storageKey);
    setStatus('idle'); setMessage(''); setCount(0);
    if (inputRef.current) inputRef.current.value = '';
  }
 
  var existing = (function() {
    try { var d = JSON.parse(localStorage.getItem(props.storageKey) || '[]'); return Array.isArray(d) ? d.length : 0; }
    catch (e) { return 0; }
  })();
 
  var borderColor = status === 'loading' ? 'var(--blue)' : status === 'success' ? 'var(--green)' : status === 'error' ? 'var(--danger)' : 'var(--border)';
 
  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--black)', marginBottom: 4 }}>{props.title}</div>
          <div style={{ fontSize: 12, color: 'var(--gray)', lineHeight: 1.5, maxWidth: 320 }}>{props.description}</div>
        </div>
        {(existing > 0 || status === 'success') && (
          <div style={{ background: '#ECFDF5', color: 'var(--green)', border: '1px solid #A7F3D0', borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
            {status === 'success' ? count : existing} records loaded
          </div>
        )}
      </div>
      <div style={{ border: '2px dashed ' + borderColor, borderRadius: 10, padding: 32, textAlign: 'center', cursor: 'pointer', background: 'var(--bg)' }}
        onDrop={handleDrop} onDragOver={function(e) { e.preventDefault(); }}
        onClick={function() { if (inputRef.current) inputRef.current.click(); }}>
        <input ref={inputRef} type="file" accept=".xlsx,.xls" onChange={handleChange} style={{ display: 'none' }} />
        {status === 'loading' ? <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--black)' }}>Processing...</div>
          : status === 'success' ? <div style={{ color: 'var(--green)', fontWeight: 600 }}>&#10003; {message}</div>
          : status === 'error' ? <div style={{ color: 'var(--danger)' }}>{message}</div>
          : <div>
              <div style={{ fontSize: 28, marginBottom: 8 }}>&#128196;</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--black)', marginBottom: 4 }}>Drop .xlsx file here or click to browse</div>
              <div style={{ fontSize: 12, color: 'var(--gray)' }}>Pariox export only</div>
            </div>
        }
      </div>
      {(status === 'success' || existing > 0) && (
        <button onClick={clearData} style={{ marginTop: 12, background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 14px', fontSize: 12, color: 'var(--gray)', cursor: 'pointer' }}>
          Clear data
        </button>
      )}
    </div>
  );
}
 
export default function UploadsPage() {
  var [driveLink, setDriveLink] = useState(function() {
    try { var s = JSON.parse(localStorage.getItem('axiom_drive_links') || '{}'); return s.main || ''; }
    catch (e) { return ''; }
  });
  var [alertStatus, setAlertStatus] = useState('');
 
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
      }
    });
  }
 
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Data Uploads" subtitle="Upload Pariox exports to populate the platform" />
      <div style={{ padding: 28, flex: 1 }}>
 
        {alertStatus && (
          <div style={{ background: '#EFF6FF', border: '1px solid #93C5FD', borderRadius: 8, padding: '10px 16px', marginBottom: 20, fontSize: 13, color: '#1E40AF', fontWeight: 500 }}>
            &#128276; {alertStatus}
          </div>
        )}
 
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20, marginBottom: 24 }}>
          <UploadCard
            title="Visit Schedule"
            description="Pariox visit schedule export (.xlsx). Columns: Patient, Address, Ref Source, Region, Discipline, Staff, Event, Date, Time, Insurance, Status, Notes."
            storageKey="axiom_pariox_data"
            parseType="visits"
            onSuccess={handleVisitUpload}
          />
          <UploadCard
            title="Patient Census"
            description="Pariox patient census export (.xlsx). Columns: Patient, Address, Disc, Ref Source, Region, SOC, Insurance, Status."
            storageKey="axiom_census"
            parseType="census"
          />
        </div>
 
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
              Open Drive &#8594;
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
 
