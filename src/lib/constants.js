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

export const REGIONS = {
  A: 'Uma Jacobs',
  B: 'Lia Davis',
  C: 'Earl Dimaano',
  G: 'Samantha Faliks',
  H: 'Kaylee Ramsey',
  J: 'Hollie Fincher',
  M: 'Ariel Maboudi',
  N: 'Ariel Maboudi',
  T: 'Samantha Faliks',
  V: 'Samantha Faliks',
};

export const SETTINGS_PIN = '2208';

export const EXPANSION = [
  { state: 'Georgia', status: 'In Progress', credentialing: 60, staffHired: 2, target: 'May 2026' },
  { state: 'Texas', status: 'Planning', credentialing: 20, staffHired: 0, target: 'July 2026' },
  { state: 'North Carolina', status: 'Planning', credentialing: 10, staffHired: 0, target: 'August 2026' },
];
