import { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import TopBar from '../../components/TopBar';

function parseXLSXFile(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, {
    type: 'array',
    cellDates: false,
    cellFormula: false,
    cellNF: false,
    sheetStubs: false,
    raw: true,
  });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('No sheet found');

  // Strip formula cells (Pariox =right() formulas in Region col)
  const ref = ws['!ref'];
  if (ref) {
    const range = XLSX.utils.decode_range(ref);
    for (let R = range.s.r; R <= range.e.r; R++) {
      for (let C = range.s.c; C <= range.e.c; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        const cell = ws[addr];
        if (cell && cell.f) {
          ws[addr] = cell.v !== undefined
            ? { v: String(cell.v), t: 's' }
            : { v: '', t: 's' };
        }
      }
    }
  }
  return XLSX.utils.sheet_to_csv(ws, { blankrows: false });
}

function parseVisitCSV(csv) {
  const lines = csv.split('\n').filter(l => l.trim());
  const rows = lines.slice(1); // skip header
  return rows.map(line => {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    return {
      patient_name: cols[0] || '',
      address:      cols[1] || '',
      ref_source:   cols[2] || '',
      region: (() => {
  const raw = (cols[3] || '').trim();
  // Extract single letter — take last character if multi-char, or the value itself
  const single = raw.slice(-1).toUpperCase();
  return /^[A-Z]$/.test(single) ? single : raw.toUpperCase();
})(),
      discipline:   cols[4] || '',
      staff_name:   cols[5] || '',
      event_type:   cols[6] || '',
      raw_date:     cols[7] || '',
      visit_time:   cols[8] || '',
      insurance:    cols[9] || '',
      status:       cols[10] || '',
      notes:        cols[11] || '',
    };
  }).filter(r => r.patient_name);
}

function parseCensusCSV(csv) {
  const lines = csv.split('\n').filter(l => l.trim());
  const rows = lines.slice(1); // skip header
  return rows.map(line => {
    // Handle quoted CSV fields properly
    const cols = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQuotes = !inQuotes; }
      else if (line[i] === ',' && !inQuotes) { cols.push(current.trim()); current = ''; }
      else { current += line[i]; }
    }
    cols.push(current.trim());

    // A=Patient, B=Address, C=Disc, D=RefSource, E=Region, F=SOC, G=Insurance, H=Status
    return {
      patient_name: cols[0] || '',
      address:      cols[1] || '',
      discipline:   cols[2] || '',
      ref_source:   cols[3] || '',
      region:       (cols[4] || '').toUpperCase().trim(),
      insurance:    cols[6] || '',
      status:       cols[7] || 'active',
    };
  }).filter(r => r.patient_name && r.patient_name.trim());
}

function UploadCard({ title, description, storageKey, parseType, onSuccess }) {
  const [status, setStatus] = useState('idle'); // idle | loading | success | error
  const [message, setMessage] = useState('');
  const [count, setCount] = useState(0);
  const inputRef = useRef();

  function handleFile(file) {
    if (!file) return;
    setStatus('loading');
    setMessage('');

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const csv = parseXLSXFile(e.target.result);
        const data = parseType === 'visits' ? parseVisitCSV(csv) : parseCensusCSV(csv);
        localStorage.setItem(storageKey, JSON.stringify(data));
        setCount(data.length);
        setStatus('success');
        setMessage(`${data.length} records loaded successfully`);
        if (onSuccess) onSuccess(data);
      } catch (err) {
        setStatus('error');
        setMessage(`Error: ${err.message}`);
      }
    };
    reader.onerror = () => {
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

  const existing = (() => {
    try {
      const d = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return Array.isArray(d) ? d.length : 0;
    } catch { return 0; }
  })();

  return (
    <div style={cardStyles.card}>
      <div style={cardStyles.header}>
        <div>
          <div style={cardStyles.title}>{title}</div>
          <div style={cardStyles.desc}>{description}</div>
        </div>
        {(existing > 0 || status === 'success') && (
          <div style={cardStyles.badge}>
            {status === 'success' ? count : existing} records loaded
          </div>
        )}
      </div>

      <div
        style={{
          ...cardStyles.dropZone,
          borderColor: status === 'loading' ? 'var(--blue)'
            : status === 'success' ? 'var(--green)'
            : status === 'error' ? 'var(--danger)'
            : 'var(--border)',
        }}
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleChange}
          style={{ display: 'none' }}
        />
        {status === 'loading' ? (
          <div style={cardStyles.dropText}>Processing...</div>
        ) : status === 'success' ? (
          <div style={{ color: 'var(--green)', fontWeight: 600 }}>✓ {message}</div>
        ) : status === 'error' ? (
          <div style={{ color: 'var(--danger)' }}>{message}</div>
        ) : (
          <>
            <div style={cardStyles.dropIcon}>📄</div>
            <div style={cardStyles.dropText}>Drop .xlsx file here or click to browse</div>
            <div style={cardStyles.dropSub}>Pariox export only</div>
          </>
        )}
      </div>

      {(status === 'success' || existing > 0) && (
        <button onClick={clearData} style={cardStyles.clearBtn}>
          Clear data
        </button>
      )}
    </div>
  );
}

export default function UploadsPage() {
  const [driveLink, setDriveLink] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem('axiom_drive_links') || '{}');
      return s.main || '';
    } catch { return ''; }
  });

  function saveDriveLink() {
    localStorage.setItem('axiom_drive_links', JSON.stringify({ main: driveLink }));
    alert('Drive link saved.');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar
        title="Data Uploads"
        subtitle="Upload Pariox exports to populate the platform"
      />

      <div style={{ padding: '28px', flex: 1 }}>
        <div style={styles.grid}>
          <UploadCard
            title="Visit Schedule"
            description="Upload the Pariox visit schedule export (.xlsx). Columns: Patient, Address, Ref Source, Region, Discipline, Staff, Event, Date, Time, Insurance, Status, Notes."
            storageKey="axiom_pariox_data"
            parseType="visits"
          />
          <UploadCard
            title="Patient Census"
            description="Upload the Pariox patient census export (.xlsx). Must include patient name, region, insurance, and status columns."
            storageKey="axiom_census"
            parseType="census"
          />
        </div>

        {/* Google Drive Link */}
        <div style={styles.driveCard}>
          <div style={styles.driveTitle}>Google Drive Link</div>
          <div style={styles.driveDesc}>Paste your shared Google Drive folder link for team access to documents.</div>
          <div style={styles.driveRow}>
            <input
              type="url"
              value={driveLink}
              onChange={e => setDriveLink(e.target.value)}
              placeholder="https://drive.google.com/drive/folders/..."
              style={styles.driveInput}
            />
            <button onClick={saveDriveLink} style={styles.driveBtn}>Save</button>
          </div>
          {driveLink && (
            <a href={driveLink} target="_blank" rel="noopener noreferrer" style={styles.driveOpen}>
              Open Drive →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
    gap: '20px',
    marginBottom: '24px',
  },
  driveCard: {
    background: 'var(--card-bg)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    padding: '24px',
  },
  driveTitle: { fontSize: '15px', fontWeight: '600', color: 'var(--black)', marginBottom: '4px' },
  driveDesc: { fontSize: '13px', color: 'var(--gray)', marginBottom: '16px' },
  driveRow: { display: 'flex', gap: '10px' },
  driveInput: {
    flex: 1,
    padding: '10px 14px',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    fontSize: '13px',
    background: 'var(--bg)',
    color: 'var(--black)',
    outline: 'none',
  },
  driveBtn: {
    padding: '10px 20px',
    background: 'var(--red)',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  driveOpen: {
    display: 'inline-block',
    marginTop: '12px',
    fontSize: '13px',
    color: 'var(--blue)',
    textDecoration: 'none',
  },
};

const cardStyles = {
  card: {
    background: 'var(--card-bg)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    padding: '24px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '16px',
  },
  title: { fontSize: '15px', fontWeight: '600', color: 'var(--black)', marginBottom: '4px' },
  desc: { fontSize: '12px', color: 'var(--gray)', lineHeight: 1.5, maxWidth: '320px' },
  badge: {
    background: '#ECFDF5',
    color: 'var(--green)',
    border: '1px solid #A7F3D0',
    borderRadius: '999px',
    padding: '3px 10px',
    fontSize: '11px',
    fontWeight: '600',
    whiteSpace: 'nowrap',
  },
  dropZone: {
    border: '2px dashed',
    borderRadius: '10px',
    padding: '32px',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'all 0.15s',
    background: 'var(--bg)',
  },
  dropIcon: { fontSize: '28px', marginBottom: '8px' },
  dropText: { fontSize: '14px', fontWeight: '500', color: 'var(--black)', marginBottom: '4px' },
  dropSub: { fontSize: '12px', color: 'var(--gray)' },
  clearBtn: {
    marginTop: '12px',
    background: 'none',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    padding: '6px 14px',
    fontSize: '12px',
    color: 'var(--gray)',
    cursor: 'pointer',
  },
};
