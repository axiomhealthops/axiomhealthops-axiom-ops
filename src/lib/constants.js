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

// 2026-06-09: Territory metadata for the Marketing Referrals page (and any
// future page that needs the county breakdown / proper EdemaCare-branded
// "Territory" naming). Single source of truth — pages should pull from here
// rather than hardcoding strings. Liam confirmed these county groupings on
// 2026-06-09 in the Marketing Referrals build.
export const TERRITORIES = {
  A: { letter: 'A', counties: 'Osceola, Orange, Seminole',     manager: 'Uma Jacobs',      managerRole: 'TM' },
  B: { letter: 'B', counties: 'Duval, Nassau, Clay',           manager: 'Lia Davis',       managerRole: 'AD' },
  C: { letter: 'C', counties: "St. Johns, Flagler, Putnam",    manager: 'Earl Dimaano',    managerRole: 'TM' },
  G: { letter: 'G', counties: 'Volusia',                       manager: 'Lia Davis',       managerRole: 'AD' },
  H: { letter: 'H', counties: 'Lake, Sumter, Marion',          manager: 'Kaylee Ramsey',   managerRole: 'TM' },
  J: { letter: 'J', counties: 'Brevard, Indian River',         manager: 'Hollie Fincher',  managerRole: 'TM' },
  M: { letter: 'M', counties: 'Hillsborough, Pinellas',        manager: 'Ariel Maboudi',   managerRole: 'AD' },
  N: { letter: 'N', counties: 'Polk, Manatee, Hardee',         manager: 'Ariel Maboudi',   managerRole: 'AD' },
  T: { letter: 'T', counties: 'Palm Beach, St. Lucie, Martin', manager: 'Samantha Faliks', managerRole: 'AD' },
  V: { letter: 'V', counties: 'Miami-Dade, Broward, Monroe',   manager: 'Samantha Faliks', managerRole: 'AD' },
};
export const TERRITORY_LETTERS = Object.keys(TERRITORIES);

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

// =====================================================================
// Marketing surface — primary-role classification (v5 design, 2026-05-30)
//
// Liam's framing: "If there is a staff member who is a Regional Manager,
// then they are a clinician first, marketing executive second. If they
// are a HAE, their primary job is marketing not clinical work."
//
// Used by Marketing Team Directory and Marketing CRM scorecard rollups
// to split "marketing-primary contribution" from "clinical-primary
// secondary contribution". Same person can appear in both buckets
// depending on the role they're playing for a given territory.
// =====================================================================

// Roles whose primary job is clinical. Their marketing contributions
// count as SECONDARY on marketing scorecards (not held to HAE volume).
export const CLINICAL_PRIMARY_ROLES = ['assoc_director', 'regional_manager'];

// Roles whose primary job is marketing. Full marketing scorecard weight.
export const MARKETING_PRIMARY_ROLES = ['healthcare_account_executive'];

// Roles that have any marketing involvement (primary OR secondary).
// Used to filter the Marketing Team Directory.
export const MARKETING_TEAM_ROLES = [
  ...MARKETING_PRIMARY_ROLES,
  ...CLINICAL_PRIMARY_ROLES,
];

export function isMarketingPrimary(role) {
  return MARKETING_PRIMARY_ROLES.includes(role);
}

export function isClinicalPrimaryWithMarketingSecondary(role, secondaryRoles) {
  return CLINICAL_PRIMARY_ROLES.includes(role)
      && Array.isArray(secondaryRoles)
      && secondaryRoles.includes('marketing_rep');
}

// Standard duties for all marketing team members. Static reference for
// the Marketing Team Directory page's right-rail panel.
export const MARKETING_STANDARD_DUTIES = [
  'Meet with healthcare providers, specialists, hospitals, physician practices, and healthcare facilities',
  'Develop and maintain referral relationships',
  'Conduct in-services, educational presentations, and community outreach events',
  'Participate in networking and community engagement',
  'Track outreach activities, referral opportunities, and provider feedback',
  'Share market intelligence and field feedback with leadership',
  'Hospital discharge relationship development and referral growth',
  'School administration contacts, therapy program directors, career services contacts for recruiting and career fairs',
  'Promote therapist recruitment and represent EdemaCare at educational/career events',
  'Support strategic growth initiatives as assigned',
];

// Assignment-role display labels for the Marketing Team Directory.
export const ASSIGNMENT_ROLE_LABELS = {
  primary:    'Primary',
  oversight:  'Oversight',
  supervisor: 'Supervisor',
  partner:    'Partner',
};

export const ASSIGNMENT_ROLE_COLORS = {
  primary:    { fg: '#065F46', bg: '#ECFDF5', border: '#A7F3D0' },
  oversight:  { fg: '#1565C0', bg: '#EFF6FF', border: '#BFDBFE' },
  supervisor: { fg: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE' },
  partner:    { fg: '#374151', bg: '#F3F4F6', border: '#D1D5DB' },
};

// =====================================================================
// Canonical role display map — single source of truth for the User
// Management page and any future page that needs to render role pills.
//
// Order matters: USER_MANAGEMENT_ROLE_KEYS sets the dropdown order
// shown to admins when creating/editing a user.
//
// To add a new role: add it to USER_MANAGEMENT_ROLE_KEYS + ROLE_LABELS
// + ROLE_COLORS + ROLE_BGS in this file. Don't add it to local arrays
// in individual pages — drift is how we end up with HAE missing from
// the dropdown after the migration adds it everywhere else.
// =====================================================================

export const USER_MANAGEMENT_ROLE_KEYS = [
  'super_admin',
  'admin',
  'director_payer_marketing',
  'assoc_director',
  'regional_manager',
  'healthcare_account_executive',
  'auth_coordinator',
  'intake_coordinator',
  'care_coordinator',
  'telehealth',
  'clinician',
];

export const ROLE_LABELS = {
  super_admin:                  'Super Admin',
  admin:                        'Director / Admin',
  director_payer_marketing:     'Director of Payer Relations & Marketing',
  assoc_director:               'Assoc. Director of Clinical Ops',
  regional_manager:             'Regional Manager',
  healthcare_account_executive: 'Healthcare Account Executive (HAE)',
  auth_coordinator:             'Auth Coordinator',
  intake_coordinator:           'Intake Coordinator',
  care_coordinator:             'Care Coordinator',
  telehealth:                   'Telehealth PT/OT',
  clinician:                    'Clinician',
};

export const ROLE_COLORS = {
  super_admin:                  '#DC2626',
  admin:                        '#7C3AED',
  director_payer_marketing:     '#BE185D',
  assoc_director:               '#0369A1',
  regional_manager:             '#0E7490',
  healthcare_account_executive: '#9A3412',
  auth_coordinator:             '#1565C0',
  intake_coordinator:           '#065F46',
  care_coordinator:             '#D97706',
  telehealth:                   '#0D9488',
  clinician:                    '#059669',
};

export const ROLE_BGS = {
  super_admin:                  '#FEF2F2',
  admin:                        '#F5F3FF',
  director_payer_marketing:     '#FDF2F8',
  assoc_director:               '#E0F2FE',
  regional_manager:             '#ECFEFF',
  healthcare_account_executive: '#FFF7ED',
  auth_coordinator:             '#EFF6FF',
  intake_coordinator:           '#ECFDF5',
  care_coordinator:             '#FEF3C7',
  telehealth:                   '#F0FDFA',
  clinician:                    '#F0FFF4',
};

export const EXPANSION = [
  { state: 'Georgia', status: 'In Progress', credentialing: 60, staffHired: 2, target: 'May 2026' },
  { state: 'Texas', status: 'Planning', credentialing: 20, staffHired: 0, target: 'July 2026' },
  { state: 'North Carolina', status: 'Planning', credentialing: 10, staffHired: 0, target: 'August 2026' },
];
