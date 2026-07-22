-- Coverage Board: the working list behind the "prescribed care not
-- delivered" number on Director Command. Lands in OPERATIONS at 115,
-- directly after Visit Schedule (110), because it is read alongside the
-- schedule rather than alongside the census.
--
-- Roles: everyone who can act on a scheduling gap. Care coordinators do
-- the booking, RMs and ADs own the territory, Carla runs the function,
-- Liam reads the total. Clinicians, intake, auth, telehealth and
-- marketing are excluded — the board is a scheduling instrument, and
-- widening it would expose full-region patient lists to roles that have
-- no action to take on them.
--
-- Idempotent: safe to re-run. Does not overwrite an existing row, so a
-- later permission change made in User Management is never clobbered.
--
-- Applied to production via MCP 2026-07-22; checked in for git history.
insert into page_permissions (
  page_key, page_label, page_section, sort_order,
  super_admin, admin, assoc_director, regional_manager, pod_leader,
  team_member, care_coordinator,
  intake_coordinator, auth_coordinator, clinician, telehealth,
  marketing_rep, healthcare_account_executive, director_payer_marketing
)
select
  'coverage-board', 'Coverage Board', 'OPERATIONS', 115,
  true, true, true, true, true,
  true, true,
  false, false, false, false,
  false, false, false
where not exists (
  select 1 from page_permissions where page_key = 'coverage-board'
);
