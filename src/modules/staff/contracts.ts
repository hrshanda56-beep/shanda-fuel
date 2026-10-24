import type { RoleCode, ScopeType } from '../authorization';

export type StaffInvitationScope = Readonly<{
  scopeType: ScopeType;
  legalEntityId?: string;
  stationIds: readonly string[];
}>;

export type StaffInvitationSummary = Readonly<{
  id: string;
  email: string | null;
  name: string;
  role: RoleCode;
  scopeType: ScopeType;
  legalEntityId?: string;
  stationIds: readonly string[];
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  expiresAt?: string;
  createdAt: string;
  deliveryMethod: 'EMAIL' | 'MANUAL';
  staffNumber?: string;
}>;

export type StaffMemberSummary = Readonly<{
  membershipId: string;
  identityId: string;
  name: string;
  email: string | null;
  staffNumber?: string;
  status: 'ACTIVE' | 'DISABLED' | 'SUSPENDED' | 'LOCKED' | 'INVITED';
  roles: readonly RoleCode[];
  scopeLabels: readonly string[];
  assignments?: readonly {
    role: RoleCode;
    scopeType: ScopeType;
    legalEntityId?: string;
    stationId?: string;
  }[];
}>;

export type StaffOverview = Readonly<{
  canManage: boolean;
  canInviteOwner: boolean;
  scopeOptions: readonly StaffScopeOption[];
  pendingInvitations: readonly StaffInvitationSummary[];
  activeStaff: readonly StaffMemberSummary[];
  deactivatedStaff: readonly StaffMemberSummary[];
}>;

export type StaffScopeOption = Readonly<{
  id: string;
  name: string;
  stations: readonly { id: string; code: string; name: string }[];
}>;

export type InvitationView =
  | { kind: 'new-identity'; organisationName: string; email: string; invitedName: string }
  | { kind: 'existing-identity'; organisationName: string }
  | { kind: 'unavailable' };
