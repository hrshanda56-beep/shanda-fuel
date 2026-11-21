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
