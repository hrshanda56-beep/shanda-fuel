import type { RoleCode } from '../authorization';

/** How each role is named to a person, on the Staff page and in the invite wizards. */
export const STAFF_ROLE_LABELS: Record<RoleCode, string> = {
  OWNER: 'Owner',
  ADMINISTRATOR: 'Administrator',
  FINANCE: 'Finance',
  SUPERVISOR: 'Supervisor',
  ATTENDANT: 'Attendant',
  AUDITOR: 'Auditor (read only)',
  AREA_MANAGER: 'Area manager',
  CASH_COLLECTOR: 'Cash collector',
};

/** One plain sentence per role, shown under the role pick. Mirrors docs/ROLES.md. */
export const STAFF_ROLE_HINTS: Record<RoleCode, string> = {
  OWNER: 'Everything, including inviting administrators and approving large amounts.',
  ADMINISTRATOR: 'Runs the company day to day: setup, staff, prices and expenses.',
  FINANCE:
    'Money: cash and banking, supplier payments, expenses, customer accounts and finance reports.',
  SUPERVISOR:
    'Runs a station: opens and closes the day, records deliveries, approves shift reports.',
  ATTENDANT: 'Captures pump readings for their shift. Nothing else.',
  AUDITOR: 'Can look at every screen but cannot change or approve anything.',
  AREA_MANAGER:
    'Like a supervisor, but over several stations, and can also see the finance reports.',
  CASH_COLLECTOR: 'Collects cash from stations and hands it on. Cannot see sales or profit.',
};
