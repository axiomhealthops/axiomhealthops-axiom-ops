// EdemaCare Auth Request Form - PDF renderer (jsPDF, client-side).
// Design doc: docs/Auth_Request_Form_Design.md (rev 2).
//
// Renders a polished, fax-readable PDF that includes:
//   PAGE 1: HIPAA-compliant fax cover sheet with EdemaCare contact info,
//           From/To/Date/Pages/Subject, and the full HIPAA confidentiality
//           notice required for transmissions containing PHI.
//   PAGE 2+: The authorization request (or service order) itself, mirroring
//           the static Humana/CarePlus/FHCP layout the team used historically.
//
// Brand rules (CLAUDE.md):
//   - Visible strings say "EdemaCare"
//   - Legal-line footer: "EdemaCare is a service of AxiomHealth Management LLC"
//   - Body kept B&W for fax readability; brand color only on rules
//
// Contact info is loaded from the clinic_settings table on every render so
// admins can update it without redeploying. If any required value is still
// the placeholder string, the cover sheet renders a loud yellow banner so
// an auth coordinator cannot accidentally fax placeholder values to a PCP.

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from './supabase';

const BRAND_RED = [217, 79, 43]; // #D94F2B
const BLACK     = [26, 26, 26];
const GRAY      = [107, 114, 128];
const LIGHT     = [240, 228, 224];
const WARN_BG   = [254, 243, 199];
const WARN_FG   = [146, 64, 14];

const PLACEHOLDER_TOKEN = '[CONFIGURE IN SETTINGS]';

// Request-type variants. Drives the document title, an optional physician-of-
// record line, and the signature block. 2026-06 (Liam): four request types.
const REQUEST_TYPE_META = {
  new_patient:  { label: 'New Patient Authorization Request', title: 'Authorization Request / Physician Order',   physician: '' },
  resumption:   { label: 'Resumption Order',                  title: 'Resumption of Care Authorization Request',  physician: '' },
  coc:          { label: 'Continuation of Care (COC)',        title: 'Continuation of Care Authorization Request', physician: '' },
  wound_care:   { label: 'Wound Care Request',                title: 'Wound Care Authorization Request',           physician: '' },
  garment:      { label: 'Garment Authorization Request',     title: 'Garment Authorization Request',              physician: '' },
  // legacy alias (pre-2026-06 forms saved with request_type='continuation')
  continuation: { label: 'Continuation of Care (COC)',        title: 'Continuation of Care Authorization Request', physician: 'David Harbour, MD' },
};
export function requestMeta(rt) { return REQUEST_TYPE_META[rt] || REQUEST_TYPE_META.new_patient; }

function safe(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + 'T00:00:00') : new Date(iso);
  if (isNaN(d.getTime())) return safe(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return safe(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function loadLogoDataUrl() {
  return fetch('/logo.png')
    .then(r => r.ok ? r.blob() : null)
    .then(blob => {
      if (!blob) return null;
      return new Promise(resolve => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => resolve(null);
        fr.readAsDataURL(blob);
      });
    })
    .catch(() => null);
}

// Load clinic contact info from clinic_settings. Returns { phone, fax,
// email, website, npi, tax_id, street, city_state_zip, clinic_name,
// legal_entity, missingRequired:[...] } so the renderer can show a warning
// banner if any required field is still the placeholder.
async function loadClinicSettings() {
  const defaults = {
    clinic_name:          'EdemaCare',
    legal_entity:         'AxiomHealth Management LLC',
    clinic_phone:         PLACEHOLDER_TOKEN,
    clinic_fax:           PLACEHOLDER_TOKEN,
    clinic_email:         PLACEHOLDER_TOKEN,
    clinic_website:       'edemacare.com',
    clinic_npi:           PLACEHOLDER_TOKEN,
    clinic_tax_id:        PLACEHOLDER_TOKEN,
    clinic_street:        PLACEHOLDER_TOKEN,
    clinic_city_state_zip: PLACEHOLDER_TOKEN,
  };
  try {
    const { data, error } = await supabase
      .from('clinic_settings')
      .select('setting_key, setting_value, is_required');
    if (error) throw error;
    const settings = { ...defaults };
    const missing = [];
    (data || []).forEach(r => {
      settings[r.setting_key] = (r.setting_value && r.setting_value.trim()) || PLACEHOLDER_TOKEN;
      if (r.is_required && (!r.setting_value || r.setting_value === PLACEHOLDER_TOKEN || !r.setting_value.trim())) {
        missing.push(r.setting_key);
      }
    });
    settings.missingRequired = missing;
    return settings;
  } catch (e) {
    console.warn('[loadClinicSettings] using defaults', e?.message || e);
    return {
      ...defaults,
      missingRequired: Object.keys(defaults).filter(k => defaults[k] === PLACEHOLDER_TOKEN),
    };
  }
}

// Format a token as "(XXX) XXX-XXXX" if it looks like 10 digits, else as-is.
function fmtPhone(s) {
  if (!s || s === PLACEHOLDER_TOKEN) return s || '';
  const digits = String(s).replace(/\D/g, '');
  if (digits.length === 10) {
    return '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6);
  }
  return String(s);
}

// Main entry point. `form` is the auth_request_forms row shape.
// Optional `opts.includeCoverSheet` (default true) to skip the cover.
// Returns a jsPDF instance the caller can .save() or .output() on.
export async function buildAuthRequestPdf(form, opts = {}) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const includeCover = opts.includeCoverSheet !== false;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36; // 0.5" margins

  const isOrderOnly = form.requires_prior_auth === false;
  // 2026-06 (Liam): request-type drives the title. The form doubles as a
  // physician order, so a standard new-patient request to a payor that does
  // not require prior auth falls back to the Service Order title.
  const rt = form.request_type || (form.form_data || {}).request_type || 'new_patient';
  const meta = requestMeta(rt);
  const docTitle = (rt === 'new_patient' && isOrderOnly)
    ? 'Service Order / Physician Order'
    : meta.title;
  // Dr. Harbour signs Continuation-of-Care requests for FHCP specifically.
  const isFHCP = /florida health|fhcp/i.test(form.insurance_name || '');
  const physicianOfRecord = ((rt === 'coc' || rt === 'continuation') && isFHCP)
    ? 'David Harbour, MD'
    : (meta.physician || '');

  const [logoDataUrl, clinic] = await Promise.all([
    loadLogoDataUrl(),
    loadClinicSettings(),
  ]);

  const fd = form.form_data || {};

  // -----------------------------------------------------------------
  // PAGE 1: HIPAA cover sheet
  // -----------------------------------------------------------------
  if (includeCover) {
    drawCoverSheet({ doc, W, H, M, clinic, logoDataUrl, form, fd, docTitle, isOrderOnly });
    doc.addPage();
  }

  // -----------------------------------------------------------------
  // PAGE 2: Authorization Request / Physician Order body
  //
  // 2026-06-04 (Liam): rebuilt to fit on one page with PCP signature
  // block + memo section. Layout strategy:
  //   - Section headers 9pt (was 10), reduced to 12pt gap
  //   - Label 7pt / value 9pt (was 8/10), 13pt row pitch (was 28pt)
  //   - Compact 2-column CPT table, no category col
  //   - Optional sections (medicaid id, secondary ins, diagnosis_description,
  //     additional_notes, etc) only render when populated
  //   - Bottom: memo block + PCP signature box with Signature, Printed
  //     Name, Title, Date for wet-signature return
  // -----------------------------------------------------------------
  drawHeader({ doc, W, M, logoDataUrl, title: docTitle, formId: form.id });

  let y = M + 60;

  // Compact section header.
  function section(label) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...BRAND_RED);
    doc.text(String(label).toUpperCase(), M, y);
    doc.setDrawColor(...LIGHT);
    doc.setLineWidth(0.4);
    doc.line(M, y + 2, W - M, y + 2);
    y += 12;
    doc.setTextColor(...BLACK);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
  }

  // Compact 2-column row. 13pt total height (was 28pt). Label 7pt + value 9pt
  // on the same line (label, value).
  function row(pairs) {
    const colW = (W - 2 * M) / 2;
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    doc.text(safe(pairs[0][0]).toUpperCase(), M, y);
    if (pairs[1]) doc.text(safe(pairs[1][0]).toUpperCase(), M + colW, y);
    doc.setFontSize(9);
    doc.setTextColor(...BLACK);
    doc.text(safe(pairs[0][1]) || '-', M, y + 10);
    if (pairs[1]) doc.text(safe(pairs[1][1]) || '-', M + colW, y + 10);
    y += 18;
  }

  // Tight free-text block (label on its own line, value wrapped below).
  function block(label, value, maxLines) {
    if (!value) return;
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    doc.text(safe(label).toUpperCase(), M, y);
    y += 9;
    doc.setFontSize(9);
    doc.setTextColor(...BLACK);
    let wrapped = doc.splitTextToSize(safe(value), W - 2 * M);
    if (maxLines && wrapped.length > maxLines) {
      wrapped = wrapped.slice(0, maxLines);
      // ellipsis marker on the last line
      const last = wrapped[wrapped.length - 1];
      wrapped[wrapped.length - 1] = (last.length > 5 ? last.slice(0, last.length - 3) : last) + '...';
    }
    doc.text(wrapped, M, y);
    y += wrapped.length * 10 + 4;
  }

  // Page-overflow guard. Manual jsPDF text does not auto-paginate, so before
  // drawing a block that must stay intact (memo, signature) we break to a new
  // page + redraw the body header if there isn't enough vertical room.
  function ensureSpace(needed) {
    if (y + needed > H - 56) {
      doc.addPage();
      drawHeader({ doc, W, M, logoDataUrl, title: docTitle, formId: form.id });
      y = M + 60;
    }
  }

  // ---- Patient ----
  section('Patient Information');
  row([['Patient Name', form.patient_name], ['DOB', fmtDate(form.patient_dob)]]);
  row([['Address', [fd.address, fd.city, fd.zip_code].filter(Boolean).join(', ')],
       ['Phone', fmtPhone(fd.phone)]]);

  // ---- Insurance ----
  section('Insurance');
  if (isOrderOnly) {
    doc.setFillColor(...WARN_BG);
    doc.rect(M, y - 2, W - 2 * M, 14, 'F');
    doc.setFontSize(8);
    doc.setTextColor(...BLACK);
    doc.text('Prior authorization not required for this payor; serves as Physician Order only.', M + 6, y + 8);
    y += 18;
  }
  row([['Insurance Carrier', form.insurance_name], ['Plan Type', form.insurance_type]]);
  row([['Member / Policy #', fd.member_id],
       ['Medicare Type / Medicaid ID', [fd.medicare_type, fd.medicaid_id].filter(Boolean).join(' / ')]]);
  if (fd.secondary_insurance) {
    row([['Secondary Insurance', fd.secondary_insurance], ['Secondary ID', fd.secondary_id]]);
  }

  // ---- Clinical ----
  section('Clinical');
  row([['Primary Diagnosis (ICD-10)', fd.diagnosis_code],
       ['Disciplines', (fd.disciplines || []).join(', ')]]);
  row([['Wounds Present', fd.wounds_present ? 'Yes' : 'No'],
       ['Wound Type / Location', fd.wound_type || '-']]);
  row([['PCP Name', fd.pcp_name],
       ['PCP Phone / Fax', [fmtPhone(fd.pcp_phone), fmtPhone(fd.pcp_fax)].filter(Boolean).join(' / ')]]);
  if (fd.pcp_facility || fd.requesting_provider) {
    row([['PCP Facility', fd.pcp_facility || '-'],
         ['Requesting Provider (NPI)', [fd.requesting_provider, fd.requesting_provider_npi].filter(Boolean).join(' / ')]]);
  }
  if (fd.diagnosis_description) block('Diagnosis Description', fd.diagnosis_description, 2);

  // ---- CPT codes (compact 2-column table) ----
  section('Service Codes Requested');
  const cpts = Array.isArray(fd.cpt_codes) ? fd.cpt_codes : [];
  if (cpts.length === 0) {
    doc.setFontSize(9);
    doc.setTextColor(...GRAY);
    doc.text('No CPT codes selected.', M, y + 4);
    y += 14;
  } else {
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [['CPT', 'Units', 'Visits', 'Mod', 'Description']],
      body: cpts.map(c => {
        const units  = (c.units != null && c.units !== '') ? c.units : '';
        const visits = (c.visits != null && c.visits !== '') ? c.visits
                       : (c.quantity != null && c.quantity !== '' ? c.quantity : '');
        return [
          safe(c.code),
          safe(units || '-'),
          safe(visits || '-'),
          safe(c.modifier || ''),
          safe(c.description),
        ];
      }),
      styles:      { fontSize: 8, cellPadding: 2, lineColor: LIGHT, lineWidth: 0.2 },
      headStyles:  { fillColor: BRAND_RED, textColor: 255, fontStyle: 'bold', fontSize: 8, halign: 'left' },
      columnStyles:{
        0: { cellWidth: 48, fontStyle: 'bold' },
        1: { cellWidth: 36, halign: 'center' },
        2: { cellWidth: 36, halign: 'center' },
        3: { cellWidth: 52, halign: 'center' },
      },
      alternateRowStyles: { fillColor: [251, 247, 246] },
      pageBreak: 'avoid',
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ---- Service Request ----
  section('Service Request');
  row([['Visits Requested', safe(fd.visits_requested)],
       ['Evaluations / Re-evals', [safe(fd.evals_requested), safe(fd.reassessments_requested)].filter(s => s && s !== '0').join(' / ') || '-']]);
  row([['Frequency / Duration', [fd.frequency, fd.duration].filter(Boolean).join(' x ') || '-'],
       ['Date Range', [fmtDate(fd.start_date), fmtDate(fd.end_date)].filter(Boolean).join(' - ') || '-']]);
  row([['Place of Service', fd.place_of_service || '12 - Home'],
       ['Submitted By', form.created_by_name || fd.created_by_name || '-']]);
  if (fd.clinical_justification) block('Clinical Justification', fd.clinical_justification, 3);
  if (fd.additional_notes)       block('Additional Notes',      fd.additional_notes, 2);

  // ---- Coordinator memo to PCP (why we are sending THIS request type) ----
  if (fd.memo_to_pcp) {
    ensureSpace(70);
    section('Memo to PCP Office');
    block('Reason for this ' + meta.label, fd.memo_to_pcp, 6);
  }

  // ---- Memo: what we need back from the PCP ----
  ensureSpace(80);
  // Right above the signature block - critical instruction for the PCP
  // so the returned fax has everything billing needs.
  section('Please Return to EdemaCare');
  doc.setFontSize(9);
  doc.setTextColor(...BLACK);
  const returnFax = fmtPhone(clinic.clinic_fax);
  const returnPhone = fmtPhone(clinic.clinic_phone);
  const memoLines = [
    'Fax to: ' + returnFax + '   |   Questions: ' + returnPhone,
    '   [_]  Signed Physician Order (signature, name, title, date below)',
    '   [_]  Authorization number once approved by ' + safe(form.insurance_name || 'the payor'),
    '   [_]  Any additional clinical documentation required by the payor',
  ];
  memoLines.forEach((line, i) => {
    if (i === 0) {
      doc.setFont('helvetica', 'bold');
    } else {
      doc.setFont('helvetica', 'normal');
    }
    doc.text(line, M, y + 4 + i * 11);
  });
  doc.setFont('helvetica', 'normal');
  y += 8 + memoLines.length * 11 + 4;

  // ---- PCP / Provider Acknowledgement & Signature ----
  ensureSpace(160);
  section('Provider Acknowledgement and Signature');
  doc.setFontSize(8);
  doc.setTextColor(...BLACK);
  doc.text(
    'By signing below, I certify that the services requested above are medically necessary for the named ' +
    'patient and are consistent with my plan of care. This signature serves as a Physician Order.',
    M, y + 2, { maxWidth: W - 2 * M }
  );
  y += 18;

  // Continuation-of-care requests for FHCP are signed by the physician of record.
  if (physicianOfRecord) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...BLACK);
    doc.text('Physician of Record: ' + physicianOfRecord, M, y);
    doc.setFont('helvetica', 'normal');
    y += 14;
  }

  // Signature box - 2 columns: Signature + Date on top row, Printed Name + Title on bottom row.
  const sigColW = (W - 2 * M) / 2;
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.6);
  // Top row lines (signature left, date right)
  doc.line(M,                y + 16, M + sigColW - 12,       y + 16);
  doc.line(M + sigColW,      y + 16, W - M,                  y + 16);
  doc.setFontSize(7);
  doc.setTextColor(...GRAY);
  doc.text('PROVIDER SIGNATURE',  M,           y + 26);
  doc.text('DATE',                M + sigColW, y + 26);
  // Bottom row (printed name, title)
  y += 36;
  doc.setDrawColor(...BLACK);
  doc.line(M,                y + 16, M + sigColW - 12,       y + 16);
  doc.line(M + sigColW,      y + 16, W - M,                  y + 16);
  doc.text('PRINTED NAME',        M,           y + 26);
  doc.text('TITLE',               M + sigColW, y + 26);
  y += 36;

  // EdemaCare authorized signature (left blank; signed at point of use).
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.6);
  doc.line(M,           y + 16, M + sigColW - 12, y + 16);
  doc.line(M + sigColW, y + 16, W - M,            y + 16);
  doc.setFontSize(7);
  doc.setTextColor(...GRAY);
  doc.text('EDEMACARE AUTHORIZED SIGNATURE', M,           y + 26);
  doc.text('DATE',                           M + sigColW, y + 26);
  y += 30;

  // -----------------------------------------------------------------
  // Footer on every page
  // -----------------------------------------------------------------
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LIGHT);
    doc.setLineWidth(0.5);
    doc.line(M, H - 44, W - M, H - 44);

    doc.setFontSize(8);
    doc.setTextColor(...GRAY);
    const contactLine =
      safe(clinic.clinic_name) +
      '  |  Phone: ' + fmtPhone(clinic.clinic_phone) +
      '  |  Fax: '   + fmtPhone(clinic.clinic_fax) +
      '  |  NPI: '   + safe(clinic.clinic_npi);
    doc.text(contactLine, M, H - 30);
    doc.text(safe(clinic.clinic_name) + ' is a service of ' + safe(clinic.legal_entity), M, H - 18);
    doc.text('Page ' + i + ' of ' + pageCount, W - M, H - 18, { align: 'right' });
  }

  return doc;
}

// =====================================================================
// HIPAA cover sheet renderer
// =====================================================================
function drawCoverSheet({ doc, W, H, M, clinic, logoDataUrl, form, fd, docTitle, isOrderOnly }) {
  // --- Letterhead / clinic identity (top) ---
  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, 'PNG', M, M, 110, 30); } catch (_) {}
  } else {
    doc.setFontSize(18);
    doc.setTextColor(...BRAND_RED);
    doc.setFont('helvetica', 'bold');
    doc.text(safe(clinic.clinic_name) || 'EdemaCare', M, M + 18);
  }

  // Right-side clinic contact block
  doc.setFontSize(9);
  doc.setTextColor(...BLACK);
  doc.setFont('helvetica', 'normal');
  const contactLines = [
    safe(clinic.clinic_street),
    safe(clinic.clinic_city_state_zip),
    'Phone: ' + fmtPhone(clinic.clinic_phone) + '   Fax: ' + fmtPhone(clinic.clinic_fax),
    'NPI: ' + safe(clinic.clinic_npi) + '   Tax ID: ' + safe(clinic.clinic_tax_id),
  ];
  if (clinic.clinic_email && clinic.clinic_email !== PLACEHOLDER_TOKEN) {
    contactLines.push('Email: ' + clinic.clinic_email);
  }
  if (clinic.clinic_website && clinic.clinic_website !== PLACEHOLDER_TOKEN) {
    contactLines.push('Web: ' + clinic.clinic_website);
  }
  contactLines.forEach((line, i) => {
    doc.text(line, W - M, M + 12 + i * 11, { align: 'right' });
  });

  // Brand divider
  doc.setDrawColor(...BRAND_RED);
  doc.setLineWidth(1.5);
  doc.line(M, M + 80, W - M, M + 80);

  // --- Big cover sheet title ---
  let y = M + 110;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...BLACK);
  doc.text('FAX COVER SHEET', W / 2, y, { align: 'center' });
  y += 8;
  doc.setFontSize(11);
  doc.setTextColor(...GRAY);
  doc.setFont('helvetica', 'normal');
  doc.text('Contains Protected Health Information - Handle in accordance with HIPAA', W / 2, y + 12, { align: 'center' });
  y += 32;

  // --- Configuration warning, if any required clinic field still placeholder ---
  if (Array.isArray(clinic.missingRequired) && clinic.missingRequired.length > 0) {
    doc.setFillColor(...WARN_BG);
    doc.setDrawColor(...WARN_FG);
    doc.setLineWidth(1);
    doc.rect(M, y, W - 2 * M, 56, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...WARN_FG);
    doc.text('DO NOT FAX - CLINIC CONTACT INFO NOT CONFIGURED', M + 12, y + 18);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const missingList = clinic.missingRequired.map(k => k.replace(/^clinic_/, '').replace(/_/g, ' ')).join(', ');
    const lines = doc.splitTextToSize(
      'These required values are still placeholders: ' + missingList +
      '. An admin must set them in clinic_settings before this form is sent to a PCP or payor.',
      W - 2 * M - 24
    );
    doc.text(lines, M + 12, y + 32);
    y += 70;
  }

  // --- From / To / Date / Pages / Subject block ---
  doc.setDrawColor(...LIGHT);
  doc.setLineWidth(0.5);
  doc.rect(M, y, W - 2 * M, 130, 'S');

  const colW = (W - 2 * M) / 2;
  function cell(label, value, x, yy) {
    doc.setFontSize(8);
    doc.setTextColor(...GRAY);
    doc.text(String(label).toUpperCase(), x + 10, yy + 14);
    doc.setFontSize(11);
    doc.setTextColor(...BLACK);
    doc.text(value || '-', x + 10, yy + 28);
  }

  // Row 1: TO / FROM
  cell('To',          safe(fd.pcp_facility) || safe(fd.pcp_name) || 'PCP Office',           M,         y);
  cell('From',        safe(clinic.clinic_name),                                            M + colW,   y);
  doc.setDrawColor(...LIGHT);
  doc.line(M, y + 42, W - M, y + 42);
  // sub-rows under TO
  doc.setFontSize(9);
  doc.setTextColor(...BLACK);
  if (fd.pcp_name)     doc.text('Attn: ' + fd.pcp_name,                          M + 10,        y + 56);
  if (fd.pcp_fax)      doc.text('Fax: '  + fmtPhone(fd.pcp_fax),                 M + 10,        y + 68);
  if (fd.pcp_phone)    doc.text('Phone: '+ fmtPhone(fd.pcp_phone),               M + 10,        y + 80);
  // sub-rows under FROM
  doc.text('Sender: ' + safe(form.created_by_name || 'EdemaCare Auth Team'),    M + colW + 10, y + 56);
  doc.text('Fax: '    + fmtPhone(clinic.clinic_fax),                            M + colW + 10, y + 68);
  doc.text('Phone: '  + fmtPhone(clinic.clinic_phone),                          M + colW + 10, y + 80);

  // Row 2: DATE / PAGES
  doc.line(M, y + 92, W - M, y + 92);
  cell('Date',  fmtDateTime(form.sent_at || form.created_at || new Date().toISOString()),
       M,         y + 90);
  cell('Pages', 'See document - includes this cover sheet', M + colW, y + 90);

  y += 144;

  // --- Subject line ---
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.text('SUBJECT', M, y);
  doc.setFontSize(12);
  doc.setTextColor(...BLACK);
  doc.setFont('helvetica', 'bold');
  const subject = docTitle + ' - ' + safe(form.patient_name) +
                  (form.patient_dob ? ' (DOB ' + fmtDate(form.patient_dob) + ')' : '');
  doc.text(subject, M, y + 14);
  doc.setFont('helvetica', 'normal');
  y += 36;

  // --- Brief message ---
  doc.setFontSize(10);
  doc.setTextColor(...BLACK);
  const messageBody = isOrderOnly
    ? 'Attached is a Service Order / Plan of Care Notification for the above-referenced patient. This document does not require prior authorization from the payor; it is provided to the PCP for clinical coordination and patient records. Please review and contact our office at the number above with any questions.'
    : 'Attached is an Authorization Request for the above-referenced patient. Please review the requested services and CPT codes listed on the following page. Return the signed and/or approved request to the fax number listed in the FROM block above. If you have questions or need additional clinical documentation, please contact our office at the number above.';
  const messageLines = doc.splitTextToSize(messageBody, W - 2 * M);
  doc.text(messageLines, M, y);
  y += messageLines.length * 12 + 16;

  // --- HIPAA confidentiality notice ---
  doc.setFontSize(9);
  doc.setTextColor(...BRAND_RED);
  doc.setFont('helvetica', 'bold');
  doc.text('CONFIDENTIALITY NOTICE', M, y);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...BLACK);
  y += 14;

  const hipaa = 'This facsimile transmission and any documents accompanying it may contain confidential, ' +
    'privileged, and legally protected health information intended solely for the use of the individual ' +
    'or entity named in the TO block above. Protected Health Information (PHI) is governed by the ' +
    'Health Insurance Portability and Accountability Act of 1996 (HIPAA), 45 CFR Parts 160 and 164. ' +
    'If you are not the intended recipient, you are hereby notified that any disclosure, copying, ' +
    'distribution, or use of the information contained in or transmitted with this facsimile is ' +
    'strictly prohibited. If you have received this transmission in error, please notify the sender ' +
    'immediately by telephone at ' + fmtPhone(clinic.clinic_phone) + ' and destroy this transmission ' +
    'along with any attachments. Thank you.';
  const hipaaLines = doc.splitTextToSize(hipaa, W - 2 * M);
  doc.setFontSize(9);
  doc.text(hipaaLines, M, y);
  y += hipaaLines.length * 11 + 16;

  // --- Form tracking ID for support calls ---
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.text('Form Tracking ID: ' + safe(form.id).slice(0, 8) + ' (reference if calling about this request)', M, H - 60);
}

// =====================================================================
// Body header (used by page 2+)
// =====================================================================
function drawHeader({ doc, W, M, logoDataUrl, title, formId }) {
  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, 'PNG', M, M, 110, 30); } catch (_) {}
  } else {
    doc.setFontSize(16);
    doc.setTextColor(...BRAND_RED);
    doc.setFont('helvetica', 'bold');
    doc.text('EdemaCare', M, M + 18);
  }
  doc.setFontSize(16);
  doc.setTextColor(...BLACK);
  doc.setFont('helvetica', 'bold');
  doc.text(title, W - M, M + 18, { align: 'right' });

  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.setFont('helvetica', 'normal');
  doc.text('Form ID ' + safe(formId).slice(0, 8), W - M, M + 32, { align: 'right' });
  doc.text('Generated ' + fmtDate(new Date().toISOString()), W - M, M + 42, { align: 'right' });

  doc.setDrawColor(...BRAND_RED);
  doc.setLineWidth(1.2);
  doc.line(M, M + 52, W - M, M + 52);
}

function categoryLabel(c) {
  switch (c) {
    case 'wound_care': return 'Wound Care';
    case 'lymphedema': return 'Lymphedema';
    case 'pt':         return 'Physical Therapy';
    case 'ot':         return 'Occupational Therapy';
    default:           return safe(c);
  }
}

export function downloadAuthRequestPdf(form, filename) {
  return buildAuthRequestPdf(form).then(doc => {
    const safeName = (form.patient_name || 'patient').replace(/[^a-zA-Z0-9_-]/g, '_');
    const fname = filename || ('AuthRequest_' + safeName + '_' + safe(form.id).slice(0, 8) + '.pdf');
    doc.save(fname);
  });
}
