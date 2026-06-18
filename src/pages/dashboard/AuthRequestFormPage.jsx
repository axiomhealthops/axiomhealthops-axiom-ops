import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
// (useCallback used by PatientTypeahead helper below.)
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages, safeUpdate, logActivity } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { downloadAuthRequestPdf, buildAuthRequestPdf, requestMeta } from '../../lib/authRequestPdf';

// EdemaCare Auth Request Form - Phase 2 build (docs/Auth_Request_Form_Design.md rev 2).
// Works for ALL payors EdemaCare services. Conditional sections based on
// payor selected. PDF generated client-side via jsPDF.
//
// ASCII-only in JSX text (CLAUDE.md). No unicode literals.

// Pinned-top carriers by use-frequency.
const PINNED_CARRIERS = ['Humana', 'CarePlus', 'Florida Health'];

// Type of Request - drives the PDF title + signature block (see authRequestPdf.js).
const REQUEST_TYPES = [
  { value: 'new_patient', label: 'New Patient',                hint: 'Initial request. Needs referral and authorization (if required).' },
  { value: 'resumption',  label: 'Resumption Order',           hint: 'Resume care after a hospital or rehab stay. PCP signs the resumption order; request auth if needed. Note the facility + discharge date in the memo.' },
  { value: 'coc',         label: 'Continuation of Care (COC)', hint: 'Established patient continuing care. Needs a new authorization only. (COC + FHCP must be signed by Dr. David Harbour, MD.)' },
  { value: 'wound_care',  label: 'Wound Care Request',         hint: 'Wound care request. FHCP and Humana / CarePlus only.' },
  { value: 'garment',     label: 'Garment Request',            hint: 'Compression garment authorization (A-codes).' },
];

// Payors whose Wound Care Request is accepted.
const WOUND_CARE_PAYORS = ['Florida Health', 'Humana', 'CarePlus'];

// Payor -> standard CPT set. units = billed units, visits = visit count;
// either may be a string ('as needed'). modifier optional. Descriptions are
// filled in from the live cpt_codes library at load time.
const PAYOR_TEMPLATES = {
  // Aetna Medicare, Health First, Cigna Medicare
  aetna_hf_cigna: [
    { code: '97162', units: '1',  visits: '1'  },
    { code: '97166', units: '1',  visits: '1'  },
    { code: '97164', units: '3',  visits: '3'  },
    { code: '97168', units: '3',  visits: '3'  },
    { code: '29581', units: '25', visits: '25', modifier: 'RT, LT, 50' },
    { code: '97140', units: '75', visits: '25' },
    { code: '97110', units: '50', visits: '25' },
    { code: '97535', units: '50', visits: '25' },
    { code: '97530', units: '50', visits: '25' },
    { code: '97116', units: '50', visits: '25' },
    { code: '97112', units: '50', visits: '25' },
    { code: '97760', units: '1',  visits: '1'  },
    { code: '97763', units: '25', visits: '25' },
    { code: '97597', units: '25', visits: '25' },
    { code: '97598', units: '25', visits: '25' },
  ],
  // Humana, CarePlus
  humana: [
    { code: '97162', units: '', visits: '1'  },
    { code: '97166', units: '', visits: '1'  },
    { code: '97164', units: '', visits: '3'  },
    { code: '97168', units: '', visits: '3'  },
    { code: '97140', units: '', visits: '24' },
    { code: '97597', units: '', visits: 'as needed' },
    { code: '97598', units: '', visits: 'as needed' },
  ],
  // Florida Health (FHCP) - No OT
  fhcp: [
    { code: '97162', units: '', visits: '1'  },
    { code: '97164', units: '', visits: '3'  },
    { code: '97140', units: '', visits: '24' },
    { code: '97597', units: '', visits: 'as needed' },
    { code: '97598', units: '', visits: 'as needed' },
  ],
};
const WOUND_ONLY_TEMPLATE = [
  { code: '97597', units: '', visits: 'as needed' },
  { code: '97598', units: '', visits: 'as needed' },
];

function payorGroup(insuranceName) {
  const n = (insuranceName || '').trim().toLowerCase();
  if (n === 'aetna medicare' || n === 'health first' || n === 'cigna medicare') return 'aetna_hf_cigna';
  if (n === 'humana' || n === 'careplus') return 'humana';
  if (n === 'florida health') return 'fhcp';
  return null; // Devoted Health / others -> no standard template
}

const STATUSES = [
  { value: 'draft',         label: 'Draft',         color: '#D97706', bg: '#FEF3C7' },
  { value: 'ready_to_send', label: 'Ready to Send', color: '#1565C0', bg: '#EFF6FF' },
  { value: 'sent',          label: 'Sent',          color: '#065F46', bg: '#ECFDF5' },
  { value: 'superseded',    label: 'Superseded',    color: '#6B7280', bg: '#F3F4F6' },
];

const CATEGORY_TABS = [
  { value: 'wound_care', label: 'Wound Care' },
  { value: 'lymphedema', label: 'Lymphedema' },
  { value: 'pt',         label: 'Physical Therapy' },
  { value: 'ot',         label: 'Occupational Therapy' },
  { value: 'garment',    label: 'Garment' },
  { value: 'all',        label: 'All' },
];

function getStatus(s) { return STATUSES.find(x => x.value === s) || STATUSES[0]; }
function fmtDate(d) {
  if (!d) return '-';
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T00:00:00') : new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function AuthRequestFormPage({ intent }) {
  const { profile } = useAuth();
  const profileName = profile?.full_name || profile?.email || 'Unknown';

  // 2026-06-03 Phase 2.5 - one-shot intent from the patient chart deep-link.
  // Lazy-initialize so re-renders don't re-trigger the prefill.
  const [pendingIntent] = useState(() => intent || null);

  // ---- Master data -----------------------------------------------------
  const [carriers, setCarriers]   = useState([]); // [{insurance_name, requires_prior_auth}]
  const [cptCodes, setCptCodes]   = useState([]); // [{code, description, category, sort_order}]
  const [patients, setPatients]   = useState([]); // unique patient candidates
  const [view, setView]           = useState('new'); // 'new'|'drafts'|'sent'|'all'
  const [forms, setForms]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  // ---- Active form state ----------------------------------------------
  const [activeForm, setActiveForm] = useState(null); // a row from auth_request_forms (or null = composing new)
  const [draftData, setDraftData]   = useState(emptyDraft());

  function emptyDraft() {
    return {
      request_type: 'new_patient',
      memo_to_pcp: '',
      patient_name: '',
      patient_dob: '',
      manual_patient: false,
      // Default blank so the typeahead shows the whole census until the user
      // either picks a patient (carrier autofills) or sets the carrier as
      // a deliberate filter.
      insurance_name: '',
      insurance_type: '',
      requires_prior_auth: true,
      // form_data jsonb payload
      address: '', city: '', zip_code: '', phone: '',
      member_id: '', secondary_insurance: '', secondary_id: '',
      medicare_type: '', medicaid_id: '', msp_screening: '',
      diagnosis_code: '', diagnosis_description: '',
      disciplines: [], wounds_present: false, wound_type: '',
      pcp_name: '', pcp_phone: '', pcp_fax: '', pcp_facility: '',
      requesting_provider: '', requesting_provider_npi: '',
      cpt_codes: [],
      visits_requested: '', evals_requested: '', reassessments_requested: '',
      frequency: '', duration: '', start_date: '', end_date: '',
      place_of_service: '12 - Home',
      clinical_justification: '', additional_notes: '',
      signature_typed_name: '', signature_date: '',
      region: '',
    };
  }

  // ---- Load lookups ----------------------------------------------------
  useEffect(() => { (async () => {
    setLoading(true);
    const [{ data: ins }, { data: cpts }] = await Promise.all([
      supabase.from('insurance_abbreviations')
        .select('insurance_name, requires_prior_auth')
        .eq('is_active', true),
      supabase.from('cpt_codes').select('*').eq('is_active', true).order('category').order('sort_order'),
    ]);
    // De-duplicate carriers (lookup has multiple abbreviations per name)
    const seen = new Set();
    const uniqCarriers = [];
    (ins || []).forEach(r => {
      if (!r.insurance_name || seen.has(r.insurance_name)) return;
      seen.add(r.insurance_name);
      uniqCarriers.push(r);
    });
    uniqCarriers.sort((a, b) => {
      const ai = PINNED_CARRIERS.indexOf(a.insurance_name);
      const bi = PINNED_CARRIERS.indexOf(b.insurance_name);
      if (ai !== -1 || bi !== -1) {
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      }
      return a.insurance_name.localeCompare(b.insurance_name);
    });
    uniqCarriers.push({ insurance_name: 'Other', requires_prior_auth: true });
    setCarriers(uniqCarriers);
    setCptCodes(cpts || []);
    setLoading(false);
  })(); }, []);

  // ---- Load patient typeahead source ----------------------------------
  // 2026-06-03 ROOT-CAUSE FIX (Kirk Jones case): the previous intake select
  // included has_wound/wound_type which don't exist on intake_referrals -
  // Postgres returned an error, fetchAllPages swallowed it and returned [],
  // so the entire intake_referrals body (3K+ rows of DOB, address, phone,
  // PCP info, dx) was missing from the merge. Census + auth_tracker carry
  // almost no demographics, which is why autofill was producing blanks
  // even on patients that DO have full records on file.
  //
  // Sources merged (by precedence after merge):
  //   census_data       (897 rows)  - name, region, insurance, wounds, address
  //   intake_referrals  (3K)        - dob, full address, phone, pcp, dx, sec ins
  //   auth_tracker      (745)       - insurance_type, member_id, pcp_facility
  //   patient_master    (~900)      - has_been_active flag, recent activity
  //
  // Merge key is normalized (sorted lowercase tokens) so 'Jones, Kirk' and
  // 'Kirk Jones' link the same patient defensively.
  useEffect(() => { (async () => {
    const census = await fetchAllPages(
      supabase.from('census_data')
        .select('patient_name, region, insurance, address, has_wound, wound_type, current_visit_cadence, inferred_frequency')
        .not('patient_name', 'is', null)
    );
    const intake = await fetchAllPages(
      supabase.from('intake_referrals')
        .select('patient_name, dob, region, insurance, policy_number, phone, contact_number, location, city, zip_code, county, pcp_name, pcp_phone, pcp_fax, diagnosis_clean, diagnosis, medicare_type, secondary_insurance, secondary_id')
        .not('patient_name', 'is', null)
    );
    const auths = await fetchAllPages(
      supabase.from('auth_tracker')
        .select('patient_name, dob, region, insurance, insurance_type, member_id, phone, pcp_name, pcp_phone, pcp_fax, pcp_facility, diagnosis_code, requesting_provider, requesting_provider_npi')
        .not('patient_name', 'is', null)
    );
    const masters = await fetchAllPages(
      supabase.from('patient_master')
        .select('patient_name, region, insurance, has_wound, current_status')
        .not('patient_name', 'is', null)
    );
    const byKey = new Map();
    function merge(row, defaults) {
      if (!row?.patient_name) return;
      const key = nameKey(row.patient_name);
      if (!key) return;
      const existing = byKey.get(key) || { patient_name: row.patient_name };
      const next = { ...defaults, ...existing };
      Object.entries(row).forEach(([k, v]) => {
        if (v !== null && v !== undefined && v !== '' &&
            (next[k] === null || next[k] === undefined || next[k] === '')) {
          next[k] = v;
        }
      });
      // Preserve the first non-empty display name we saw for the patient.
      next.patient_name = existing.patient_name || row.patient_name;
      byKey.set(key, next);
    }
    (census  || []).forEach(r => merge(r, { source: 'census' }));
    (intake  || []).forEach(r => merge(r, { source: 'intake' }));
    (auths   || []).forEach(r => merge(r, { source: 'auth_tracker' }));
    (masters || []).forEach(r => merge(r, { source: 'patient_master' }));
    setPatients(
      Array.from(byKey.values()).sort(
        (a, b) => (a.patient_name || '').localeCompare(b.patient_name || '')
      )
    );
  })(); }, []);

  // ---- Load saved forms for the right-side list / history -------------
  // Same fetchAllPages signature fix.
  useEffect(() => { (async () => {
    const rows = await fetchAllPages(
      supabase.from('auth_request_forms').select('*').order('created_at', { ascending: false })
    );
    setForms(rows || []);
  })(); }, [reloadKey]);

  // ---- Consume one-shot intent (deep-link from PatientAuthDrawer) -----
  // After lookups + forms are loaded, open the intended form by id or
  // prefill a new one with the supplied patient data. Runs at most once
  // per page mount thanks to the lazy-initialized pendingIntent.
  const [intentHandled, setIntentHandled] = useState(false);
  useEffect(() => {
    if (intentHandled || !pendingIntent) return;
    if (loading || patients.length === 0 && forms.length === 0) return;
    if (pendingIntent.formId) {
      const f = forms.find(x => x.id === pendingIntent.formId);
      if (f) {
        manualEdit.current = true; // opening a saved form - keep its codes
        setActiveForm(f);
        setDraftData(fromFormRow(f));
        setView('new');
        setIntentHandled(true);
      }
      // If forms aren't loaded yet, wait for next tick.
      return;
    }
    if (pendingIntent.patientPrefill) {
      const pp = pendingIntent.patientPrefill;
      // Try to find this patient in the typeahead source for a richer prefill.
      const match = patients.find(p => (p.patient_name || '').trim().toLowerCase() === (pp.patient_name || '').trim().toLowerCase());
      if (match) {
        selectPatient(match);
      } else {
        // Fall back to whatever the drawer passed.
        setDraftData(d => ({
          ...d,
          patient_name: pp.patient_name || '',
          patient_dob:  pp.dob || '',
          region:       pp.region || '',
          member_id:    pp.member_id || '',
          pcp_name:     pp.pcp_name || '',
          pcp_phone:    pp.pcp_phone || '',
          pcp_fax:      pp.pcp_fax || '',
          pcp_facility: pp.pcp_facility || '',
          diagnosis_code: pp.diagnosis_code || '',
          insurance_name: matchCarrier(pp.insurance, d.insurance_name, carriers),
          manual_patient: !match,
        }));
      }
      setActiveForm(null);
      setView('new');
      setIntentHandled(true);
    }
  }, [pendingIntent, intentHandled, loading, forms, patients, carriers]);

  // ---- Derived ---------------------------------------------------------
  // 2026-06-04: numerical sort across all CPT lists. localeCompare with
  // numeric:true handles '11042' < '97161' correctly AND keeps letter-
  // prefixed codes (G0151, A6531) grouped together after the all-digit ones.
  const cptCodesSorted = useMemo(() => {
    return [...cptCodes].sort((a, b) =>
      String(a.code).localeCompare(String(b.code), undefined, { numeric: true, sensitivity: 'base' })
    );
  }, [cptCodes]);

  const cptByCat = useMemo(() => {
    const m = { wound_care: [], lymphedema: [], pt: [], ot: [], garment: [] };
    cptCodesSorted.forEach(c => { if (m[c.category]) m[c.category].push(c); });
    return m;
  }, [cptCodesSorted]);

  // Fast code -> library-row lookup for template descriptions.
  const cptByCode = useMemo(() => {
    const m = {};
    cptCodes.forEach(c => { if (c.code) m[String(c.code).toUpperCase()] = c; });
    return m;
  }, [cptCodes]);

  const isFHCP = useMemo(
    () => /florida health|fhcp/i.test(draftData.insurance_name || ''),
    [draftData.insurance_name]
  );

  // Build the payor/request-type standard code set, enriched with library
  // descriptions + categories. Returns null when no template applies.
  const buildTemplate = useCallback((insuranceName, requestType) => {
    if (requestType === 'garment') return null;     // garments are patient-specific
    let rows;
    if (requestType === 'wound_care') {
      rows = WOUND_ONLY_TEMPLATE;
    } else {
      const grp = payorGroup(insuranceName);
      if (!grp) return null;
      rows = PAYOR_TEMPLATES[grp];
    }
    return rows.map(r => {
      const meta = cptByCode[r.code.toUpperCase()] || {};
      return {
        code:        r.code,
        description: meta.description || '',
        category:    meta.category || '',
        units:       r.units != null ? r.units : '1',
        visits:      r.visits != null ? r.visits : '1',
        modifier:    r.modifier || '',
      };
    });
  }, [cptByCode]);

  // True once the coordinator manually curates codes, which stops auto-loading.
  const manualEdit = useRef(false);

  // Auto-load the payor's standard code set when carrier / request type changes,
  // unless the coordinator has manually curated the list.
  useEffect(() => {
    if (manualEdit.current) return;
    const tmpl = buildTemplate(draftData.insurance_name, draftData.request_type);
    if (tmpl) setDraftData(d => ({ ...d, cpt_codes: tmpl }));
  }, [draftData.insurance_name, draftData.request_type, buildTemplate]);

  function loadPayorTemplate() {
    const tmpl = buildTemplate(draftData.insurance_name, draftData.request_type);
    if (!tmpl || tmpl.length === 0) {
      setSaveMsg({ type: 'error', text: 'No standard code set for this payor / request type.' });
      return;
    }
    manualEdit.current = false;
    setDraftData(d => ({ ...d, cpt_codes: tmpl }));
    setSaveMsg({ type: 'ok', text: 'Loaded standard codes for ' + (draftData.insurance_name || 'this payor') + '.' });
  }

  const filteredCarrier = useMemo(
    () => carriers.find(c => c.insurance_name === draftData.insurance_name) || null,
    [carriers, draftData.insurance_name]
  );

  // PPO-ness comes from insurance_type, not carrier
  const isPpo = (draftData.insurance_type || '').toLowerCase() === 'ppo';

  const computedRequiresPriorAuth = useMemo(() => {
    if (!filteredCarrier) return true;
    if (filteredCarrier.requires_prior_auth === false) return false;
    if (isPpo) return false;
    return true;
  }, [filteredCarrier, isPpo]);

  // Sync the boolean into draft so PDF gets it
  useEffect(() => {
    setDraftData(d => ({ ...d, requires_prior_auth: computedRequiresPriorAuth }));
  }, [computedRequiresPriorAuth]);

  const patientHistory = useMemo(() => {
    if (!draftData.patient_name) return [];
    const key = draftData.patient_name.trim().toLowerCase();
    return forms.filter(f => (f.patient_name || '').trim().toLowerCase() === key);
  }, [forms, draftData.patient_name]);

  // ---- Patient selection + autopopulate -------------------------------
  // Patient is the PRIMARY input. Picking a patient applies what we know
  // about them across census / intake / auth_tracker / patient_master,
  // including insurance carrier + plan type. Then we kick off an
  // enrichment query that hits the DB directly for anything still blank
  // (handles patients whose data lives in newer rows the typeahead
  // didn't get a chance to merge, or in tables not in the typeahead set).
  function selectPatient(p) {
    const base = applyPatientToDraft(p, draftData, carriers);
    setDraftData(base);
    // Fire-and-forget enrichment. If it finds more data, the form gets
    // a second update without blocking selection.
    enrichPatient(p.patient_name).then(extra => {
      if (!extra) return;
      setDraftData(d => mergeIntoDraftPreserveEdits(d, extra, carriers));
    });
  }

  // ---- CPT picker handling --------------------------------------------
  const [cptTab, setCptTab] = useState('wound_care');
  const [cptSearch, setCptSearch] = useState('');
  useEffect(() => { setCptTab(draftData.wounds_present ? 'wound_care' : 'pt'); /* default */ }, [draftData.wounds_present]);
  // Clear the search when the user switches categories - separate workflows.
  useEffect(() => { setCptSearch(''); }, [cptTab]);

  // Apply the search filter on top of the active category. Match code OR
  // description, case-insensitive.
  const visibleCpts = useMemo(() => {
    const base = cptTab === 'all' ? cptCodesSorted : (cptByCat[cptTab] || []);
    const needle = cptSearch.trim().toLowerCase();
    if (!needle) return base;
    return base.filter(c =>
      (c.code || '').toLowerCase().includes(needle) ||
      (c.description || '').toLowerCase().includes(needle)
    );
  }, [cptTab, cptCodesSorted, cptByCat, cptSearch]);

  // If the search has content but no hits in the active category, peek at
  // whether other categories have matches so we can nudge the user.
  const searchMatchesOutsideTab = useMemo(() => {
    const needle = cptSearch.trim().toLowerCase();
    if (!needle || visibleCpts.length > 0 || cptTab === 'all') return 0;
    return cptCodesSorted.filter(c =>
      (c.code || '').toLowerCase().includes(needle) ||
      (c.description || '').toLowerCase().includes(needle)
    ).length;
  }, [cptSearch, visibleCpts, cptCodesSorted, cptTab]);

  function toggleCpt(c) {
    manualEdit.current = true;
    setDraftData(d => {
      const already = (d.cpt_codes || []).find(x => x.code === c.code);
      if (already) return { ...d, cpt_codes: d.cpt_codes.filter(x => x.code !== c.code) };
      return {
        ...d,
        cpt_codes: [
          ...(d.cpt_codes || []),
          { code: c.code, description: c.description, category: c.category, units: '1', visits: '1', modifier: '' },
        ],
      };
    });
  }

  // Per-code units / visits / modifier. units = billed units, visits = visit
  // count (either may be 'as needed'); modifier e.g. 'RT, LT, 50'.
  function setCptField(code, field, value) {
    manualEdit.current = true;
    setDraftData(d => ({
      ...d,
      cpt_codes: (d.cpt_codes || []).map(x =>
        x.code === code ? { ...x, [field]: value } : x
      ),
    }));
  }

  function removeCpt(code) {
    manualEdit.current = true;
    setDraftData(d => ({ ...d, cpt_codes: (d.cpt_codes || []).filter(x => x.code !== code) }));
  }

  // ---- Save / send -----------------------------------------------------
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);

  // ---- Submit/Process -> PDF preview state -----------------------------
  const [preview, setPreview]       = useState(null); // { url, blob, filename }
  const [processing, setProcessing] = useState(false);

  // ---- Off-list CPT request state --------------------------------------
  const [customCode, setCustomCode]     = useState('');
  const [customDesc, setCustomDesc]     = useState('');
  const [customReason, setCustomReason] = useState('');
  const [cptRequests, setCptRequests]   = useState([]); // recent requests for status display

  // Recent off-list CPT requests (so the coordinator can see pending/approved status).
  useEffect(() => { (async () => {
    const { data } = await supabase
      .from('cpt_code_requests')
      .select('id, code, status, requested_by_name, created_at, review_notes')
      .order('created_at', { ascending: false })
      .limit(50);
    setCptRequests(data || []);
  })(); }, [reloadKey]);

  // Build the auth_request_forms-shaped row the PDF renderer expects.
  function rowFromDraft() {
    const base = {
      patient_name:        draftData.patient_name,
      patient_dob:         draftData.patient_dob || null,
      insurance_name:      draftData.insurance_name,
      insurance_type:      draftData.insurance_type,
      region:              draftData.region,
      requires_prior_auth: draftData.requires_prior_auth,
      request_type:        draftData.request_type || 'new_patient',
      form_data:           toFormData(draftData),
    };
    return activeForm
      ? { ...activeForm, ...base, created_by_name: activeForm.created_by_name || profileName }
      : { ...emptyRow(), ...base, created_by_name: profileName, created_at: new Date().toISOString() };
  }

  function pdfFilename() {
    const safeName = (draftData.patient_name || 'patient').replace(/[^a-zA-Z0-9_-]/g, '_');
    return 'EdemaCare_' + (draftData.request_type || 'new_patient') + '_' + safeName + '_' +
           new Date().toISOString().slice(0, 10) + '.pdf';
  }

  // Submit / Process -> render the PDF and open the preview.
  async function processForm() {
    if (!draftData.patient_name) {
      setSaveMsg({ type: 'error', text: 'Select or enter a patient before processing.' });
      return;
    }
    setProcessing(true); setSaveMsg(null);
    try {
      const doc = await buildAuthRequestPdf(rowFromDraft());
      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);
      setPreview({ url, blob, filename: pdfFilename() });
    } catch (e) {
      setSaveMsg({ type: 'error', text: 'Could not build preview: ' + (e?.message || e) });
    } finally {
      setProcessing(false);
    }
  }

  function editFromPreview() {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
  }

  // From the preview: persist the form, store the PDF on the patient chart
  // (patient-documents bucket + patient_documents row), and download it.
  async function saveAndDownload() {
    if (!preview) return;
    setProcessing(true); setSaveMsg(null);
    try {
      const basePayload = {
        patient_name:        draftData.patient_name,
        patient_dob:         draftData.patient_dob || null,
        insurance_name:      draftData.insurance_name,
        insurance_type:      draftData.insurance_type || null,
        region:              draftData.region || null,
        requires_prior_auth: draftData.requires_prior_auth,
        request_type:        draftData.request_type || 'new_patient',
        form_data:           toFormData(draftData),
        updated_by:          profileName,
      };
      let formRow = activeForm;
      if (formRow?.id && formRow.status !== 'sent' && formRow.status !== 'superseded') {
        await safeUpdate('auth_request_forms', basePayload, { id: formRow.id });
        formRow = { ...formRow, ...basePayload };
      } else if (!formRow?.id) {
        const { data, error } = await supabase.from('auth_request_forms')
          .insert({ ...basePayload, status: 'draft', created_by: profile?.user_id || null, created_by_name: profileName })
          .select('*').single();
        if (error) throw error;
        formRow = data;
        setActiveForm(data);
      }

      // Upload the generated PDF to the patient-documents storage bucket.
      const safeName = (draftData.patient_name || 'patient').replace(/[^a-zA-Z0-9_-]/g, '_');
      const path = safeName + '/auth_request/' + (formRow?.id || 'unsaved') + '_' + Date.now() + '.pdf';
      const up = await supabase.storage.from('patient-documents')
        .upload(path, preview.blob, { contentType: 'application/pdf', upsert: false });
      if (up.error) throw up.error;

      // Record it on the patient chart (Documents).
      const meta = requestMeta(draftData.request_type);
      const { error: docErr } = await supabase.from('patient_documents').insert({
        patient_name:    draftData.patient_name,
        region:          draftData.region || null,
        doc_type:        'auth_request_form',
        doc_label:       meta.label + (draftData.insurance_name ? ' - ' + draftData.insurance_name : ''),
        file_name:       preview.filename,
        file_path:       up.data?.path || path,
        file_type:       'application/pdf',
        file_size:       preview.blob.size,
        effective_date:  new Date().toISOString().slice(0, 10),
        is_latest:       true,
        uploaded_by:     profileName,
        auth_tracker_id: formRow?.auth_tracker_id || null,
      });
      if (docErr) throw docErr;

      // Download a local copy.
      const a = document.createElement('a');
      a.href = preview.url; a.download = preview.filename;
      document.body.appendChild(a); a.click(); a.remove();

      logActivity({
        coordinatorId:   profile?.id,
        coordinatorName: profileName,
        coordinatorRole: profile?.role,
        actionType:      'auth_request_form_saved_to_chart',
        tableName:       'patient_documents',
        recordId:        formRow?.id || null,
        actionDetail:    'Saved ' + meta.label + ' to chart for ' + draftData.patient_name,
        metadata:        { patient_name: draftData.patient_name, request_type: draftData.request_type, insurance: draftData.insurance_name },
      }).catch(() => {});

      setReloadKey(k => k + 1);
      setSaveMsg({ type: 'ok', text: 'Saved to the patient chart (Documents) and downloaded.' });
      editFromPreview();
    } catch (e) {
      setSaveMsg({ type: 'error', text: 'Save to chart failed: ' + (e?.message || e) });
    } finally {
      setProcessing(false);
    }
  }

  // Off-list CPT: add directly if already approved, else file a request for Carla.
  async function requestCustomCode() {
    const code = (customCode || '').trim().toUpperCase();
    if (!code) return;
    const existing = cptCodes.find(c => (c.code || '').toUpperCase() === code);
    if (existing) {
      toggleCpt(existing);
      setCustomCode(''); setCustomDesc(''); setCustomReason('');
      setSaveMsg({ type: 'ok', text: code + ' is already approved - added to this request.' });
      return;
    }
    const { error } = await supabase.from('cpt_code_requests').insert({
      code,
      description:       customDesc || null,
      category:         cptTab === 'all' ? null : cptTab,
      reason:           customReason || null,
      requested_by:     profile?.user_id || null,
      requested_by_name: profileName,
      context_patient:  draftData.patient_name || null,
      context_form_id:  activeForm?.id || null,
    });
    if (error) { setSaveMsg({ type: 'error', text: error.message }); return; }
    setCustomCode(''); setCustomDesc(''); setCustomReason('');
    setReloadKey(k => k + 1);
    setSaveMsg({ type: 'ok', text: code + ' submitted to Carla Smith for approval. It cannot be added to a request until approved.' });
  }

  async function save(asStatus) {
    setSaving(true); setSaveMsg(null);
    const payload = {
      patient_name:        draftData.patient_name,
      patient_dob:         draftData.patient_dob || null,
      insurance_name:      draftData.insurance_name,
      insurance_type:      draftData.insurance_type || null,
      region:              draftData.region || null,
      requires_prior_auth: draftData.requires_prior_auth,
      request_type:        draftData.request_type || 'new_patient',
      status:              asStatus,
      form_data:           toFormData(draftData),
      created_by_name:     activeForm?.created_by_name || profileName,
      updated_by:          profileName,
      sent_at:             asStatus === 'sent' ? new Date().toISOString() : (activeForm?.sent_at || null),
      sent_method:         asStatus === 'sent' ? (draftData.sent_method || 'manual') : (activeForm?.sent_method || null),
      sent_to:             asStatus === 'sent' ? (draftData.sent_to || null) : (activeForm?.sent_to || null),
    };

    let res, row;
    if (activeForm?.id) {
      // Lock-after-sent: the DB trigger will reject any non-superseded update on a sent row.
      res = await safeUpdate('auth_request_forms', payload, { id: activeForm.id });
      row = { ...activeForm, ...payload };
    } else {
      res = await supabase.from('auth_request_forms').insert({
        ...payload,
        created_by_name: profileName,
        created_by: profile?.user_id || null,
      }).select('*').single();
      row = res.data;
    }

    if (res.error) {
      setSaveMsg({ type: 'error', text: res.error.message || 'Save failed' });
    } else {
      setActiveForm(row);
      setSaveMsg({ type: 'ok', text: asStatus === 'sent' ? 'Marked as sent.' : 'Saved.' });
      setReloadKey(k => k + 1);
      // Feed the engagement / patient activity stream so the chart's History
      // tab + coordinator_daily_metrics see this work.
      logActivity({
        coordinatorId:   profile?.id,
        coordinatorName: profileName,
        coordinatorRole: profile?.role,
        actionType:      'auth_request_form_' + asStatus,
        tableName:       'auth_request_forms',
        recordId:        row?.id || null,
        actionDetail:    (asStatus === 'sent' ? 'Sent ' : 'Saved ') +
                         (draftData.requires_prior_auth ? 'auth request' : 'service order') +
                         ' for ' + draftData.insurance_name +
                         ((draftData.cpt_codes || []).length ? ' (' + draftData.cpt_codes.length + ' CPTs)' : ''),
        metadata:        { patient_name: draftData.patient_name, insurance: draftData.insurance_name, cpt_count: (draftData.cpt_codes || []).length },
      }).catch(() => {});
    }
    setSaving(false);
  }

  async function startAmendment() {
    if (!activeForm) return;
    // Insert new row with parent_form_id; mark original as superseded.
    const newRow = {
      patient_name:   activeForm.patient_name,
      patient_dob:    activeForm.patient_dob,
      insurance_name: activeForm.insurance_name,
      insurance_type: activeForm.insurance_type,
      region:         activeForm.region,
      requires_prior_auth: activeForm.requires_prior_auth,
      request_type:   activeForm.request_type || 'new_patient',
      form_data:      activeForm.form_data,
      status:         'draft',
      version_number: (activeForm.version_number || 1) + 1,
      parent_form_id: activeForm.id,
      created_by:     profile?.user_id || null,
      created_by_name: profileName,
    };
    const { data: inserted, error } = await supabase.from('auth_request_forms').insert(newRow).select('*').single();
    if (error) { setSaveMsg({ type: 'error', text: error.message }); return; }
    await safeUpdate('auth_request_forms', { status: 'superseded' }, { id: activeForm.id });
    manualEdit.current = true; // amendment carries the original codes forward
    setActiveForm(inserted);
    setDraftData(fromFormRow(inserted));
    setReloadKey(k => k + 1);
    setSaveMsg({ type: 'ok', text: 'Amendment v' + inserted.version_number + ' opened. Original locked as superseded.' });
  }

  function newRequest() {
    manualEdit.current = false; // allow payor template auto-load on a fresh request
    setActiveForm(null);
    setDraftData(emptyDraft());
    setSaveMsg(null);
    setView('new');
  }

  function openExisting(f) {
    manualEdit.current = true; // preserve the saved code list; do not auto-load a template over it
    setActiveForm(f);
    setDraftData(fromFormRow(f));
    setView('new');
  }

  async function exportPdf() {
    const row = activeForm || { ...emptyRow(), patient_name: draftData.patient_name, patient_dob: draftData.patient_dob, insurance_name: draftData.insurance_name, insurance_type: draftData.insurance_type, region: draftData.region, requires_prior_auth: draftData.requires_prior_auth, form_data: toFormData(draftData), created_by_name: profileName, created_at: new Date().toISOString() };
    try {
      await downloadAuthRequestPdf(row);
      if (activeForm?.id) {
        logActivity({
          coordinatorId:   profile?.id,
          coordinatorName: profileName,
          coordinatorRole: profile?.role,
          actionType:      'auth_request_form_downloaded',
          tableName:       'auth_request_forms',
          recordId:        activeForm.id,
          actionDetail:    'Downloaded ' + (activeForm.requires_prior_auth === false ? 'Service Order' : 'Auth Request') +
                           ' v' + (activeForm.version_number || 1) + ' - ' + (activeForm.insurance_name || '-'),
          metadata:        { patient_name: activeForm.patient_name },
        }).catch(() => {});
      }
    } catch (e) {
      setSaveMsg({ type: 'error', text: 'PDF export failed: ' + (e?.message || e) });
    }
  }

  const locked = activeForm?.status === 'sent' || activeForm?.status === 'superseded';

  // ---- Render ----------------------------------------------------------
  return (
    <div>
      <TopBar
        title="Auth Request Form"
        subtitle="Generate prior authorization requests and service orders"
      />

      {/* List rail */}
      <div style={S.viewBar}>
        <ViewBtn label="New Request" active={view==='new'}    onClick={newRequest} />
        <ViewBtn label={'Drafts (' + forms.filter(f=>f.status==='draft').length + ')'}      active={view==='drafts'} onClick={()=>setView('drafts')} />
        <ViewBtn label={'Sent ('   + forms.filter(f=>f.status==='sent').length   + ')'}     active={view==='sent'}   onClick={()=>setView('sent')} />
        <ViewBtn label={'All ('    + forms.length + ')'}                                     active={view==='all'}    onClick={()=>setView('all')} />
        <div style={{ flex: 1 }} />
        <div style={S.cptSeedNotice} title="CPT seed library">
          {'CPT library: ' + cptCodes.length + ' codes (2025). Verify against contract before public rollout.'}
        </div>
      </div>

      {/* List view */}
      {view !== 'new' && (
        <div style={S.listWrap}>
          {forms
            .filter(f => view==='all' ? true : (view==='drafts' ? f.status==='draft' : f.status==='sent'))
            .map(f => (
              <div key={f.id} style={S.listRow} onClick={() => openExisting(f)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={S.listName}>{f.patient_name}</div>
                  <div style={S.listSub}>
                    {f.insurance_name} {f.insurance_type ? '(' + f.insurance_type + ')' : ''} - v{f.version_number} - {fmtDate(f.created_at)}
                  </div>
                </div>
                <Badge status={f.status} />
              </div>
            ))}
          {forms.filter(f => view==='all' ? true : (view==='drafts' ? f.status==='draft' : f.status==='sent')).length === 0 && (
            <div style={S.empty}>No forms in this view yet.</div>
          )}
        </div>
      )}

      {/* New / edit form */}
      {view === 'new' && (
        <div style={S.layout}>
          {/* LEFT - form */}
          <div style={S.leftCol}>
            {locked && (
              <div style={S.lockedBanner}>
                {'This form was ' + activeForm.status + ' on ' + fmtDate(activeForm.sent_at || activeForm.updated_at) + '. It is read-only. '}
                {activeForm.status === 'sent' && (
                  <button style={S.amendBtn} onClick={startAmendment}>Start amendment (new version)</button>
                )}
              </div>
            )}

            {!computedRequiresPriorAuth && (
              <div style={S.noAuthBanner}>
                <strong>Prior auth not required for this payor / plan combo.</strong>
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  This form will generate a <em>Service Order / Plan of Care Notification</em> for the patient record and PCP, not a prior auth request to the carrier. Form is still saved and versioned.
                </div>
              </div>
            )}

            <Section title="Type of Request">
              <Field label="Authorization Type">
                <select value={draftData.request_type || 'new_patient'} disabled={locked}
                        onChange={e => setDraftData(d => ({ ...d, request_type: e.target.value }))}
                        style={S.input}>
                  {REQUEST_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <div style={S.hint}>
                  {REQUEST_TYPES.find(t => t.value === (draftData.request_type || 'new_patient'))?.hint}
                </div>
              </Field>
              {draftData.request_type === 'coc' && isFHCP && (
                <div style={S.infoNote}>COC for FHCP must be signed by <strong>Dr. David Harbour, MD</strong>. The PDF will print his physician signature line.</div>
              )}
              {draftData.request_type === 'resumption' && (
                <div style={S.infoNote}>Use the Memo below to note the hospital / rehab facility and discharge date driving this resumption.</div>
              )}
              {draftData.request_type === 'wound_care' && draftData.insurance_name && !WOUND_CARE_PAYORS.includes(draftData.insurance_name) && (
                <div style={S.warnNote}>Wound Care Requests are for FHCP and Humana / CarePlus only. {draftData.insurance_name} is not one of these.</div>
              )}
            </Section>

            <Section title="Patient">
              <PatientTypeahead
                value={draftData.patient_name}
                disabled={locked}
                options={patients}
                filterInsurance={draftData.insurance_name === 'Other' ? '' : draftData.insurance_name}
                filterPlanType={draftData.insurance_type}
                carriers={carriers}
                onSelect={selectPatient}
                onManualChange={(name) => setDraftData(d => ({ ...d, patient_name: name, manual_patient: true }))}
              />
              {draftData.manual_patient && draftData.patient_name && (
                <div style={S.hint}>
                  Using "{draftData.patient_name}" as a new patient. All other fields stay blank for you to fill in.
                </div>
              )}
            </Section>

            <Section title="Insurance">
              <Field label="Insurance Carrier">
                <select value={draftData.insurance_name} disabled={locked}
                        onChange={e => setDraftData(d => ({ ...d, insurance_name: e.target.value }))}
                        style={S.input}>
                  <option value="">- Auto-fills when you pick a patient -</option>
                  {carriers.map(c => (
                    <option key={c.insurance_name} value={c.insurance_name}>{c.insurance_name}</option>
                  ))}
                </select>
                <div style={S.hint}>
                  Tip: set carrier + plan type BEFORE picking a patient to narrow the patient search above.
                </div>
              </Field>
              {draftData.insurance_name === 'Other' && (
                <Field label="Specify Carrier">
                  <input style={S.input} disabled={locked}
                         value={draftData.insurance_name_other || ''}
                         onChange={e => setDraftData(d => ({ ...d, insurance_name_other: e.target.value }))} />
                </Field>
              )}
              <Field label="Plan Type">
                <select value={draftData.insurance_type} disabled={locked}
                        onChange={e => setDraftData(d => ({ ...d, insurance_type: e.target.value }))}
                        style={S.input}>
                  <option value="">- Select -</option>
                  <option value="HMO">HMO</option>
                  <option value="PPO">PPO</option>
                  <option value="MA">Medicare Advantage</option>
                  <option value="Medicaid">Medicaid</option>
                  <option value="Original">Original / Traditional</option>
                  <option value="Commercial">Commercial</option>
                </select>
              </Field>
            </Section>

            <Section title="Demographics">
              <Field label="DOB"><input type="date" disabled={locked} value={draftData.patient_dob || ''}
                onChange={e => setDraftData(d => ({ ...d, patient_dob: e.target.value }))} style={S.input} /></Field>
              <Field label="Phone"><input disabled={locked} value={draftData.phone}
                onChange={e => setDraftData(d => ({ ...d, phone: e.target.value }))} style={S.input} /></Field>
              <Field label="Address"><input disabled={locked} value={draftData.address}
                onChange={e => setDraftData(d => ({ ...d, address: e.target.value }))} style={S.input} /></Field>
              <Field label="City"><input disabled={locked} value={draftData.city}
                onChange={e => setDraftData(d => ({ ...d, city: e.target.value }))} style={S.input} /></Field>
              <Field label="ZIP"><input disabled={locked} value={draftData.zip_code}
                onChange={e => setDraftData(d => ({ ...d, zip_code: e.target.value }))} style={S.input} /></Field>
              <Field label="Region"><input disabled={locked} value={draftData.region}
                onChange={e => setDraftData(d => ({ ...d, region: e.target.value }))} style={S.input} /></Field>
            </Section>

            <Section title="Insurance Details">
              <Field label="Member / Policy #"><input disabled={locked} value={draftData.member_id}
                onChange={e => setDraftData(d => ({ ...d, member_id: e.target.value }))} style={S.input} /></Field>
              {(draftData.insurance_name || '').toLowerCase().includes('medicare') && (
                <Field label="Medicare Plan Letter">
                  <select disabled={locked} value={draftData.medicare_type}
                          onChange={e => setDraftData(d => ({ ...d, medicare_type: e.target.value }))}
                          style={S.input}>
                    <option value="">- Select -</option>
                    <option>A</option><option>B</option><option>C</option><option>D</option>
                  </select>
                </Field>
              )}
              {draftData.insurance_name === 'Simply' && (
                <Field label="Medicaid ID"><input disabled={locked} value={draftData.medicaid_id}
                  onChange={e => setDraftData(d => ({ ...d, medicaid_id: e.target.value }))} style={S.input} /></Field>
              )}
              <Field label="Secondary Insurance"><input disabled={locked} value={draftData.secondary_insurance}
                onChange={e => setDraftData(d => ({ ...d, secondary_insurance: e.target.value }))} style={S.input} /></Field>
              <Field label="Secondary ID"><input disabled={locked} value={draftData.secondary_id}
                onChange={e => setDraftData(d => ({ ...d, secondary_id: e.target.value }))} style={S.input} /></Field>
              {draftData.secondary_insurance && (
                <Field label="MSP Screening Done?">
                  <select disabled={locked} value={draftData.msp_screening}
                          onChange={e => setDraftData(d => ({ ...d, msp_screening: e.target.value }))}
                          style={S.input}>
                    <option value="">- Select -</option>
                    <option>Yes</option><option>No</option>
                  </select>
                </Field>
              )}
            </Section>

            <Section title="Clinical">
              <Field label="Primary Diagnosis (ICD-10)"><input disabled={locked} value={draftData.diagnosis_code}
                onChange={e => setDraftData(d => ({ ...d, diagnosis_code: e.target.value }))} style={S.input} /></Field>
              <Field label="Diagnosis Description"><input disabled={locked} value={draftData.diagnosis_description}
                onChange={e => setDraftData(d => ({ ...d, diagnosis_description: e.target.value }))} style={S.input} /></Field>
              <Field label="Disciplines">
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  {['PT', 'OT', 'SLP', 'Wound'].map(disc => (
                    <label key={disc} style={S.checkLabel}>
                      <input type="checkbox" disabled={locked}
                             checked={(draftData.disciplines || []).includes(disc)}
                             onChange={() => setDraftData(d => {
                               const arr = d.disciplines || [];
                               return { ...d, disciplines: arr.includes(disc) ? arr.filter(x => x !== disc) : [...arr, disc] };
                             })} />
                      <span>{disc}</span>
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Wounds Present">
                <div style={{ display: 'flex', gap: 18 }}>
                  <label style={S.checkLabel}>
                    <input type="radio" disabled={locked} checked={draftData.wounds_present === true}
                           onChange={() => setDraftData(d => ({ ...d, wounds_present: true }))} />
                    <span>Yes</span>
                  </label>
                  <label style={S.checkLabel}>
                    <input type="radio" disabled={locked} checked={draftData.wounds_present === false}
                           onChange={() => setDraftData(d => ({ ...d, wounds_present: false }))} />
                    <span>No</span>
                  </label>
                </div>
              </Field>
              {draftData.wounds_present && (
                <Field label="Wound Type / Location"><input disabled={locked} value={draftData.wound_type}
                  onChange={e => setDraftData(d => ({ ...d, wound_type: e.target.value }))} style={S.input} /></Field>
              )}
              <Field label="PCP Name"><input disabled={locked} value={draftData.pcp_name}
                onChange={e => setDraftData(d => ({ ...d, pcp_name: e.target.value }))} style={S.input} /></Field>
              <Field label="PCP Phone"><input disabled={locked} value={draftData.pcp_phone}
                onChange={e => setDraftData(d => ({ ...d, pcp_phone: e.target.value }))} style={S.input} /></Field>
              <Field label="PCP Fax"><input disabled={locked} value={draftData.pcp_fax}
                onChange={e => setDraftData(d => ({ ...d, pcp_fax: e.target.value }))} style={S.input} /></Field>
              <Field label="PCP Facility"><input disabled={locked} value={draftData.pcp_facility}
                onChange={e => setDraftData(d => ({ ...d, pcp_facility: e.target.value }))} style={S.input} /></Field>
              <Field label="Requesting Provider"><input disabled={locked} value={draftData.requesting_provider}
                onChange={e => setDraftData(d => ({ ...d, requesting_provider: e.target.value }))} style={S.input} /></Field>
              <Field label="Provider NPI"><input disabled={locked} value={draftData.requesting_provider_npi}
                onChange={e => setDraftData(d => ({ ...d, requesting_provider_npi: e.target.value }))} style={S.input} /></Field>
            </Section>

            <Section title="CPT Codes">
              {buildTemplate(draftData.insurance_name, draftData.request_type) && (
                <div style={S.templateBar}>
                  <span style={{ fontSize: 12, color: '#1E40AF' }}>
                    Standard code set available for {draftData.request_type === 'wound_care' ? 'Wound Care' : (draftData.insurance_name || 'this payor')}.
                  </span>
                  <button style={S.templateBtn} disabled={locked} onClick={loadPayorTemplate}>Reload standard codes</button>
                </div>
              )}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
                {CATEGORY_TABS.map(t => (
                  <button key={t.value} onClick={() => setCptTab(t.value)} disabled={locked}
                          style={{ ...S.tabBtn, ...(cptTab === t.value ? S.tabBtnActive : {}) }}>
                    {t.label}
                  </button>
                ))}
              </div>
              <div style={{ position: 'relative', marginBottom: 10 }}>
                <input
                  type="search"
                  disabled={locked}
                  value={cptSearch}
                  onChange={e => setCptSearch(e.target.value)}
                  placeholder="Quick search: type CPT code or keyword (e.g. 97597 or debridement)"
                  style={S.cptSearch}
                />
                {cptSearch && (
                  <button onClick={() => setCptSearch('')} style={S.cptSearchClear} title="Clear search">x</button>
                )}
              </div>
              <div style={S.cptList}>
                {visibleCpts.map(c => {
                  const sel = (draftData.cpt_codes || []).find(x => x.code === c.code);
                  const toggle = () => !locked && toggleCpt(c);
                  return (
                    <div key={c.code} style={{ ...S.cptRow, ...(sel ? S.cptRowOn : {}), cursor: locked ? 'default' : 'pointer' }} onClick={toggle}>
                      <input type="checkbox" disabled={locked} checked={!!sel} onChange={toggle} onClick={e => e.stopPropagation()} />
                      <div style={S.cptCode}>{c.code}</div>
                      <div style={S.cptDesc}>{c.description}</div>
                    </div>
                  );
                })}
                {visibleCpts.length === 0 && cptSearch && (
                  <div style={S.empty}>
                    No matches for "{cptSearch}" in {CATEGORY_TABS.find(t => t.value === cptTab)?.label || ''}.
                    {searchMatchesOutsideTab > 0 && (
                      <>
                        <br />
                        <button onClick={() => setCptTab('all')}
                                style={{ marginTop: 8, padding: '4px 10px', borderRadius: 6, border: '1px solid #D94F2B', background: '#fff', color: '#D94F2B', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>
                          {searchMatchesOutsideTab} match{searchMatchesOutsideTab === 1 ? '' : 'es'} in other categories - search All
                        </button>
                      </>
                    )}
                  </div>
                )}
                {visibleCpts.length === 0 && !cptSearch && cptTab !== 'all' && (
                  <div style={S.empty}>No codes in this category yet.</div>
                )}
              </div>
              {(draftData.cpt_codes || []).length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={S.selHead}>Requested Codes ({draftData.cpt_codes.length})</div>
                  <div style={S.selTableHead}>
                    <span>Code</span><span>Units</span><span>Visits</span><span>Modifier</span><span></span>
                  </div>
                  {draftData.cpt_codes.map(c => (
                    <div key={c.code} style={S.selRow}>
                      <span style={S.selCode} title={c.description}>{c.code}</span>
                      <input style={S.selInput} disabled={locked} placeholder="-"
                             value={c.units ?? ''}
                             onChange={e => setCptField(c.code, 'units', e.target.value)} />
                      <input style={S.selInput} disabled={locked} placeholder="-"
                             value={c.visits ?? (c.quantity != null ? String(c.quantity) : '')}
                             onChange={e => setCptField(c.code, 'visits', e.target.value)} />
                      <input style={S.selInputWide} disabled={locked} placeholder="-"
                             value={c.modifier ?? ''}
                             onChange={e => setCptField(c.code, 'modifier', e.target.value)} />
                      <button style={S.selRemove} disabled={locked} onClick={() => removeCpt(c.code)} title="Remove">x</button>
                    </div>
                  ))}
                  <div style={S.hint}>Units = billed units; Visits = visit count. Both accept text (e.g. "as needed"). Edit any value as needed.</div>
                </div>
              )}

              {/* Off-list CPT: must be approved by Carla before use */}
              <div style={S.customCptBox}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: '#1A1A1A' }}>
                  Need a code that is not listed?
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <input style={{ ...S.input, maxWidth: 130 }} placeholder="CPT code" value={customCode} disabled={locked}
                         onChange={e => setCustomCode(e.target.value)} />
                  <input style={{ ...S.input, flex: 1, minWidth: 160 }} placeholder="Description (optional)" value={customDesc} disabled={locked}
                         onChange={e => setCustomDesc(e.target.value)} />
                </div>
                <input style={{ ...S.input, marginTop: 6 }} placeholder="Why is this code needed? (helps Carla review)" value={customReason} disabled={locked}
                       onChange={e => setCustomReason(e.target.value)} />
                <button style={{ ...S.outlineBtn, marginTop: 6 }} disabled={locked || !customCode.trim()} onClick={requestCustomCode}>
                  Submit code for approval
                </button>
                <div style={S.hint}>
                  Off-list codes are reviewed by Carla Smith before they can be used. This prevents inaccurate codes on auth requests.
                </div>
                {cptRequests.filter(r => r.status === 'pending').length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                      Pending approval
                    </div>
                    {cptRequests.filter(r => r.status === 'pending').slice(0, 5).map(r => (
                      <div key={r.id} style={S.cptReqRow}>
                        <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontWeight: 700 }}>{r.code}</span>
                        <span style={{ color: '#6B7280' }}>{r.requested_by_name || ''}</span>
                        <span style={S.cptReqPending}>pending</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Section>

            <Section title="Service Request">
              <Field label="Visits Requested"><input type="number" disabled={locked} value={draftData.visits_requested}
                onChange={e => setDraftData(d => ({ ...d, visits_requested: e.target.value }))} style={S.input} /></Field>
              <Field label="Evaluations"><input type="number" disabled={locked} value={draftData.evals_requested}
                onChange={e => setDraftData(d => ({ ...d, evals_requested: e.target.value }))} style={S.input} /></Field>
              <Field label="Frequency"><input disabled={locked} value={draftData.frequency} placeholder="e.g. 2x/wk x 4wk"
                onChange={e => setDraftData(d => ({ ...d, frequency: e.target.value }))} style={S.input} /></Field>
              <Field label="Duration"><input disabled={locked} value={draftData.duration}
                onChange={e => setDraftData(d => ({ ...d, duration: e.target.value }))} style={S.input} /></Field>
              <Field label="Start Date"><input type="date" disabled={locked} value={draftData.start_date}
                onChange={e => setDraftData(d => ({ ...d, start_date: e.target.value }))} style={S.input} /></Field>
              <Field label="End Date"><input type="date" disabled={locked} value={draftData.end_date}
                onChange={e => setDraftData(d => ({ ...d, end_date: e.target.value }))} style={S.input} /></Field>
              <Field label="Clinical Justification">
                <textarea disabled={locked} value={draftData.clinical_justification}
                          onChange={e => setDraftData(d => ({ ...d, clinical_justification: e.target.value }))}
                          rows={4} maxLength={2000} style={{ ...S.input, fontFamily: 'inherit' }} />
                <div style={S.charCount}>{(draftData.clinical_justification || '').length} / 2000</div>
              </Field>
              <Field label="Additional Notes">
                <textarea disabled={locked} value={draftData.additional_notes}
                          onChange={e => setDraftData(d => ({ ...d, additional_notes: e.target.value }))}
                          rows={3} style={{ ...S.input, fontFamily: 'inherit' }} />
              </Field>
            </Section>

            <Section title="Memo to PCP Office">
              <Field label="Message to the PCP - why are we requesting this authorization?">
                <textarea disabled={locked} value={draftData.memo_to_pcp || ''}
                          onChange={e => setDraftData(d => ({ ...d, memo_to_pcp: e.target.value }))}
                          rows={4} maxLength={1500} style={{ ...S.input, fontFamily: 'inherit' }}
                          placeholder="e.g. Patient discharged from Florida Hospital Altamonte on 06/14 after a 6-day admission for cellulitis; resuming lymphedema therapy per plan of care." />
                <div style={S.charCount}>{(draftData.memo_to_pcp || '').length} / 1500</div>
              </Field>
              <div style={S.hint}>This memo prints on the PDF above the provider signature block, so the PCP office understands the reason for the request.</div>
            </Section>

            <Section title="Signature">
              <Field label="Typed name (e-signature)"><input disabled={locked} value={draftData.signature_typed_name}
                onChange={e => setDraftData(d => ({ ...d, signature_typed_name: e.target.value }))} style={S.input} /></Field>
              <Field label="Date"><input type="date" disabled={locked} value={draftData.signature_date}
                onChange={e => setDraftData(d => ({ ...d, signature_date: e.target.value }))} style={S.input} /></Field>
            </Section>

            {patientHistory.length > 1 && (
              <Section title="Form History for this Patient">
                {patientHistory.map(f => (
                  <div key={f.id} style={{ ...S.listRow, opacity: f.id === activeForm?.id ? 1 : 0.85 }} onClick={() => openExisting(f)}>
                    <div style={{ flex: 1 }}>
                      <div style={S.listName}>v{f.version_number} - {fmtDate(f.created_at)}</div>
                      <div style={S.listSub}>{f.insurance_name} - {(f.form_data?.cpt_codes || []).length} CPTs</div>
                    </div>
                    <Badge status={f.status} />
                  </div>
                ))}
              </Section>
            )}
          </div>

          {/* RIGHT - actions */}
          <div style={S.rightCol}>
            <div style={S.sticky}>
              <div style={S.previewCard}>
                <div style={S.previewTitle}>
                  {computedRequiresPriorAuth ? 'Authorization Request' : 'Service Order'}
                </div>
                <div style={S.previewSub}>
                  {draftData.patient_name || '(no patient selected)'}<br />
                  {draftData.insurance_name}{draftData.insurance_type ? ' (' + draftData.insurance_type + ')' : ''}<br />
                  {(draftData.cpt_codes || []).length} CPT codes selected
                </div>
                {activeForm && (
                  <div style={S.previewStatus}>
                    Status: <Badge status={activeForm.status} /> v{activeForm.version_number}
                  </div>
                )}
              </div>

              <button style={S.primaryBtn} disabled={processing || !draftData.patient_name} onClick={processForm}>
                {processing ? 'Processing...' : 'Submit / Process'}
              </button>
              <div style={S.previewHint}>Builds a PDF preview you can review, then edit or save to the patient chart.</div>
              <button style={S.outlineBtn} onClick={exportPdf}>Quick PDF (no save)</button>

              {!locked && (
                <>
                  <button style={S.outlineBtn} disabled={saving} onClick={() => save('draft')}>
                    {saving ? 'Saving...' : 'Save Draft'}
                  </button>
                  <button style={S.sendBtn} disabled={saving || !draftData.patient_name} onClick={() => save('sent')}>
                    {'Mark as Sent'}
                  </button>
                </>
              )}

              {saveMsg && (
                <div style={{ ...S.msg, ...(saveMsg.type === 'error' ? S.msgErr : S.msgOk) }}>
                  {saveMsg.text}
                </div>
              )}

              <div style={S.legalNote}>
                EdemaCare is a service of AxiomHealth Management LLC. Form data is versioned;
                once a form is marked sent, it cannot be edited - file an amendment instead.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Submit / Process -> PDF preview overlay */}
      {preview && (
        <div style={S.previewOverlay}>
          <div style={S.previewModal}>
            <div style={S.previewBar}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>PDF Preview</div>
                <div style={{ fontSize: 11, color: '#6B7280' }}>Review the document, then edit or save it to the patient chart.</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={S.outlineBtn} disabled={processing} onClick={editFromPreview}>Edit</button>
                <button style={S.sendBtn} disabled={processing} onClick={saveAndDownload}>
                  {processing ? 'Saving...' : 'Save to Chart & Download'}
                </button>
              </div>
            </div>
            <iframe title="Auth request PDF preview" src={preview.url} style={S.previewFrame} />
          </div>
        </div>
      )}
    </div>
  );
}

// ===================== helpers =====================

// Normalized name key for cross-table merging. Strips commas/punctuation,
// splits into tokens, lowercases, sorts. So:
//   "Jones, Kirk"  -> "jones kirk"
//   "Kirk Jones"   -> "jones kirk"
//   "JONES KIRK"   -> "jones kirk"
// Keeps the typeahead robust against the inconsistent name formats across
// census_data, intake_referrals, and auth_tracker.
function nameKey(s) {
  if (!s) return '';
  return String(s)
    .replace(/[,.;]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.toLowerCase())
    .sort()
    .join(' ');
}

// Build a complete draft from the merged patient option. Used on initial
// selection; the enrichment call follows and fills any blanks.
function applyPatientToDraft(p, d, carriers) {
  return {
    ...d,
    manual_patient:          false,
    patient_name:            p.patient_name || d.patient_name || '',
    patient_dob:             p.dob || d.patient_dob || '',
    address:                 p.location || p.address || d.address || '',
    city:                    p.city || d.city || '',
    zip_code:                p.zip_code || d.zip_code || '',
    phone:                   p.phone || p.contact_number || d.phone || '',
    member_id:               p.member_id || p.policy_number || d.member_id || '',
    region:                  p.region || d.region || '',
    pcp_name:                p.pcp_name || d.pcp_name || '',
    pcp_phone:               p.pcp_phone || d.pcp_phone || '',
    pcp_fax:                 p.pcp_fax || d.pcp_fax || '',
    pcp_facility:            p.pcp_facility || d.pcp_facility || '',
    diagnosis_code:          p.diagnosis_code || p.diagnosis_clean || d.diagnosis_code || '',
    diagnosis_description:   p.diagnosis || d.diagnosis_description || '',
    medicare_type:           p.medicare_type || d.medicare_type || '',
    secondary_insurance:     p.secondary_insurance || d.secondary_insurance || '',
    secondary_id:            p.secondary_id || d.secondary_id || '',
    wounds_present:          d.wounds_present || !!p.has_wound,
    wound_type:              p.wound_type || d.wound_type || '',
    requesting_provider:     p.requesting_provider || d.requesting_provider || '',
    requesting_provider_npi: p.requesting_provider_npi || d.requesting_provider_npi || '',
    insurance_name:          matchCarrier(p.insurance, d.insurance_name, carriers),
    insurance_type:          normalizePlan(p.insurance_type) || d.insurance_type || '',
    frequency:               d.frequency || p.current_visit_cadence || p.inferred_frequency || '',
  };
}

// Second-pass merge from enrichment query. Only fills BLANK fields - never
// overwrites anything the user may have edited between selection and
// enrichment landing.
function mergeIntoDraftPreserveEdits(d, extra, carriers) {
  const out = { ...d };
  const tryFill = (k, v) => {
    if (v === null || v === undefined || v === '') return;
    if (out[k] === null || out[k] === undefined || out[k] === '') {
      out[k] = v;
    }
  };
  tryFill('patient_dob',           extra.dob);
  tryFill('address',               extra.location || extra.address);
  tryFill('city',                  extra.city);
  tryFill('zip_code',              extra.zip_code);
  tryFill('phone',                 extra.phone || extra.contact_number);
  tryFill('member_id',             extra.member_id || extra.policy_number);
  tryFill('region',                extra.region);
  tryFill('pcp_name',              extra.pcp_name);
  tryFill('pcp_phone',             extra.pcp_phone);
  tryFill('pcp_fax',               extra.pcp_fax);
  tryFill('pcp_facility',          extra.pcp_facility);
  tryFill('diagnosis_code',        extra.diagnosis_code || extra.diagnosis_clean);
  tryFill('diagnosis_description', extra.diagnosis);
  tryFill('medicare_type',         extra.medicare_type);
  tryFill('secondary_insurance',   extra.secondary_insurance);
  tryFill('secondary_id',          extra.secondary_id);
  tryFill('wound_type',            extra.wound_type);
  tryFill('requesting_provider',   extra.requesting_provider);
  tryFill('requesting_provider_npi', extra.requesting_provider_npi);
  tryFill('frequency',             extra.current_visit_cadence || extra.inferred_frequency);
  if (extra.has_wound && !out.wounds_present) out.wounds_present = true;
  if (!out.insurance_name && extra.insurance) {
    out.insurance_name = matchCarrier(extra.insurance, '', carriers);
  }
  if (!out.insurance_type && extra.insurance_type) {
    out.insurance_type = normalizePlan(extra.insurance_type);
  }
  return out;
}

// Map auth_tracker's free-form insurance_type values onto our dropdown
// values. auth_tracker has values like "standard" / "HMO" / "PPO" / "MA";
// the dropdown understands HMO/PPO/MA/Medicaid/Original/Commercial.
function normalizePlan(t) {
  if (!t) return '';
  const s = String(t).trim().toLowerCase();
  if (!s) return '';
  if (s === 'hmo') return 'HMO';
  if (s === 'ppo') return 'PPO';
  if (s === 'ma' || s.includes('medicare advantage')) return 'MA';
  if (s.includes('medicaid')) return 'Medicaid';
  if (s.includes('original') || s.includes('traditional')) return 'Original';
  if (s.includes('commercial')) return 'Commercial';
  if (s === 'standard') return 'HMO'; // auth_tracker default; HMO is the safe assumption
  return '';
}

// On-pick enrichment: directly query the DB for any data we may not have
// already merged into the typeahead option. Uses ilike with the exact
// patient_name first, then a token-based fallback so 'Jones, Kirk' will
// still hit rows stored as 'Kirk Jones'. Returns a single merged object
// with the most-specific non-null value per field.
async function enrichPatient(patientName) {
  if (!patientName) return null;
  const trimmed = patientName.trim();
  if (!trimmed) return null;
  const tokens = trimmed.replace(/[,.;]/g, ' ').split(/\s+/).filter(Boolean);
  // Match patient_name that contains every token in any order.
  const tokenFilter = tokens.length > 0
    ? tokens.map(t => `patient_name.ilike.%${t}%`).join(',')
    : `patient_name.ilike.%${trimmed}%`;

  try {
    const [intakeRes, authRes, censusRes] = await Promise.all([
      supabase.from('intake_referrals')
        .select('patient_name, dob, region, insurance, policy_number, phone, contact_number, location, city, zip_code, county, pcp_name, pcp_phone, pcp_fax, diagnosis_clean, diagnosis, medicare_type, secondary_insurance, secondary_id')
        .or(tokenFilter).order('created_at', { ascending: false }).limit(5),
      supabase.from('auth_tracker')
        .select('patient_name, dob, region, insurance, insurance_type, member_id, phone, pcp_name, pcp_phone, pcp_fax, pcp_facility, diagnosis_code, requesting_provider, requesting_provider_npi')
        .or(tokenFilter).order('updated_at', { ascending: false }).limit(5),
      supabase.from('census_data')
        .select('patient_name, region, insurance, address, has_wound, wound_type, current_visit_cadence, inferred_frequency')
        .or(tokenFilter).limit(5),
    ]);
    // Confirm matches: all tokens present in returned name (avoid false
    // positives like "Jones, Kirk" matching "Kirk Smith" via just "Kirk").
    function isRealMatch(row) {
      if (!row?.patient_name) return false;
      const n = row.patient_name.toLowerCase();
      return tokens.every(t => n.includes(t.toLowerCase()));
    }
    const intakeRows = (intakeRes.data || []).filter(isRealMatch);
    const authRows   = (authRes.data   || []).filter(isRealMatch);
    const censusRows = (censusRes.data || []).filter(isRealMatch);
    if (intakeRows.length === 0 && authRows.length === 0 && censusRows.length === 0) {
      return null;
    }
    // Collapse to one object, most-recent values winning.
    const out = {};
    function absorb(rows) {
      rows.forEach(r => {
        Object.entries(r).forEach(([k, v]) => {
          if (v !== null && v !== undefined && v !== '' &&
              (out[k] === null || out[k] === undefined || out[k] === '')) {
            out[k] = v;
          }
        });
      });
    }
    absorb(intakeRows);
    absorb(authRows);
    absorb(censusRows);
    return out;
  } catch (e) {
    console.warn('[enrichPatient] failed', e?.message || e);
    return null;
  }
}

function matchCarrier(rawInsurance, current, carriers) {
  if (!rawInsurance) return current;
  // strip "X - " region prefix from messy auth_tracker / intake_referrals values
  const norm = rawInsurance.replace(/^[A-Z]\s*-\s*/, '').trim().toLowerCase();
  const found = carriers.find(c => c.insurance_name.toLowerCase() === norm
                                  || norm.includes(c.insurance_name.toLowerCase())
                                  || c.insurance_name.toLowerCase().includes(norm));
  return found ? found.insurance_name : current;
}

function toFormData(d) {
  // Strip the top-level snapshot fields the row already has columns for.
  const { patient_name, patient_dob, insurance_name, insurance_type, region, requires_prior_auth, manual_patient, ...rest } = d;
  return rest;
}

function fromFormRow(row) {
  return {
    patient_name:        row.patient_name || '',
    patient_dob:         row.patient_dob || '',
    insurance_name:      row.insurance_name || 'Humana',
    insurance_type:      row.insurance_type || '',
    region:              row.region || '',
    requires_prior_auth: row.requires_prior_auth !== false,
    manual_patient:      false,
    ...(row.form_data || {}),
    request_type:        row.request_type || (row.form_data || {}).request_type || 'new_patient',
  };
}

function emptyRow() {
  return { id: '', form_data: {}, requires_prior_auth: true, status: 'draft', version_number: 1 };
}

// ===================== presentational =====================

function Section({ title, children }) {
  return (
    <div style={S.section}>
      <div style={S.sectionTitle}>{title}</div>
      <div>{children}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={S.field}>
      <div style={S.fieldLabel}>{label}</div>
      {children}
    </div>
  );
}

function ViewBtn({ label, active, onClick }) {
  return <button onClick={onClick} style={{ ...S.viewBtn, ...(active ? S.viewBtnActive : {}) }}>{label}</button>;
}

function Badge({ status }) {
  const s = getStatus(status);
  return <span style={{ fontSize: 10, fontWeight: 700, color: s.color, background: s.bg, padding: '2px 8px', borderRadius: 999 }}>{s.label}</span>;
}

// 2026-06-03 redesign per Liam:
//   * Patient is the primary input, sits at the top, drives autofill.
//   * When Insurance Carrier / Plan Type are set BEFORE picking a patient,
//     the typeahead narrows to that filtered census slice.
//   * Keyboard nav (up/down/enter/escape) + rich row preview + match
//     highlight + "Use as new patient" fallback when no hits.
function PatientTypeahead({
  value, disabled, options, onSelect, onManualChange,
  filterInsurance, filterPlanType, carriers,
}) {
  const [q, setQ]           = useState(value || '');
  const [open, setOpen]     = useState(false);
  const [hover, setHover]   = useState(0);
  useEffect(() => { setQ(value || ''); }, [value]);

  // Normalize the carrier filter to handle the messy `auth_tracker.insurance`
  // values like "A - Humana" we merged in. Insurance equality is loose-match.
  const carrierMatches = useCallbackInsurance(filterInsurance, carriers);

  const filtered = useMemo(() => {
    const needle = (q || '').trim().toLowerCase();
    let pool = options;
    if (filterInsurance && filterInsurance !== '' && filterInsurance !== 'Other') {
      pool = pool.filter(p => carrierMatches(p.insurance));
    }
    if (filterPlanType) {
      // Plan type only exists on auth_tracker-sourced rows. If we filter,
      // we keep rows where insurance_type matches OR is null (unknown).
      const planN = filterPlanType.toLowerCase();
      pool = pool.filter(p => {
        const t = (p.insurance_type || '').toLowerCase();
        if (!t) return true;
        return t === planN;
      });
    }
    if (!needle) return pool.slice(0, 80);
    return pool
      .filter(p => (p.patient_name || '').toLowerCase().includes(needle))
      .slice(0, 80);
  }, [q, options, filterInsurance, filterPlanType, carrierMatches]);

  // Reset hover when filtered list changes so up/down lands on a valid row.
  useEffect(() => { setHover(0); }, [q, filterInsurance, filterPlanType]);

  function pick(p) {
    if (!p) return;
    onSelect(p);
    setQ(p.patient_name);
    setOpen(false);
  }

  function onKey(e) {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHover(h => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setHover(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter')     { e.preventDefault(); if (filtered[hover]) pick(filtered[hover]); }
    else if (e.key === 'Escape')    { setOpen(false); }
  }

  const showNoMatch = open && q.trim() && filtered.length === 0;

  return (
    <div style={{ position: 'relative' }}>
      <div style={S.fieldLabel}>
        Patient Name {(filterInsurance || filterPlanType) ? (
          <span style={S.filterTag}>
            Filtered by {[filterInsurance, filterPlanType].filter(Boolean).join(' / ')}
          </span>
        ) : null}
      </div>
      <input
        value={q}
        disabled={disabled}
        autoFocus
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        onChange={e => { setQ(e.target.value); onManualChange(e.target.value); setOpen(true); }}
        onKeyDown={onKey}
        placeholder={options.length === 0
          ? 'Loading patient census...'
          : 'Start typing - matches from census, referrals, and auth tracker'}
        style={{ ...S.input, fontSize: 14, padding: '10px 12px' }}
      />
      {open && filtered.length > 0 && (
        <div style={S.suggest}>
          <div style={S.suggestMeta}>
            {filtered.length} match{filtered.length === 1 ? '' : 'es'}
            {q.trim() ? ` for "${q.trim()}"` : ''}
            {(filterInsurance || filterPlanType) ? ' (filtered)' : ''}
          </div>
          {filtered.map((p, i) => {
            const isHover = i === hover;
            return (
              <div key={(p.patient_name || '') + i}
                   style={{ ...S.suggestRow, background: isHover ? '#FEF7F5' : '#fff' }}
                   onMouseEnter={() => setHover(i)}
                   onMouseDown={() => pick(p)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#1A1A1A' }}>
                    {highlight(p.patient_name, q)}
                  </div>
                  <div style={{ fontSize: 10, color: '#9CA3AF', fontFamily: 'ui-monospace, Menlo, monospace' }}>
                    {p.dob ? fmtDob(p.dob) : ''}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#6B7280', marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <span>{p.insurance || 'No insurance on file'}{p.insurance_type ? ' (' + p.insurance_type + ')' : ''}</span>
                  <span>Region {p.region || '-'}</span>
                  <span style={{ color: '#9CA3AF' }}>via {p.source || 'system'}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {showNoMatch && (
        <div style={S.suggest}>
          <div style={S.suggestMeta}>No matches found in census / referrals / auth tracker.</div>
          <div style={{ ...S.suggestRow, background: '#fff' }}
               onMouseDown={() => { onManualChange(q.trim()); setOpen(false); }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#D94F2B' }}>
              + Use "{q.trim()}" as a new patient
            </div>
            <div style={{ fontSize: 11, color: '#6B7280', marginTop: 3 }}>
              You will need to fill in DOB, address, insurance, etc. manually.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Inline match-highlight: bolds the matched substring.
function highlight(text, needle) {
  if (!text || !needle) return text || '';
  const n = needle.trim().toLowerCase();
  if (!n) return text;
  const i = text.toLowerCase().indexOf(n);
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <span style={{ background: '#FEE4B7', color: '#7C2D12', borderRadius: 2, padding: '0 1px' }}>
        {text.slice(i, i + n.length)}
      </span>
      {text.slice(i + n.length)}
    </>
  );
}

function fmtDob(d) {
  if (!d) return '';
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T00:00:00') : new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
}

// Returns a stable function that decides whether a candidate patient's
// `insurance` field matches the chosen carrier filter. Handles the messy
// `auth_tracker.insurance` strings (region-prefixed) by stripping them
// before comparison.
function useCallbackInsurance(filterCarrier, carriers) {
  return useCallback((insuranceValue) => {
    if (!filterCarrier) return true;
    if (!insuranceValue) return false;
    const norm = String(insuranceValue).replace(/^[A-Z]\s*-\s*/, '').trim().toLowerCase();
    const target = filterCarrier.trim().toLowerCase();
    if (norm === target) return true;
    if (norm.includes(target) || target.includes(norm)) return true;
    return false;
  }, [filterCarrier, carriers]);
}

// ===================== styles =====================

const S = {
  viewBar: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderBottom: '1px solid #E5E7EB', background: '#FAFAFA' },
  viewBtn: { padding: '6px 12px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: '#374151' },
  viewBtnActive: { background: '#D94F2B', color: '#fff', borderColor: '#D94F2B' },
  cptSeedNotice: { fontSize: 11, color: '#92400E', background: '#FEF3C7', padding: '4px 10px', borderRadius: 6, border: '1px solid #FCD34D' },

  layout: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 20, padding: 20 },
  leftCol: { minWidth: 0 },
  rightCol: { minWidth: 0 },
  sticky: { position: 'sticky', top: 80, display: 'flex', flexDirection: 'column', gap: 10 },

  section: { background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: 16, marginBottom: 14 },
  sectionTitle: { fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#D94F2B', marginBottom: 12, borderBottom: '1px solid #F3F4F6', paddingBottom: 8 },
  field: { marginBottom: 12 },
  fieldLabel: { fontSize: 11, fontWeight: 600, color: '#6B7280', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' },
  input: { width: '100%', padding: '7px 10px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, background: '#fff', boxSizing: 'border-box' },
  checkLabel: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#1A1A1A', cursor: 'pointer' },
  charCount: { fontSize: 10, color: '#9CA3AF', textAlign: 'right', marginTop: 2 },

  suggest: { position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #D1D5DB', borderRadius: 8, marginTop: 4, maxHeight: 340, overflowY: 'auto', boxShadow: '0 12px 28px rgba(0,0,0,0.14)', zIndex: 500 },
  suggestRow: { padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid #F3F4F6' },
  suggestMeta: { padding: '6px 12px', fontSize: 10, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB' },
  filterTag: { fontSize: 9, fontWeight: 700, color: '#7C2D12', background: '#FEE4B7', padding: '2px 6px', borderRadius: 999, marginLeft: 6, textTransform: 'none', letterSpacing: 'normal' },
  hint: { fontSize: 11, color: '#6B7280', marginTop: 6, lineHeight: 1.4 },

  tabBtn: { padding: '5px 10px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontSize: 12, color: '#374151' },
  tabBtnActive: { background: '#1A1A1A', color: '#fff', borderColor: '#1A1A1A' },
  cptSearch: { width: '100%', padding: '8px 32px 8px 12px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, background: '#fff', boxSizing: 'border-box', outline: 'none' },
  cptSearchClear: { position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 22, height: 22, borderRadius: '50%', border: 'none', background: '#E5E7EB', color: '#374151', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 },
  cptList: { maxHeight: 280, overflowY: 'auto', border: '1px solid #F3F4F6', borderRadius: 6 },
  cptRow: { display: 'grid', gridTemplateColumns: '24px 70px 1fr', gap: 8, padding: '8px 10px', borderBottom: '1px solid #F3F4F6', alignItems: 'center' },
  cptRowOn: { background: '#FEF7F5' },
  cptCode: { fontFamily: 'ui-monospace, Menlo, monospace', fontWeight: 700, fontSize: 12 },
  cptDesc: { fontSize: 12, color: '#374151' },
  cptQty: { width: '100%', padding: '4px 6px', border: '1px solid #D94F2B', borderRadius: 4, fontSize: 12, fontWeight: 700, textAlign: 'center', background: '#fff', boxSizing: 'border-box' },
  cptQtyPlaceholder: { fontSize: 10, color: '#D1D5DB', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.06em' },

  listWrap: { padding: 20, display: 'flex', flexDirection: 'column', gap: 6 },
  listRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, cursor: 'pointer' },
  listName: { fontSize: 14, fontWeight: 600, color: '#1A1A1A' },
  listSub: { fontSize: 11, color: '#6B7280', marginTop: 2 },
  empty: { padding: 40, textAlign: 'center', color: '#9CA3AF', fontSize: 13 },

  primaryBtn: { padding: '10px 14px', borderRadius: 8, border: 'none', background: '#D94F2B', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 14 },
  outlineBtn: { padding: '10px 14px', borderRadius: 8, border: '1px solid #D1D5DB', background: '#fff', color: '#1A1A1A', fontWeight: 600, cursor: 'pointer', fontSize: 13 },
  sendBtn:    { padding: '10px 14px', borderRadius: 8, border: 'none', background: '#065F46', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 14 },

  noAuthBanner: { background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 8, padding: '10px 12px', color: '#92400E', marginBottom: 14, fontSize: 13 },
  lockedBanner: { background: '#F3F4F6', border: '1px solid #D1D5DB', borderRadius: 8, padding: '10px 12px', color: '#374151', marginBottom: 14, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  amendBtn: { padding: '4px 10px', borderRadius: 6, border: '1px solid #D94F2B', color: '#D94F2B', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 },

  previewCard: { background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 12 },
  previewTitle: { fontSize: 13, fontWeight: 700, color: '#1A1A1A' },
  previewSub: { fontSize: 11, color: '#6B7280', marginTop: 6, lineHeight: 1.5 },
  previewStatus: { fontSize: 11, color: '#6B7280', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 },

  msg: { padding: '8px 10px', borderRadius: 6, fontSize: 12 },
  msgOk: { background: '#ECFDF5', color: '#065F46', border: '1px solid #A7F3D0' },
  msgErr: { background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA' },

  legalNote: { fontSize: 10, color: '#9CA3AF', lineHeight: 1.4, marginTop: 6, padding: '0 4px' },

  infoNote: { background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: '8px 10px', color: '#1E40AF', marginTop: 6, fontSize: 12, lineHeight: 1.4 },
  warnNote: { background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 8, padding: '8px 10px', color: '#92400E', marginTop: 6, fontSize: 12, lineHeight: 1.4 },
  previewHint: { fontSize: 10, color: '#9CA3AF', lineHeight: 1.4, marginTop: -2, padding: '0 4px' },

  templateBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: '8px 10px', marginBottom: 10 },
  templateBtn: { padding: '6px 12px', borderRadius: 6, border: 'none', background: '#1E40AF', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 12 },

  selHead: { fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' },
  selTableHead: { display: 'grid', gridTemplateColumns: '70px 60px 60px 1fr 24px', gap: 8, fontSize: 9, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0 2px 4px' },
  selRow: { display: 'grid', gridTemplateColumns: '70px 60px 60px 1fr 24px', gap: 8, alignItems: 'center', padding: '4px 2px', borderBottom: '1px solid #F3F4F6' },
  selCode: { fontFamily: 'ui-monospace, Menlo, monospace', fontWeight: 700, fontSize: 12, color: '#1A1A1A' },
  selInput: { width: '100%', padding: '5px 6px', border: '1px solid #D1D5DB', borderRadius: 5, fontSize: 12, textAlign: 'center', background: '#fff', boxSizing: 'border-box' },
  selInputWide: { width: '100%', padding: '5px 8px', border: '1px solid #D1D5DB', borderRadius: 5, fontSize: 12, background: '#fff', boxSizing: 'border-box' },
  selRemove: { width: 22, height: 22, borderRadius: 5, border: '1px solid #FECACA', background: '#fff', color: '#991B1B', fontWeight: 700, fontSize: 11, cursor: 'pointer', padding: 0 },

  customCptBox: { marginTop: 12, padding: 12, border: '1px dashed #D1D5DB', borderRadius: 8, background: '#FAFAFA' },
  cptReqRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '3px 0' },
  cptReqPending: { fontSize: 9, fontWeight: 700, color: '#92400E', background: '#FEF3C7', padding: '1px 6px', borderRadius: 999, marginLeft: 'auto' },

  previewOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
  previewModal: { background: '#fff', borderRadius: 12, width: '100%', maxWidth: 900, height: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,0.35)' },
  previewBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', borderBottom: '1px solid #E5E7EB', background: '#fff' },
  previewFrame: { flex: 1, width: '100%', border: 'none', background: '#525659' },
};
