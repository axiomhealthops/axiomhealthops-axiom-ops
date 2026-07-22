// =====================================================================
// exportSheet.js
//
// Shared spreadsheet export. Extracted from ReportsExportPage 2026-07-22
// when the Productivity report needed the same thing — a third
// copy-paste of `XLSX.utils.book_new()` is how column widths, date
// handling and CSV quoting drift apart between reports that are supposed
// to look identical.
//
// XLSX for Excel; CSV for Google Sheets, which imports it cleanly via
// File > Import. Both are offered everywhere rather than guessing which
// one a given person wants.
// =====================================================================
import * as XLSX from 'xlsx';

/** Column widths sized to the header, so nothing renders as ####. */
function colWidths(rows) {
  const first = rows[0] || {};
  return Object.keys(first).map(k => {
    let widest = k.length;
    for (const r of rows) {
      const v = r[k] == null ? '' : String(r[k]);
      if (v.length > widest) widest = v.length;
    }
    // Capped so one long note column does not push everything off screen.
    return { wch: Math.min(Math.max(widest + 2, 12), 50) };
  });
}

/**
 * Download an array of flat objects as .xlsx.
 * Keys of the first row become the header, so callers should build rows
 * in the display order they want.
 */
export function exportXLSX(rows, sheetName, filename) {
  if (!rows || rows.length === 0) return false;
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = colWidths(rows);
  // Excel rejects sheet names over 31 chars or containing : \ / ? * [ ]
  const safeSheet = String(sheetName || 'Sheet1').replace(/[:\\/?*[\]]/g, '-').slice(0, 31);
  XLSX.utils.book_append_sheet(wb, ws, safeSheet);
  XLSX.writeFile(wb, filename + '.xlsx');
  return true;
}

/** Download the same rows as .csv — the Google Sheets path. */
export function exportCSV(rows, filename) {
  if (!rows || rows.length === 0) return false;
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    // A leading =, +, - or @ makes Excel and Sheets evaluate the cell as
    // a formula. Prefix with a quote so exported data is never executed.
    const safe = /^[=+\-@]/.test(s) ? "'" + s : s;
    return /[",\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
  };
  const csv = [headers.join(',')]
    .concat(rows.map(r => headers.map(h => esc(r[h])).join(',')))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}

/** Timestamp suffix so repeated exports do not overwrite each other. */
export function fileStamp(date) {
  const d = date || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
