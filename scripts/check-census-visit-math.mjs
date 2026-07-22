// =====================================================================
// check-census-visit-math.mjs        run with:  npm run check
//
// Dependency-free assertions over the two pure modules that every revenue
// and census number on the dashboards is derived from:
//   src/lib/visitMath.js     — visit classification + slot counting
//   src/lib/censusStatus.js  — census status normalization + buckets
//
// These exist because CLAUDE.md's "Things that broke before" list is
// mostly this same class of defect recurring: the $185-vs-$230 rate
// drift, the Mon-Sun vs Sun-Sat week drift, the 1000-row truncation, the
// Pariox cancelled-as-Completed overcount, and the ghost-row inflation.
// Every one shipped because the math had no executable definition of
// correct. Each assertion below pins one real production trap.
//
// Pure functions only — no network, no auth, no fixtures on disk. Runs in
// well under a second, so there is no excuse to skip it before `ship`.
// =====================================================================
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const R = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib') + '/';
const {classifyWeekSlots}=await import(R+'visitMath.js');
const {dedupVisitsByLatestUpload,dedupVisitsByAuthoritativeBatch}=await import(R+'visitDedup.js');
const {bucketCensus,normalizeStatus,isLiveRoster}=await import(R+'censusStatus.js');
let fail=0;
const eq=(n,a,b)=>{const p=JSON.stringify(a)===JSON.stringify(b);if(!p)fail++;console.log((p?'PASS ':'FAIL ')+n+(p?'':`  got ${JSON.stringify(a)} want ${JSON.stringify(b)}`));};
// Subset compare — asserts only the named fields, so adding a return field to
// classifyWeekSlots doesn't break every assertion that never cared about it.
const eqPart=(n,a,b)=>{const got={};for(const k of Object.keys(b))got[k]=a[k];eq(n,got,b);};

// --- Pariox trap 1: cancelled masquerading as Completed
const V=(p,d,s,e,u='2026-07-20T10:00:00Z')=>({patient_name:p,visit_date:d,status:s,event_type:e,uploaded_at:u,staff_name:'X'});
eqPart('cancel-as-completed is NOT billable',
  classifyWeekSlots([V('A','2026-07-20','Completed','Cancelled Treatment *e*')]),
  {completed:0,missed:0,cancelled:1,scheduled:0,booked:0,slots:1});

// --- Pariox trap 2: cancelled masquerading as Scheduled
eqPart('cancel-as-scheduled is not booked work',
  classifyWeekSlots([V('B','2026-07-20','Scheduled','Cancelled Treatment *e*')]),
  {completed:0,missed:0,cancelled:1,scheduled:0,booked:0,slots:1});

// --- co-treat: two clinicians, same slot, same batch => ONE encounter
// Same clinician twice on one slot: one visit, one encounter.
eqPart('co-treat collapses to one slot',
  classifyWeekSlots([V('C','2026-07-20','Completed','Lymphedema Visit *e*'),
                     V('C','2026-07-20','Completed','Lymphedema Visit - Level 2 *e*')]),
  {completed:1,missed:0,cancelled:0,scheduled:0,booked:1,slots:1});

// TWO clinicians on one slot: 2 visits (scheduling unit) but 1 billable
// encounter. Conflating these is what made Director Command read 924 when
// the schedule said 764.
const ct=[{...V('CT','2026-07-20','Scheduled','Lymphedema Visit *e*'),staff_name:'PT One'},
          {...V('CT','2026-07-20','Scheduled','Lymphedema Visit *e*'),staff_name:'PTA Two'}];
eqPart('co-treat is 2 visits but 1 encounter',
  classifyWeekSlots(ct), {booked:1,bookedVisits:2,scheduled:1,scheduledVisits:2,visitRows:2});

// --- precedence: a delivered slot with a stale Scheduled row counts once, as completed
eqPart('completed beats leftover scheduled',
  classifyWeekSlots([V('D','2026-07-20','Scheduled','Lymphedema Visit'),
                     V('D','2026-07-20','Completed','Lymphedema Visit')]),
  {completed:1,missed:0,cancelled:0,scheduled:0,booked:1,slots:1});

// --- additivity: booked === completed + missed + scheduled, always
const mix=[V('E','2026-07-20','Completed','Visit'),V('F','2026-07-20','Missed','Visit'),
           V('G','2026-07-20','Scheduled','Visit'),V('H','2026-07-20','Scheduled','Cancelled Treatment')];
const s=classifyWeekSlots(mix);
eq('counts are additive', s.booked, s.completed+s.missed+s.scheduled);
eqPart('cancelled excluded from booked', s, {completed:1,missed:1,cancelled:1,scheduled:1,booked:3,slots:4});

// --- ghost rows: reassigned staff across uploads, older row must die
const ghost=[V('I','2026-07-20','Scheduled','Visit','2026-07-01T00:00:00Z'),
             V('I','2026-07-20','Completed','Visit','2026-07-19T00:00:00Z')];
eqPart('ghost row dropped before counting',
  classifyWeekSlots(dedupVisitsByLatestUpload(ghost)),
  {completed:1,missed:0,cancelled:0,scheduled:0,booked:1,slots:1});

// --- authoritative-batch dedup (Rule C) ------------------------------
// Pariox re-exports the whole week each morning. A slot the new snapshot
// DROPS (cancelled/rescheduled) must die; per-(patient,date) dedup can't
// see that because there is no newer row for that key to win.
const B=(p,d,s_,u,st='Staff')=>({patient_name:p,visit_date:d,status:s_,event_type:'Visit',uploaded_at:u,staff_name:st});
const snapOld=[B('P1','2026-07-20','Scheduled','2026-07-13T11:00:00Z'),
               B('P2','2026-07-20','Scheduled','2026-07-13T11:00:00Z'),
               B('P3','2026-07-20','Scheduled','2026-07-13T11:00:00Z')];
// new full snapshot for the same date keeps only P1 and P2 -> P3 was dropped
const snapNew=[B('P1','2026-07-20','Completed','2026-07-21T11:00:00Z'),
               B('P2','2026-07-20','Scheduled','2026-07-21T11:00:00Z')];
eq('stale slot survives old per-key rule (the bug)',
  dedupVisitsByLatestUpload([...snapOld,...snapNew]).length, 3);
eq('authoritative batch drops the stale slot',
  dedupVisitsByAuthoritativeBatch([...snapOld,...snapNew]).map(r=>r.patient_name).sort(), ['P1','P2']);

// A SMALL partial upload must NOT wipe a date -- this is the documented
// Brian Espinola 19-vs-22 undercount that the naive "latest batch per date"
// fix caused. The delta ADDS its row and leaves the rest of the day intact.
const partial=[B('P9','2026-07-20','Scheduled','2026-07-22T11:00:00Z')];
eq('small partial batch adds without emptying the date',
  dedupVisitsByAuthoritativeBatch([...snapOld,...partial]).map(r=>r.patient_name).sort(),
  ['P1','P2','P3','P9']);

// A delta arriving AFTER the governing snapshot must win for its own slot.
const late=[B('P2','2026-07-20','Completed','2026-07-22T09:00:00Z')];
eq('later delta overrides the snapshot for its slot',
  dedupVisitsByAuthoritativeBatch([...snapOld,...snapNew,...late])
    .filter(r=>r.patient_name==='P2').map(r=>r.status), ['Completed']);

// Dates no snapshot ever covered must not be silently emptied.
eq('date with no snapshot keeps its rows',
  dedupVisitsByAuthoritativeBatch([B('PX','2026-08-01','Scheduled','2026-07-13T11:00:00Z'),
                                   ...snapOld,...snapNew])
    .filter(r=>r.visit_date==='2026-08-01').length, 1);

// --- census: Pariox 20-char truncation must not fall into "Active"
eq('truncated status repaired', normalizeStatus('Active - Auth Pendin'), 'Active - Auth Pending');
eq('casing drift repaired', normalizeStatus('active'), 'Active');
eq('non-admit is not live roster', isLiveRoster('Non-Admit'), false);
eq('discharge variant is not live roster', isLiveRoster('Discharge - Change I'), false);

const C=(st,lv,fs,ov)=>({status:st,last_visit_date:lv,first_seen_date:fs,days_overdue:ov});
const old='2026-01-01', recent='2026-07-19';
const cen=[
  C('Active',recent,old,0), C('Active',null,old,5), C('active',recent,old,0),
  C('Active - Auth Pendin',recent,old,0),
  C('SOC Pending',null,old,0),      // never seen, aged -> risk
  C('SOC Pending',null,recent,0),   // never seen but new -> NOT risk
  C('Waitlist',null,old,0),
  C('On Hold - Facility',recent,old,0), C('On Hold',recent,old,0),
  C('Hospitalized',recent,old,0), C('Recert/DC Pending',null,old,0),
  C('Discharge',recent,old,0), C('Discharge - Change I',recent,old,0), C('Non-Admit',null,old,0),
];
const cb=bucketCensus(cen);
eq('Active excludes auth-pending', cb.byKey.active.count, 3);
eq('auth-pending is its own bucket', cb.byKey.active_auth.count, 1);
eq('discharged counted separately', cb.discharged, 2);
eq('non-admit counted separately', cb.nonAdmit, 1);
eq('live roster excludes both', cb.liveRoster, 11);
eq('buckets sum to live roster', cb.buckets.reduce((a,b)=>a+b.count,0), cb.liveRoster);
eq('reconciliation identity holds', cb.total, cb.liveRoster+cb.discharged+cb.nonAdmit);
eq('no unmapped statuses', cb.unmapped, []);
eq('on-hold sub-types roll up', cb.byKey.on_hold.count, 2);
eq('never-seen risk respects age gate', cb.byKey.soc_pending.riskCount, 1);
eq('overdue risk on active', cb.byKey.active.riskCount, 1);

// --- unmapped guard actually fires
eq('unknown status surfaces in unmapped',
  bucketCensus([C('Pending Martian Review',null,old,0)]).unmapped,
  [{status:'Pending Martian Review',count:1}]);

// --- Medicare archive eligibility (2026-07-21) ------------------------
// Guards the Archive button on MedicareTrackerPage. The visit check is the
// one that matters: status is editable, a completed visit is a billing fact,
// and archiving a patient we actually treated would hide revenue.
const {canArchiveFlag,archiveWarnings}=await import(R+'medicareArchive.js');
const F=(o={})=>({patient_status:'Non-Admit',total_completed_visits:0,archived_at:null,...o});
eq('non-admit with 0 visits is archivable', canArchiveFlag(F()), true);
eq('non-admit with visits is NOT archivable', canArchiveFlag(F({total_completed_visits:3})), false);
eq('active status is NOT archivable', canArchiveFlag(F({patient_status:'Active'})), false);
eq('soc pending is NOT archivable', canArchiveFlag(F({patient_status:'SOC Pending'})), false);
eq('already-archived is NOT archivable', canArchiveFlag(F({archived_at:'2026-07-21T00:00:00Z'})), false);
eq('null visit count treated as zero', canArchiveFlag(F({total_completed_visits:null})), true);
eq('case/space drift still archivable', canArchiveFlag(F({patient_status:' non-admit '})), true);
eq('missing flag is not archivable', canArchiveFlag(null), false);

// Warnings never block; they must SURFACE the two real conflicts.
eq('census mismatch warns',
  archiveWarnings(F(),{status:'SOC Pending',last_visit_date:null}).length, 1);
eq('recorded visit warns',
  archiveWarnings(F(),{status:'Non-Admit',last_visit_date:'2026-07-17'}).length, 1);
eq('both conflicts warn twice',
  archiveWarnings(F(),{status:'Waitlist',last_visit_date:'2026-05-29'}).length, 2);
eq('clean row warns not at all',
  archiveWarnings(F(),{status:'Non-Admit',last_visit_date:null}), []);
eq('missing census row warns',
  archiveWarnings(F(),undefined).length, 1);

// =====================================================================
// staffMatch.js — roster/schedule reconciliation
//
// Every assertion below pins a defect measured in production on
// 2026-07-22 against the week of 2026-07-12. See the module header.
// =====================================================================
const {staffKey,flipName,visitStaffName,buildStaffIndex,matchStaff,reconcileRoster}=await import(R+'staffMatch.js');

// --- Name format: the join that silently matched zero rows
eq('flipName converts Pariox "Last, First"', flipName('Taylor, Natalie'), 'Natalie Taylor');
eq('flipName leaves "First Last" alone', flipName('Andrea Schwab'), 'Andrea Schwab');
eq('flipName survives a missing first name', flipName('Taylor,'), 'Taylor');
eq('flipName is null-safe', flipName(null), '');
eq('staffKey ignores case, spacing and punctuation',
  staffKey('  Mary  Devota   Dubach '), staffKey('mary devota dubach'));
eq('visitStaffName prefers the normalized column',
  visitStaffName({staff_name:'Balogun, Abi', staff_name_normalized:'Abi Balogun'}), 'Abi Balogun');
eq('visitStaffName falls back to flipping the raw column',
  visitStaffName({staff_name:'Taylor, Natalie'}), 'Natalie Taylor');

// --- Nickname drift: Abiola/Abi and Nicholas/Nick were counted as idle
// clinicians AND as unrostered staff simultaneously.
const ROSTER=[
  {full_name:'Abiola Balogun', weekly_visit_target:25},
  {full_name:'Andrea Schwab',  weekly_visit_target:20},
  {full_name:'Lia Davis',      weekly_visit_target:25},
];
const IDX=buildStaffIndex(ROSTER);
eq('exact match wins', matchStaff(IDX,'Andrea Schwab').via, 'exact');
eq('nickname resolves to the roster name',
  matchStaff(IDX,'Abi Balogun').clinician.full_name, 'Abiola Balogun');
eq('nickname match is flagged as an alias', matchStaff(IDX,'Abi Balogun').via, 'alias');
eq('unknown name stays unmatched', matchStaff(IDX,'Nobody Here').clinician, null);

// An alias shared by two roster rows must NEVER silently merge them —
// combining two clinicians' visit counts is worse than reporting neither.
const AMBIG=buildStaffIndex([
  {full_name:'John Smith', weekly_visit_target:10},
  {full_name:'Jane Smith', weekly_visit_target:10},
]);
eq('ambiguous alias refuses to guess', matchStaff(AMBIG,'J Smith').clinician, null);

// --- Phantom capacity: the header prints claimed, not deliverable
const D=new Map([['abi balogun',18],['andrea schwab',20],['ghost person',9]]);
const REC=reconcileRoster(ROSTER,D);
eq('claimed capacity is the raw roster sum', REC.claimedCapacity, 70);
eq('working capacity excludes clinicians who delivered nothing', REC.workingCapacity, 45);
eq('phantom capacity is the difference', REC.phantomCapacity, 25);
eq('nickname visits are credited to the roster, not lost', REC.deliveredTotal, 38);
eq('alias matches are surfaced so the roster can be fixed', REC.aliasMatches.length, 1);
eq('unrostered deliverers are surfaced, not silently dropped',
  REC.scheduleOnly, [{name:'ghost person', visits:9}]);
eq('idle roster rows are surfaced with their target',
  REC.rosterOnly, [{name:'Lia Davis', target:25, discipline:undefined, region:undefined}]);
// 38/45, NOT 38/70 — utilization measured against capacity that exists.
eq('utilization uses working capacity as the denominator', REC.utilizationPct, 84);
eq('empty roster does not divide by zero', reconcileRoster([],new Map()).utilizationPct, null);
eq('null inputs are safe', reconcileRoster(null,null).claimedCapacity, 0);

console.log(fail?`\n${fail} FAILED`:'\nAll assertions passed');
process.exit(fail?1:0);
