import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import TopBar from '../../components/TopBar';
 
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
 
function parseVisitCSV(csv) {
  var lines = csv.split('\n').filter(function(l) { return l.trim(); });
  var rows = lines.slice(1);
  return rows.map(function(line) {
    var cols = parseCSVLine(line);
    var region = (function() {
      var raw = (cols[3] || '').trim();
      var single = raw.slice(-1).toUpperCase();
      return /^[A-Z]$/.test(single) ? single : raw.toUpperCase();
    })();
    return {
      patient_name: cols[0] || '',
      address: cols[1] || '',
      ref_source: cols[2] || '',
      region: region,
      discipline: cols[4] || '',
      staff_name: cols[5] || '',
      event_type: cols[6] || '',
      raw_date: cols[7] || '',
      visit_time: cols[8] || '',
      insurance: cols[9] || '',
      status: cols[10] || '',
      notes: cols[11] || '',
    };
  }).filter(function(r) { return r.patient_name; });
}
 
function parseCensusCSV(csv) {
  var lines = csv.split('\n').filter(function(l) { return l.trim(); });
  var rows = lines.slice(1);
  return rows.map(function(line) {
    var cols = parseCSVLine(line);
    return {
      patient_name: cols[0] || '',
      address: cols[1] || '',
      discipline: cols[2] || '',
      ref_source: cols[3] || '',
      region: (cols[4] || '').toUpperCase().trim(),
      insurance: cols[6] || '',
      status: cols[7] || 'active',
    };
  }).filter(function(r) { return r.patient_name && r.patient_name.trim(); });
}
 
function UploadCard(props) {
  var title = props.title;
  var description = props.description;
  var storageKey = props.storageKey;
  var parseType = props.parseType;
  var onSuccess = props.onSuccess;
 
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
        var data = parseType === 'visits' ? parseVisitCSV(csv) : parseCensusCSV(csv);
        localStorage.setItem(storageKey, JSON.stringify(data));
        setCount(data.length);
        setStatus('success');
        setMessage(data.length + ' records loaded successfully');
        if (onSuccess) onSuccess(data);
      } catch (err) {
        setStatus('error');
        setMessage('Error: ' + err.message);
      }
    };
    reader.onerror = function() {
      setStatus('error');
      setMessage('Failed to read file');
    };
    reader.readAsArrayBuffer(file);
  }
 
  function handleDrop(e) {
    e.preventDefault();
    handleFile(e.dataTransfer.files[0]);
  }
 
  function handleChange(e) {
    handleFile(e.target.files[0]);
  }
 
  function clearData() {
    localStorage.removeItem(storageKey);
    setStatus('idle');
    setMessage('');
    setCount(0);
    if (inputRef.current) inputRef.current.value = '';
  }
 
  var existing = (function() {
    try {
      var d = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return Array.isArray(d) ? d.length : 0;
    } catch (e) { return 0; }
  })();
 
  var borderColor = status === 'loading' ? 'var(--blue)' : status === 'success' ? 'var(--green)' : status === 'error' ? 'var(--danger)' : 'var(--border)';
 
  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--black)', marginBottom: 4 }}>{title}</div>
          <div style={{ fontSize: 12, color: 'var(--gray)', lineHeight: 1.5, maxWidth: 320 }}>{description}</div>
        </div>
        {(existing > 0 || status === 'success') && (
          <div style={{ background: '#ECFDF5', color: 'var(--green)', border: '1px solid #A7F3D0', borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
            {status === 'success' ? count : existing} records loaded
          </div>
        )}
      </div>
      <div style={{ border: '2px dashed ' + borderColor, borderRadius: 10, padding: 32, textAlign: 'center', cursor: 'pointer', background: 'var(--bg)' }}
        onDrop={handleDrop}
        onDragOver={function(e) { e.preventDefault(); }}
        onClick={function() { if (inputRef.current) inputRef.current.click(); }}>
        <input ref={inputRef} type="file" accept=".xlsx,.xls" onChange={handleChange} style={{ display: 'none' }} />
        {status === 'loading'
          ? <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--black)' }}>Processing...</div>
          : status === 'success'
          ? <div style={{ color: 'var(--green)', fontWeight: 600 }}>&#10003; {message}</div>
          : status === 'error'
          ? <div style={{ color: 'var(--danger)' }}>{message}</div>
          : (
            <div>
              <div style={{ fontSize: 28, marginBottom: 8 }}>&#128196;</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--black)', marginBottom: 4 }}>Drop .xlsx file here or click to browse</div>
              <div style={{ fontSize: 12, color: 'var(--gray)' }}>Pariox export only</div>
            </div>
          )
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
    try {
      var s = JSON.parse(localStorage.getItem('axiom_drive_links') || '{}');
      return s.main || '';
    } catch (e) { return ''; }
  });
 
  function saveDriveLink() {
    localStorage.setItem('axiom_drive_links', JSON.stringify({ main: driveLink }));
    alert('Drive link saved.');
  }
 
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Data Uploads" subtitle="Upload Pariox exports to populate the platform" />
      <div style={{ padding: 28, flex: 1 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20, marginBottom: 24 }}>
          <UploadCard
            title="Visit Schedule"
            description="Upload the Pariox visit schedule export (.xlsx). Columns: Patient, Address, Ref Source, Region, Discipline, Staff, Event, Date, Time, Insurance, Status, Notes."
            storageKey="axiom_pariox_data"
            parseType="visits"
          />
          <UploadCard
            title="Patient Census"
            description="Upload the Pariox patient census export (.xlsx). Columns: Patient, Address, Disc, Ref Source, Region, SOC, Insurance, Status."
            storageKey="axiom_census"
            parseType="census"
          />
        </div>
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--black)', marginBottom: 4 }}>Google Drive Link</div>
          <div style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 16 }}>Paste your shared Google Drive folder link for team access to documents.</div>
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
 
