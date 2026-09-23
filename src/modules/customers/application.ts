import type { AccessScope } from '../../platform/security/permissions';
import type {
  CustomerAccountAuditActionCode,
  CustomerFuelAuthorizationCommand,
  CustomerFuelPostingRequest,
  CustomerFuelUsageCommand,
  CustomerPaymentCommand,
  PrepaidTopUpCommand,
} from './contracts';

/** Proposed permission names; central permission wiring is deferred to integration. */
export const CUSTOMER_PERMISSION_CODES = [
  'customer.view',
  'customer.manage',
  'customer.account.manage',
  'customer.credit.authorize',
  'customer.prepaid.top_up',
  'customer.payment.record',
  'customer.statement.view',
  'customer.account.adjust',
  'customer.limit.override',
] as const;
export type CustomerPermissionCode = (typeof CUSTOMER_PERMISSION_CODES)[number];

export const CUSTOMER_COMMAND_TYPES = [
  'CreateCustomer',
  'CreateCustomerAccount',
  'RequestCustomerFuelAuthorization',
  'AuthorizeCustomerFuel',
  'CompleteCustomerFuelTransaction',
  'CancelCustomerFuelAuthorization',
  'ExpireCustomerFuelAuthorization',
  'RecordCustomerPayment',
  'RecordPrepaidTopUp',
  'ReverseCustomerLedgerEntry',
] as const;
export type CustomerCommandType = (typeof CUSTOMER_COMMAND_TYPES)[number];

export type CustomerCommandEnvelope<TPayload> = Readonly<{
  commandType: CustomerCommandType;
  idempotencyKey: string;
  requestHash: string;
  payload: TPayload;
}>;

export type CustomerApplicationCommand =
  | CustomerCommandEnvelope<CustomerFuelAuthorizationCommand>
  | CustomerCommandEnvelope<CustomerFuelUsageCommand>
  | CustomerCommandEnvelope<CustomerPaymentCommand>
  | CustomerCommandEnvelope<PrepaidTopUpCommand>
  | CustomerCommandEnvelope<CustomerFuelPostingRequest>;

export type CustomerCommandPolicy = Readonly<{
  permissionCode: CustomerPermissionCode;
  scopeType: 'TENANT' | 'STATION';
  requiresStepUp: boolean;
  requiresExpectedVersion: boolean;
}>;

export const CUSTOMER_COMMAND_POLICY: Readonly<
  Partial<Record<CustomerCommandType, CustomerCommandPolicy>>
> = {
  CreateCustomer: {
    permissionCode: 'customer.manage',
    scopeType: 'TENANT',
    requiresStepUp: false,
    requiresExpectedVersion: false,
  },
  CreateCustomerAccount: {
    permissionCode: 'customer.account.manage',
    scopeType: 'TENANT',
    requiresStepUp: true,
    requiresExpectedVersion: false,
  },
  RequestCustomerFuelAuthorization: {
    permissionCode: 'customer.credit.authorize',
    scopeType: 'STATION',
    requiresStepUp: false,
    requiresExpectedVersion: true,
  },
  AuthorizeCustomerFuel: {
    permissionCode: 'customer.credit.authorize',
    scopeType: 'STATION',
    requiresStepUp: true,
    requiresExpectedVersion: true,
  },
  CompleteCustomerFuelTransaction: {
    permissionCode: 'customer.credit.authorize',
    scopeType: 'STATION',
    requiresStepUp: false,
    requiresExpectedVersion: true,
  },
  RecordCustomerPayment: {
    permissionCode: 'customer.payment.record',
    scopeType: 'TENANT',
    requiresStepUp: false,
    requiresExpectedVersion: true,
  },
  RecordPrepaidTopUp: {
    permissionCode: 'customer.prepaid.top_up',
    scopeType: 'TENANT',
    requiresStepUp: true,
    requiresExpectedVersion: true,
  },
  ReverseCustomerLedgerEntry: {
    permissionCode: 'customer.account.adjust',
    scopeType: 'TENANT',
    requiresStepUp: true,
    requiresExpectedVersion: true,
  },
};

export type CustomerExecutionContext = Readonly<{
  tenantId: string;
  actorId: string;
  membershipId: string;
  requestId: string;
  scope: AccessScope;
}>;

export type CustomerIdempotencyRequest = Readonly<{
  tenantId: string;
  commandType: CustomerCommandType;
  idempotencyKey: string;
  requestHash: string;
}>;

export type CustomerAuditRequest = Readonly<{
  actionCode: CustomerAccountAuditActionCode;
  subjectType: 'Customer' | 'CustomerAccount' | 'CustomerFuelAuthorization' | 'CustomerLedgerEntry';
  subjectId: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
}>;

export type CustomerPostingIntegrationRequirement = Readonly<{
  source: 'A5';
  evidenceEvent: 'a5.customer_fuel_allocation_posted.v1';
  uniquenessKey: Readonly<{
    tenantId: string;
    paymentEvidenceId: string;
    reconciliationRevisionId: string;
  }>;
  retryRule: 'same-source-reference-returns-existing-entry';
}>;
