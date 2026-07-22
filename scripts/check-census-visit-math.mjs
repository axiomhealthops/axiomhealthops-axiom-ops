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
const {staffKey,flipName,visitStaffName,buildStaffIndex,matchStaff,reconcileRoster,isContracted,isReserve,
       isPerDiem,flagOverCap,capFor}=await import(R+'staffMatch.js');

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
  {full_name:'Abiola Balogun', weekly_visit_target:25, aliases:['Abi Balogun']},
  {full_name:'Andrea Schwab',  weekly_visit_target:20},
  {full_name:'Lia Davis',      weekly_visit_target:25},
];
const IDX=buildStaffIndex(ROSTER);
eq('exact match wins', matchStaff(IDX,'Andrea Schwab').via, 'exact');
eq('maintained alias resolves to the roster name',
  matchStaff(IDX,'Abi Balogun').clinician.full_name, 'Abiola Balogun');
eq('maintained alias is a clean match, not a guess', matchStaff(IDX,'Abi Balogun').via, 'alias');
eq('unknown name stays unmatched', matchStaff(IDX,'Nobody Here').clinician, null);

// The maintained `aliases` column is the ONLY tier that catches drift a
// surname heuristic cannot: different surname, or a discipline baked into
// the name. All four of these are real rows in production.
const REAL=buildStaffIndex([
  {full_name:'Marlene Ortega',     weekly_visit_target:15, aliases:['Marlene Olea']},
  {full_name:'Dawn Felix-Dawn',    weekly_visit_target:15, aliases:['Dawn Felix Wall']},
  {full_name:'Edna Mccall',        weekly_visit_target:10, aliases:['Edna PTA McCall']},
  {full_name:'Mary Devota Dubach', weekly_visit_target:10, aliases:['Devota Dubach']},
]);
eq('alias with a different surname resolves',
  matchStaff(REAL,'Marlene Olea').clinician.full_name, 'Marlene Ortega');
eq('alias with a changed surname resolves',
  matchStaff(REAL,'Dawn Felix Wall').clinician.full_name, 'Dawn Felix-Dawn');
eq('alias with an embedded discipline resolves',
  matchStaff(REAL,'Edna PTA McCall').clinician.full_name, 'Edna Mccall');
eq('alias with a dropped first name resolves',
  matchStaff(REAL,'Devota Dubach').clinician.full_name, 'Mary Devota Dubach');

// A real clinician's own name must never be shadowed by someone's alias.
const SHADOW=buildStaffIndex([
  {full_name:'Chris Young', weekly_visit_target:10},
  {full_name:'Christopher Elder', weekly_visit_target:10, aliases:['Chris Young']},
]);
eq('an alias never shadows a real clinician name',
  matchStaff(SHADOW,'Chris Young').clinician.full_name, 'Chris Young');

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
eq('alias visits are credited to the roster, not lost', REC.deliveredTotal, 38);
eq('a maintained alias is not reported as an exception', REC.heuristicMatches.length, 0);
// A guess IS reported, so the pairing can be promoted into `aliases`.
const GUESS=reconcileRoster(
  [{full_name:'Nicholas DeCandia', weekly_visit_target:25}],
  new Map([['nick decandia',12]]));
eq('an unmaintained guess is surfaced for promotion', GUESS.heuristicMatches,
  [{scheduleName:'nick decandia', rosterName:'Nicholas DeCandia', visits:12}]);
eq('a guessed match still credits the visits', GUESS.deliveredTotal, 12);
eq('unrostered deliverers are surfaced, not silently dropped',
  REC.scheduleOnly, [{name:'ghost person', visits:9}]);
eq('idle roster rows are surfaced with their target',
  REC.rosterOnly, [{name:'Lia Davis', target:25, discipline:undefined, region:undefined}]);
// 38/45, NOT 38/70 — utilization measured against capacity that exists.
eq('utilization uses working capacity as the denominator', REC.utilizationPct, 84);

// --- Assignment gap: visits to BOOK to bring contracted staff to target.
// Per diem is excluded. Its target of 10 is an alert threshold, not a
// commitment (see the set_visit_target trigger), so counting it as
// capacity-to-fill would invent an obligation and inflate the gap.
const GAPROSTER=[
  {full_name:'Full Timer',  employment_type:'ft',  weekly_visit_target:25},
  {full_name:'Part Timer',  employment_type:'pt',  weekly_visit_target:15},
  {full_name:'Per Diemer',  employment_type:'prn', weekly_visit_target:10},
];
const GAP=reconcileRoster(GAPROSTER,new Map([
  ['full timer',18],   // 7 short
  ['part timer',9],    // 6 short
  ['per diemer',2],    // 8 "short" — must NOT count
]));
eq('committed capacity excludes per diem', GAP.committedCapacity, 40);
eq('assignment gap excludes per diem', GAP.assignmentGap, 13);
eq('committed utilization is measured on contracted staff only',
  GAP.committedUtilizationPct, 68);
eq('under-target list excludes per diem and sorts worst first',
  GAP.underTarget.map(u=>[u.name,u.short]), [['Full Timer',7],['Part Timer',6]]);
// A clinician at or over target contributes nothing to the gap.
eq('meeting target contributes no gap',
  reconcileRoster([{full_name:'At Target',employment_type:'ft',weekly_visit_target:25}],
    new Map([['at target',25]])).assignmentGap, 0);
eq('exceeding target never produces a negative gap',
  reconcileRoster([{full_name:'Over',employment_type:'ft',weekly_visit_target:25}],
    new Map([['over',30]])).assignmentGap, 0);

// --- Reserve tier: non-treating ADOCs (Liam 2026-07-22). They are
// full-time employees who no longer owe a caseload. They must not inflate
// contracted capacity, must not appear as "under target", and must not
// be counted as idle capacity — but visits they DO deliver are real.
const RES=[
  {full_name:'Working FT', employment_type:'ft', weekly_visit_target:25, is_treating:true},
  {full_name:'Lia Davis',  employment_type:'ft', weekly_visit_target:0,  is_treating:false},
  {full_name:'Ariel Maboudi', employment_type:'ft', weekly_visit_target:0, is_treating:false},
];
const RESREC=reconcileRoster(RES,new Map([['working ft',20],['ariel maboudi',15]]));
eq('reserve is excluded from contracted capacity', RESREC.committedCapacity, 25);
eq('reserve does not inflate the assignment gap', RESREC.assignmentGap, 5);
eq('reserve never appears as under target',
  RESREC.underTarget.map(u=>u.name), ['Working FT']);
eq('a reserve clinician who delivered nothing is NOT idle capacity',
  RESREC.rosterOnly.map(r=>r.name), []);
eq('reserve is listed separately', RESREC.reserve.map(r=>r.name).sort(),
  ['Ariel Maboudi','Lia Davis']);
eq('visits delivered by reserve are still credited', RESREC.reserveDelivered, 15);

// --- Negotiated minimum: a cover role carrying a floor, not a full
// caseload and not zero. Ariel Maboudi covers region N; her target of 8
// is the median of her cover history, set via
// weekly_visit_target_override. The DB trigger applies it; this asserts
// the reader treats it as a real contracted obligation and labels it so
// nobody "corrects" the 8 back to a full-time 25.
const MINREC=reconcileRoster(
  [{full_name:'Ariel Maboudi', employment_type:'ft', weekly_visit_target:8,
    is_treating:true, weekly_visit_target_override:8},
   {full_name:'Plain FT', employment_type:'ft', weekly_visit_target:25, is_treating:true}],
  new Map([['ariel maboudi',3],['plain ft',25]]));
eq('a negotiated minimum counts as contracted capacity', MINREC.committedCapacity, 33);
eq('the gap measures against the minimum, not the ft default', MINREC.assignmentGap, 5);
eq('a negotiated minimum is labelled',
  MINREC.underTarget.map(u=>[u.name,u.target,u.isNegotiatedMinimum]),
  [['Ariel Maboudi',8,true]]);
eq('an ordinary target is not labelled as negotiated',
  reconcileRoster([{full_name:'Plain FT',employment_type:'ft',weekly_visit_target:25,is_treating:true}],
    new Map([['plain ft',10]])).underTarget[0].isNegotiatedMinimum, false);
eq('isContracted excludes both reserve and per diem',
  [isContracted({employment_type:'ft',is_treating:true}),
   isContracted({employment_type:'ft',is_treating:false}),
   isContracted({employment_type:'prn',is_treating:true})], [true,false,false]);
// A salaried ADOC covering shifts is reserve working as intended, not a
// per-diem contract problem — they have no per-diem contract to fix.
eq('reserve is never flagged for per-diem overuse',
  flagOverCap(
    [{full_name:'Reserve Cover', employment_type:'prn', is_treating:false}],
    new Map([['reserve cover', new Map([['2026-06-14',18],['2026-06-21',18]])]]),
    ['2026-06-14','2026-06-21']).length, 0);
// Control: the identical pattern on a genuine per-diem contract DOES fire,
// so the assertion above is proving the reserve exemption and not just a
// broken fixture.
eq('the same pattern on a real per-diem contract does fire',
  flagOverCap(
    [{full_name:'Real Per Diem', employment_type:'prn'}],
    new Map([['real per diem', new Map([['2026-06-14',18],['2026-06-21',18]])]]),
    ['2026-06-14','2026-06-21']).length, 1);

// --- Ceilings: three problems in the same shape, distinguished so the
// recommended action is right (Liam 2026-07-22).
const CAPW=['2026-06-14','2026-06-21'];
const CAPCOUNTS=new Map([
  ['randi bonner',  new Map([['2026-06-14',6],['2026-06-21',7]])],
  ['ivon delgado',  new Map([['2026-06-14',14],['2026-06-21',15]])],
  ['tiffany harrison', new Map([['2026-06-14',17],['2026-06-21',17]])],
  ['hollie fincher', new Map([['2026-06-14',30],['2026-06-21',31]])],
]);
// An explicit cap beats every default, and applies even to a
// non-treating role — that is the whole point of capping one.
eq('an explicit cap wins over the reserve exemption',
  capFor({weekly_visit_cap:4, is_treating:false}), 4);
eq('reserve with no stated cap has no ceiling',
  capFor({is_treating:false, employment_type:'ft'}), null);
eq('per diem defaults to the 10 alert threshold',
  capFor({employment_type:'prn'}), 10);
eq('a contracted clinician has no ceiling',
  capFor({employment_type:'ft', is_treating:true}), null);

const CAPFLAGS=flagOverCap([
  {full_name:'Randi Bonner', weekly_visit_cap:4, is_treating:false,
   employment_type:'ft', job_description:'Director of Clinical Operations'},
  {full_name:'Ivon Delgado', employment_type:'prn', is_agency:true, is_treating:true},
  {full_name:'Tiffany Harrison', employment_type:'prn', is_treating:true},
  // Contracted and far over target: doing exactly what we want.
  {full_name:'Hollie Fincher', employment_type:'ft', is_treating:true},
], CAPCOUNTS, CAPW);
eq('a capped role over its ceiling is flagged',
  CAPFLAGS.find(f=>f.name==='Randi Bonner').reason, 'capped-role');
eq('agency staff are flagged but not as a per-diem contract',
  CAPFLAGS.find(f=>f.name==='Ivon Delgado').reason, 'agency');
eq('agency gets no contract-conversion suggestion',
  CAPFLAGS.find(f=>f.name==='Ivon Delgado').suggestedType, null);
eq('a direct per-diem contractor still gets one',
  CAPFLAGS.find(f=>f.name==='Tiffany Harrison').suggestedType, 'full-time');
eq('a contracted clinician over target is never flagged',
  CAPFLAGS.some(f=>f.name==='Hollie Fincher'), false);
eq('the cap that was breached is reported',
  CAPFLAGS.find(f=>f.name==='Randi Bonner').cap, 4);
eq('empty roster does not divide by zero', reconcileRoster([],new Map()).utilizationPct, null);
eq('null inputs are safe', reconcileRoster(null,null).claimedCapacity, 0);

// --- Per-diem overuse: a standing caseload without a contract
// Rule per Liam 2026-07-22: more than 10 visits in each of 2+ CONSECUTIVE
// weeks. The real production case is Tiffany Harrison, 12/17/17/17/14/19
// across six straight weeks on a per-diem contract.
const W=['2026-06-07','2026-06-14','2026-06-21','2026-06-28','2026-07-05','2026-07-12'];
const PDROSTER=[
  {full_name:'Tiffany Harrison',  employment_type:'prn', region:'G', discipline:'PTA'},
  {full_name:'Amilkar Gonzalez',  employment_type:'prn', region:'A', discipline:'PTA'},
  {full_name:'Brian Espinola',    employment_type:'ft',  region:'A', discipline:'PTA'},
];
const PDCOUNTS=new Map([
  ['tiffany harrison', new Map([['2026-06-07',12],['2026-06-14',17],['2026-06-21',17],
                                ['2026-06-28',17],['2026-07-05',14],['2026-07-12',19]])],
  // 11 once, never twice running — cover, not a caseload.
  ['amilkar gonzalez', new Map([['2026-06-07',11],['2026-06-14',10],['2026-06-21',9],
                                ['2026-06-28',6],['2026-07-05',5],['2026-07-12',5]])],
  // Full-time, way over the threshold, must never be flagged.
  ['brian espinola',   new Map([['2026-06-07',24],['2026-06-14',25],['2026-06-21',23],
                                ['2026-06-28',25],['2026-07-05',24],['2026-07-12',25]])],
]);
const PDFLAGS=flagOverCap(PDROSTER,PDCOUNTS,W);
eq('flags the sustained per-diem caseload', PDFLAGS.map(f=>f.name), ['Tiffany Harrison']);
eq('counts the full consecutive run', PDFLAGS[0].consecutiveWeeks, 6);
eq('reports the peak week', PDFLAGS[0].peak, 19);
eq('reports the average across the streak', PDFLAGS[0].average, 16);
eq('a sustained load above part-time suggests full-time', PDFLAGS[0].suggestedType, 'full-time');
eq('one busy week is cover, not a caseload',
  flagOverCap([PDROSTER[1]],PDCOUNTS,W).length, 0);
eq('full-time staff are never flagged however busy',
  flagOverCap([PDROSTER[2]],PDCOUNTS,W).length, 0);

// A quiet week is a ZERO and must BREAK the streak, not be bridged.
eq('a gap week breaks the streak',
  flagOverCap(
    [{full_name:'Gap Person', employment_type:'prn'}],
    new Map([['gap person', new Map([['2026-06-07',15],['2026-06-21',15]])]]),
    W).length, 0);
eq('two consecutive over-threshold weeks is enough',
  flagOverCap(
    [{full_name:'Two Weeks', employment_type:'prn'}],
    new Map([['two weeks', new Map([['2026-06-14',12],['2026-06-21',13]])]]),
    W)[0].consecutiveWeeks, 2);
// Exactly at the threshold is NOT over it — 10 is the allowed level.
eq('exactly 10 is not over the threshold',
  flagOverCap(
    [{full_name:'Exactly Ten', employment_type:'prn'}],
    new Map([['exactly ten', new Map([['2026-06-14',10],['2026-06-21',10]])]]),
    W).length, 0);
eq('per-diem employment types are recognized',
  [isPerDiem('prn'), isPerDiem('Per Diem'), isPerDiem('1099 Per Diem'), isPerDiem('ft')],
  [true,true,true,false]);
eq('no roster does not throw', flagOverCap(null,null,null), []);

// =====================================================================
// frequencyMath.js — inferred_frequency parsing
//
// Every string below is a real value from census_data on 2026-07-22.
// The LOC-prefixed ones are the 38 active patients that carry a
// parseable frequency but no overdue_threshold_days, and are therefore
// currently skipped by every overdue check in the system.
// =====================================================================
const {parseFrequency,expectedVisitsThisWeek,coverageGap,summarizeCoverage}=await import(R+'frequencyMath.js');

// --- The six canonical values must match the thresholds census_data
// already stores, or we have created a second disagreeing source.
eq('4w4 threshold matches the column', parseFrequency('4w4').thresholdDays, 3);
eq('2w4 threshold matches the column', parseFrequency('2w4').thresholdDays, 4);
eq('1w4 threshold matches the column', parseFrequency('1w4').thresholdDays, 10);
eq('1em1 is monthly, not weekly', Math.round(parseFrequency('1em1').perWeek*100), 23);
// Confirmed by Liam 2026-07-22: the trailing digit is an INTERVAL on the
// em/ew forms ("once every two months") and a DURATION on NwD ("once a
// week for four weeks"). Same position, two meanings, by letter. Pinned
// here so the next person cannot quietly "fix" it into consistency.
eq('1em2 is once every TWO months, not monthly for two months',
  parseFrequency('1em2').thresholdDays, 60);
// These two are the values census_data stores. Pinned because an earlier
// build let the monthly cadences fall through to a generic per-week
// heuristic and produced 46 and 88 instead — a second source of truth
// disagreeing with the column, silently.
eq('1em1 threshold matches the column', parseFrequency('1em1').thresholdDays, 30);
eq('1ew2 threshold is the fortnight itself', parseFrequency('1ew2').thresholdDays, 14);
eq('1em1 and 1em2 are not the same cadence',
  parseFrequency('1em1').thresholdDays !== parseFrequency('1em2').thresholdDays, true);
eq('1ew2 is fortnightly, so not owed a visit every week',
  expectedVisitsThisWeek(parseFrequency('1ew2')), 0);
eq('1w4 trailing digit stays a DURATION -- still one visit a week',
  parseFrequency('1w4').perWeek, 1);
eq('1w8 is the same weekly cadence as 1w4, just a longer course',
  parseFrequency('1w8').perWeek, parseFrequency('1w4').perWeek);
eq('2w4 is two visits a week', parseFrequency('2w4').perWeek, 2);

// --- The 38-patient blind spot: parseable frequency buried in LOC text
eq('LOC prefix does not hide the frequency', parseFrequency('LOC 3 DM 1w4').canonical, '1w4');
eq('Maintenance qualifier does not hide it', parseFrequency('LOC 4 Maintenance 2w8').canonical, '2w8');
eq('leading dash does not hide it', parseFrequency('Maintenance -1em2').canonical, '1em2');
eq('AD qualifier does not hide it', parseFrequency('LOC 4 AD 4w5').canonical, '4w5');
eq('colon does not hide it', parseFrequency('LOC 4 DM: 1ew2').canonical, '1ew2');
eq('a buried 1w4 gets the same threshold as a bare one',
  parseFrequency('LOC 3 Maintenance 1w4').thresholdDays, parseFrequency('1w4').thresholdDays);

// --- Multi-phase orders: first token is the current phase
eq('taper takes the first phase', parseFrequency('LOC 3 - 4w4, 2w2').canonical, '4w4');
eq('taper reports how many phases it saw', parseFrequency('LOC 3 - 4w4, 2w2').phases, 2);
eq('comma-packed taper still parses', parseFrequency('LOC 2 AD - 4w2,2w4').canonical, '4w2');

// --- prn is RECOGNIZED and never overdue. Conflating it with
// unparseable would put 24 patients into the wrong bucket.
eq('prn is recognized', parseFrequency('prn').recognized, true);
eq('prn is never overdue', parseFrequency('prn').thresholdDays, 9999);
eq('prn expects no visits', expectedVisitsThisWeek(parseFrequency('prn')), 0);

// --- Unknown values NEVER get a silent default
eq('N/A is not recognized', parseFrequency('N/A').recognized, false);
eq('NA is not recognized', parseFrequency('NA').recognized, false);
eq('null is not recognized', parseFrequency(null).recognized, false);
eq('empty is not recognized', parseFrequency('').recognized, false);
eq('unparseable text invents no expectation', expectedVisitsThisWeek(parseFrequency('twice weekly')), 0);

// --- Weekly expectation
eq('4w4 expects 4 visits', expectedVisitsThisWeek(parseFrequency('4w4')), 4);
eq('1w4 expects 1 visit', expectedVisitsThisWeek(parseFrequency('1w4')), 1);
// A monthly patient is not owed a visit in any given week. Counting them
// short every week would bury the patients genuinely behind.
eq('1em1 expects nothing in a given week', expectedVisitsThisWeek(parseFrequency('1em1')), 0);

// --- coverageGap distinguishes "no shortfall" from "no basis to judge"
eq('2w4 seen twice is covered', coverageGap('2w4',2).shortfall, 0);
eq('2w4 seen once is one short', coverageGap('2w4',1).shortfall, 1);
eq('2w4 unseen is two short', coverageGap('2w4',0).shortfall, 2);
eq('over-delivery is not a negative shortfall', coverageGap('1w4',3).shortfall, 0);
eq('unparseable yields null, not zero', coverageGap('N/A',0).shortfall, null);
eq('monthly patient unseen this week is NOT short', coverageGap('1em1',0).shortfall, 0);

// --- Roll-up excludes guesses from the headline number
const COV=summarizeCoverage([
  {frequency:'2w4', delivered:0},          // 2 short
  {frequency:'1w4', delivered:0},          // 1 short
  {frequency:'LOC 3 DM 1w4', delivered:0}, // 1 short — the blind spot
  {frequency:'1w4', delivered:1},          // covered
  {frequency:'1em1', delivered:0},         // monthly, not short
  {frequency:'prn', delivered:0},          // as needed
  {frequency:'N/A', delivered:0},          // no basis to judge
]);
eq('shortfall counts only patients with a real expectation', COV.shortfallVisits, 4);
eq('the blind-spot patient is now counted', COV.short, 3);
eq('unparseable is excluded from the gap, not assumed', COV.unparseable, 1);
eq('prn is bucketed separately', COV.asNeeded, 1);
eq('monthly is bucketed separately', COV.sparserThanWeekly, 1);
eq('unparseable values are surfaced for cleanup',
  Array.from(COV.unparseableValues.entries()), [['N/A',1]]);
eq('blank frequency is labelled, not dropped',
  Array.from(summarizeCoverage([{frequency:'',delivered:0}]).unparseableValues.keys()), ['(blank)']);

console.log(fail?`\n${fail} FAILED`:'\nAll assertions passed');
process.exit(fail?1:0);
