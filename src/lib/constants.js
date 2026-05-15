export const B = {
  red: '#D94F2B',
  darkRed: '#8B1A10',
  orange: '#E8763A',
  black: '#1A1A1A',
  gray: '#8B6B64',
  lightGray: '#BBA8A4',
  border: '#F0E4E0',
  bg: '#FBF7F6',
  cardBg: '#fff',
  green: '#2E7D32',
  yellow: '#D97706',
  danger: '#DC2626',
  blue: '#1565C0',
};

export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  CEO: 'ceo',
  AUTH_COORDINATOR:    'auth_coordinator',
  INTAKE_COORDINATOR:  'intake_coordinator',
  CARE_COORDINATOR:    'care_coordinator',
  CLINICIAN:           'clinician',
  DIRECTOR: 'director',
  REGIONAL_MGR: 'regional_mgr',
  ADMIN: 'admin',
  POD_LEADER: 'pod_leader',
  TEAM_LEADER: 'team_leader',
  TEAM_MEMBER: 'team_member',
  COORDINATOR: 'coordinator',
};

export const DIRECTOR_ROLES = ['super_admin', 'ceo', 'admin', 'assoc_director'];
export const MISSION_ROLES = ['auth_coordinator', 'intake_coordinator', 'care_coordinator', 'telehealth', 'clinician', 'pod_leader', 'team_leader', 'team_member'];
export const COORDINATOR_ROLES = ['coordinator'];

export const METRICS = {
  WEEKLY_VISIT_TARGET: 800,
  REVENUE_TARGET: 200000,
  AVG_REIMBURSEMENT: 90,
  CENSUS_TARGET: 500,
  COORDINATOR_CASELOAD_CAP: 80,
};

// Each letter is a single sub-region; the value shown is the person currently
// responsible for it (dedicated TM where one exists, AD acting otherwise).
// Source of truth for role/regions arrays is the coordinators table — this
// map is just a display convenience for legacy pages that don't yet query it.
// As of 2026-05-15 reorganization, six regions have AD acting coverage:
// B (Lia), G (Lia), M (Ariel), N (Ariel), T (Samantha), V (Samantha).
export const REGIONS = {
  A: 'Uma Jacobs',          // dedicated TM
  B: 'Lia Davis',           // AD acting
  C: 'Earl Dimaano',        // dedicated TM
  G: 'Lia Davis',           // AD acting (was Samantha pre-2026-05-15)
  H: 'Kaylee Ramsey',       // dedicated TM
  J: 'Hollie Fincher',      // dedicated TM
  M: 'Ariel Maboudi',       // AD acting
  N: 'Ariel Maboudi',       // AD acting
  T: 'Samantha Faliks',     // AD acting
  V: 'Samantha Faliks',     // AD acting
};

// =====================================================================
// EdemaCare regional structure (introduced 2026-05-15 reorganization)
//
// Florida is grouped into three parent Regions ("FL North", "FL Central",
// "FL South"), each overseen by an Associate Director of Clinical
// Operations. Each parent Region contains 3-4 existing single-letter
// regions. The EdemaCare rebrand roadmap eventually renames these to
// "Territories" — NOT in this round per Liam (Director of Operations).
//
// Use these constants in the Associate Director dashboard and any
// regional rollup view. For per-user scope (who can see what), use the
// coordinators.regions array on the user's profile via useAuth /
// useAssignedRegions — NOT this map. This is structural only.
// =====================================================================

export const FL_NORTH   = ['B', 'C', 'G'];
export const FL_CENTRAL = ['A', 'H', 'M', 'N'];
export const FL_SOUTH   = ['J', 'T', 'V'];

export const FL_PARENT_REGIONS = {
  'FL North':   FL_NORTH,
  'FL Central': FL_CENTRAL,
  'FL South':   FL_SOUTH,
};

export const ASSOC_DIRECTORS = {
  'FL North':   'Lia Davis',
  'FL Central': 'Ariel Maboudi',
  'FL South':   'Samantha Faliks',
};

// Reverse lookup: region letter → parent region name.
// Example: REGION_TO_PARENT.B === 'FL North'
export const REGION_TO_PARENT = (() => {
  const map = {};
  Object.entries(FL_PARENT_REGIONS).forEach(([parent, letters]) => {
    letters.forEach(l => { map[l] = parent; });
  });
  return map;
})();

// Reverse lookup: region letter → name of overseeing AD.
// Example: REGION_TO_AD.B === 'Lia Davis'
export const REGION_TO_AD = (() => {
  const map = {};
  Object.entries(FL_PARENT_REGIONS).forEach(([parent, letters]) => {
    const ad = ASSOC_DIRECTORS[parent];
    letters.forEach(l => { map[l] = ad; });
  });
  return map;
})();

// Returns true if the named person is the Associate Director acting
// as manager for the region (i.e., no dedicated TM exists).
// Used by the AD dashboard to flag acting-coverage gaps as recruitment signals.
export function isActingManager(regionLetter) {
  return REGIONS[regionLetter] === REGION_TO_AD[regionLetter];
}

export const SETTINGS_PIN = '2208';

export const EXPANSION = [
  { state: 'Georgia', status: 'In Progress', credentialing: 60, staffHired: 2, target: 'May 2026' },
  { state: 'Texas', status: 'Planning', credentialing: 20, staffHired: 0, target: 'July 2026' },
  { state: 'North Carolina', status: 'Planning', credentialing: 10, staffHired: 0, target: 'August 2026' },
];
