import { AppError } from '../../platform/errors';
import {
  ExactDecimal,
  businessDate,
  litres,
  money,
  type BusinessDate,
  type CurrencyCode,
  type Litres,
  type Money,
} from '../../platform/domain/primitives';

export const CUSTOMER_ACCOUNT_TYPES = ['CREDIT', 'PREPAID_VALUE', 'PREPAID_LITRES'] as const;
export type CustomerAccountType = (typeof CUSTOMER_ACCOUNT_TYPES)[number];

export const CUSTOMER_LIFECYCLE_STATES = ['ACTIVE', 'SUSPENDED', 'CLOSED'] as const;
export type CustomerLifecycleState = (typeof CUSTOMER_LIFECYCLE_STATES)[number];

export const CUSTOMER_ACCOUNT_STATES = ['ACTIVE', 'SUSPENDED', 'CLOSED'] as const;
export type CustomerAccountState = (typeof CUSTOMER_ACCOUNT_STATES)[number];

export const CUSTOMER_LEDGER_ENTRY_TYPES = [
  'CREDIT_FUEL_CHARGE',
  'CUSTOMER_PAYMENT',
  'PREPAID_TOPUP',
  'PREPAID_FUEL_USAGE',
  'ADJUSTMENT',
  'REVERSAL',
] as const;
export type CustomerLedgerEntryType = (typeof CUSTOMER_LEDGER_ENTRY_TYPES)[number];

export const CUSTOMER_LEDGER_DIRECTIONS = ['INCREASE', 'DECREASE'] as const;
export type CustomerLedgerDirection = (typeof CUSTOMER_LEDGER_DIRECTIONS)[number];

export const CUSTOMER_SOURCE_TYPES = [
  'A5_RECONCILIATION_CUSTOMER_FUEL',
  'CUSTOMER_PAYMENT',
  'PREPAID_TOPUP',
  'MANUAL_ADJUSTMENT',
  'LEDGER_REVERSAL',
] as const;
export type CustomerSourceType = (typeof CUSTOMER_SOURCE_TYPES)[number];

export type CustomerSourceReference = Readonly<{
  sourceType: CustomerSourceType;
  sourceId: string;
  sourceRevisionId?: string;
}>;

export type Customer = Readonly<{
  id: string;
  tenantId: string;
  accountReference: string;
  displayName: string;
  status: CustomerLifecycleState;
  legalEntityId?: string | null;
  contactMetadata?: Readonly<Record<string, string>>;
}>;

export type CustomerAccount = Readonly<{
  id: string;
  tenantId: string;
  customerId: string;
  accountType: CustomerAccountType;
  currency: CurrencyCode;
  status: CustomerAccountState;
  legalEntityId?: string | null;
  stationScope?: CustomerAccountStationScope;
  stationScopeConfigured?: boolean;
  /** Optional policy input; the domain does not invent a default limit. */
  creditLimit?: Money;
}>;

export type CustomerFuelValue = Readonly<{
  productId: string;
  litres: Litres;
  amount: Money;
}>;

type LedgerEntryBase = Readonly<{
  id: string;
  tenantId: string;
  customerId: string;
  accountId: string;
  direction: CustomerLedgerDirection;
  source: CustomerSourceReference;
  occurredAt: string;
  businessDate: BusinessDate;
  note?: string;
  reason?: string;
  fuelAllocationId?: string;
  reversalOfEntryId?: string;
}>;

export type CreditLedgerEntry = LedgerEntryBase &
  Readonly<{
    accountType: 'CREDIT';
    entryType: 'CREDIT_FUEL_CHARGE' | 'CUSTOMER_PAYMENT' | 'ADJUSTMENT' | 'REVERSAL';
    amount: Money;
  }>;

export type PrepaidValueLedgerEntry = LedgerEntryBase &
  Readonly<{
    accountType: 'PREPAID_VALUE';
    entryType: 'PREPAID_TOPUP' | 'PREPAID_FUEL_USAGE' | 'ADJUSTMENT' | 'REVERSAL';
    amount: Money;
  }>;

export type PrepaidLitresLedgerEntry = LedgerEntryBase &
  Readonly<{
    accountType: 'PREPAID_LITRES';
    entryType: 'PREPAID_TOPUP' | 'PREPAID_FUEL_USAGE' | 'ADJUSTMENT' | 'REVERSAL';
    productId: string;
    quantityLitres: Litres;
  }>;

export type CustomerLedgerEntry =
  CreditLedgerEntry | PrepaidValueLedgerEntry | PrepaidLitresLedgerEntry;

export type CustomerAccountBalance =
  | Readonly<{
      accountType: 'CREDIT' | 'PREPAID_VALUE';
      currency: CurrencyCode;
      amount: Money;
    }>
  | Readonly<{
      accountType: 'PREPAID_LITRES';
      currency: CurrencyCode;
      productBalances: readonly Readonly<{ productId: string; litres: Litres }>[];
    }>;

export const CUSTOMER_FUEL_AUTHORIZATION_STATES = [
  'REQUESTED',
  'AUTHORIZED',
  'PARTIALLY_USED',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
  'REJECTED',
] as const;
export type CustomerFuelAuthorizationState = (typeof CUSTOMER_FUEL_AUTHORIZATION_STATES)[number];

export type CustomerFuelAuthorization = Readonly<{
  id: string;
  tenantId: string;
  stationId: string;
  customerId: string;
  accountId: string;
  accountType: CustomerAccountType;
  requested: CustomerFuelValue;
  used: CustomerFuelValue;
  remaining: CustomerFuelValue;
  state: CustomerFuelAuthorizationState;
  requestedBy: string;
  requestedAt: string;
  source: CustomerSourceReference;
  version: number;
}>;

export type ActiveReservation = Readonly<{
  accountId: string;
  accountType: CustomerAccountType;
  remaining: CustomerFuelValue;
  state: 'AUTHORIZED' | 'PARTIALLY_USED';
}>;

function requireText(value: string, label: string): string {
  if (!value || value.trim() === '')
    throw new AppError('VALIDATION_FAILED', `${label} is required.`);
  return value.trim();
}

function requirePositiveMoney(value: Money, label: string): Money {
  if (value.amount.value.isNegative() || value.amount.value.isZero())
    throw new AppError('VALIDATION_FAILED', `${label} must be more than zero.`);
  return value;
}

function requirePositiveLitres(value: Litres, label: string): Litres {
  if (value.value.isNegative() || value.value.isZero())
    throw new AppError('VALIDATION_FAILED', `${label} must be more than zero.`);
  return value;
}

function signed(value: ExactDecimal, direction: CustomerLedgerDirection): ExactDecimal {
  return direction === 'INCREASE' ? value : new ExactDecimal(`-${value.toString()}`);
}

function subtractPositive(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  return left.subtract(right);
}

function sameSource(left: CustomerSourceReference, right: CustomerSourceReference): boolean {
  return (
    left.sourceType === right.sourceType &&
    left.sourceId === right.sourceId &&
    left.sourceRevisionId === right.sourceRevisionId
  );
}

export function customerLedgerSourceKey(source: CustomerSourceReference): string {
  return JSON.stringify([source.sourceType, source.sourceId, source.sourceRevisionId ?? null]);
}

export function assertSourceReferenceUnused(
  entries: readonly CustomerLedgerEntry[],
  source: CustomerSourceReference,
): void {
  if (entries.some((entry) => sameSource(entry.source, source))) {
    throw new AppError(
      'IDEMPOTENCY_CONFLICT',
      'This payment or top-up has already been posted, so it was not recorded a second time.',
    );
  }
}

export function newCustomer(input: {
  id: string;
  tenantId: string;
  accountReference: string;
  displayName: string;
  contactMetadata?: Readonly<Record<string, string>>;
}): Customer {
  return {
    id: requireText(input.id, 'Customer id'),
    tenantId: requireText(input.tenantId, 'Customer tenant id'),
    accountReference: requireText(input.accountReference, 'Customer account reference'),
    displayName: requireText(input.displayName, 'Customer display name'),
    status: 'ACTIVE',
    ...(input.contactMetadata ? { contactMetadata: input.contactMetadata } : {}),
  };
}

export function updateCustomerMasterData(
  customer: Customer,
  input: {
    accountReference?: string;
    displayName?: string;
    contactMetadata?: Readonly<Record<string, string>>;
  },
): Customer {
  return {
    ...customer,
    ...(input.accountReference !== undefined
      ? { accountReference: requireText(input.accountReference, 'Customer account reference') }
      : {}),
    ...(input.displayName !== undefined
      ? { displayName: requireText(input.displayName, 'Customer display name') }
      : {}),
    ...(input.contactMetadata !== undefined ? { contactMetadata: input.contactMetadata } : {}),
  };
}

/** Deactivation is the reversible SUSPENDED lifecycle state; CLOSED remains terminal. */
export function deactivateCustomer(customer: Customer): Customer {
  if (customer.status === 'CLOSED') {
    throw new AppError('CONFLICT', 'A closed customer cannot be deactivated');
  }
  if (customer.status === 'SUSPENDED') {
    throw new AppError('CONFLICT', 'The customer is already deactivated');
  }
  return { ...customer, status: 'SUSPENDED' };
}

export function activateCustomer(customer: Customer): Customer {
  if (customer.status === 'CLOSED') {
    throw new AppError('CONFLICT', 'A closed customer cannot be activated');
  }
  if (customer.status === 'ACTIVE') {
    throw new AppError('CONFLICT', 'The customer is already active');
  }
  return { ...customer, status: 'ACTIVE' };
}

export function newCustomerAccount(input: {
  id: string;
  tenantId: string;
  customerId: string;
  accountType: CustomerAccountType;
  currency: CurrencyCode;
  creditLimit?: Money;
}): CustomerAccount {
  if (input.accountType === 'CREDIT' && !input.creditLimit) {
    throw new AppError('VALIDATION_FAILED', 'Credit accounts require a positive credit limit');
  }
  const account = {
    id: requireText(input.id, 'Customer account id'),
    tenantId: requireText(input.tenantId, 'Customer account tenant id'),
    customerId: requireText(input.customerId, 'Customer id'),
    accountType: input.accountType,
    currency: input.currency,
    status: 'ACTIVE' as const,
    ...(input.creditLimit
      ? { creditLimit: requirePositiveMoney(input.creditLimit, 'Credit limit') }
      : {}),
  };
  if (account.accountType !== 'CREDIT' && input.creditLimit) {
    throw new AppError('VALIDATION_FAILED', 'Credit limits apply only to credit accounts');
  }
  if (input.creditLimit && input.creditLimit.currency !== input.currency) {
    throw new AppError('VALIDATION_FAILED', 'Credit limit currency must match the account');
  }
  return account;
}

export function assertCustomerAccountTransactionAllowed(
  customerStatus: CustomerLifecycleState,
  accountStatus: CustomerAccountState,
): void {
  if (customerStatus !== 'ACTIVE' || accountStatus !== 'ACTIVE') {
    throw new AppError(
      'CONFLICT',
      'This customer or account is not active. Reactivate the customer before recording payments or fuel.',
    );
  }
}

export const CUSTOMER_ACCOUNT_STATION_SCOPES = ['ALL', 'SELECTED'] as const;
export type CustomerAccountStationScope = (typeof CUSTOMER_ACCOUNT_STATION_SCOPES)[number];

/** Where a customer account may be used (ADR-017). */
export type CustomerAccountStationPolicy = Readonly<{
  /** The customer's one legal entity; null until onboarding confirms it. */
  legalEntityId: string | null;
  /** Explicit owner/administrator confirmation is required, including for ALL. */
  configured: boolean;
  /** `ALL`: every station of the legal entity. `SELECTED`: only `allowedStationIds`. */
  scope: CustomerAccountStationScope;
  allowedStationIds: readonly string[];
}>;

/**
 * A customer account's balance is organisation-wide, but fuel may be drawn only
 * at stations of the account's legal entity and, when the account selects
 * stations, only at those.
 */
export function assertStationAllowedForAccount(
  policy: CustomerAccountStationPolicy,
  station: Readonly<{ stationId: string; legalEntityId: string }>,
): void {
  if (!policy.configured) {
    throw new AppError(
      'CONFLICT',
      'The customer account station scope is not configured. Confirm ALL or SELECTED station scope before use.',
    );
  }
  if (!policy.legalEntityId) {
    throw new AppError(
      'CONFLICT',
      'The customer has no legal entity yet. Confirm it before authorising fuel.',
    );
  }
  if (policy.legalEntityId !== station.legalEntityId) {
    throw new AppError(
      'FORBIDDEN',
      'This customer account cannot be used at a station of another legal entity',
    );
  }
  if (policy.scope === 'SELECTED' && !policy.allowedStationIds.includes(station.stationId)) {
    throw new AppError('FORBIDDEN', 'This customer account cannot be used at this station');
  }
}

export function assertCreditAccountHasPositiveLimit(account: CustomerAccount): void {
  if (account.accountType !== 'CREDIT') return;
  const limit = account.creditLimit?.amount;
  if (!limit || limit.value.isNegative() || limit.value.isZero()) {
    throw new AppError('CONFLICT', 'Credit account is disabled without a positive credit limit');
  }
}

function assertAccountMatchesEntry(account: CustomerAccount, entry: CustomerLedgerEntry): void {
  if (
    entry.tenantId !== account.tenantId ||
    entry.accountId !== account.id ||
    entry.customerId !== account.customerId ||
    entry.accountType !== account.accountType
  ) {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'Customer ledger entry does not belong to the account',
    );
  }
}

function assertEntryShape(entry: CustomerLedgerEntry): void {
  requireText(entry.id, 'Ledger entry id');
  requireText(entry.tenantId, 'Ledger entry tenant id');
  requireText(entry.customerId, 'Ledger entry customer id');
  requireText(entry.accountId, 'Ledger entry account id');
  requireText(entry.source.sourceId, 'Ledger source id');
  requireText(entry.occurredAt, 'Ledger occurred-at timestamp');
  requireText(entry.businessDate, 'Ledger business date');
  businessDate(entry.businessDate);
  if (entry.direction !== 'INCREASE' && entry.direction !== 'DECREASE')
    throw new AppError('VALIDATION_FAILED', 'Ledger direction is invalid');
  if (
    entry.accountType === 'CREDIT' &&
    !['CREDIT_FUEL_CHARGE', 'CUSTOMER_PAYMENT', 'ADJUSTMENT', 'REVERSAL'].includes(entry.entryType)
  ) {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'Credit accounts cannot contain this ledger entry type',
    );
  }
  if (
    entry.accountType !== 'CREDIT' &&
    !['PREPAID_TOPUP', 'PREPAID_FUEL_USAGE', 'ADJUSTMENT', 'REVERSAL'].includes(entry.entryType)
  ) {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'Prepaid accounts cannot contain this ledger entry type',
    );
  }
  if (entry.entryType === 'CREDIT_FUEL_CHARGE' && entry.direction !== 'INCREASE') {
    throw new AppError('INVARIANT_VIOLATION', 'Credit fuel charges must increase the receivable');
  }
  if (
    (entry.entryType === 'CUSTOMER_PAYMENT' || entry.entryType === 'PREPAID_FUEL_USAGE') &&
    entry.direction !== 'DECREASE'
  ) {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'Usage and payment entries must decrease the balance',
    );
  }
  if (entry.entryType === 'PREPAID_TOPUP' && entry.direction !== 'INCREASE') {
    throw new AppError('INVARIANT_VIOLATION', 'Prepaid top-ups must increase the balance');
  }
  if (entry.accountType === 'PREPAID_LITRES' && !entry.productId.trim()) {
    throw new AppError('VALIDATION_FAILED', 'Prepaid litre entries require a product');
  }
  if (entry.entryType === 'ADJUSTMENT' && !entry.reason?.trim()) {
    throw new AppError('VALIDATION_FAILED', 'Customer ledger adjustments require a reason');
  }
  if (entry.entryType === 'REVERSAL' && !entry.reversalOfEntryId) {
    throw new AppError('VALIDATION_FAILED', 'Customer ledger reversals require a source entry');
  }
  if ('amount' in entry) requirePositiveMoney(entry.amount, 'Ledger amount');
  if ('quantityLitres' in entry) requirePositiveLitres(entry.quantityLitres, 'Ledger litres');
}

export function deriveAccountBalance(
  account: CustomerAccount,
  entries: readonly CustomerLedgerEntry[],
): CustomerAccountBalance {
  let amount = new ExactDecimal('0');
  const productBalances = new Map<string, ExactDecimal>();

  for (const entry of entries) {
    assertAccountMatchesEntry(account, entry);
    assertEntryShape(entry);
    if ('amount' in entry) {
      if (entry.amount.currency !== account.currency) {
        throw new AppError('INVARIANT_VIOLATION', 'Ledger currency does not match the account');
      }
      amount = amount.add(signed(entry.amount.amount, entry.direction));
    } else {
      const current = productBalances.get(entry.productId) ?? new ExactDecimal('0');
      productBalances.set(
        entry.productId,
        current.add(signed(entry.quantityLitres, entry.direction)),
      );
    }
  }

  if (account.accountType === 'PREPAID_VALUE' && amount.value.isNegative()) {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'This would take the prepaid money balance below zero, so it was not saved.',
    );
  }
  if (account.accountType === 'PREPAID_LITRES') {
    for (const [productId, balance] of productBalances) {
      if (balance.value.isNegative()) {
        throw new AppError(
          'INVARIANT_VIOLATION',
          'This would take the prepaid litres balance below zero, so it was not saved.',
        );
      }
    }
    return {
      accountType: account.accountType,
      currency: account.currency,
      productBalances: [...productBalances.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([productId, balance]) => ({ productId, litres: litres(balance.toString()) })),
    };
  }

  return {
    accountType: account.accountType,
    currency: account.currency,
    amount: money(amount.toString(), account.currency),
  };
}

function assertFuelValue(input: CustomerFuelValue, currency: CurrencyCode): CustomerFuelValue {
  requireText(input.productId, 'Fuel product id');
  requirePositiveLitres(input.litres, 'Fuel litres');
  requirePositiveMoney(input.amount, 'Fuel amount');
  if (input.amount.currency !== currency) {
    throw new AppError('VALIDATION_FAILED', 'Fuel amount currency must match the account');
  }
  return input;
}

function sumReserved(
  reservations: readonly ActiveReservation[],
  account: CustomerAccount,
  productId: string,
): { amount: ExactDecimal; litres: ExactDecimal } {
  let amount = new ExactDecimal('0');
  let reservedLitres = new ExactDecimal('0');
  for (const reservation of reservations) {
    if (reservation.accountId !== account.id || reservation.accountType !== account.accountType)
      continue;
    amount = amount.add(reservation.remaining.amount.amount);
    if (reservation.remaining.productId === productId) {
      reservedLitres = reservedLitres.add(reservation.remaining.litres);
    }
  }
  return { amount, litres: reservedLitres };
}

export function requestCustomerFuelAuthorization(input: {
  id: string;
  account: CustomerAccount;
  stationId: string;
  requested: CustomerFuelValue;
  requestedBy: string;
  requestedAt: string;
  source: CustomerSourceReference;
}): CustomerFuelAuthorization {
  if (input.account.status !== 'ACTIVE')
    throw new AppError('CONFLICT', 'Fuel authorization requires an active customer account');
  assertCreditAccountHasPositiveLimit(input.account);
  const requested = assertFuelValue(input.requested, input.account.currency);
  return {
    id: requireText(input.id, 'Fuel authorization id'),
    tenantId: input.account.tenantId,
    stationId: requireText(input.stationId, 'Fuel authorization station id'),
    customerId: input.account.customerId,
    accountId: input.account.id,
    accountType: input.account.accountType,
    requested,
    used: {
      productId: requested.productId,
      litres: litres('0'),
      amount: money('0', requested.amount.currency),
    },
    remaining: requested,
    state: 'REQUESTED',
    requestedBy: requireText(input.requestedBy, 'Fuel authorization requester'),
    requestedAt: requireText(input.requestedAt, 'Fuel authorization request time'),
    source: input.source,
    version: 0,
  };
}

export function reserveCustomerFuelAuthorization(input: {
  authorization: CustomerFuelAuthorization;
  account: CustomerAccount;
  entries: readonly CustomerLedgerEntry[];
  activeReservations: readonly ActiveReservation[];
}): CustomerFuelAuthorization {
  const { authorization, account } = input;
  if (authorization.state !== 'REQUESTED') {
    throw new AppError('CONFLICT', 'Only requested fuel authorizations can be reserved');
  }
  if (authorization.accountId !== account.id || authorization.tenantId !== account.tenantId) {
    throw new AppError('INVARIANT_VIOLATION', 'Fuel authorization does not belong to the account');
  }
  const balance = deriveAccountBalance(account, input.entries);
  const reserved = sumReserved(
    input.activeReservations,
    account,
    authorization.requested.productId,
  );
  if (account.accountType === 'CREDIT') {
    assertCreditAccountHasPositiveLimit(account);
    if (balance.accountType !== 'CREDIT')
      throw new AppError('INVARIANT_VIOLATION', 'Credit account balance has the wrong shape');
    const owed = balance.amount.amount.add(reserved.amount);
    const limit = account.creditLimit?.amount;
    if (!limit || limit.value.isNegative() || limit.value.isZero()) {
      throw new AppError('CONFLICT', 'Credit account is disabled without a positive credit limit');
    }
    if (owed.add(authorization.requested.amount.amount).value.gt(limit.value)) {
      throw new AppError(
        'CONFLICT',
        'This would put the customer over their credit limit. Lower the amount or record a payment first.',
      );
    }
  } else if (account.accountType === 'PREPAID_VALUE') {
    if (balance.accountType !== 'PREPAID_VALUE')
      throw new AppError('INVARIANT_VIOLATION', 'Prepaid value balance has the wrong shape');
    const available = balance.amount.amount.subtract(reserved.amount);
    if (available.value.lt(authorization.requested.amount.amount.value)) {
      throw new AppError(
        'CONFLICT',
        'The customer does not have enough prepaid money for this. Top up the account or lower the amount.',
      );
    }
  } else {
    if (balance.accountType !== 'PREPAID_LITRES')
      throw new AppError('INVARIANT_VIOLATION', 'Prepaid litre balance has the wrong shape');
    const productBalance = balance.productBalances.find(
      (item: Readonly<{ productId: string; litres: Litres }>) =>
        item.productId === authorization.requested.productId,
    );
    const available = (productBalance?.litres ?? new ExactDecimal('0')).subtract(reserved.litres);
    if (available.value.lt(authorization.requested.litres.value)) {
      throw new AppError(
        'CONFLICT',
        'The customer does not have enough prepaid litres of this fuel. Top up the account or lower the litres.',
      );
    }
  }
  return { ...authorization, state: 'AUTHORIZED', version: authorization.version + 1 };
}

export function recordCustomerFuelUse(input: {
  authorization: CustomerFuelAuthorization;
  account: CustomerAccount;
  used: CustomerFuelValue;
  entryId: string;
  source: CustomerSourceReference;
  occurredAt: string;
  businessDate: string;
  fuelAllocationId: string;
}): { authorization: CustomerFuelAuthorization; ledgerEntry: CustomerLedgerEntry } {
  const { authorization, account } = input;
  assertCreditAccountHasPositiveLimit(account);
  if (authorization.state !== 'AUTHORIZED' && authorization.state !== 'PARTIALLY_USED') {
    throw new AppError('CONFLICT', 'Fuel usage requires an authorized reservation');
  }
  const used = assertFuelValue(input.used, account.currency);
  if (used.productId !== authorization.remaining.productId) {
    throw new AppError('INVARIANT_VIOLATION', 'Fuel product cannot change during an authorization');
  }
  if (
    used.amount.amount.value.gt(authorization.remaining.amount.amount.value) ||
    used.litres.value.gt(authorization.remaining.litres.value)
  ) {
    throw new AppError('CONFLICT', 'Fuel usage exceeds the remaining authorization');
  }
  const remaining: CustomerFuelValue = {
    productId: used.productId,
    amount: money(
      subtractPositive(authorization.remaining.amount.amount, used.amount.amount).toString(),
      account.currency,
    ),
    litres: litres(subtractPositive(authorization.remaining.litres, used.litres).toString()),
  };
  const usedTotal: CustomerFuelValue = {
    productId: used.productId,
    amount: money(
      authorization.used.amount.amount.add(used.amount.amount).toString(),
      account.currency,
    ),
    litres: litres(authorization.used.litres.add(used.litres).toString()),
  };
  const completed = remaining.amount.amount.value.isZero() && remaining.litres.value.isZero();
  const base = {
    id: requireText(input.entryId, 'Customer ledger entry id'),
    tenantId: account.tenantId,
    customerId: account.customerId,
    accountId: account.id,
    direction: account.accountType === 'CREDIT' ? ('INCREASE' as const) : ('DECREASE' as const),
    source: input.source,
    occurredAt: requireText(input.occurredAt, 'Customer ledger occurred-at timestamp'),
    businessDate: businessDate(input.businessDate),
    fuelAllocationId: requireText(input.fuelAllocationId, 'Fuel allocation id'),
  };
  let ledgerEntry: CustomerLedgerEntry;
  if (account.accountType === 'PREPAID_LITRES') {
    ledgerEntry = {
      ...base,
      accountType: 'PREPAID_LITRES',
      entryType: 'PREPAID_FUEL_USAGE',
      productId: used.productId,
      quantityLitres: used.litres,
    };
  } else if (account.accountType === 'CREDIT') {
    ledgerEntry = {
      ...base,
      accountType: 'CREDIT',
      entryType: 'CREDIT_FUEL_CHARGE',
      amount: used.amount,
    };
  } else {
    ledgerEntry = {
      ...base,
      accountType: 'PREPAID_VALUE',
      entryType: 'PREPAID_FUEL_USAGE',
      amount: used.amount,
    };
  }
  assertEntryShape(ledgerEntry);
  return {
    authorization: {
      ...authorization,
      used: usedTotal,
      remaining,
      state: completed ? 'COMPLETED' : 'PARTIALLY_USED',
      version: authorization.version + 1,
    },
    ledgerEntry,
  };
}

export function createCustomerPaymentEntry(input: {
  id: string;
  account: CustomerAccount;
  amount: Money;
  source: CustomerSourceReference;
  occurredAt: string;
  businessDate: string;
  note?: string;
}): CreditLedgerEntry {
  if (input.account.accountType !== 'CREDIT') {
    throw new AppError('VALIDATION_FAILED', 'Customer payments apply only to credit accounts');
  }
  const entry: CreditLedgerEntry = {
    id: requireText(input.id, 'Customer payment entry id'),
    tenantId: input.account.tenantId,
    customerId: input.account.customerId,
    accountId: input.account.id,
    accountType: 'CREDIT',
    entryType: 'CUSTOMER_PAYMENT',
    direction: 'DECREASE',
    amount: requirePositiveMoney(input.amount, 'Customer payment amount'),
    source: input.source,
    occurredAt: requireText(input.occurredAt, 'Customer payment time'),
    businessDate: businessDate(input.businessDate),
    ...(input.note ? { note: input.note } : {}),
  };
  assertEntryShape(entry);
  if (entry.amount.currency !== input.account.currency)
    throw new AppError('VALIDATION_FAILED', 'Customer payment currency must match the account');
  return entry;
}

export function createPrepaidTopUpEntry(input: {
  id: string;
  account: CustomerAccount;
  amount?: Money;
  productId?: string;
  quantityLitres?: Litres;
  source: CustomerSourceReference;
  occurredAt: string;
  businessDate: string;
}): PrepaidValueLedgerEntry | PrepaidLitresLedgerEntry {
  if (input.account.accountType === 'CREDIT') {
    throw new AppError('VALIDATION_FAILED', 'Prepaid top-ups do not apply to credit accounts');
  }
  const base = {
    id: requireText(input.id, 'Prepaid top-up entry id'),
    tenantId: input.account.tenantId,
    customerId: input.account.customerId,
    accountId: input.account.id,
    entryType: 'PREPAID_TOPUP' as const,
    direction: 'INCREASE' as const,
    source: input.source,
    occurredAt: requireText(input.occurredAt, 'Prepaid top-up time'),
    businessDate: businessDate(input.businessDate),
  };
  if (input.account.accountType === 'PREPAID_VALUE') {
    if (!input.amount || input.productId || input.quantityLitres)
      throw new AppError(
        'VALIDATION_FAILED',
        'Prepaid value top-ups require only a monetary amount',
      );
    const entry: PrepaidValueLedgerEntry = {
      ...base,
      accountType: 'PREPAID_VALUE',
      amount: requirePositiveMoney(input.amount, 'Prepaid top-up amount'),
    };
    if (entry.amount.currency !== input.account.currency)
      throw new AppError('VALIDATION_FAILED', 'Prepaid top-up currency must match the account');
    assertEntryShape(entry);
    return entry;
  }
  if (!input.productId || !input.quantityLitres || input.amount) {
    throw new AppError('VALIDATION_FAILED', 'Prepaid litre top-ups require a product and litres');
  }
  const entry: PrepaidLitresLedgerEntry = {
    ...base,
    accountType: 'PREPAID_LITRES',
    productId: requireText(input.productId, 'Prepaid litre product id'),
    quantityLitres: requirePositiveLitres(input.quantityLitres, 'Prepaid top-up litres'),
  };
  assertEntryShape(entry);
  return entry;
}

export function cancelCustomerFuelAuthorization(
  authorization: CustomerFuelAuthorization,
  reason: string,
): CustomerFuelAuthorization {
  requireText(reason, 'Cancellation reason');
  if (authorization.state !== 'AUTHORIZED' && authorization.state !== 'PARTIALLY_USED')
    throw new AppError('CONFLICT', 'Only reserved fuel authorizations can be cancelled');
  return {
    ...authorization,
    state: 'CANCELLED',
    version: authorization.version + 1,
    remaining: {
      ...authorization.remaining,
      amount: money('0', authorization.remaining.amount.currency),
      litres: litres('0'),
    },
  };
}

export function expireCustomerFuelAuthorization(
  authorization: CustomerFuelAuthorization,
  expiredAt: string,
): CustomerFuelAuthorization {
  if (authorization.state !== 'AUTHORIZED' && authorization.state !== 'PARTIALLY_USED')
    throw new AppError('CONFLICT', 'Only reserved fuel authorizations can expire');
  requireText(expiredAt, 'Fuel authorization expiry time');
  return {
    ...authorization,
    state: 'EXPIRED',
    version: authorization.version + 1,
    remaining: {
      ...authorization.remaining,
      amount: money('0', authorization.remaining.amount.currency),
      litres: litres('0'),
    },
  };
}
