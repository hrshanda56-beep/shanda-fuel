import { seedClerkSession, seedActiveStepUp, clerkHeaders } from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { POST as forecourtCommandPost } from '../../src/app/api/forecourt/commands/route';
import { GET as dailyReportGet } from '../../src/app/api/reports/daily/route';
import { GET as managementReportGet } from '../../src/app/api/reports/management/route';
import { GET as reportActivityGet } from '../../src/app/api/reports/activity/route';
import { GET as reportExportGet } from '../../src/app/api/reports/export/route';
import { POST as reportSharePost } from '../../src/app/api/reports/share/route';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required for A10 management-reporting integration tests. Configure a dedicated PostgreSQL test database.',
  );
}

const ids = {
  tenant: 'a10b0000-0000-4000-8000-000000000001',
  otherTenant: 'a10b0000-0000-4000-8000-000000000002',
  legal: 'a10b0000-0000-4000-8000-000000000011',
  station: 'a10b0000-0000-4000-8000-000000000021',
  scopedStation: 'a10b0000-0000-4000-8000-000000000023',
  otherLegal: 'a10b0000-0000-4000-8000-000000000012',
  otherStation: 'a10b0000-0000-4000-8000-000000000022',
  actor: 'a10b0000-0000-4000-8000-000000000031',
  membership: 'a10b0000-0000-4000-8000-000000000041',
  session: 'a10b0000-0000-4000-8000-000000000051',
  scopedActor: 'a10b0000-0000-4000-8000-000000000061',
  scopedMembership: 'a10b0000-0000-4000-8000-000000000071',
  scopedSession: 'a10b0000-0000-4000-8000-000000000081',
  factDay: 'a10b0000-0000-4000-8000-000000000091',
  factShift: 'a10b0000-0000-4000-8000-000000000092',
  factRecon: 'a10b0000-0000-4000-8000-000000000093',
  factRevision: 'a10b0000-0000-4000-8000-000000000094',
  factProduct: 'a10b0000-0000-4000-8000-000000000095',
  factPump: 'a10b0000-0000-4000-8000-000000000096',
  factNozzle: 'a10b0000-0000-4000-8000-000000000097',
  factMeter: 'a10b0000-0000-4000-8000-000000000098',
  factInstallation: 'a10b0000-0000-4000-8000-000000000099',
  factPrice: 'a10b0000-0000-4000-8000-0000000000a0',
  factReading: 'a10b0000-0000-4000-8000-0000000000a1',
  factCashPayment: 'a10b0000-0000-4000-8000-0000000000a2',
  factPosPayment: 'a10b0000-0000-4000-8000-0000000000a3',
  factEcoPayment: 'a10b0000-0000-4000-8000-0000000000a4',
  factCreditPayment: 'a10b0000-0000-4000-8000-0000000000a5',
  factPrepaidPayment: 'a10b0000-0000-4000-8000-0000000000a6',
  factExpense: 'a10b0000-0000-4000-8000-0000000000a7',
  factExpenseCategory: 'a10b0000-0000-4000-8000-0000000000f2',
  factExpenseRecognition: 'a10b0000-0000-4000-8000-0000000000f3',
  factCashDeclaration: 'a10b0000-0000-4000-8000-0000000000a8',
  factTill: 'a10b0000-0000-4000-8000-0000000000a9',
  factSafe: 'a10b0000-0000-4000-8000-0000000000aa',
  factBankAccount: 'a10b0000-0000-4000-8000-0000000000ab',
  factCollection: 'a10b0000-0000-4000-8000-0000000000ac',
  factDeposit: 'a10b0000-0000-4000-8000-0000000000ad',
  factDepositAllocation: 'a10b0000-0000-4000-8000-0000000000ae',
  factProvider: 'a10b0000-0000-4000-8000-0000000000af',
  factProviderAccount: 'a10b0000-0000-4000-8000-0000000000b1',
  factSettlement: 'a10b0000-0000-4000-8000-0000000000b2',
  factSettlementAllocation: 'a10b0000-0000-4000-8000-0000000000b3',
  factSettlementReversal: 'a10b0000-0000-4000-8000-0000000000f1',
  factSupplier: 'a10b0000-0000-4000-8000-0000000000b4',
  factSupplierInvoice: 'a10b0000-0000-4000-8000-0000000000b5',
  factSupplierCredit: 'a10b0000-0000-4000-8000-0000000000b6',
  factSupplierPayment: 'a10b0000-0000-4000-8000-0000000000b7',
  factCustomer: 'a10b0000-0000-4000-8000-0000000000b8',
  factCreditAccount: 'a10b0000-0000-4000-8000-0000000000b9',
  factPrepaidAccount: 'a10b0000-0000-4000-8000-0000000000ba',
  factCreditCharge: 'a10b0000-0000-4000-8000-0000000000bb',
  factCustomerPayment: 'a10b0000-0000-4000-8000-0000000000bc',
  factPrepaidTopup: 'a10b0000-0000-4000-8000-0000000000bd',
  factTank: 'a10b0000-0000-4000-8000-0000000000be',
  factInventoryMovement: 'a10b0000-0000-4000-8000-0000000000bf',
  factCostEvent: 'a10b0000-0000-4000-8000-0000000000c0',
  factDelivery: 'a10b0000-0000-4000-8000-0000000000c1',
  factOpeningBoundary: 'a10b0000-0000-4000-8000-0000000000c2',
  factClosingBoundary: 'a10b0000-0000-4000-8000-0000000000c3',
  factSegment: 'a10b0000-0000-4000-8000-0000000000c4',
  revaluationPositive: 'a10b0000-0000-4000-8000-0000000000c7',
  revaluationNegative: 'a10b0000-0000-4000-8000-0000000000c8',
  revaluationSequential: 'a10b0000-0000-4000-8000-0000000000c9',
  revaluationPending: 'a10b0000-0000-4000-8000-0000000000ca',
  revaluationSourcePositive: 'a10b0000-0000-4000-8000-0000000000cb',
  revaluationSourceNegative: 'a10b0000-0000-4000-8000-0000000000cc',
  revaluationSourceSequential: 'a10b0000-0000-4000-8000-0000000000cd',
  revaluationSourcePending: 'a10b0000-0000-4000-8000-0000000000ce',
  revaluationLinePositive: 'a10b0000-0000-4000-8000-0000000000cf',
  revaluationLineNegative: 'a10b0000-0000-4000-8000-0000000000d0',
  revaluationLineSequential: 'a10b0000-0000-4000-8000-0000000000d1',
  revaluationLinePending: 'a10b0000-0000-4000-8000-0000000000d2',
  revaluationEventPositive: 'a10b0000-0000-4000-8000-0000000000d3',
  revaluationEventNegative: 'a10b0000-0000-4000-8000-0000000000d4',
  revaluationEventSequential: 'a10b0000-0000-4000-8000-0000000000d5',
  revaluationEventPending: 'a10b0000-0000-4000-8000-0000000000d6',
  costingDay: 'a10b0000-0000-4000-8000-0000000000d7',
  costingShift: 'a10b0000-0000-4000-8000-0000000000d8',
  costingRecon: 'a10b0000-0000-4000-8000-0000000000d9',
  costingRevisionSuperseded: 'a10b0000-0000-4000-8000-0000000000da',
  costingRevisionLatest: 'a10b0000-0000-4000-8000-0000000000db',
  costingReading: 'a10b0000-0000-4000-8000-0000000000dc',
  costingSegmentSuperseded: 'a10b0000-0000-4000-8000-0000000000dd',
  costingSegmentLatest: 'a10b0000-0000-4000-8000-0000000000de',
  costingMovementSuperseded: 'a10b0000-0000-4000-8000-0000000000df',
  costingMovementLatest: 'a10b0000-0000-4000-8000-0000000000e0',
  costingBridgeSuperseded: 'a10b0000-0000-4000-8000-0000000000e1',
  costingBridgeLatest: 'a10b0000-0000-4000-8000-0000000000e2',
  costingTank: 'a10b0000-0000-4000-8000-0000000000e3',
  costingNozzle: 'a10b0000-0000-4000-8000-0000000000e4',
  costingInstallation: 'a10b0000-0000-4000-8000-0000000000e5',
  costingOpeningBoundary: 'a10b0000-0000-4000-8000-0000000000e6',
  costingClosingBoundary: 'a10b0000-0000-4000-8000-0000000000e7',
  costingOpeningBoundaryLatest: 'a10b0000-0000-4000-8000-0000000000e8',
  costingClosingBoundaryLatest: 'a10b0000-0000-4000-8000-0000000000e9',
  costingSegmentMissing: 'a10b0000-0000-4000-8000-0000000000ea',
  costingMovementMissing: 'a10b0000-0000-4000-8000-0000000000eb',
  costingBridgeMissing: 'a10b0000-0000-4000-8000-0000000000ec',
  costingMissingOpeningBoundary: 'a10b0000-0000-4000-8000-0000000000ed',
  costingMissingClosingBoundary: 'a10b0000-0000-4000-8000-0000000000ee',
  costingInvalidAttribution: 'a10b0000-0000-4000-8000-0000000000ef',
  costingInvalidEvent: 'a10b0000-0000-4000-8000-0000000000f0',
};
const sessionToken = 'a10-management-session-token';
const scopedSessionToken = 'a10-management-scoped-session-token';

async function signedCookie(token = sessionToken): Promise<string> {
  return token;
}

async function forecourtCommand(input: Record<string, unknown>, key: string) {
  return forecourtCommandPost(
    new Request('http://127.0.0.1:3000/api/forecourt/commands', {
      method: 'POST',
      headers: {
        ...clerkHeaders(await signedCookie()),
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      body: JSON.stringify(input),
    }),
  );
}

describe('A10 management reporting PostgreSQL read model', () => {
  let client: Sql;

  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';

    client = postgres(databaseUrl!, { max: 2, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'A10 Reporting Tenant', 'a10-reporting-tenant'),
        ('${ids.otherTenant}', 'A10 Other Tenant', 'a10-other-tenant')
      on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.actor}', 'A10 Finance', 'a10-finance@example.test'),
        ('${ids.scopedActor}', 'A10 Station Finance', 'a10-station-finance@example.test')
      on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status)
        values
          ('${ids.membership}', '${ids.tenant}', '${ids.actor}', 'ACTIVE'),
          ('${ids.scopedMembership}', '${ids.tenant}', '${ids.scopedActor}', 'ACTIVE')
      on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'A10 Legal'),
        ('${ids.otherLegal}', '${ids.otherTenant}', 'A10 Other Legal')
      on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'A10MAIN', 'A10 Main Station', 'ACTIVE'),
        ('${ids.scopedStation}', '${ids.tenant}', '${ids.legal}', 'A10SCOPED', 'A10 Scoped Station', 'ACTIVE'),
        ('${ids.otherStation}', '${ids.otherTenant}', '${ids.otherLegal}', 'A10OTHER', 'A10 Other Station', 'ACTIVE')
      on conflict (id) do nothing;
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values ('${ids.tenant}', '${ids.membership}', 'FINANCE', 'TENANT', null, null)
      on conflict do nothing;
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values
        ('${ids.tenant}', '${ids.membership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.station}'),
        ('${ids.tenant}', '${ids.membership}', 'ATTENDANT', 'STATION', '${ids.legal}', '${ids.station}')
      on conflict do nothing;
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values ('${ids.tenant}', '${ids.scopedMembership}', 'FINANCE', 'STATION', '${ids.legal}', '${ids.scopedStation}')
      on conflict do nothing;
      insert into app.station_business_days (id, tenant_id, station_id, business_date, state)
        values ('${ids.factDay}', '${ids.tenant}', '${ids.station}', '2026-09-20', 'NOT_STARTED')
        on conflict (id) do nothing;
      update app.station_business_days set state = 'OPEN', opened_at = now()
        where id = '${ids.factDay}' and state = 'NOT_STARTED';
      insert into app.products (id, tenant_id, code, name, status)
        values ('${ids.factProduct}', '${ids.tenant}', 'A10-PMS', 'A10 Petrol', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.pumps (id, tenant_id, station_id, number, name, status)
        values ('${ids.factPump}', '${ids.tenant}', '${ids.station}', 'A10-1', 'A10 Pump', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.nozzles (id, tenant_id, station_id, pump_id, number, product_id, status)
        values ('${ids.factNozzle}', '${ids.tenant}', '${ids.station}', '${ids.factPump}', 'A10-1', '${ids.factProduct}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.meters (id, tenant_id, serial_number, status)
        values ('${ids.factMeter}', '${ids.tenant}', 'A10-METER-1', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.meter_installations
        (id, tenant_id, station_id, nozzle_id, meter_id, effective_from, installed_by)
        values ('${ids.factInstallation}', '${ids.tenant}', '${ids.station}', '${ids.factNozzle}', '${ids.factMeter}', '2026-09-19T00:00:00Z', '${ids.membership}')
        on conflict (id) do nothing;
      insert into app.selling_prices
        (id, tenant_id, station_id, product_id, effective_from, unit_price, state, requested_by)
        values ('${ids.factPrice}', '${ids.tenant}', '${ids.station}', '${ids.factProduct}', '2026-09-20T00:00:00Z', 10.000000, 'DRAFT', '${ids.membership}')
        on conflict (id) do nothing;
      update app.selling_prices set state='PENDING_APPROVAL'
        where id='${ids.factPrice}' and state='DRAFT';
      update app.selling_prices set state='APPROVED', approved_by='${ids.membership}', approved_at=now()
        where id='${ids.factPrice}' and state='PENDING_APPROVAL';
      update app.selling_prices set state='PENDING_STATION_ACTIVATION'
        where id='${ids.factPrice}' and state='APPROVED';
      update app.selling_prices set state='BOUNDARIES_IN_PROGRESS'
        where id='${ids.factPrice}' and state='PENDING_STATION_ACTIVATION';
      update app.selling_prices set state='ACTIVE', activated_at=now()
        where id='${ids.factPrice}' and state='BOUNDARIES_IN_PROGRESS';
      insert into app.shifts
        (id, tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at, business_date)
        values ('${ids.factShift}', '${ids.tenant}', '${ids.station}', '${ids.factDay}', 'PLANNED', '2026-09-20T06:00:00Z', '2026-09-20T14:00:00Z', '2026-09-20')
        on conflict (id) do nothing;
      insert into app.meter_boundaries
        (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id, reason,
         reading_status, reading_value, effective_at, confirmed_at, confirmed_by, entered_by, attendant_id)
      values
        ('${ids.factOpeningBoundary}', '${ids.tenant}', '${ids.station}', '${ids.factNozzle}', '${ids.factInstallation}', '${ids.factDay}', '${ids.factShift}', 'SHIFT_OPEN',
         'AVAILABLE', 100.000, '2026-09-20T06:00:00Z', '2026-09-20T06:00:01Z', '${ids.membership}', '${ids.membership}', '${ids.membership}'),
        ('${ids.factClosingBoundary}', '${ids.tenant}', '${ids.station}', '${ids.factNozzle}', '${ids.factInstallation}', '${ids.factDay}', '${ids.factShift}', 'SHIFT_CLOSE',
         'AVAILABLE', 110.500, '2026-09-20T07:00:00Z', '2026-09-20T07:00:01Z', '${ids.membership}', '${ids.membership}', '${ids.membership}')
      on conflict (id) do nothing;
      insert into app.reconciliations
        (id, tenant_id, station_id, business_day_id, shift_id, supervisor_id, created_by, state)
        values ('${ids.factRecon}', '${ids.tenant}', '${ids.station}', '${ids.factDay}', '${ids.factShift}', '${ids.membership}', '${ids.membership}', 'DRAFT')
        on conflict (id) do nothing;
      insert into app.reconciliation_revisions
        (id, tenant_id, station_id, reconciliation_id, revision, state, expected_sales, accounted_sales, variance, currency, variance_classification, declarations, approved_by, approved_at)
        values ('${ids.factRevision}', '${ids.tenant}', '${ids.station}', '${ids.factRecon}', 1, 'READY', 135.0000, 130.0000, -5.0000, 'USD', 'INFORMATIONAL', '[]'::jsonb, null, null)
        on conflict (id) do nothing;
      insert into app.reconciliation_meter_readings
        (id, tenant_id, station_id, reconciliation_id, shift_id, nozzle_id, product_id, opening_reading, closing_reading, litres_sold, unit_price, sales_value, entered_by)
        values ('${ids.factReading}', '${ids.tenant}', '${ids.station}', '${ids.factRecon}', '${ids.factShift}', '${ids.factNozzle}', '${ids.factProduct}', 100.000, 110.500, 10.500, 10.000000, 105.0000, '${ids.membership}')
        on conflict (id) do nothing;
      insert into app.reconciliation_payments
        (id, tenant_id, station_id, reconciliation_id, method, amount, reference, entered_by)
        values
          ('${ids.factCashPayment}', '${ids.tenant}', '${ids.station}', '${ids.factRecon}', 'CASH', 70.0000, 'A10-CASH', '${ids.membership}'),
          ('${ids.factPosPayment}', '${ids.tenant}', '${ids.station}', '${ids.factRecon}', 'POS', 30.0000, 'A10-POS', '${ids.membership}'),
          ('${ids.factEcoPayment}', '${ids.tenant}', '${ids.station}', '${ids.factRecon}', 'ECOCASH', 15.0000, 'A10-ECO', '${ids.membership}'),
          ('${ids.factCreditPayment}', '${ids.tenant}', '${ids.station}', '${ids.factRecon}', 'CUSTOMER_CREDIT', 10.0000, 'A10-CREDIT', '${ids.membership}'),
          ('${ids.factPrepaidPayment}', '${ids.tenant}', '${ids.station}', '${ids.factRecon}', 'PREPAID', 5.0000, 'A10-PREPAID', '${ids.membership}')
        on conflict (id) do nothing;
      insert into app.reconciliation_expenses
        (id, tenant_id, station_id, reconciliation_id, category, description, amount, payment_method, entered_by)
        values ('${ids.factExpense}', '${ids.tenant}', '${ids.station}', '${ids.factRecon}', 'A10_TEST', 'A10 test expense', 2.0000, 'CASH', '${ids.membership}')
        on conflict (id) do nothing;
      insert into app.expense_categories
        (id, tenant_id, code, name, classification, status, created_by)
        values ('${ids.factExpenseCategory}', '${ids.tenant}', 'A10_TEST', 'A10 test expense', 'OPERATING', 'ACTIVE', '${ids.membership}')
        on conflict (id) do nothing;
      insert into app.expenses
        (id, tenant_id, legal_entity_id, station_id, category_id, expense_date, description, amount, submitted_by)
        values ('${ids.factExpense}', '${ids.tenant}', '${ids.legal}', '${ids.station}', '${ids.factExpenseCategory}',
         '2026-09-20', 'A10 test expense', 2.0000, '${ids.membership}')
        on conflict (id) do nothing;
      insert into app.expense_recognition_movements
        (id, tenant_id, legal_entity_id, station_id, category_id, classification, movement_type,
         source_type, source_id, recognition_date, currency, amount, actor_membership_id)
        values ('${ids.factExpenseRecognition}', '${ids.tenant}', '${ids.legal}', '${ids.station}',
         '${ids.factExpenseCategory}', 'OPERATING', 'RECOGNITION', 'EXPENSE', '${ids.factExpense}',
         '2026-09-20', 'USD', 2.0000, '${ids.membership}')
        on conflict (id) do nothing;
      insert into app.reconciliation_cash_declarations
        (id, tenant_id, station_id, reconciliation_id, counted_cash, expected_physical_cash, cash_paid_expenses, net_expected_cash, cash_variance, entered_by)
        values ('${ids.factCashDeclaration}', '${ids.tenant}', '${ids.station}', '${ids.factRecon}', 69.0000, 70.0000, 2.0000, 68.0000, 1.0000, '${ids.membership}')
        on conflict (id) do nothing;
      insert into app.reconciliation_variance_explanations
        (id, tenant_id, station_id, reconciliation_id, category, explanation, entered_by)
        values ('a10b0000-0000-4000-8000-0000000000c5', '${ids.tenant}', '${ids.station}', '${ids.factRecon}', 'SALES', 'A10 canonical reporting fixture variance', '${ids.membership}')
        on conflict (id) do nothing;
      insert into app.reconciliation_variance_explanations
        (id, tenant_id, station_id, reconciliation_id, category, explanation, entered_by)
        values ('a10b0000-0000-4000-8000-0000000000c6', '${ids.tenant}', '${ids.station}', '${ids.factRecon}', 'CASH', 'A10 canonical cash variance explanation', '${ids.membership}')
        on conflict (id) do nothing;
      update app.shifts set state = 'OPEN', opened_at = '2026-09-20T06:00:00Z' where id = '${ids.factShift}' and state = 'PLANNED';
      update app.reconciliations set state = 'READY' where id = '${ids.factRecon}' and state = 'DRAFT';
      update app.reconciliations set state = 'SUBMITTED', submitted_by = '${ids.scopedMembership}', submitted_at = '2026-09-20T22:00:00Z' where id = '${ids.factRecon}' and state = 'READY';
      update app.reconciliation_revisions set state = 'SUBMITTED', submitted_by = '${ids.scopedMembership}', submitted_at = '2026-09-20T22:00:00Z' where id = '${ids.factRevision}' and state = 'READY';
      update app.reconciliation_revisions set state = 'PENDING_APPROVAL' where id = '${ids.factRevision}' and state = 'SUBMITTED';
      insert into app.cash_locations
        (id, tenant_id, station_id, code, name, location_type)
        values
          ('${ids.factTill}', '${ids.tenant}', '${ids.station}', 'A10-TILL', 'A10 Till', 'STATION_TILL'),
          ('${ids.factSafe}', '${ids.tenant}', '${ids.station}', 'A10-SAFE', 'A10 Safe', 'STATION_SAFE')
        on conflict (id) do nothing;
      insert into app.bank_accounts
        (id, tenant_id, legal_entity_id, name, bank_name, account_reference_masked)
        values ('${ids.factBankAccount}', '${ids.tenant}', '${ids.legal}', 'A10 Bank', 'A10 Bank', '****1010')
        on conflict (id) do nothing;
      insert into app.cash_collections
        (id, tenant_id, station_id, collection_reference, source_location_id, current_location_id, amount, business_date, state, recorded_by, received_by, received_at)
        values ('${ids.factCollection}', '${ids.tenant}', '${ids.station}', 'A10-COLLECTION', '${ids.factTill}', '${ids.factSafe}', 60.0000, '2026-09-20', 'RECEIVED', '${ids.membership}', '${ids.membership}', '2026-09-20T23:30:00Z')
        on conflict (id) do nothing;
      insert into app.bank_deposits
        (id, tenant_id, station_id, source_location_id, bank_account_id, amount, deposit_reference, state, deposited_at, confirmed_amount, confirmation_variance, bank_reference, confirmed_at, recorded_by, confirmed_by)
        values ('${ids.factDeposit}', '${ids.tenant}', '${ids.station}', '${ids.factSafe}', '${ids.factBankAccount}', 40.0000, 'A10-DEPOSIT', 'CONFIRMED', '2026-09-22T08:00:00Z', 40.0000, 0.0000, 'A10-BANK-REF', '2026-09-22T09:00:00Z', '${ids.membership}', '${ids.membership}')
        on conflict (id) do nothing;
      insert into app.bank_deposit_allocations
        (id, tenant_id, station_id, deposit_id, collection_id, amount, allocated_by)
        values ('${ids.factDepositAllocation}', '${ids.tenant}', '${ids.station}', '${ids.factDeposit}', '${ids.factCollection}', 40.0000, '${ids.membership}')
        on conflict (id) do nothing;
      insert into app.payment_providers
        (id, tenant_id, code, name, provider_type, created_by)
        values ('${ids.factProvider}', '${ids.tenant}', 'A10-PROVIDER', 'A10 Provider', 'MOBILE_MONEY', '${ids.membership}')
        on conflict (id) do nothing;
      insert into app.provider_accounts
        (id, tenant_id, provider_id, legal_entity_id, station_id, account_reference, display_name, created_by, updated_by)
        values ('${ids.factProviderAccount}', '${ids.tenant}', '${ids.factProvider}', '${ids.legal}', '${ids.station}', 'A10-ACCOUNT', 'A10 Provider Account', '${ids.membership}', '${ids.membership}')
        on conflict (id) do nothing;
      insert into app.provider_settlements
        (id, tenant_id, provider_account_id, station_id, settlement_reference, transaction_date, settlement_date, currency, gross_amount, provider_fee_amount, provider_deduction_amount, source_type, source_key, state, recorded_by)
        values ('${ids.factSettlement}', '${ids.tenant}', '${ids.factProviderAccount}', '${ids.station}', 'A10-SETTLEMENT', '2026-09-20', '2026-09-22', 'USD', 45.0000, 1.0000, 0.0000, 'MANUAL', 'A10-SETTLEMENT-SOURCE', 'PARTIALLY_MATCHED', '${ids.membership}')
        on conflict (id) do nothing;
      insert into app.suppliers
        (id, tenant_id, code, legal_name, created_by, updated_by)
        values ('${ids.factSupplier}', '${ids.tenant}', 'A10-SUPPLIER', 'A10 Supplier', '${ids.membership}', '${ids.membership}')
        on conflict (id) do nothing;
      insert into app.supplier_account_movements
        (id, tenant_id, legal_entity_id, supplier_id, movement_type, amount, source_type, source_id, effective_date, actor_membership_id)
        values
          ('${ids.factSupplierInvoice}', '${ids.tenant}', '${ids.legal}', '${ids.factSupplier}', 'INVOICE', 100.0000, 'A10_TEST', '${ids.factSupplierInvoice}', '2026-09-19', '${ids.membership}'),
          ('${ids.factSupplierCredit}', '${ids.tenant}', '${ids.legal}', '${ids.factSupplier}', 'CREDIT_NOTE', 5.0000, 'A10_TEST', '${ids.factSupplierCredit}', '2026-09-20', '${ids.membership}'),
          ('${ids.factSupplierPayment}', '${ids.tenant}', '${ids.legal}', '${ids.factSupplier}', 'PAYMENT', 25.0000, 'A10_TEST', '${ids.factSupplierPayment}', '2026-09-20', '${ids.membership}')
        on conflict (id) do nothing;
      insert into app.customers
        (id, tenant_id, account_reference, display_name, created_by, updated_by)
        values ('${ids.factCustomer}', '${ids.tenant}', 'A10-CUSTOMER', 'A10 Customer', '${ids.membership}', '${ids.membership}')
        on conflict (id) do nothing;
      insert into app.customer_accounts
        (id, tenant_id, customer_id, account_type, credit_limit, created_by, updated_by)
        values
          ('${ids.factCreditAccount}', '${ids.tenant}', '${ids.factCustomer}', 'CREDIT', 500.0000, '${ids.membership}', '${ids.membership}'),
          ('${ids.factPrepaidAccount}', '${ids.tenant}', '${ids.factCustomer}', 'PREPAID_VALUE', null, '${ids.membership}', '${ids.membership}')
        on conflict (id) do nothing;
      insert into app.customer_ledger_entries
        (id, tenant_id, customer_id, account_id, account_type, entry_type, direction, amount, source_type, source_id, source_key, occurred_at, business_date, actor_membership_id)
        values
          ('${ids.factCreditCharge}', '${ids.tenant}', '${ids.factCustomer}', '${ids.factCreditAccount}', 'CREDIT', 'CREDIT_FUEL_CHARGE', 'INCREASE', 40.0000, 'A5_RECONCILIATION_CUSTOMER_FUEL', '${ids.factRecon}', 'A10-CREDIT-CHARGE', '2026-09-19T12:00:00Z', '2026-09-19', '${ids.membership}'),
          ('${ids.factCustomerPayment}', '${ids.tenant}', '${ids.factCustomer}', '${ids.factCreditAccount}', 'CREDIT', 'CUSTOMER_PAYMENT', 'DECREASE', 10.0000, 'CUSTOMER_PAYMENT', '${ids.factCustomerPayment}', 'A10-CUSTOMER-PAYMENT', '2026-09-20T12:00:00Z', '2026-09-20', '${ids.membership}'),
          ('${ids.factPrepaidTopup}', '${ids.tenant}', '${ids.factCustomer}', '${ids.factPrepaidAccount}', 'PREPAID_VALUE', 'PREPAID_TOPUP', 'INCREASE', 12.0000, 'PREPAID_TOPUP', '${ids.factPrepaidTopup}', 'A10-PREPAID-TOPUP', '2026-09-20T12:00:00Z', '2026-09-20', '${ids.membership}')
        on conflict (id) do nothing;
      insert into app.tanks
        (id, tenant_id, station_id, code, product_id, capacity_litres, created_by, updated_by)
        values ('${ids.factTank}', '${ids.tenant}', '${ids.station}', 'A10-TANK', '${ids.factProduct}', 10000.000, '${ids.membership}', '${ids.membership}')
        on conflict (id) do nothing;
      insert into app.inventory_movements
        (id, tenant_id, station_id, tank_id, product_id, movement_type, quantity_litres, effective_at, business_date, source_type, source_id, actor_membership_id, unit_landed_cost, total_landed_cost, currency)
        values ('${ids.factInventoryMovement}', '${ids.tenant}', '${ids.station}', '${ids.factTank}', '${ids.factProduct}', 'OPENING_BALANCE', 95.000, '2026-09-19T00:00:00Z', '2026-09-19', 'A10_TEST', '${ids.factInventoryMovement}', '${ids.membership}', 2.00000000, 190.0000, 'USD')
        on conflict (id) do nothing;
      insert into app.inventory_cost_events
        (id, tenant_id, station_id, tank_id, product_id, event_type, source_type, source_id,
         effective_at, business_date, amount, currency, actor_membership_id)
        values ('${ids.factCostEvent}', '${ids.tenant}', '${ids.station}', '${ids.factTank}', '${ids.factProduct}',
          'OPENING_COST', 'A10_TEST', '${ids.factInventoryMovement}',
          '2026-09-19T00:00:00Z', '2026-09-19', 190.0000, 'USD', '${ids.membership}')
        on conflict (id) do nothing;
      insert into app.fuel_deliveries
        (id, tenant_id, station_id, product_id, delivery_note_number, delivered_at, business_date, note_quantity_litres, actual_quantity_litres, shortage_excess_litres, status, unit_landed_cost, total_landed_cost, currency, recorded_by, confirmed_by, confirmed_at)
        values ('${ids.factDelivery}', '${ids.tenant}', '${ids.station}', '${ids.factProduct}', 'A10-DELIVERY', '2026-09-20T10:00:00Z', '2026-09-20', 20.000, 20.000, 0.000, 'CONFIRMED', 2.00000000, 40.0000, 'USD', '${ids.membership}', '${ids.membership}', '2026-09-20T11:00:00Z')
        on conflict (id) do nothing;
    `);
    await seedClerkSession(client, ids.session, sessionToken, ids.actor, true);
    await seedClerkSession(client, ids.scopedSession, scopedSessionToken, ids.scopedActor, true);
    await seedActiveStepUp(client, ids.session, ids.tenant);

    const seal = await forecourtCommand(
      {
        commandType: 'SealSegment',
        tenantId: ids.tenant,
        stationId: ids.station,
        segmentId: ids.factSegment,
        nozzleId: ids.factNozzle,
        meterInstallationId: ids.factInstallation,
        businessDayId: ids.factDay,
        shiftId: ids.factShift,
        openingBoundaryId: ids.factOpeningBoundary,
        closingBoundaryId: ids.factClosingBoundary,
        productId: ids.factProduct,
        responsibleAttendantId: ids.membership,
        startAt: '2026-09-20T06:00:00.000Z',
        endAt: '2026-09-20T07:00:00.000Z',
        expectedVersion: 0,
      },
      'a10-seal-canonical-segment',
    );
    expect(seal.status).toBe(201);

    const approval = await forecourtCommand(
      {
        commandType: 'ApproveProductionReconciliation',
        tenantId: ids.tenant,
        stationId: ids.station,
        reconciliationId: ids.factRecon,
        expectedVersion: 0,
      },
      'a10-approve-canonical-reconciliation',
    );
    const approvalBody = (await approval.json()) as Record<string, unknown>;
    expect(approval.status, JSON.stringify(approvalBody)).toBe(200);

    await client.unsafe(`
      insert into app.provider_settlement_allocations
        (id, tenant_id, station_id, settlement_id, reconciliation_payment_id, amount, allocation_key, state, allocated_by)
      values ('${ids.factSettlementAllocation}', '${ids.tenant}', '${ids.station}', '${ids.factSettlement}', '${ids.factPosPayment}', 20.0000, 'A10-SETTLEMENT-ALLOCATION', 'POSTED', '${ids.membership}')
      on conflict (id) do nothing;
    `);

    const segmentSaleMovements = await client.unsafe<
      { source_type: string; source_id: string; movement_type: string; quantity_litres: string }[]
    >(`
      select source_type, source_id, movement_type, quantity_litres::text as quantity_litres
      from app.inventory_movements
      where tenant_id='${ids.tenant}'
        and station_id='${ids.station}'
        and source_type='METER_SEGMENT_SALE'
        and source_id='${ids.factSegment}'
        and movement_type='SALE'
    `);
    expect(segmentSaleMovements).toEqual([
      {
        source_type: 'METER_SEGMENT_SALE',
        source_id: ids.factSegment,
        movement_type: 'SALE',
        quantity_litres: '-10.500',
      },
    ]);

    const saleEvidence = await client.unsafe<
      {
        sale_movement_id: string;
        attribution_id: string;
        original_cogs: string;
        pre_sale_wac: string;
        sale_effective_at: string;
        business_date: string;
      }[]
    >(`
      select movement.id as sale_movement_id,
             attribution.id as attribution_id,
             attribution.original_cogs::text as original_cogs,
             attribution.pre_sale_wac::text as pre_sale_wac,
             movement.effective_at::text as sale_effective_at,
             movement.business_date
      from app.inventory_movements movement
      join app.inventory_sale_cost_attributions attribution
        on attribution.tenant_id = movement.tenant_id
       and attribution.station_id = movement.station_id
       and attribution.inventory_movement_id = movement.id
      where movement.tenant_id = '${ids.tenant}'
        and movement.station_id = '${ids.station}'
        and movement.source_type = 'METER_SEGMENT_SALE'
        and movement.source_id = '${ids.factSegment}'
        and movement.movement_type = 'SALE'
    `);
    expect(saleEvidence).toHaveLength(1);

    const sale = saleEvidence[0]!;
    const revaluations = [
      {
        revaluationId: ids.revaluationPositive,
        sourceId: ids.revaluationSourcePositive,
        lineId: ids.revaluationLinePositive,
        eventId: ids.revaluationEventPositive,
        delta: '5.0000',
        prior: '21.0000',
        recomputed: '26.0000',
        posted: true,
      },
      {
        revaluationId: ids.revaluationNegative,
        sourceId: ids.revaluationSourceNegative,
        lineId: ids.revaluationLineNegative,
        eventId: ids.revaluationEventNegative,
        delta: '-2.0000',
        prior: '26.0000',
        recomputed: '24.0000',
        posted: true,
      },
      {
        revaluationId: ids.revaluationSequential,
        sourceId: ids.revaluationSourceSequential,
        lineId: ids.revaluationLineSequential,
        eventId: ids.revaluationEventSequential,
        delta: '1.2500',
        prior: '24.0000',
        recomputed: '25.2500',
        posted: true,
      },
      {
        revaluationId: ids.revaluationPending,
        sourceId: ids.revaluationSourcePending,
        lineId: ids.revaluationLinePending,
        eventId: ids.revaluationEventPending,
        delta: '100.0000',
        prior: '25.2500',
        recomputed: '125.2500',
        posted: false,
      },
    ] as const;

    for (const revaluation of revaluations) {
      await client.unsafe(`
        insert into app.inventory_cost_revaluations
          (id, tenant_id, station_id, tank_id, product_id, reason, status, source_type, source_id,
           amount, currency, effective_at, business_date, requested_by, requested_at)
        values
          ('${revaluation.revaluationId}', '${ids.tenant}', '${ids.station}', '${ids.factTank}', '${ids.factProduct}',
           'A10 restated COGS integration evidence', 'REQUESTED', 'A10_TEST_REVALUATION', '${revaluation.sourceId}',
           ${revaluation.delta.startsWith('-') ? revaluation.delta.slice(1) : revaluation.delta}, 'USD',
           '${sale.sale_effective_at}', '${sale.business_date}', '${ids.membership}', '2026-09-25T08:00:00Z')
        on conflict (id) do nothing;
        update app.inventory_cost_revaluations
           set status = 'APPROVED', approved_by = '${ids.membership}', approved_at = '2026-09-25T09:00:00Z'
         where id = '${revaluation.revaluationId}' and status = 'REQUESTED';
        insert into app.inventory_cost_events
          (id, tenant_id, station_id, tank_id, product_id, event_type, source_type, source_id,
           effective_at, business_date, amount, currency, actor_membership_id)
        values
          ('${revaluation.eventId}', '${ids.tenant}', '${ids.station}', '${ids.factTank}', '${ids.factProduct}',
           'COGS_REVALUATION', 'INVENTORY_COST_REVALUATION_LINE', '${revaluation.lineId}',
           '${sale.sale_effective_at}', '${sale.business_date}', ${revaluation.delta}, 'USD', '${ids.membership}')
        on conflict (id) do nothing;
        insert into app.inventory_cost_revaluation_lines
          (id, tenant_id, station_id, tank_id, product_id, revaluation_id, sale_movement_id,
           sale_attribution_id, original_pre_sale_wac, recomputed_pre_sale_wac, original_cogs,
           prior_restated_cogs, recomputed_cogs, cogs_delta, currency, sale_effective_at,
           cogs_revaluation_event_id, replay_fingerprint)
        values
          ('${revaluation.lineId}', '${ids.tenant}', '${ids.station}', '${ids.factTank}', '${ids.factProduct}',
           '${revaluation.revaluationId}', '${sale.sale_movement_id}', '${sale.attribution_id}',
           ${sale.pre_sale_wac}, ${sale.pre_sale_wac}, ${sale.original_cogs}, ${revaluation.prior},
           ${revaluation.recomputed}, ${revaluation.delta}, 'USD', '${sale.sale_effective_at}',
           '${revaluation.eventId}', 'a10-revaluation-${revaluation.lineId}')
        on conflict (id) do nothing;
        ${
          revaluation.posted
            ? `update app.inventory_cost_revaluations
                 set status = 'POSTED', posted_by = '${ids.membership}', posted_at = '2026-09-25T10:00:00Z',
                     replay_fingerprint = 'a10-posted-${revaluation.revaluationId}'
               where id = '${revaluation.revaluationId}' and status = 'APPROVED';`
            : ''
        }
      `);
    }

    const immutableOriginalCogs = await client.unsafe<{ original_cogs: string }[]>(`
      select original_cogs::text
      from app.inventory_sale_cost_attributions
      where tenant_id = '${ids.tenant}' and id = '${sale.attribution_id}'
    `);
    expect(immutableOriginalCogs).toEqual([{ original_cogs: '21.0000' }]);

    await client.begin(async (transaction) => {
      // This deliberately malformed historical fixture is isolated to the A10
      // read-model test. It proves that reporting period membership follows
      // the persisted A4 sale movement date rather than reconciliation-day
      // metadata, while the production A4/A5/A12 guards remain unchanged.
      await transaction.unsafe(`set local session_replication_role = 'replica'`);
      await transaction.unsafe(`
        insert into app.station_business_days (id, tenant_id, station_id, business_date, state)
        values ('${ids.costingDay}', '${ids.tenant}', '${ids.scopedStation}', '2026-10-11', 'OPEN')
        on conflict (id) do nothing;
        insert into app.reconciliations
          (id, tenant_id, station_id, business_day_id, state, version)
        values ('${ids.costingRecon}', '${ids.tenant}', '${ids.scopedStation}', '${ids.costingDay}', 'POSTED', 0)
        on conflict (id) do nothing;
        insert into app.reconciliation_revisions
          (id, tenant_id, station_id, reconciliation_id, revision, state, expected_sales,
           accounted_sales, variance, currency, variance_classification, declarations,
           source_segment_ids, source_shift_ids, source_revision_id, correction_of_revision_id,
           posted_by, posted_at)
        values
          ('${ids.costingRevisionSuperseded}', '${ids.tenant}', '${ids.scopedStation}', '${ids.costingRecon}',
           1, 'POSTED', 10.0000, 10.0000, 0.0000, 'USD', 'INFORMATIONAL', '[]'::jsonb,
           '["${ids.costingSegmentSuperseded}"]'::jsonb, '["${ids.costingShift}"]'::jsonb,
           null, null, '${ids.scopedMembership}', '2026-10-11T22:00:00Z'),
          ('${ids.costingRevisionLatest}', '${ids.tenant}', '${ids.scopedStation}', '${ids.costingRecon}',
           2, 'POSTED', 10.0000, 10.0000, 0.0000, 'USD', 'INFORMATIONAL', '[]'::jsonb,
           '["${ids.costingSegmentLatest}", "${ids.costingSegmentMissing}"]'::jsonb, '["${ids.costingShift}"]'::jsonb,
           '${ids.costingRevisionSuperseded}', '${ids.costingRevisionSuperseded}',
           '${ids.scopedMembership}', '2026-10-11T23:00:00Z')
        on conflict (id) do nothing;
        insert into app.meter_segments
          (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id,
           opening_boundary_id, closing_boundary_id, product_id, attendant_id, entered_by,
           opening_reading, closing_reading, litres, unit_price, expected_sale_value, currency,
           boundary_reason, segment_start_at, segment_end_at, sealed_at, state, version)
        values
          ('${ids.costingSegmentSuperseded}', '${ids.tenant}', '${ids.scopedStation}', '${ids.costingNozzle}', '${ids.costingInstallation}', '${ids.costingDay}', '${ids.costingShift}',
           '${ids.costingOpeningBoundary}', '${ids.costingClosingBoundary}', '${ids.factProduct}', '${ids.scopedMembership}', '${ids.scopedMembership}',
           0.000, 1.000, 1.000, 10.000000, 10.0000, 'USD', 'A10 TEST', '2026-10-10T06:00:00Z', '2026-10-10T07:00:00Z', '2026-10-11T20:00:00Z', 'SEALED', 1),
          ('${ids.costingSegmentLatest}', '${ids.tenant}', '${ids.scopedStation}', '${ids.costingNozzle}', '${ids.costingInstallation}', '${ids.costingDay}', '${ids.costingShift}',
           '${ids.costingOpeningBoundaryLatest}', '${ids.costingClosingBoundaryLatest}', '${ids.factProduct}', '${ids.scopedMembership}', '${ids.scopedMembership}',
           1.000, 2.000, 1.000, 10.000000, 10.0000, 'USD', 'A10 TEST', '2026-10-10T07:00:00Z', '2026-10-10T08:00:00Z', '2026-10-11T20:00:00Z', 'SEALED', 1),
          ('${ids.costingSegmentMissing}', '${ids.tenant}', '${ids.scopedStation}', '${ids.costingNozzle}', '${ids.costingInstallation}', '${ids.costingDay}', '${ids.costingShift}',
           '${ids.costingMissingOpeningBoundary}', '${ids.costingMissingClosingBoundary}', '${ids.factProduct}', '${ids.scopedMembership}', '${ids.scopedMembership}',
           2.000, 3.000, 1.000, 10.000000, 10.0000, 'USD', 'A10 TEST', '2026-10-10T08:00:00Z', '2026-10-10T09:00:00Z', '2026-10-11T20:00:00Z', 'SEALED', 1)
        on conflict (id) do nothing;
        insert into app.reconciliation_meter_reading_segments
          (id, tenant_id, station_id, reconciliation_id, revision_id, reconciliation_meter_reading_id,
           meter_segment_id, allocated_litres)
        values
          ('${ids.costingBridgeSuperseded}', '${ids.tenant}', '${ids.scopedStation}', '${ids.costingRecon}', '${ids.costingRevisionSuperseded}', '${ids.costingReading}', '${ids.costingSegmentSuperseded}', 1.000),
          ('${ids.costingBridgeLatest}', '${ids.tenant}', '${ids.scopedStation}', '${ids.costingRecon}', '${ids.costingRevisionLatest}', '${ids.costingReading}', '${ids.costingSegmentLatest}', 1.000),
          ('${ids.costingBridgeMissing}', '${ids.tenant}', '${ids.scopedStation}', '${ids.costingRecon}', '${ids.costingRevisionLatest}', '${ids.costingReading}', '${ids.costingSegmentMissing}', 1.000)
        on conflict (id) do nothing;
        insert into app.inventory_movements
          (id, tenant_id, station_id, tank_id, product_id, movement_type, quantity_litres,
           effective_at, business_date, source_type, source_id, actor_membership_id, posted_at)
        values
          ('${ids.costingMovementSuperseded}', '${ids.tenant}', '${ids.scopedStation}', '${ids.costingTank}', '${ids.factProduct}', 'SALE', -1.000,
           '2026-10-10T07:00:00Z', '2026-10-10', 'METER_SEGMENT_SALE', '${ids.costingSegmentSuperseded}', '${ids.scopedMembership}', '2026-10-11T20:00:00Z'),
          ('${ids.costingMovementLatest}', '${ids.tenant}', '${ids.scopedStation}', '${ids.costingTank}', '${ids.factProduct}', 'SALE', -1.000,
           '2026-10-10T08:00:00Z', '2026-10-10', 'METER_SEGMENT_SALE', '${ids.costingSegmentLatest}', '${ids.scopedMembership}', '2026-10-11T20:00:00Z'),
          ('${ids.costingMovementMissing}', '${ids.tenant}', '${ids.scopedStation}', '${ids.costingTank}', '${ids.factProduct}', 'SALE', -1.000,
           '2026-10-10T09:00:00Z', '2026-10-10', 'METER_SEGMENT_SALE', '${ids.costingSegmentMissing}', '${ids.scopedMembership}', '2026-10-11T20:00:00Z')
        on conflict (id) do nothing;
        insert into app.inventory_cost_events
          (id, tenant_id, station_id, tank_id, product_id, event_type, source_type, source_id,
           effective_at, business_date, amount, currency, actor_membership_id)
        values ('${ids.costingInvalidEvent}', '${ids.tenant}', '${ids.scopedStation}', '${ids.costingTank}', '${ids.factProduct}',
          'SALE_COGS', 'A10_INVALID_SOURCE', '${ids.costingSegmentLatest}', '2026-10-10T08:00:00Z', '2026-10-10', -21.0000, 'USD', '${ids.scopedMembership}')
        on conflict (id) do nothing;
        insert into app.inventory_sale_cost_attributions
          (id, tenant_id, station_id, tank_id, product_id, inventory_movement_id, meter_segment_id,
           sale_quantity_litres, pre_sale_wac, original_cogs, valuation_status, valuation_basis,
           replay_fingerprint, sale_cost_event_id, effective_at, business_date)
        values ('${ids.costingInvalidAttribution}', '${ids.tenant}', '${ids.scopedStation}', '${ids.costingTank}', '${ids.factProduct}',
          '${ids.costingMovementLatest}', '${ids.costingSegmentLatest}', 1.000, 2.00000000, 21.0000,
          'VALUED', 'PRE_SALE_WAC', 'a10-invalid-attribution', '${ids.costingInvalidEvent}', '2026-10-10T08:00:00Z', '2026-10-10')
        on conflict (id) do nothing;
      `);
    });
  });

  afterAll(async () => client?.end());

  it('returns a deterministic empty report at money and litre scales', async () => {
    const response = await managementReportGet(
      new Request(
        `http://127.0.0.1:3000/api/reports/management?tenantId=${ids.tenant}&fromDate=2026-09-18&toDate=2026-09-18`,
        { headers: { ...clerkHeaders(await signedCookie()) } },
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;
    expect(body.sales.salesValue).toBe('0.0000');
    expect(body.sales.litresSold).toBe('0.000');
    expect(body.revenue).toMatchObject({
      revenueStatus: 'NO_SALES',
      recognizedRevenue: '0.0000',
      saleCount: 0,
      sales: [],
    });
    expect(body.cash.cashEvidence).toBe('0.0000');
    expect(body.cash.collected).toBe('0.0000');
    expect(body.cash.banked).toBe('0.0000');
    expect(body.providers.paymentEvidence).toBe('0.0000');
    expect(body.inventory.expectedLitres).toBe('0.000');
    expect(body.costing).toMatchObject({
      currency: 'USD',
      costingStatus: 'NO_SALES',
      originalCogs: '0.0000',
      revaluationDelta: '0.0000',
      restatedCogs: '0.0000',
      saleCount: 0,
      valuedSaleCount: 0,
      unvaluedSaleCount: 0,
      sales: [],
    });
    expect(body.grossMargin).toBeNull();
    expect(body.revenue.revenueStatus).toBe('NO_SALES');
    expect(body.dateBasis.providerSettlements).toBe('A9 settlement date');
    expect(body.dateBasis.bankedCash).toBe('A6 bank_deposits.deposited_at UTC calendar date');
    expect(body.dateBasis.suppliers).toBe('A7 effective_date <= toDate; balance as of toDate');
    expect(body.dateBasis.customers).toBe(
      'A8 balance as of toDate using ledger business_date and authorization requested_at',
    );
    expect(body.customers.availability).toBe('AVAILABLE');
    expect(body.customers.receivableBalance).toBe('0.0000');
  });

  it('combines finalized A4-A9 facts without conflating dates or domains', async () => {
    const response = await managementReportGet(
      new Request(
        `http://127.0.0.1:3000/api/reports/management?tenantId=${ids.tenant}&fromDate=2026-09-20&toDate=2026-09-22`,
        { headers: { ...clerkHeaders(await signedCookie()) } },
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;
    expect(body.sales).toMatchObject({
      salesValue: '130.0000',
      litresSold: '10.500',
      salesVariance: '-5.0000',
      approvedReconciliationCount: 1,
    });
    expect(body.revenue).toMatchObject({
      revenueStatus: 'POSTED',
      recognizedRevenue: '105.0000',
      saleCount: 1,
    });
    expect(body.revenue.sales[0]).toMatchObject({
      stationId: ids.station,
      reconciliationId: ids.factRecon,
      revisionId: ids.factRevision,
      meterSegmentId: ids.factSegment,
      recognizedRevenue: '105.0000',
      quantityLitres: '10.500',
      businessDate: '2026-09-20',
      currency: 'USD',
    });
    expect(body.grossMargin).toBe('79.7500');
    expect(body.fuelProfit).toEqual([
      expect.objectContaining({
        productId: ids.factProduct,
        productCode: 'A10-PMS',
        revenue: '105.0000',
        cost: '25.2500',
        profit: '79.7500',
        status: 'COMPLETE',
      }),
    ]);
    expect(body.sales.reconciliationIds).toContain(ids.factRecon);

    const priorBusinessDateResponse = await managementReportGet(
      new Request(
        `http://127.0.0.1:3000/api/reports/management?tenantId=${ids.tenant}&fromDate=2026-09-19&toDate=2026-09-19`,
        { headers: { ...clerkHeaders(await signedCookie()) } },
      ),
    );
    const priorBusinessDateBody = (await priorBusinessDateResponse.json()) as Record<string, any>;
    expect(priorBusinessDateBody.revenue).toMatchObject({
      revenueStatus: 'NO_SALES',
      recognizedRevenue: '0.0000',
      saleCount: 0,
    });
    expect(priorBusinessDateBody.grossMargin).toBeNull();

    expect(body.costing).toMatchObject({
      currency: 'USD',
      costingStatus: 'COMPLETE',
      originalCogs: '21.0000',
      revaluationDelta: '4.2500',
      restatedCogs: '25.2500',
      saleCount: 1,
      valuedSaleCount: 1,
      unvaluedSaleCount: 0,
    });
    expect(body.costing.sales[0]).toMatchObject({
      stationId: ids.station,
      reconciliationId: ids.factRecon,
      revisionId: ids.factRevision,
      meterSegmentId: ids.factSegment,
      saleMovementId: expect.any(String),
      attributionId: expect.any(String),
      originalSaleCogsEventId: expect.any(String),
      originalCogs: '21.0000',
      revaluationDelta: '4.2500',
      restatedCogs: '25.2500',
      businessDate: '2026-09-20',
      currency: 'USD',
      valuationStatus: 'VALUED',
    });
    expect(body.costing.sales[0].revaluationLineIds).toEqual(
      expect.arrayContaining([
        ids.revaluationLinePositive,
        ids.revaluationLineNegative,
        ids.revaluationLineSequential,
      ]),
    );
    expect(body.costing.sales[0].revaluationLineIds).not.toContain(ids.revaluationLinePending);
    expect(body.costing.sales[0].revaluationEventIds).toEqual(
      expect.arrayContaining([
        ids.revaluationEventPositive,
        ids.revaluationEventNegative,
        ids.revaluationEventSequential,
      ]),
    );
    expect(body.costing.sales[0].revaluationEventIds).not.toContain(ids.revaluationEventPending);
    expect(body.cash).toMatchObject({
      cashEvidence: '70.0000',
      collected: '60.0000',
      banked: '40.0000',
      collectedButNotBanked: '20.0000',
      cashVariance: '1.0000',
    });
    expect(body.cash.collectionIds).toContain(ids.factCollection);
    expect(body.cash.depositIds).toContain(ids.factDeposit);
    expect(body.providers).toMatchObject({
      paymentEvidence: '45.0000',
      settlementGross: '45.0000',
      allocatedAmount: '20.0000',
      unallocatedProviderAmount: '25.0000',
      unmatchedEvidenceAmount: '25.0000',
    });
    expect(body.providers.rows[0].settlementId).toBe(ids.factSettlement);
    expect(body.suppliers).toMatchObject({
      invoiceValue: '100.0000',
      creditNoteValue: '5.0000',
      payments: '25.0000',
      outstandingBalance: '70.0000',
    });
    expect(body.customers).toMatchObject({
      availability: 'AVAILABLE',
      receivableBalance: '30.0000',
      prepaidValueBalance: '12.0000',
    });
    expect(body.inventory).toMatchObject({
      expectedLitres: '84.500',
      physicalLitres: null,
      varianceLitres: null,
      deliveryLitres: '20.000',
      deliveryValue: '40.0000',
    });
    expect(body.expenses.total).toBe('2.0000');
    expect(body.expenses.rows[0]).toMatchObject({
      category: 'A10_TEST',
      amount: '2.0000',
      sourceIds: [ids.factExpense],
      recognitionMovementIds: [ids.factExpenseRecognition],
    });
    expect(body.dateBasis.expenses).toBe('expense_recognition_movements.recognition_date');
    expect(body.dateBasis.bankedCash).toBe('A6 bank_deposits.deposited_at UTC calendar date');

    await client.unsafe(`
      insert into app.provider_settlement_allocations
        (id, tenant_id, station_id, settlement_id, reconciliation_payment_id, amount, allocation_key, state, reversal_of_id, allocated_by)
      values ('${ids.factSettlementReversal}', '${ids.tenant}', '${ids.station}', '${ids.factSettlement}', '${ids.factPosPayment}', 20.0000, 'A10-SETTLEMENT-ALLOCATION-REVERSAL', 'REVERSED', '${ids.factSettlementAllocation}', '${ids.membership}')
      on conflict (id) do nothing;
    `);

    const reversedResponse = await managementReportGet(
      new Request(
        `http://127.0.0.1:3000/api/reports/management?tenantId=${ids.tenant}&fromDate=2026-09-20&toDate=2026-09-22`,
        { headers: { ...clerkHeaders(await signedCookie()) } },
      ),
    );
    expect(reversedResponse.status).toBe(200);
    const reversedBody = (await reversedResponse.json()) as Record<string, any>;
    expect(reversedBody.providers).toMatchObject({
      paymentEvidence: '45.0000',
      settlementGross: '45.0000',
      allocatedAmount: '0.0000',
      unallocatedProviderAmount: '45.0000',
      unmatchedEvidenceAmount: '45.0000',
    });

    const collectionDateOnly = await managementReportGet(
      new Request(
        `http://127.0.0.1:3000/api/reports/management?tenantId=${ids.tenant}&fromDate=2026-09-20&toDate=2026-09-20`,
        { headers: { ...clerkHeaders(await signedCookie()) } },
      ),
    );
    const collectionDateBody = (await collectionDateOnly.json()) as Record<string, any>;
    expect(collectionDateBody.cash.collected).toBe('60.0000');
    expect(collectionDateBody.cash.banked).toBe('0.0000');

    const depositDateOnly = await managementReportGet(
      new Request(
        `http://127.0.0.1:3000/api/reports/management?tenantId=${ids.tenant}&fromDate=2026-09-22&toDate=2026-09-22`,
        { headers: { ...clerkHeaders(await signedCookie()) } },
      ),
    );
    const depositDateBody = (await depositDateOnly.json()) as Record<string, any>;
    expect(depositDateBody.cash.collected).toBe('0.0000');
    expect(depositDateBody.cash.banked).toBe('40.0000');

    const dailyResponse = await dailyReportGet(
      new Request(
        `http://127.0.0.1:3000/api/reports/daily?tenantId=${ids.tenant}&fromDate=2026-09-20&toDate=2026-09-22`,
        { headers: { ...clerkHeaders(await signedCookie()) } },
      ),
    );
    expect(dailyResponse.status).toBe(200);
    const dailyBody = (await dailyResponse.json()) as Record<string, any>;
    expect(dailyBody.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reportDate: '2026-09-22',
          bankedCash: '40.0000',
          providerSettledAmount: '45.0000',
          providerOutstandingAmount: '45.0000',
        }),
      ]),
    );
    expect(
      dailyBody.rows.find((row: Record<string, any>) => row.reportDate === '2026-09-20')
        ?.inventoryVariance,
    ).toBeNull();
    expect(dailyBody.rows.every((row: Record<string, any>) => !('businessDate' in row))).toBe(true);
  });

  it('returns an explicit unavailable customer scope for a station-filtered report', async () => {
    const response = await managementReportGet(
      new Request(
        `http://127.0.0.1:3000/api/reports/management?tenantId=${ids.tenant}&stationId=${ids.station}`,
        { headers: { ...clerkHeaders(await signedCookie()) } },
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;
    expect(body.customers).toMatchObject({
      availability: 'UNAVAILABLE_STATION_DIMENSION',
      receivableBalance: null,
      prepaidValueBalance: null,
      reservedAmount: null,
      reservedLitres: null,
      rows: [],
    });
    // What was drawn at the station stays visible even though balances are not.
    expect(Array.isArray(body.customers.activity)).toBe(true);
    expect(
      body.customers.activity.every((row: Record<string, any>) => row.stationId === ids.station),
    ).toBe(true);
  });

  it('reports on several selected stations and marks customer scope unavailable', async () => {
    const response = await managementReportGet(
      new Request(
        `http://127.0.0.1:3000/api/reports/management?tenantId=${ids.tenant}&stationIds=${ids.station},${ids.scopedStation}`,
        { headers: { ...clerkHeaders(await signedCookie()) } },
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;
    expect(body.filters.stationIds).toEqual([ids.station, ids.scopedStation].sort());
    expect(body.stations.map((station: Record<string, any>) => station.stationId).sort()).toEqual(
      [ids.station, ids.scopedStation].sort(),
    );
    expect(body.customers.availability).toBe('UNAVAILABLE_STATION_DIMENSION');
  });

  it('rejects the whole request when any selected station is not permitted', async () => {
    const scopedActorHeaders = clerkHeaders(scopedSessionToken);
    const mixed = await managementReportGet(
      new Request(
        `http://127.0.0.1:3000/api/reports/management?tenantId=${ids.tenant}&stationIds=${ids.station},${ids.scopedStation}`,
        { headers: scopedActorHeaders },
      ),
    );
    expect(mixed.status).toBe(403);

    const foreign = await managementReportGet(
      new Request(
        `http://127.0.0.1:3000/api/reports/management?tenantId=${ids.tenant}&stationIds=${ids.station},${ids.otherStation}`,
        { headers: { ...clerkHeaders(await signedCookie()) } },
      ),
    );
    expect(foreign.status).toBe(404);
  });

  it('uses the A4 sale business date for costing periods and does not double-count revisions', async () => {
    const saleDateResponse = await managementReportGet(
      new Request(
        `http://127.0.0.1:3000/api/reports/management?tenantId=${ids.tenant}&stationId=${ids.scopedStation}&fromDate=2026-10-10&toDate=2026-10-10`,
        {
          headers: {
            ...clerkHeaders(await signedCookie(scopedSessionToken)),
          },
        },
      ),
    );
    expect(saleDateResponse.status).toBe(200);
    const saleDateBody = (await saleDateResponse.json()) as Record<string, any>;
    expect(saleDateBody.costing).toMatchObject({
      currency: 'USD',
      costingStatus: 'UNVALUED',
      originalCogs: null,
      revaluationDelta: null,
      restatedCogs: null,
      saleCount: 2,
      valuedSaleCount: 0,
      unvaluedSaleCount: 2,
    });
    expect(saleDateBody.revenue).toMatchObject({
      revenueStatus: 'NO_SALES',
      recognizedRevenue: '0.0000',
      saleCount: 0,
      sales: [],
    });
    expect(saleDateBody.grossMargin).toBeNull();
    expect(saleDateBody.costing.sales).toHaveLength(2);
    expect(saleDateBody.costing.sales).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reconciliationId: ids.costingRecon,
          revisionId: ids.costingRevisionLatest,
          meterSegmentId: ids.costingSegmentLatest,
          saleMovementId: ids.costingMovementLatest,
          attributionId: ids.costingInvalidAttribution,
          originalSaleCogsEventId: ids.costingInvalidEvent,
          originalCogs: null,
          revaluationDelta: null,
          restatedCogs: null,
          businessDate: '2026-10-10',
          currency: 'USD',
          valuationStatus: 'UNVALUED',
        }),
        expect.objectContaining({
          reconciliationId: ids.costingRecon,
          revisionId: ids.costingRevisionLatest,
          meterSegmentId: ids.costingSegmentMissing,
          saleMovementId: ids.costingMovementMissing,
          attributionId: null,
          originalSaleCogsEventId: null,
          originalCogs: null,
          revaluationDelta: null,
          restatedCogs: null,
          businessDate: '2026-10-10',
          currency: null,
          valuationStatus: 'UNVALUED',
        }),
      ]),
    );
    expect(
      saleDateBody.costing.sales.every(
        (sale: Record<string, unknown>) => sale.revisionId === ids.costingRevisionLatest,
      ),
    ).toBe(true);
    expect(
      saleDateBody.costing.sales.map((sale: Record<string, string>) => sale.revisionId),
    ).not.toContain(ids.costingRevisionSuperseded);

    const reconciliationDateResponse = await managementReportGet(
      new Request(
        `http://127.0.0.1:3000/api/reports/management?tenantId=${ids.tenant}&stationId=${ids.scopedStation}&fromDate=2026-10-11&toDate=2026-10-11`,
        {
          headers: {
            ...clerkHeaders(await signedCookie(scopedSessionToken)),
          },
        },
      ),
    );
    expect(reconciliationDateResponse.status).toBe(200);
    const reconciliationDateBody = (await reconciliationDateResponse.json()) as Record<string, any>;
    expect(reconciliationDateBody.costing).toMatchObject({
      costingStatus: 'NO_SALES',
      saleCount: 0,
      originalCogs: '0.0000',
      revaluationDelta: '0.0000',
      restatedCogs: '0.0000',
    });
    expect(reconciliationDateBody.revenue.revenueStatus).toBe('NO_SALES');
    expect(reconciliationDateBody.grossMargin).toBeNull();

    const otherStationResponse = await managementReportGet(
      new Request(
        `http://127.0.0.1:3000/api/reports/management?tenantId=${ids.tenant}&stationId=${ids.station}&fromDate=2026-10-10&toDate=2026-10-10`,
        { headers: { ...clerkHeaders(await signedCookie()) } },
      ),
    );
    expect(otherStationResponse.status).toBe(200);
    const otherStationBody = (await otherStationResponse.json()) as Record<string, any>;
    expect(otherStationBody.costing).toMatchObject({ costingStatus: 'NO_SALES', saleCount: 0 });
    expect(otherStationBody.revenue).toMatchObject({
      revenueStatus: 'NO_SALES',
      recognizedRevenue: '0.0000',
      saleCount: 0,
    });
    expect(otherStationBody.grossMargin).toBeNull();
  });

  it('rejects cross-tenant report selection and unauthorized station scope', async () => {
    const otherTenantResponse = await managementReportGet(
      new Request(`http://127.0.0.1:3000/api/reports/management?tenantId=${ids.otherTenant}`, {
        headers: { ...clerkHeaders(await signedCookie()) },
      }),
    );
    expect(otherTenantResponse.status).toBe(403);

    const wrongStationResponse = await managementReportGet(
      new Request(
        `http://127.0.0.1:3000/api/reports/management?tenantId=${ids.tenant}&stationId=${ids.otherStation}`,
        { headers: { ...clerkHeaders(await signedCookie()) } },
      ),
    );
    expect(wrongStationResponse.status).toBe(404);

    const scopedStationResponse = await managementReportGet(
      new Request(
        `http://127.0.0.1:3000/api/reports/management?tenantId=${ids.tenant}&stationId=${ids.station}`,
        {
          headers: {
            ...clerkHeaders(await signedCookie(scopedSessionToken)),
          },
        },
      ),
    );
    expect(scopedStationResponse.status).toBe(403);
  });

  describe('report share, export and recent activity', () => {
    const range = 'fromDate=2026-09-01&toDate=2026-09-30';
    const both = `${ids.station},${ids.scopedStation}`;

    async function eventCount(): Promise<number> {
      const rows = await client.unsafe(
        `select count(*)::int as n from platform.security_events
         where tenant_id = '${ids.tenant}' and event_code in ('REPORT.SHARED', 'REPORT.EXPORTED')`,
      );
      return Number((rows[0] as unknown as { n: number }).n);
    }

    async function exportAs(token: string | null, query: string) {
      return reportExportGet(
        new Request(`http://127.0.0.1:3000/api/reports/export?${query}`, {
          headers: token ? { ...clerkHeaders(await signedCookie(token)) } : {},
        }),
      );
    }

    async function shareAs(token: string | null, body: Record<string, unknown>) {
      return reportSharePost(
        new Request('http://127.0.0.1:3000/api/reports/share', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { ...clerkHeaders(await signedCookie(token)) } : {}),
          },
          body: JSON.stringify(body),
        }),
      );
    }

    it('exports an authorised station subset as a named CSV and records it', async () => {
      const before = await eventCount();
      const response = await exportAs(
        sessionToken,
        `report=sales&period=last-month&tenantId=${ids.tenant}&stationIds=${both}&${range}`,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/csv; charset=utf-8');
      expect(response.headers.get('content-disposition')).toBe(
        'attachment; filename="sales_2026-09-01_to_2026-09-30_2-stations.csv"',
      );
      const csv = await response.text();
      expect(csv.split('\r\n')[0]).toBe(
        'business_date,station_code,product_code,product_name,litres_sold,sales_value,average_realized_price,variance',
      );
      expect(await eventCount()).toBe(before + 1);
    });

    it('exports every station only when none is selected', async () => {
      const response = await exportAs(sessionToken, `report=cash&tenantId=${ids.tenant}&${range}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-disposition')).toBe(
        'attachment; filename="cash_2026-09-01_to_2026-09-30.csv"',
      );
    });

    it('refuses export and share without authentication, and records nothing', async () => {
      const before = await eventCount();
      const query = `report=sales&tenantId=${ids.tenant}&${range}`;
      expect((await exportAs(null, query)).status).toBe(401);
      expect(
        (
          await shareAs(null, {
            report: 'sales',
            tenantId: ids.tenant,
            fromDate: '2026-09-01',
            toDate: '2026-09-30',
          })
        ).status,
      ).toBe(401);
      expect(await eventCount()).toBe(before);
    });

    it('applies the same station authorisation as viewing, records nothing when denied', async () => {
      const before = await eventCount();
      // The scoped user may not report on the main station, alone or mixed.
      for (const stations of [ids.station, both]) {
        expect(
          (
            await exportAs(
              scopedSessionToken,
              `report=sales&tenantId=${ids.tenant}&stationIds=${stations}&${range}`,
            )
          ).status,
        ).toBe(403);
        expect(
          (
            await shareAs(scopedSessionToken, {
              report: 'sales',
              tenantId: ids.tenant,
              stationIds: stations,
              fromDate: '2026-09-01',
              toDate: '2026-09-30',
            })
          ).status,
        ).toBe(403);
      }
      // Other tenant and a station from another tenant.
      expect(
        (await exportAs(sessionToken, `report=sales&tenantId=${ids.otherTenant}&${range}`)).status,
      ).toBe(403);
      expect(
        (
          await exportAs(
            sessionToken,
            `report=sales&tenantId=${ids.tenant}&stationIds=${ids.otherStation}&${range}`,
          )
        ).status,
      ).toBe(404);
      expect(await eventCount()).toBe(before);
    });

    it('needs a fresh step-up to export, and records nothing without one', async () => {
      const before = await eventCount();
      // The scoped user is allowed to report on its own station but has not stepped up.
      const response = await exportAs(
        scopedSessionToken,
        `report=sales&tenantId=${ids.tenant}&stationIds=${ids.scopedStation}&${range}`,
      );
      expect(response.status).toBe(403);
      expect(((await response.json()) as { message: string }).message).toMatch(/step-up/i);
      expect(await eventCount()).toBe(before);
    });

    it('rejects an unknown report', async () => {
      expect(
        (await exportAs(sessionToken, `report=payroll&tenantId=${ids.tenant}&${range}`)).status,
      ).toBe(404);
    });

    it('creates a private link that carries state but no credentials', async () => {
      const response = await shareAs(sessionToken, {
        report: 'cash',
        tenantId: ids.tenant,
        stationIds: both,
        period: '3m',
        fromDate: '2026-07-09',
        toDate: '2026-10-08',
      });
      expect(response.status).toBe(200);
      const { path } = (await response.json()) as { path: string };
      expect(path).toBe(
        `/reports/cash?tenantId=${ids.tenant}&stations=${[ids.station, ids.scopedStation]
          .sort()
          .join('%2C')}&period=3m`,
      );
      expect(path).not.toMatch(/token|secret|session|signature/i);
    });

    it('lists only the signed-in user’s own real actions, without raw ids', async () => {
      await seedActiveStepUp(client, ids.scopedSession, ids.tenant);
      await exportAs(
        scopedSessionToken,
        `report=sales&period=this-month&tenantId=${ids.tenant}&stationIds=${ids.scopedStation}&${range}`,
      );
      const owner = await reportActivityGet(
        new Request(`http://127.0.0.1:3000/api/reports/activity?tenantId=${ids.tenant}`, {
          headers: { ...clerkHeaders(await signedCookie()) },
        }),
      );
      expect(owner.status).toBe(200);
      const ownerText = await owner.text();
      const ownerItems = (JSON.parse(ownerText) as { data: Record<string, string>[] }).data;
      expect(ownerItems.length).toBeGreaterThan(0);
      expect(ownerItems.map((item) => item.headline)).toContain('Sales & Payments exported');
      expect(ownerItems[0]?.detail ?? '').toMatch(/·/);
      // No station or tenant id appears in anything shown (the event id is only a list key).
      expect(ownerText.replace(/"id":"[^"]+",/g, '')).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
      );

      const scoped = await reportActivityGet(
        new Request(`http://127.0.0.1:3000/api/reports/activity?tenantId=${ids.tenant}`, {
          headers: {
            ...clerkHeaders(await signedCookie(scopedSessionToken)),
          },
        }),
      );
      const scopedItems = ((await scoped.json()) as { data: Record<string, string>[] }).data;
      expect(scopedItems).toHaveLength(1);
      expect(scopedItems[0]?.detail).toContain('A10 Scoped Station');
    });

    it('stops honouring a copied link once the permission is revoked', async () => {
      const body = {
        report: 'sales',
        tenantId: ids.tenant,
        stationIds: ids.scopedStation,
        period: 'last-month',
        fromDate: '2026-09-01',
        toDate: '2026-09-30',
      };
      const link = await shareAs(scopedSessionToken, body);
      expect(link.status).toBe(200);
      const viewUrl = `http://127.0.0.1:3000/api/reports/management?tenantId=${ids.tenant}&stationIds=${ids.scopedStation}&${range}`;
      const view = () =>
        managementReportGet(
          new Request(viewUrl, {
            headers: {
              ...clerkHeaders(scopedSessionCookieSync),
            },
          }),
        );
      const scopedSessionCookieSync = await signedCookie(scopedSessionToken);
      expect((await view()).status).toBe(200);

      await client.unsafe(
        `delete from app.membership_role_assignments
         where tenant_id = '${ids.tenant}' and membership_id = '${ids.scopedMembership}'`,
      );
      try {
        const before = await eventCount();
        expect((await view()).status).toBe(403);
        expect(
          (
            await exportAs(
              scopedSessionToken,
              `report=sales&tenantId=${ids.tenant}&stationIds=${ids.scopedStation}&${range}`,
            )
          ).status,
        ).toBe(403);
        expect((await shareAs(scopedSessionToken, body)).status).toBe(403);
        expect(await eventCount()).toBe(before);
      } finally {
        await client.unsafe(
          `insert into app.membership_role_assignments
             (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
           values ('${ids.tenant}', '${ids.scopedMembership}', 'FINANCE', 'STATION', '${ids.legal}', '${ids.scopedStation}')
           on conflict do nothing`,
        );
      }
    });

    it('exports the table reports from the same fixtures, as CSV, Excel and PDF', async () => {
      const base = `tenantId=${ids.tenant}&${range}`;
      const delivery = await exportAs(sessionToken, `report=delivery-variance&${base}`);
      expect(delivery.status).toBe(200);
      expect(delivery.headers.get('content-disposition')).toBe(
        'attachment; filename="delivery-variance_2026-09-01_to_2026-09-30.csv"',
      );
      const deliveryCsv = (await delivery.text()).split('\r\n');
      expect(deliveryCsv[0]).toContain('Short (−) / over (+) (L)');
      expect(
        deliveryCsv.some((line) => line.includes('A10-DELIVERY') && line.includes('20.000')),
      ).toBe(true);

      const movements = await exportAs(sessionToken, `report=stock-movements&${base}`);
      expect(movements.status).toBe(200);
      const movementCsv = await movements.text();
      expect(movementCsv).toContain('Opening stock');
      expect(movementCsv).toContain('A10-TANK');
      expect(movementCsv).toContain('95.000');

      const dips = await exportAs(sessionToken, `report=tank-dip-history&${base}`);
      expect(dips.status).toBe(200);
      expect((await dips.text()).trim().split('\r\n')).toHaveLength(1);

      const xlsx = await exportAs(sessionToken, `report=stock-movements&format=xlsx&${base}`);
      expect(xlsx.headers.get('content-disposition')).toContain('.xlsx"');
      expect(
        Buffer.from(await xlsx.arrayBuffer())
          .subarray(0, 2)
          .toString(),
      ).toBe('PK');
      const pdf = await exportAs(sessionToken, `report=stock-movements&format=pdf&${base}`);
      expect(
        Buffer.from(await pdf.arrayBuffer())
          .subarray(0, 5)
          .toString(),
      ).toBe('%PDF-');
    });

    it('shows running balances on the supplier and customer statements', async () => {
      const base = `tenantId=${ids.tenant}&${range}`;
      const supplier = await (
        await exportAs(sessionToken, `report=supplier-statement&${base}`)
      ).text();
      const supplierLines = supplier.trim().split('\r\n');
      // 100 invoice, 5 credit note, 25 payment: 100 → 95 → 70 still owed.
      expect(supplierLines.at(-3)).toContain(',Invoice,100.0000,100.0000');
      expect(supplierLines.at(-2)).toContain(',Credit note,-5.0000,95.0000');
      expect(supplierLines.at(-1)).toContain(',Payment,-25.0000,70.0000');

      const customer = await (
        await exportAs(sessionToken, `report=customer-statement&${base}`)
      ).text();
      expect(customer).toContain('Credit account,Fuel on account,40.0000,40.0000');
      expect(customer).toContain('Credit account,Payment received,-10.0000,30.0000');
      expect(customer).toContain('Prepaid value,Prepaid top-up,12.0000,12.0000');

      // Customer balances have no station dimension, so a station view must not show them.
      const stationView = await (
        await exportAs(sessionToken, `report=customer-statement&stationIds=${ids.station}&${base}`)
      ).text();
      expect(stationView.trim().split('\r\n')).toHaveLength(1);
    });

    it('lists recognised expenses with their category', async () => {
      const expenses = await (
        await exportAs(sessionToken, `report=expenses-detail&tenantId=${ids.tenant}&${range}`)
      ).text();
      expect(expenses).toContain('2026-09-20');
      expect(expenses).toContain('A10 test expense');
      expect(expenses).toContain(',2.0000');
    });

    it('applies station authorisation to the table reports too', async () => {
      const response = await exportAs(
        scopedSessionToken,
        `report=stock-movements&tenantId=${ids.tenant}&stationIds=${ids.station}&${range}`,
      );
      expect(response.status).toBe(403);
    });
  });
});
