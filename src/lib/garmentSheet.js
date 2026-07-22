// =====================================================================
// garmentSheet.js
//
// The only place that interprets the "MASTER Garment Order Form
// (Responses)" workbook. Same rule as censusStatus.js and
// frequencyMath.js: one implementation, asserted in `npm run check`,
// never re-derived at a call site.
//
// Deliberately XLSX-FREE. Callers hand in an array-of-arrays (what
// `XLSX.utils.sheet_to_json(ws, {header:1})` produces), so this module
// stays pure and testable in node without pulling a parser into the
// assertion suite.
//
// WHY BY HEADER NAME, NOT COLUMN INDEX
// ------------------------------------
// LE has 51 columns, UE has 49, and they are NOT the same columns in the
// same order — UE asks "Has Axiom provided this patient with a garment in
// the past 6 months?" exactly where LE asks for a date. Index mapping
// silently writes the wrong value into the wrong field, which is worse
// than failing loudly. Measured trap: the LE address header contains the
// word "delivery" ("...not deemed safe for delivery of garment..."), so a
// loose match on "delivery" alone claims the ADDRESS column. Every needle
// set below is specific enough to avoid that, and columns are claimed
// once so a later loose match cannot steal an earlier specific one.
//
// KNOWN DATA-QUALITY FINDING (measured 2026-07-22, all 301 orders)
// ----------------------------------------------------------------
// "Delivery Date/copy and paste POD link here" is used for NEITHER. It
// holds 0 dates, 0 URLs, 6 filenames ("POD Joan Solomon.pdf"), 2 notes,
// and is blank 293 times. Order-to-delivery cycle time is therefore
// unmeasurable from this sheet. Whatever is present is preserved as
// `delivery_proof_url`; `delivery_date` stays null unless the cell truly
// parses as a date, because inventing one fabricates a cycle time.
// =====================================================================

export const GARMENT_SHEETS = ['LE garments', 'UE garments'];

const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/** Excel serial (or a date-ish string) -> YYYY-MM-DD, else null. */
export function toDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) return null;
    // Excel epoch: serial 25569 === 1970-01-01.
    const d = new Date(Math.round((v - 25569) * 86400000));
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = norm(v);
  let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    let [, mo, da, yr] = m;
    if (yr.length === 2) yr = '20' + yr;
    const mm = String(mo).padStart(2, '0');
    const dd = String(da).padStart(2, '0');
    if (+mm < 1 || +mm > 12 || +dd < 1 || +dd > 31) return null;
    return `${yr}-${mm}-${dd}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : null;
}

/** Excel serial -> ISO timestamp, for submission time. */
export function toTimestamp(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) return null;
    const d = new Date(Math.round((v - 25569) * 86400000));
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(norm(v));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** "$1,234.56" -> 1234.56. Never NaN — an unparseable cost is null. */
export function toMoney(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  const n = parseFloat(norm(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function toBool(v) {
  const s = norm(v).toLowerCase();
  if (!s) return null;
  if (/^(yes|true|y)\b/.test(s) || s === '1') return true;
  if (/^(no|false|n)\b/.test(s) || s === '0') return false;
  return null;
}

/**
 * Approval Status is free text typed by clinicians. Anything
 * unrecognised becomes 'pending', never dropped — an order with a
 * garbled status must still reach a human rather than vanish.
 */
export function toApproval(v) {
  const s = norm(v).toLowerCase();
  if (!s) return 'pending';
  if (s.includes('cancel')) return 'cancelled';
  if (s.includes('den') || s.includes('reject')) return 'denied';
  if (s.includes('approv')) return 'approved';
  return 'pending';
}

/** MM-DD-YYYY — the source_row_key format the June import already used. */
export function keyDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${m}-${d}-${y}`;
}

function makeResolver(headers) {
  const lower = (headers || []).map(h => norm(h).toLowerCase());
  const used = new Set();
  return function col(...needles) {
    for (let i = 0; i < lower.length; i++) {
      if (used.has(i)) continue;
      if (needles.every(n => lower[i].includes(n))) { used.add(i); return i; }
    }
    return -1;
  };
}

/**
 * Parse one sheet.
 *
 * @param {string} sheetName 'LE garments' | 'UE garments'
 * @param {Array<Array>} rows array-of-arrays, row 0 = headers
 * @returns {{rows: Array<Object>, problems: Array<string>}}
 */
export function parseGarmentSheet(sheetName, rows) {
  const problems = [];
  const out = [];
  if (!rows || rows.length < 2) {
    return { rows: out, problems: [`${sheetName}: no data rows`] };
  }
  const headers = rows[0] || [];
  const col = makeResolver(headers);

  // Claim order matters: specific before loose.
  const c = {
    timestamp:      col('timestamp'),
    email:          col('email address'),
    clinician:      col('clinician name'),
    insurance:      col('insurance'),
    region:         col('region'),
    patient:        col('patient name'),
    loc:            col('current level of care'),
    frequency:      col('current frequency'),
    phase:          col('phase of care'),
    address:        col('mailing address'),
    orderType:      col('order type'),
    dosage:         col('dosage'),
    etiology:       col('etiology'),
    orderForm:      col('completed order form'),
    accessories:    col('additional accessories'),
    supervisor:     col('supervisory clinician'),
    requestDate:    col('request date'),
    questions:      col('questions and comments'),
    approverEmail:  col('approver email'),
    approvalStatus: col('approval status'),
    approvalNotes:  col('approval comments'),
    statusChanged:  col('status change date'),
    authNo:         col('auth#'),
    authDate:       col('auth date'),
    authNeeded:     col('auth needed'),
    orderNo:        col('order#'),
    orderPlaced:    col('date order was placed'),
    garmentCode:    col('garment code'),
    garmentCost:    col('garment cost'),
    delivery:       col('delivery date'),
    comments:       col('comments'),
  };
  // Only the fields the pipeline genuinely depends on are worth halting
  // for; the rest degrade to null and are reported.
  const REQUIRED = ['patient', 'timestamp', 'approvalStatus'];
  const missing = Object.entries(c).filter(([, v]) => v === -1).map(([k]) => k);
  const missingRequired = missing.filter(k => REQUIRED.includes(k));
  if (missing.length) problems.push(`${sheetName}: unresolved columns -> ${missing.join(', ')}`);

  const limb = sheetName.toUpperCase().startsWith('UE') ? 'UE' : 'LE';
  const get = (r, i) => (i === -1 ? '' : r[i]);

  for (const r of rows.slice(1)) {
    if (!r) continue;
    const patient = norm(get(r, c.patient));
    const submitted = toTimestamp(get(r, c.timestamp));
    if (!patient && !submitted) continue;                 // blank row
    if (!patient) { problems.push(`${sheetName}: a row has a timestamp but no patient name - skipped`); continue; }

    const requestDate = toDate(get(r, c.requestDate));
    const keyBasis = requestDate || (submitted ? submitted.slice(0, 10) : null);
    const deliveryRaw = norm(get(r, c.delivery));
    const deliveryDate = toDate(deliveryRaw);

    out.push({
      source_row_key: `${patient} | ${keyDate(keyBasis)}`,
      limb_type: limb,
      patient_name: patient,
      region: norm(get(r, c.region)) || null,
      insurance: norm(get(r, c.insurance)) || null,
      patient_address: norm(get(r, c.address)) || null,
      clinician_name: norm(get(r, c.clinician)) || null,
      clinician_email: norm(get(r, c.email)) || null,
      approver_email: norm(get(r, c.approverEmail)) || null,
      approver_name: norm(get(r, c.supervisor)) || null,
      current_loc: norm(get(r, c.loc)) || null,
      current_frequency: norm(get(r, c.frequency)) || null,
      phase_of_care: norm(get(r, c.phase)) || null,
      order_type: norm(get(r, c.orderType)) || null,
      dosage: norm(get(r, c.dosage)) || null,
      etiology: norm(get(r, c.etiology)) || null,
      order_form_url: norm(get(r, c.orderForm)) || null,
      additional_items: norm(get(r, c.accessories)) || null,
      field_request_date: requestDate,
      clinical_approval_status: toApproval(get(r, c.approvalStatus)),
      clinical_approval_comments: norm(get(r, c.approvalNotes)) || null,
      status_change_date: toTimestamp(get(r, c.statusChanged)),
      auth_number: norm(get(r, c.authNo)) || null,
      auth_date: toDate(get(r, c.authDate)),
      auth_needed: toBool(get(r, c.authNeeded)),
      order_number: norm(get(r, c.orderNo)) || null,
      order_placed_date: toDate(get(r, c.orderPlaced)),
      garment_code: norm(get(r, c.garmentCode)) || null,
      garment_cost: toMoney(get(r, c.garmentCost)),
      delivery_date: deliveryDate,
      delivery_proof_url: deliveryRaw && !deliveryDate ? deliveryRaw : null,
      notes: [norm(get(r, c.questions)), norm(get(r, c.comments))].filter(Boolean).join(' | ') || null,
      submitted_at: submitted,
    });
  }

  return { rows: out, problems, missingRequired };
}

/**
 * Parse both sheets and collapse duplicate source keys (last wins).
 *
 * @param {Object} sheets { 'LE garments': rows, 'UE garments': rows }
 */
export function parseGarmentWorkbook(sheets) {
  const problems = [];
  const all = [];
  let missingRequired = [];
  for (const name of GARMENT_SHEETS) {
    const rows = sheets ? sheets[name] : null;
    if (!rows) { problems.push(`sheet not found: ${name}`); continue; }
    const res = parseGarmentSheet(name, rows);
    all.push(...res.rows);
    problems.push(...res.problems);
    if (res.missingRequired && res.missingRequired.length) {
      missingRequired = missingRequired.concat(res.missingRequired.map(k => `${name}.${k}`));
    }
  }
  // A form can be resubmitted for the same patient and request date; the
  // later row is the corrected one.
  const byKey = new Map();
  let duplicates = 0;
  for (const row of all) {
    if (byKey.has(row.source_row_key)) duplicates++;
    byKey.set(row.source_row_key, row);
  }
  const rows = Array.from(byKey.values());
  return {
    rows,
    problems,
    missingRequired,
    stats: {
      parsed: all.length,
      unique: rows.length,
      duplicates,
      le: rows.filter(r => r.limb_type === 'LE').length,
      ue: rows.filter(r => r.limb_type === 'UE').length,
      pending: rows.filter(r => r.clinical_approval_status === 'pending').length,
      approved: rows.filter(r => r.clinical_approval_status === 'approved').length,
      withCost: rows.filter(r => r.garment_cost != null).length,
      withOrderNumber: rows.filter(r => r.order_number).length,
      withAuth: rows.filter(r => r.auth_number).length,
      withDelivery: rows.filter(r => r.delivery_date).length,
      withDeliveryProof: rows.filter(r => r.delivery_proof_url).length,
      totalCost: Math.round(rows.reduce((s, r) => s + (r.garment_cost || 0), 0) * 100) / 100,
    },
  };
}
