// =====================================================================
// parse-garment-sheet.mjs        node scripts/parse-garment-sheet.mjs <file.xlsx>
//
// Command-line preview of the MASTER Garment Order Form workbook. Uses
// src/lib/garmentSheet.js — the SAME parser the in-app upload card runs,
// so a number seen here is the number the import will write. Keeping a
// second copy of the mapping in a script is how the local
// `TARGETS = {ft:25...}` map on the Productivity page came to disagree
// with the database for eleven people.
//
// READ ONLY. Prints a summary; never touches the database.
// =====================================================================
import XLSX from 'xlsx';
import { parseGarmentWorkbook, GARMENT_SHEETS } from '../src/lib/garmentSheet.js';

const file = process.argv[2];
if (!file) { console.error('usage: parse-garment-sheet.mjs <file.xlsx>'); process.exit(1); }

const wb = XLSX.readFile(file);
const sheets = {};
for (const name of GARMENT_SHEETS) {
  if (wb.Sheets[name]) sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
}

const { rows, problems, stats } = parseGarmentWorkbook(sheets);

console.log(`parsed rows            : ${stats.parsed}`);
console.log(`unique orders          : ${stats.unique}   (${stats.duplicates} resubmissions collapsed)`);
console.log(`  LE / UE              : ${stats.le} / ${stats.ue}`);
console.log(`  pending approval     : ${stats.pending}`);
console.log(`  approved             : ${stats.approved}`);
console.log(`  with cost            : ${stats.withCost}   ($${stats.totalCost.toLocaleString()})`);
console.log(`  with order number    : ${stats.withOrderNumber}`);
console.log(`  with auth number     : ${stats.withAuth}`);
console.log(`  with DELIVERY DATE   : ${stats.withDelivery}`);
console.log(`  with delivery proof  : ${stats.withDeliveryProof}`);

const dated = rows.map(r => r.submitted_at).filter(Boolean).sort();
if (dated.length) console.log(`  submissions span     : ${dated[0].slice(0,10)} -> ${dated[dated.length-1].slice(0,10)}`);

if (problems.length) {
  console.log('\nPROBLEMS:');
  problems.slice(0, 20).forEach(p => console.log('  -', p));
  if (problems.length > 20) console.log(`  ... +${problems.length - 20} more`);
}
