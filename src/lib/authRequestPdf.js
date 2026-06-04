// EdemaCare Auth Request Form - PDF renderer (jsPDF, client-side).
// Design doc: docs/Auth_Request_Form_Design.md (rev 2).
//
// Renders a polished, fax-readable PDF mirroring the static
// Humana/CarePlus/FHCP layout the team has used historically, but now
// works for ALL payors EdemaCare services and switches title/addressee
// based on whether the carrier requires prior auth.
//
// Brand rules (CLAUDE.md):
//   - Visible strings say "EdemaCare"
//   - Legal-line footer: "EdemaCare is a service of AxiomHealth Management LLC"
//   - Keep body B&W for fax readability; brand color only on the rule

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const BRAND_RED = [217, 79, 43]; // #D94F2B
const BLACK     = [26, 26, 26];
const GRAY      = [107, 114, 128];
const LIGHT     = [240, 228, 224];

function safe(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function fmtDate(iso) {
  if (!iso) return '';
  // Avoid Date(timezone) drift by parsing YYYY-MM-DD as local
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + 'T00:00:00') : new Date(iso);
  if (isNaN(d.getTime())) return safe(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function loadLogoDataUrl() {
  // Embed /logo.png via fetch. Returns a Promise<string|null>.
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

// Main entry point. `form` is the auth_request_forms row shape.
// Returns a jsPDF instance the caller can .save() or .output() on.
export async function buildAuthRequestPdf(form) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36; // 0.5" margins

  const isOrderOnly = form.requires_prior_auth === false;
  const title = isOrderOnly
    ? 'Service Order / Plan of Care Notification'
    : 'Authorization Request';

  // ---- Header ----------------------------------------------------------
  const logoDataUrl = await loadLogoDataUrl();
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
  doc.text('Form ID ' + safe(form.id).slice(0, 8), W - M, M + 32, { align: 'right' });
  doc.text('Generated ' + fmtDate(new Date().toISOString()), W - M, M + 42, { align: 'right' });

  // Brand divider
  doc.setDrawColor(...BRAND_RED);
  doc.setLineWidth(1.2);
  doc.line(M, M + 52, W - M, M + 52);

  // ---- Body ------------------------------------------------------------
  const fd = form.form_data || {};
  let y = M + 72;

  function section(label) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...BRAND_RED);
    doc.text(String(label).toUpperCase(), M, y);
    doc.setDrawColor(...LIGHT);
    doc.setLineWidth(0.5);
    doc.line(M, y + 3, W - M, y + 3);
    y += 16;
    doc.setTextColor(...BLACK);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
  }

  function row(pairs) {
    // pairs = [[label, value], [label, value]] - two columns
    const colW = (W - 2 * M) / 2;
    doc.setFontSize(8);
    doc.setTextColor(...GRAY);
    doc.text(safe(pairs[0][0]).toUpperCase(), M, y);
    if (pairs[1]) doc.text(safe(pairs[1][0]).toUpperCase(), M + colW, y);
    doc.setFontSize(10);
    doc.setTextColor(...BLACK);
    doc.text(safe(pairs[0][1]) || '-', M, y + 12);
    if (pairs[1]) doc.text(safe(pairs[1][1]) || '-', M + colW, y + 12);
    y += 28;
  }

  function block(label, value) {
    doc.setFontSize(8);
    doc.setTextColor(...GRAY);
    doc.text(safe(label).toUpperCase(), M, y);
    y += 12;
    doc.setFontSize(10);
    doc.setTextColor(...BLACK);
    const wrapped = doc.splitTextToSize(safe(value) || '-', W - 2 * M);
    doc.text(wrapped, M, y);
    y += wrapped.length * 12 + 6;
  }

  // Patient
  section('Patient Information');
  row([['Patient Name', form.patient_name], ['DOB', fmtDate(form.patient_dob)]]);
  row([['Address', fd.address], ['City / State / ZIP', [fd.city, fd.zip_code].filter(Boolean).join(', ')]]);
  row([['Phone', fd.phone], ['Region', form.region]]);

  // Insurance
  section('Insurance');
  if (isOrderOnly) {
    doc.setFillColor(255, 247, 219);
    doc.rect(M, y - 4, W - 2 * M, 24, 'F');
    doc.setFontSize(9);
    doc.setTextColor(...BLACK);
    doc.text('Note: This payor does not require prior authorization. This form is a service order for the patient record and PCP.', M + 6, y + 11);
    y += 30;
  }
  row([['Insurance Carrier', form.insurance_name], ['Plan Type', form.insurance_type]]);
  row([['Member / Policy #', fd.member_id], ['Medicare Type', fd.medicare_type]]);
  if (fd.secondary_insurance) {
    row([['Secondary Insurance', fd.secondary_insurance], ['Secondary ID', fd.secondary_id]]);
  }
  if (fd.medicaid_id) {
    row([['Medicaid ID', fd.medicaid_id], ['MSP Screening', fd.msp_screening || '-']]);
  }

  // Clinical
  section('Clinical');
  row([['Primary Diagnosis (ICD-10)', fd.diagnosis_code], ['Disciplines', (fd.disciplines || []).join(', ')]]);
  row([['Wounds Present', fd.wounds_present ? 'Yes' : 'No'], ['Wound Type / Location', fd.wound_type || '-']]);
  row([['PCP Name', fd.pcp_name], ['PCP Phone / Fax', [fd.pcp_phone, fd.pcp_fax].filter(Boolean).join(' / ')]]);
  if (fd.pcp_facility) {
    row([['PCP Facility', fd.pcp_facility], ['Requesting Provider', fd.requesting_provider]]);
  }
  if (fd.requesting_provider_npi) {
    row([['Requesting Provider NPI', fd.requesting_provider_npi], ['', '']]);
  }
  if (fd.diagnosis_description) block('Diagnosis Description', fd.diagnosis_description);

  // CPT codes table
  section('Service Codes Requested');
  const cpts = Array.isArray(fd.cpt_codes) ? fd.cpt_codes : [];
  if (cpts.length === 0) {
    block('CPT Codes', 'None selected');
  } else {
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [['CPT', 'Description', 'Category']],
      body: cpts.map(c => [safe(c.code), safe(c.description), categoryLabel(c.category)]),
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: BRAND_RED, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [251, 247, 246] },
    });
    y = doc.lastAutoTable.finalY + 16;
  }

  // Service request
  if (y > H - 200) { doc.addPage(); y = M; }
  section('Service Request');
  row([['Visits Requested', safe(fd.visits_requested)], ['Evaluations', safe(fd.evals_requested)]]);
  row([['Frequency', fd.frequency], ['Duration', fd.duration]]);
  row([['Start Date', fmtDate(fd.start_date)], ['End Date', fmtDate(fd.end_date)]]);
  row([['Place of Service', fd.place_of_service || '12 - Home'], ['', '']]);
  if (fd.clinical_justification) block('Clinical Justification', fd.clinical_justification);
  if (fd.additional_notes)       block('Additional Notes',      fd.additional_notes);

  // Signature
  if (y > H - 140) { doc.addPage(); y = M; }
  section('Authorized Representative');
  row([['Submitted By', form.created_by_name || fd.created_by_name], ['Submission Date', fmtDate(form.sent_at || form.created_at)]]);
  row([['Typed Signature (e-sig)', fd.signature_typed_name], ['Date', fmtDate(fd.signature_date || form.created_at)]]);

  // ---- Footer (every page) --------------------------------------------
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LIGHT);
    doc.setLineWidth(0.5);
    doc.line(M, H - 44, W - M, H - 44);

    doc.setFontSize(8);
    doc.setTextColor(...GRAY);
    doc.text('EdemaCare  |  Phone: (XXX) XXX-XXXX  |  Fax: (XXX) XXX-XXXX  |  NPI: XXXXXXXXXX', M, H - 30);
    doc.text('EdemaCare is a service of AxiomHealth Management LLC', M, H - 18);
    doc.text('Page ' + i + ' of ' + pageCount, W - M, H - 18, { align: 'right' });
  }

  return doc;
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
