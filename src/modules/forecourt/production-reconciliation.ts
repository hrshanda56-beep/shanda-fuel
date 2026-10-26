import type { RecordData } from './daily-operations-read-model';
import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../platform/errors';
import { hasAlternateApprover } from '../../platform/security/separation-of-duties';
import { ExactDecimal, money } from '../../platform/domain/primitives';
import { withTenantTransaction } from '../../platform/db/transaction';
import { postInventoryMovementInTransaction } from '../inventory/persistence';
import {
  orderInventoryCostReplay,
  persistInventoryCostProjectionInTransaction,
  postCanonicalSaleCostInTransaction,
  type CostingMovement,
} from '../costing';
import { reconciliationMeterReadingSegments } from '../../platform/db/schema/a5';
import {
  executeForecourtCommand,
  type ForecourtCommandContext,
  type ForecourtTransaction,
} from './application';
import { databaseForecourtPorts, loadForecourtStation } from './persistence';
import { resolveForecourtCommandContext } from './application';
import { authorize } from '../../platform/security/permissions';
import { deriveSegmentSaleAllocations } from './segment-sale-chronology';
import { postCanonicalSaleRevenueInTransaction } from '../revenue';

const uuid = z.string().uuid();
export const productionReconciliationPaymentMethods = [
  'CASH',
  'POS',
  'ECOCASH',
  'BANK_TRANSFER',
  'CUSTOMER_CREDIT',
  'PREPAID',
  'STAFF_OR_MANAGEMENT_FUEL',
  'OTHER_APPROVED',
] as const;
const paymentMethod = z.enum(productionReconciliationPaymentMethods);

const basePayload = z.object({
  tenantId: uuid,
  stationId: uuid,
  reconciliationId: uuid,
  expectedVersion: z.number().int().nonnegative(),
});

type HeaderRow = {
  id: string;
  tenant_id: string;
  station_id: string;
  business_day_id: string;
  shift_id: string | null;
  business_date: string;
  supervisor_id: string | null;
  state: string;
  version: number | string;
};

function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function hasPositiveLitres(value: string): boolean {
  const decimalValue = new ExactDecimal(value).value;
  return decimalValue.isPositive() && !decimalValue.isZero();
}

async function serverNow(transaction: ForecourtTransaction): Promise<string> {
  const rows = await transaction.execute<{ now: Date | string }>(sql`select now() as now`);
  return new Date(rows[0]?.now ?? Date.now()).toISOString();
}

async function contextFor(
  request: Request,
  payload: { tenantId: string; stationId: string },
): Promise<ForecourtCommandContext> {
  return resolveForecourtCommandContext({
    request,
    requestedTenantId: payload.tenantId,
    stationId: payload.stationId,
    loadStation: loadForecourtStation,
  });
}

async function loadHeader(
  transaction: ForecourtTransaction,
  context: ForecourtCommandContext,
  reconciliationId: string,
): Promise<HeaderRow> {
  const rows = await transaction.execute<HeaderRow>(sql`
    select c.id, c.tenant_id, c.station_id, c.business_day_id, c.shift_id,
           d.business_date, c.supervisor_id, c.state, c.version
    from app.reconciliations c
    join app.station_business_days d
      on d.tenant_id = c.tenant_id and d.station_id = c.station_id and d.id = c.business_day_id
    where c.tenant_id = ${context.tenantId}
      and c.station_id = ${context.stationId}
      and c.id = ${reconciliationId}
    for update of c
  `);
  const row = rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'Reconciliation was not found');
  return row;
}

function assertEditable(header: HeaderRow): void {
  if (header.state !== 'DRAFT' && header.state !== 'RETURNED') {
    throw new AppError('CONFLICT', 'Only a draft or returned reconciliation can be edited');
  }
}

async function touchDraft(
  transaction: ForecourtTransaction,
  context: ForecourtCommandContext,
  reconciliationId: string,
  expectedVersion: number,
): Promise<number> {
  const rows = await transaction.execute<{ version: number }>(sql`
    update app.reconciliations
    set version = version + 1, updated_at = now()
    where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
      and id = ${reconciliationId} and version = ${expectedVersion}
    returning version
  `);
  if (!rows[0]) throw new AppError('CONFLICT', 'The reconciliation draft is stale');
  return Number(rows[0].version);
}

async function replaceRows(
  transaction: ForecourtTransaction,
  table: string,
  reconciliationId: string,
  context: ForecourtCommandContext,
): Promise<void> {
  const allowed = new Set([
    'reconciliation_attendants',
    'reconciliation_meter_readings',
    'reconciliation_payments',
    'reconciliation_expenses',
    'reconciliation_delivery_refs',
    'reconciliation_dip_refs',
    'reconciliation_variance_explanations',
  ]);
  if (!allowed.has(table))
    throw new AppError('INTERNAL_ERROR', 'Invalid reconciliation detail table');
  await transaction.execute(
    sql.raw(
      `delete from app."${table}" where tenant_id = '${context.tenantId}' and station_id = '${context.stationId}' and reconciliation_id = '${reconciliationId}'`,
    ),
  );
}

const createPayload = basePayload.extend({
  businessDayId: uuid,
  shiftId: uuid,
});

export async function createProductionReconciliationFromRequest(request: Request, input: unknown) {
  const payload = createPayload.parse(input);
  const key = request.headers.get('idempotency-key')?.trim();
  if (!key) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  const context = await contextFor(request, payload);
  return executeForecourtCommand({
    context,
    commandType: 'CreateProductionReconciliation',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    subjectType: 'Reconciliation',
    subjectId: payload.reconciliationId,
    expectedVersion: payload.expectedVersion,
    ports: databaseForecourtPorts(),
    execute: async (transaction) => {
      const shiftRows = await transaction.execute<{
        id: string;
        business_day_id: string;
        business_date: string;
        state: string;
      }>(sql`
        select s.id, s.business_day_id, s.business_date, s.state
        from app.shifts s
        where s.tenant_id = ${context.tenantId} and s.station_id = ${context.stationId} and s.id = ${payload.shiftId}
        for update
      `);
      const shift = shiftRows[0];
      if (!shift || shift.business_day_id !== payload.businessDayId) {
        throw new AppError('FORBIDDEN', 'The shift is outside the requested station business date');
      }
      if (['NOT_OPERATED', 'CANCELLED_BEFORE_START'].includes(shift.state)) {
        throw new AppError('CONFLICT', 'A non-operating shift cannot be reconciled');
      }
      try {
        await transaction.execute(sql`
          insert into app.reconciliations
            (id, tenant_id, station_id, business_day_id, shift_id, supervisor_id, created_by, state)
          values
            (${payload.reconciliationId}, ${context.tenantId}, ${context.stationId}, ${payload.businessDayId},
             ${payload.shiftId}, ${context.actor.membershipId}, ${context.actor.membershipId}, 'DRAFT')
        `);
        await transaction.execute(sql`
          insert into app.reconciliation_revisions
            (id, tenant_id, station_id, reconciliation_id, revision, state, expected_sales, accounted_sales,
             variance, currency, variance_classification, source_segment_ids, source_shift_ids)
          values
            (${randomUUID()}, ${context.tenantId}, ${context.stationId}, ${payload.reconciliationId}, 1, 'READY',
             0, 0, 0, 'USD', 'INFORMATIONAL', '[]'::jsonb, ${JSON.stringify([payload.shiftId])}::jsonb)
        `);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AppError(
            'CONFLICT',
            'A reconciliation already exists for this station and shift',
          );
        }
        throw error;
      }
      return {
        result: {
          reconciliationId: payload.reconciliationId,
          state: 'DRAFT' as const,
          version: 0,
          businessDate: shift.business_date,
        },
        after: { reconciliationId: payload.reconciliationId, state: 'DRAFT' },
      };
    },
  });
}

const attendantsPayload = basePayload.extend({ attendantIds: z.array(uuid).max(20) });

export async function saveReconciliationDraftFromRequest(request: Request, input: unknown) {
  const payload = basePayload.parse(input);
  return runEditableDetailCommand(
    request,
    payload,
    'SaveReconciliationDraft',
    'Reconciliation',
    async () => ({ saved: true }),
  );
}

export async function setReconciliationAttendantsFromRequest(request: Request, input: unknown) {
  const payload = attendantsPayload.parse(input);
  return runEditableDetailCommand(
    request,
    payload,
    'SetAttendants',
    'reconciliation_attendants',
    async (transaction, context) => {
      for (const attendantId of payload.attendantIds) {
        const eligible = await transaction.execute<{ id: string }>(sql`
        select m.id
        from app.memberships m
        join app.membership_role_assignments a
          on a.tenant_id = m.tenant_id and a.membership_id = m.id
        where m.tenant_id = ${context.tenantId} and m.id = ${attendantId} and m.status = 'ACTIVE'
          and a.scope_type = 'STATION' and a.station_id = ${context.stationId}
          and a.role_code = 'ATTENDANT'
          and (a.expires_at is null or a.expires_at > now())
        limit 1
      `);
        if (!eligible[0])
          throw new AppError('FORBIDDEN', 'An attendant is not assigned to this station');
      }
      await replaceRows(
        transaction,
        'reconciliation_attendants',
        payload.reconciliationId,
        context,
      );
      for (const attendantId of payload.attendantIds) {
        await transaction.execute(sql`
        insert into app.reconciliation_attendants
          (tenant_id, station_id, reconciliation_id, attendant_id, assigned_by)
        values (${context.tenantId}, ${context.stationId}, ${payload.reconciliationId}, ${attendantId}, ${context.actor.membershipId})
      `);
      }
      return { attendantCount: payload.attendantIds.length };
    },
  );
}

const meterReading = z.object({
  id: uuid.optional(),
  nozzleId: uuid,
  productId: uuid,
  shiftId: uuid,
  openingReading: z.string(),
  closingReading: z.string(),
  sellingPriceId: uuid,
});
const meterPayload = basePayload.extend({ readings: z.array(meterReading).max(100) });
export async function saveReconciliationMeterReadingsFromRequest(request: Request, input: unknown) {
  const payload = meterPayload.parse(input);
  return runEditableDetailCommand(
    request,
    payload,
    'SaveMeterReadings',
    'reconciliation_meter_readings',
    async (transaction, context) => {
      await replaceRows(
        transaction,
        'reconciliation_meter_readings',
        payload.reconciliationId,
        context,
      );
      for (const reading of payload.readings) {
        const opening = new ExactDecimal(reading.openingReading);
        const closing = new ExactDecimal(reading.closingReading);
        if (closing.value.lt(opening.value))
          throw new AppError(
            'VALIDATION_FAILED',
            'Closing meter reading cannot be below opening reading',
          );
        const nozzle = await transaction.execute<{ product_id: string }>(sql`
        select product_id from app.nozzles
        where tenant_id = ${context.tenantId} and station_id = ${context.stationId} and id = ${reading.nozzleId} and status = 'ACTIVE'
      `);
        if (!nozzle[0] || nozzle[0].product_id !== reading.productId)
          throw new AppError(
            'FORBIDDEN',
            'The nozzle/product relationship is outside this station',
          );
        const price = await transaction.execute<{ product_id: string; unit_price: string }>(sql`
        select product_id, unit_price from app.selling_prices
        where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
          and id = ${reading.sellingPriceId} and state = 'ACTIVE'
        for share
      `);
        if (!price[0] || price[0].product_id !== reading.productId)
          throw new AppError('CONFLICT', 'The selling price is not active for this product');
        const sold = closing
          .subtract(opening)
          .quantize({ name: 'Litres', precision: 18, scale: 3 });
        const sales = sold
          .multiply(new ExactDecimal(price[0].unit_price))
          .quantize({ name: 'Money', precision: 20, scale: 4 });
        await transaction.execute(sql`
        insert into app.reconciliation_meter_readings
          (id, tenant_id, station_id, reconciliation_id, shift_id, nozzle_id, product_id,
           opening_reading, closing_reading, litres_sold, selling_price_id, unit_price, sales_value, entered_by)
        values (${reading.id ?? randomUUID()}, ${context.tenantId}, ${context.stationId}, ${payload.reconciliationId},
          ${reading.shiftId}, ${reading.nozzleId}, ${reading.productId}, ${opening.toString()}, ${closing.toString()},
          ${sold.toString()}, ${reading.sellingPriceId}, ${price[0].unit_price}, ${sales.toString()}, ${context.actor.membershipId})
      `);
      }
      return { readingCount: payload.readings.length };
    },
  );
}

export const productionReconciliationPaymentSchema = z.object({
  id: uuid.optional(),
  method: paymentMethod,
  amount: z.string(),
  reference: z.string().optional(),
  note: z.string().optional(),
  /**
   * Required for CUSTOMER_CREDIT and PREPAID: the customer account the sale is charged to.
   * A saved draft is read back with null here, so null means "none", the same as leaving it out.
   */
  customerAccountId: uuid.nullish().transform((value) => value ?? undefined),
  /** Required for STAFF_OR_MANAGEMENT_FUEL: who received the fuel. Null means "none". */
  beneficiaryName: z
    .string()
    .trim()
    .max(160)
    .nullish()
    .transform((value) => value ?? undefined),
});

type PaymentInput = z.infer<typeof productionReconciliationPaymentSchema>;

const ACCOUNT_TYPE_FOR_METHOD = { CUSTOMER_CREDIT: 'CREDIT', PREPAID: 'PREPAID_VALUE' } as const;

type AccountRow = {
  id: string;
  account_type: string;
  status: string;
  customer_status: string;
  display_name: string;
  credit_limit: string | null;
  station_scope: string;
  allowed: boolean;
  balance: string;
};

/**
 * A credit or prepaid sale must name its customer, and the amount is checked against that
 * customer's limit or prepaid balance when it is entered (not only when the day is approved).
 * Approved fuel must name who received it. Amounts are summed per customer so two rows for the
 * same customer cannot each slip under the limit.
 */
async function assertPaymentReferences(
  transaction: ForecourtTransaction,
  context: ForecourtCommandContext,
  payments: readonly PaymentInput[],
): Promise<void> {
  const totals = new Map<string, { method: 'CUSTOMER_CREDIT' | 'PREPAID'; amount: ExactDecimal }>();
  for (const item of payments) {
    if (item.method === 'STAFF_OR_MANAGEMENT_FUEL' && !item.beneficiaryName?.trim()) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Say who received the approved fuel (name of the staff member or manager).',
      );
    }
    if (item.method !== 'CUSTOMER_CREDIT' && item.method !== 'PREPAID') continue;
    if (!item.customerAccountId) {
      throw new AppError(
        'VALIDATION_FAILED',
        item.method === 'CUSTOMER_CREDIT'
          ? 'Choose the customer for this credit sale.'
          : 'Choose the customer whose prepaid balance paid for this sale.',
      );
    }
    const key = `${item.method}:${item.customerAccountId}`;
    const current = totals.get(key)?.amount ?? new ExactDecimal('0');
    totals.set(key, {
      method: item.method,
      amount: current.add(money(item.amount).amount),
    });
  }
  for (const [key, { method, amount }] of totals) {
    const accountId = key.slice(key.indexOf(':') + 1);
    const rows = await transaction.execute<AccountRow>(sql`
      select a.id, a.account_type, a.status, c.status as customer_status, c.display_name,
        a.credit_limit::text as credit_limit, a.station_scope,
        (a.station_scope = 'ALL' or exists (
          select 1 from app.customer_account_stations s
          where s.tenant_id = a.tenant_id and s.account_id = a.id
            and s.station_id = ${context.stationId} and s.active
        )) as allowed,
        coalesce((
          select sum(case when l.direction = 'INCREASE' then l.amount else -l.amount end)
          from app.customer_ledger_entries l
          where l.tenant_id = a.tenant_id and l.account_id = a.id
        ), 0)::text as balance
      from app.customer_accounts a
      join app.customers c on c.tenant_id = a.tenant_id and c.id = a.customer_id
      where a.tenant_id = ${context.tenantId} and a.id = ${accountId}
    `);
    const account = rows[0];
    if (!account) throw new AppError('NOT_FOUND', 'That customer account was not found.');
    if (account.account_type !== ACCOUNT_TYPE_FOR_METHOD[method]) {
      throw new AppError(
        'VALIDATION_FAILED',
        method === 'CUSTOMER_CREDIT'
          ? `${account.display_name} does not have a credit account.`
          : `${account.display_name} does not have a prepaid money account.`,
      );
    }
    if (account.status !== 'ACTIVE' || account.customer_status !== 'ACTIVE') {
      throw new AppError(
        'CONFLICT',
        `${account.display_name} is not active, so cannot be charged.`,
      );
    }
    if (!account.allowed) {
      throw new AppError(
        'FORBIDDEN',
        `${account.display_name} is not allowed to buy on account at this station.`,
      );
    }
    const balance = new ExactDecimal(account.balance);
    if (method === 'CUSTOMER_CREDIT') {
      const limit = new ExactDecimal(account.credit_limit ?? '0');
      if (!limit.value.gt(0)) {
        throw new AppError(
          'CONFLICT',
          `${account.display_name} has no credit limit, so credit sales are not allowed.`,
        );
      }
      if (balance.add(amount).value.gt(limit.value)) {
        throw new AppError(
          'CONFLICT',
          `This would put ${account.display_name} over their credit limit. Record a payment first, or ask a manager to approve a higher limit on the customer's page.`,
        );
      }
    } else if (balance.value.lt(amount.value)) {
      throw new AppError(
        'CONFLICT',
        `${account.display_name} does not have enough prepaid money for this sale. Top up the account or lower the amount.`,
      );
    }
  }
}
const paymentsPayload = basePayload.extend({
  payments: z.array(productionReconciliationPaymentSchema).max(100),
});
export async function saveReconciliationPaymentsFromRequest(request: Request, input: unknown) {
  const payload = paymentsPayload.parse(input);
  return runEditableDetailCommand(
    request,
    payload,
    'SavePaymentAllocations',
    'reconciliation_payments',
    async (transaction, context) => {
      for (const item of payload.payments) {
        if (money(item.amount).amount.value.isNegative())
          throw new AppError('VALIDATION_FAILED', 'Payment amounts cannot be negative');
      }
      await assertPaymentReferences(transaction, context, payload.payments);
      await replaceRows(transaction, 'reconciliation_payments', payload.reconciliationId, context);
      for (const item of payload.payments) {
        const amount = money(item.amount).amount;
        const isAccountSale = item.method === 'CUSTOMER_CREDIT' || item.method === 'PREPAID';
        await transaction.execute(sql`
        insert into app.reconciliation_payments (id, tenant_id, station_id, reconciliation_id, method, amount, reference, note, customer_account_id, beneficiary_name, entered_by)
        values (${item.id ?? randomUUID()}, ${context.tenantId}, ${context.stationId}, ${payload.reconciliationId}, ${item.method}, ${amount.toString()}, ${item.reference ?? null}, ${item.note ?? null}, ${isAccountSale ? (item.customerAccountId ?? null) : null}, ${item.method === 'STAFF_OR_MANAGEMENT_FUEL' ? (item.beneficiaryName?.trim() ?? null) : null}, ${context.actor.membershipId})
      `);
      }
      return { paymentCount: payload.payments.length };
    },
  );
}

const expense = z.object({
  id: uuid.optional(),
  category: z.string().trim().min(1),
  description: z.string().trim().min(1),
  amount: z.string(),
  paymentMethod,
  personPaid: z.string().optional(),
  reference: z.string().optional(),
});
const expensesPayload = basePayload.extend({ expenses: z.array(expense).max(100) });
export async function saveReconciliationExpensesFromRequest(request: Request, input: unknown) {
  const payload = expensesPayload.parse(input);
  return runEditableDetailCommand(
    request,
    payload,
    'SaveExpenses',
    'reconciliation_expenses',
    async (transaction, context) => {
      await replaceRows(transaction, 'reconciliation_expenses', payload.reconciliationId, context);
      for (const item of payload.expenses) {
        const amount = money(item.amount).amount;
        if (amount.value.isNegative())
          throw new AppError('VALIDATION_FAILED', 'Expense amounts cannot be negative');
        await transaction.execute(sql`
        insert into app.reconciliation_expenses (id, tenant_id, station_id, reconciliation_id, category, description, amount, payment_method, person_paid, reference, entered_by)
        values (${item.id ?? randomUUID()}, ${context.tenantId}, ${context.stationId}, ${payload.reconciliationId}, ${item.category}, ${item.description}, ${amount.toString()}, ${item.paymentMethod}, ${item.personPaid ?? null}, ${item.reference ?? null}, ${context.actor.membershipId})
      `);
      }
      return { expenseCount: payload.expenses.length };
    },
  );
}

const deliveryRef = z.object({
  deliveryId: uuid,
  allocationId: uuid,
  productId: uuid,
  tankId: uuid,
});
const deliveryPayload = basePayload.extend({ deliveries: z.array(deliveryRef).max(100) });
export async function linkReconciliationDeliveriesFromRequest(request: Request, input: unknown) {
  const payload = deliveryPayload.parse(input);
  return runEditableDetailCommand(
    request,
    payload,
    'LinkDeliveries',
    'reconciliation_delivery_refs',
    async (transaction, context) => {
      await replaceRows(
        transaction,
        'reconciliation_delivery_refs',
        payload.reconciliationId,
        context,
      );
      for (const item of payload.deliveries) {
        const rows = await transaction.execute<{
          product_id: string;
          tank_id: string;
          status: string;
          business_date: string;
        }>(sql`
        select d.product_id, a.tank_id, d.status, d.business_date
        from app.fuel_deliveries d
        join app.fuel_delivery_allocations a on a.tenant_id=d.tenant_id and a.station_id=d.station_id and a.delivery_id=d.id
        where d.tenant_id=${context.tenantId} and d.station_id=${context.stationId} and d.id=${item.deliveryId} and a.id=${item.allocationId}
      `);
        const row = rows[0];
        const header = await loadHeader(transaction, context, payload.reconciliationId);
        if (
          !row ||
          row.product_id !== item.productId ||
          row.tank_id !== item.tankId ||
          row.status !== 'CONFIRMED' ||
          row.business_date !== header.business_date
        ) {
          throw new AppError(
            'FORBIDDEN',
            'The delivery allocation is not valid for this reconciliation',
          );
        }
        await transaction.execute(sql`
        insert into app.reconciliation_delivery_refs
          (tenant_id, station_id, reconciliation_id, delivery_id, allocation_id, product_id, tank_id, entered_by)
        values (${context.tenantId}, ${context.stationId}, ${payload.reconciliationId}, ${item.deliveryId}, ${item.allocationId}, ${item.productId}, ${item.tankId}, ${context.actor.membershipId})
      `);
      }
      return { deliveryCount: payload.deliveries.length };
    },
  );
}

const dipRef = z.object({ dipId: uuid, tankId: uuid, productId: uuid });
const dipPayload = basePayload.extend({ dips: z.array(dipRef).max(100) });
export async function linkReconciliationDipsFromRequest(request: Request, input: unknown) {
  const payload = dipPayload.parse(input);
  return runEditableDetailCommand(
    request,
    payload,
    'LinkTankDips',
    'reconciliation_dip_refs',
    async (transaction, context) => {
      await replaceRows(transaction, 'reconciliation_dip_refs', payload.reconciliationId, context);
      const header = await loadHeader(transaction, context, payload.reconciliationId);
      for (const item of payload.dips) {
        const rows = await transaction.execute<{
          tank_id: string;
          product_id: string;
          business_date: string;
        }>(sql`
        select d.tank_id, t.product_id, d.business_date
        from app.tank_dips d join app.tanks t on t.tenant_id=d.tenant_id and t.station_id=d.station_id and t.id=d.tank_id
        where d.tenant_id=${context.tenantId} and d.station_id=${context.stationId} and d.id=${item.dipId}
      `);
        const row = rows[0];
        if (
          !row ||
          row.tank_id !== item.tankId ||
          row.product_id !== item.productId ||
          row.business_date !== header.business_date
        )
          throw new AppError('FORBIDDEN', 'The tank dip is not valid for this reconciliation');
        await transaction.execute(sql`
        insert into app.reconciliation_dip_refs (tenant_id, station_id, reconciliation_id, dip_id, tank_id, product_id, entered_by)
        values (${context.tenantId}, ${context.stationId}, ${payload.reconciliationId}, ${item.dipId}, ${item.tankId}, ${item.productId}, ${context.actor.membershipId})
      `);
      }
      return { dipCount: payload.dips.length };
    },
  );
}

const cashPayload = basePayload.extend({ countedCash: z.string() });
export async function saveReconciliationCashFromRequest(request: Request, input: unknown) {
  const payload = cashPayload.parse(input);
  return runEditableDetailCommand(
    request,
    payload,
    'SaveCashDeclaration',
    'reconciliation_cash_declarations',
    async (transaction, context) => {
      const counted = money(payload.countedCash).amount;
      if (counted.value.isNegative())
        throw new AppError('VALIDATION_FAILED', 'Cash count cannot be negative');
      const cash = await transaction.execute<{ payments: string; expenses: string }>(sql`
      select
        coalesce((select sum(amount) from app.reconciliation_payments where tenant_id=${context.tenantId} and station_id=${context.stationId} and reconciliation_id=${payload.reconciliationId} and method='CASH'), 0) as payments,
        coalesce((select sum(amount) from app.reconciliation_expenses where tenant_id=${context.tenantId} and station_id=${context.stationId} and reconciliation_id=${payload.reconciliationId} and payment_method='CASH'), 0) as expenses
    `);
      const expected = money(cash[0]?.payments ?? '0').amount;
      const expenses = money(cash[0]?.expenses ?? '0').amount;
      const net = expected.subtract(expenses);
      const variance = counted.subtract(net).quantize({ name: 'Money', precision: 20, scale: 4 });
      await transaction.execute(sql`
      insert into app.reconciliation_cash_declarations
        (tenant_id, station_id, reconciliation_id, counted_cash, expected_physical_cash, cash_paid_expenses, net_expected_cash, cash_variance, entered_by)
      values (${context.tenantId}, ${context.stationId}, ${payload.reconciliationId}, ${counted.toString()}, ${expected.toString()}, ${expenses.toString()}, ${net.toString()}, ${variance.toString()}, ${context.actor.membershipId})
      on conflict (tenant_id, station_id, reconciliation_id) do update set
        counted_cash=excluded.counted_cash, expected_physical_cash=excluded.expected_physical_cash,
        cash_paid_expenses=excluded.cash_paid_expenses, net_expected_cash=excluded.net_expected_cash,
        cash_variance=excluded.cash_variance, updated_at=now(), entered_by=excluded.entered_by
    `);
      return { cashVariance: variance.toString() };
    },
  );
}

const explanationsPayload = basePayload.extend({
  explanations: z
    .record(z.string().trim().min(1), z.string().trim().min(1))
    .superRefine((value, refinementContext) => {
      for (const category of Object.keys(value)) {
        if (!['SALES', 'CASH', 'STOCK'].includes(category)) {
          refinementContext.addIssue({
            code: 'custom',
            message: 'Explanation category must be SALES, CASH, or STOCK',
            path: [category],
          });
        }
      }
    }),
});
export async function saveReconciliationExplanationsFromRequest(request: Request, input: unknown) {
  const payload = explanationsPayload.parse(input);
  return runEditableDetailCommand(
    request,
    payload,
    'SaveVarianceExplanations',
    'reconciliation_variance_explanations',
    async (transaction, context) => {
      await replaceRows(
        transaction,
        'reconciliation_variance_explanations',
        payload.reconciliationId,
        context,
      );
      for (const [category, explanation] of Object.entries(payload.explanations)) {
        await transaction.execute(sql`
        insert into app.reconciliation_variance_explanations (tenant_id, station_id, reconciliation_id, category, explanation, entered_by)
        values (${context.tenantId}, ${context.stationId}, ${payload.reconciliationId}, ${category}, ${explanation}, ${context.actor.membershipId})
      `);
      }
      return { explanationCount: Object.keys(payload.explanations).length };
    },
  );
}

async function runEditableDetailCommand<T>(
  request: Request,
  payload: z.infer<typeof basePayload>,
  commandType:
    | 'SetAttendants'
    | 'SaveReconciliationDraft'
    | 'SaveMeterReadings'
    | 'SavePaymentAllocations'
    | 'SaveExpenses'
    | 'LinkDeliveries'
    | 'LinkTankDips'
    | 'SaveCashDeclaration'
    | 'SaveVarianceExplanations',
  subjectType: string,
  effect: (transaction: ForecourtTransaction, context: ForecourtCommandContext) => Promise<T>,
): Promise<T & { version: number }> {
  const key = request.headers.get('idempotency-key')?.trim();
  if (!key) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  const context = await contextFor(request, payload);
  return executeForecourtCommand({
    context,
    commandType,
    idempotencyKey: key,
    requestHash: requestHash(payload),
    subjectType,
    subjectId: payload.reconciliationId,
    expectedVersion: payload.expectedVersion,
    ports: databaseForecourtPorts(),
    execute: async (transaction) => {
      const header = await loadHeader(transaction, context, payload.reconciliationId);
      assertEditable(header);
      const result = await effect(transaction, context);
      const version = await touchDraft(
        transaction,
        context,
        payload.reconciliationId,
        payload.expectedVersion,
      );
      return { result: { ...result, version }, after: result };
    },
  });
}

async function loadMetrics(
  transaction: ForecourtTransaction,
  context: ForecourtCommandContext,
  reconciliationId: string,
) {
  const totals = await transaction.execute<{
    sales: string;
    payments: string;
    cash: string;
    expenses: string;
  }>(sql`
    select
      coalesce((select sum(sales_value) from app.reconciliation_meter_readings where tenant_id=${context.tenantId} and station_id=${context.stationId} and reconciliation_id=${reconciliationId}), 0) as sales,
      coalesce((select sum(amount) from app.reconciliation_payments where tenant_id=${context.tenantId} and station_id=${context.stationId} and reconciliation_id=${reconciliationId}), 0) as payments,
      coalesce((select sum(amount) from app.reconciliation_payments where tenant_id=${context.tenantId} and station_id=${context.stationId} and reconciliation_id=${reconciliationId} and method='CASH'), 0) as cash,
      coalesce((select sum(amount) from app.reconciliation_expenses where tenant_id=${context.tenantId} and station_id=${context.stationId} and reconciliation_id=${reconciliationId} and payment_method='CASH'), 0) as expenses
  `);
  const total = totals[0] ?? { sales: '0', payments: '0', cash: '0', expenses: '0' };
  const sales = money(total.sales).amount;
  const payments = money(total.payments).amount;
  const cash = money(total.cash).amount;
  const cashExpenses = money(total.expenses).amount;
  const cashRow = await transaction.execute<{ counted_cash: string }>(sql`
    select counted_cash from app.reconciliation_cash_declarations
    where tenant_id=${context.tenantId} and station_id=${context.stationId} and reconciliation_id=${reconciliationId}
  `);
  const counted = cashRow[0] ? money(cashRow[0].counted_cash).amount : null;
  const cashVariance = counted
    ? counted
        .subtract(cash.subtract(cashExpenses))
        .quantize({ name: 'Money', precision: 20, scale: 4 })
    : null;
  const stock = await transaction.execute<{
    tank_id: string;
    product_id: string;
    physical: string;
    expected: string;
    sold: string;
  }>(sql`
    select r.tank_id, r.product_id, d.physical_litres as physical,
      coalesce((select sum(m.quantity_litres) from app.inventory_movements m where m.tenant_id=r.tenant_id and m.station_id=r.station_id and m.tank_id=r.tank_id), 0) as expected,
      -- Sale movements are posted on approval, so once approved they are already inside "expected".
      case when exists (
        select 1 from app.reconciliations rec
        where rec.tenant_id=r.tenant_id and rec.station_id=r.station_id and rec.id=r.reconciliation_id
          and rec.state in ('APPROVED','POSTED','LOCKED'))
      then 0
      else coalesce((select sum(m.litres_sold) from app.reconciliation_meter_readings m where m.tenant_id=r.tenant_id and m.station_id=r.station_id and m.reconciliation_id=r.reconciliation_id and m.product_id=r.product_id), 0)
      end as sold
    from app.reconciliation_dip_refs r join app.tank_dips d on d.tenant_id=r.tenant_id and d.station_id=r.station_id and d.id=r.dip_id
    where r.tenant_id=${context.tenantId} and r.station_id=${context.stationId} and r.reconciliation_id=${reconciliationId}
  `);
  const stockVariance: Record<string, string> = {};
  for (const row of stock) {
    const tankCount = await transaction.execute<{ count: number }>(sql`
      select count(*)::int as count from app.tanks where tenant_id=${context.tenantId} and station_id=${context.stationId} and product_id=${row.product_id} and status='ACTIVE'
    `);
    if (Number(tankCount[0]?.count) !== 1)
      throw new AppError(
        'CONFLICT',
        'A reconciliation sale requires an explicit pump-to-tank mapping when a product has multiple active tanks',
      );
    stockVariance[row.tank_id] = new ExactDecimal(row.physical)
      .subtract(new ExactDecimal(row.expected).subtract(new ExactDecimal(row.sold)))
      .quantize({ name: 'Litres', precision: 18, scale: 3 })
      .toString();
  }
  const salesVariance = payments
    .subtract(sales)
    .quantize({ name: 'Money', precision: 20, scale: 4 });
  return { sales, payments, salesVariance, cash, cashExpenses, cashVariance, stockVariance };
}

async function requireExplanations(
  transaction: ForecourtTransaction,
  context: ForecourtCommandContext,
  reconciliationId: string,
  metrics: Awaited<ReturnType<typeof loadMetrics>>,
): Promise<void> {
  const required = new Set<string>();
  if (!metrics.salesVariance.value.isZero()) required.add('SALES');
  if (metrics.cashVariance && !metrics.cashVariance.value.isZero()) required.add('CASH');
  if (Object.values(metrics.stockVariance).some((value) => !new ExactDecimal(value).value.isZero()))
    required.add('STOCK');
  if (required.size === 0) return;
  const rows = await transaction.execute<{ category: string; explanation: string }>(sql`
    select category, explanation from app.reconciliation_variance_explanations
    where tenant_id=${context.tenantId} and station_id=${context.stationId} and reconciliation_id=${reconciliationId}
  `);
  const provided = new Set(rows.filter((row) => row.explanation.trim()).map((row) => row.category));
  const missing = [...required].filter((category) => !provided.has(category));
  if (missing.length)
    throw new AppError(
      'VALIDATION_FAILED',
      `Variance explanations are required for: ${missing.join(', ')}`,
    );
}

const workflowPayload = basePayload;
export async function submitProductionReconciliationFromRequest(request: Request, input: unknown) {
  return transitionProductionReconciliation(
    request,
    workflowPayload.parse(input),
    'SubmitProductionReconciliation',
    'SUBMITTED',
  );
}

export async function returnProductionReconciliationFromRequest(request: Request, input: unknown) {
  const payload = basePayload.extend({ reason: z.string().trim().min(1) }).parse(input);
  return transitionProductionReconciliation(
    request,
    payload,
    'ReturnProductionReconciliation',
    'RETURNED',
    payload.reason,
  );
}

export async function approveProductionReconciliationFromRequest(request: Request, input: unknown) {
  const payload = workflowPayload.parse(input);
  const key = request.headers.get('idempotency-key')?.trim();
  if (!key) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  const context = await contextFor(request, payload);
  const ports = databaseForecourtPorts();
  return executeForecourtCommand({
    context,
    commandType: 'ApproveProductionReconciliation',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    subjectType: 'Reconciliation',
    subjectId: payload.reconciliationId,
    expectedVersion: payload.expectedVersion,
    ports,
    execute: async (transaction) => {
      const header = await loadHeader(transaction, context, payload.reconciliationId);
      if (header.state !== 'SUBMITTED')
        throw new AppError('CONFLICT', 'Only a submitted reconciliation can be approved');
      // Separation of duties: whoever submitted the day cannot also approve it, unless they are the
      // only person who could (solo owner).
      const submitter = await transaction.execute<{ submitted_by: string | null }>(sql`
        select submitted_by
        from app.reconciliations
        where tenant_id=${context.tenantId}
          and station_id=${context.stationId}
          and id=${payload.reconciliationId}
      `);
      if (
        submitter[0]?.submitted_by === context.actor.membershipId &&
        (await hasAlternateApprover(transaction, {
          tenantId: context.tenantId,
          stationId: context.stationId,
          excludeMembershipId: context.actor.membershipId,
          permission: 'reconciliation.approve',
        }))
      ) {
        throw new AppError(
          'FORBIDDEN',
          'The person who submitted a reconciliation cannot approve it',
        );
      }
      const metrics = await loadMetrics(transaction, context, payload.reconciliationId);
      await requireExplanations(transaction, context, payload.reconciliationId, metrics);
      const bridgeTable = await transaction.execute<{ installed: boolean }>(sql`
        select to_regclass('app.reconciliation_meter_reading_segments') is not null as installed
      `);
      if (!bridgeTable[0]?.installed) {
        throw new AppError(
          'DEPENDENCY_UNAVAILABLE',
          'The A12.1 reconciliation meter-segment bridge is not installed',
        );
      }
      const revisions = await transaction.execute<{ id: string }>(sql`
        select id
        from app.reconciliation_revisions
        where tenant_id=${context.tenantId}
          and station_id=${context.stationId}
          and reconciliation_id=${payload.reconciliationId}
          and state='PENDING_APPROVAL'
        order by revision desc, id desc
        limit 1
        for update
      `);
      const revision = revisions[0];
      if (!revision) {
        throw new AppError(
          'CONFLICT',
          'The submitted reconciliation has no pending approval revision',
        );
      }
      const readings = await transaction.execute<{
        id: string;
        nozzle_id: string;
        product_id: string;
        litres_sold: string;
        shift_id: string;
        opening_reading: string;
        closing_reading: string;
      }>(sql`
        select id, nozzle_id, product_id, litres_sold, shift_id, opening_reading, closing_reading
        from app.reconciliation_meter_readings
        where tenant_id=${context.tenantId} and station_id=${context.stationId} and reconciliation_id=${payload.reconciliationId}
        order by id
      `);
      const saleMovementIds: string[] = [];
      const sourceSegmentIds: string[] = [];
      const saleCostCandidates: CostingMovement[] = [];
      const saleCostStreams = new Map<string, CostingMovement>();
      const revenueCandidates: Array<{
        readingId: string;
        segmentId: string;
        movementId: string;
        productId: string;
        nozzleId: string;
        shiftId: string;
        tankId: string;
        quantityLitres: string;
        unitPrice: string;
        businessDate: string;
        effectiveAt: Date;
      }> = [];
      for (const reading of readings) {
        if (!header.shift_id || header.shift_id !== reading.shift_id) {
          throw new AppError(
            'CONFLICT',
            'A reconciliation reading must belong to the reconciliation shift',
          );
        }
        const segmentRows = await transaction.execute<{
          id: string;
          state: string;
          opening_reading: string;
          closing_reading: string;
          litres: string;
          nozzle_id: string;
          product_id: string;
          shift_id: string;
          unit_price: string;
          meter_installation_id: string;
          business_date: string;
          segment_start_at: Date | string;
          segment_end_at: Date | string;
        }>(sql`
          select m.id, m.state, m.opening_reading, m.closing_reading, m.litres,
                 m.nozzle_id, m.product_id, m.shift_id, m.unit_price,
                 m.meter_installation_id,
                 d.business_date, m.segment_start_at, m.segment_end_at
          from app.meter_segments m
          join app.station_business_days d
            on d.tenant_id=m.tenant_id and d.station_id=m.station_id and d.id=m.business_day_id
          where m.tenant_id=${context.tenantId}
            and m.station_id=${context.stationId}
            and m.business_day_id=${header.business_day_id}
            and m.shift_id=${reading.shift_id}
            and m.nozzle_id=${reading.nozzle_id}
            and m.product_id=${reading.product_id}
            and m.opening_reading >= ${reading.opening_reading}
            and m.closing_reading <= ${reading.closing_reading}
            and not exists (
              select 1
              from app.meter_segments successor
              where successor.tenant_id=m.tenant_id
                and successor.station_id=m.station_id
                and (successor.correction_of_segment_id=m.id or successor.reversal_of_segment_id=m.id)
            )
          order by m.segment_start_at, m.id
          for update of m
        `);
        const allocations = deriveSegmentSaleAllocations(
          {
            openingReading: reading.opening_reading,
            closingReading: reading.closing_reading,
            litresSold: reading.litres_sold,
          },
          segmentRows.map((segment) => ({
            id: segment.id,
            state: segment.state,
            openingReading: segment.opening_reading,
            closingReading: segment.closing_reading,
            litres: segment.litres,
            meterInstallationId: segment.meter_installation_id,
            businessDate: segment.business_date,
            segmentStartAt: segment.segment_start_at,
            segmentEndAt: segment.segment_end_at,
          })),
        );
        const positiveAllocations = allocations.filter((allocation) =>
          hasPositiveLitres(allocation.litres),
        );
        let tankId: string | undefined;
        if (positiveAllocations.length > 0) {
          const tanksForProduct = await transaction.execute<{ id: string }>(sql`
            select id from app.tanks where tenant_id=${context.tenantId} and station_id=${context.stationId} and product_id=${reading.product_id} and status='ACTIVE'
            order by id
          `);
          if (tanksForProduct.length !== 1)
            throw new AppError('CONFLICT', 'Cannot post a sale without an unambiguous source tank');
          tankId = tanksForProduct[0]!.id;
        }
        for (const allocation of allocations) {
          let movementId: string | undefined;
          if (hasPositiveLitres(allocation.litres)) {
            const existingMovement = await transaction.execute<{ id: string }>(sql`
              select id
              from app.inventory_movements
              where tenant_id=${context.tenantId}
                and station_id=${context.stationId}
                and movement_type='SALE'
                and source_type='METER_SEGMENT_SALE'
                and source_id=${allocation.segmentId}
              for update
            `);
            if (existingMovement.length > 0) {
              throw new AppError(
                'CONFLICT',
                'Canonical sale movement already exists for a sealed meter segment',
              );
            }
            movementId = await postInventoryMovementInTransaction(transaction, {
              tenantId: context.tenantId,
              stationId: context.stationId,
              tankId: tankId!,
              productId: reading.product_id,
              movementType: 'SALE',
              quantityLitres: `-${allocation.litres}`,
              effectiveAt: new Date(allocation.segmentEndAt),
              businessDate: allocation.businessDate,
              sourceType: 'METER_SEGMENT_SALE',
              sourceId: allocation.segmentId,
              actorMembershipId: context.actor.membershipId,
            });
            const segment = segmentRows.find((candidate) => candidate.id === allocation.segmentId);
            if (!segment) {
              throw new AppError('INTERNAL_ERROR', 'The allocated meter segment disappeared');
            }
            revenueCandidates.push({
              readingId: reading.id,
              segmentId: allocation.segmentId,
              movementId,
              productId: reading.product_id,
              nozzleId: reading.nozzle_id,
              shiftId: reading.shift_id,
              tankId: tankId!,
              quantityLitres: allocation.litres,
              unitPrice: segment.unit_price,
              businessDate: allocation.businessDate,
              effectiveAt: new Date(allocation.segmentEndAt),
            });
            saleCostCandidates.push({
              tenantId: context.tenantId,
              stationId: context.stationId,
              tankId: tankId!,
              productId: reading.product_id,
              id: movementId,
              movementType: 'SALE',
              quantityLitres: `-${allocation.litres}`,
              effectiveAt: new Date(allocation.segmentEndAt),
              businessDate: allocation.businessDate,
              sourceType: 'METER_SEGMENT_SALE',
              sourceId: allocation.segmentId,
            });
            saleCostStreams.set(
              [context.tenantId, context.stationId, tankId!, reading.product_id].join('|'),
              saleCostCandidates.at(-1)!,
            );
          }
          await transaction.insert(reconciliationMeterReadingSegments).values({
            tenantId: context.tenantId,
            stationId: context.stationId,
            reconciliationId: payload.reconciliationId,
            revisionId: revision.id,
            reconciliationMeterReadingId: reading.id,
            meterSegmentId: allocation.segmentId,
            allocatedLitres: allocation.litres,
          });
          if (movementId) saleMovementIds.push(movementId);
          sourceSegmentIds.push(allocation.segmentId);
          if (movementId)
            await ports.audit.append({
              transaction,
              context,
              commandType: 'InventorySalePosted',
              subjectType: 'InventoryMovement',
              subjectId: movementId,
              after: {
                reconciliationId: payload.reconciliationId,
                reconciliationRevisionId: revision.id,
                reconciliationMeterReadingId: reading.id,
                meterSegmentId: allocation.segmentId,
                movementId,
                litres: allocation.litres,
                effectiveAt: new Date(allocation.segmentEndAt).toISOString(),
              },
              provenance: {
                actorId: context.actor.actorId,
                membershipId: context.actor.membershipId,
                tenantId: context.tenantId,
                stationId: context.stationId,
                requestId: context.requestId,
              },
            });
        }
      }
      const orderedSaleCostCandidates = orderInventoryCostReplay(saleCostCandidates, []).filter(
        (item): item is CostingMovement & { kind: 'MOVEMENT' } => item.kind === 'MOVEMENT',
      );
      for (const sale of orderedSaleCostCandidates) {
        await postCanonicalSaleCostInTransaction(transaction, {
          tenantId: context.tenantId,
          stationId: context.stationId,
          movementId: sale.id,
          meterSegmentId: sale.sourceId,
          actorMembershipId: context.actor.membershipId,
          persistProjection: false,
        });
      }
      for (const stream of saleCostStreams.values()) {
        await persistInventoryCostProjectionInTransaction(transaction, {
          tenantId: stream.tenantId,
          stationId: stream.stationId,
          tankId: stream.tankId,
          productId: stream.productId,
        });
      }
      const revenueRequestId = uuid.safeParse(context.requestId).success
        ? context.requestId
        : randomUUID();
      for (const candidate of revenueCandidates) {
        const revenue = await postCanonicalSaleRevenueInTransaction(transaction, {
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          stationId: context.stationId,
          businessDate: candidate.businessDate,
          productId: candidate.productId,
          tankId: candidate.tankId,
          nozzleId: candidate.nozzleId,
          shiftId: candidate.shiftId,
          meterSegmentId: candidate.segmentId,
          inventorySaleMovementId: candidate.movementId,
          reconciliationId: payload.reconciliationId,
          reconciliationRevisionId: revision.id,
          reconciliationMeterReadingId: candidate.readingId,
          quantityLitres: candidate.quantityLitres,
          unitPrice: candidate.unitPrice,
          currency: 'USD',
          effectiveAt: candidate.effectiveAt,
          actorMembershipId: context.actor.membershipId,
          requestId: revenueRequestId,
          classification: 'ORDINARY_FUEL_SALE',
          sourceType: 'METER_SEGMENT_SALE',
        });
        await ports.audit.append({
          transaction,
          context,
          commandType: 'SaleRevenuePosted',
          subjectType: 'SaleRecognitionMovement',
          subjectId: revenue.id,
          after: {
            reconciliationId: payload.reconciliationId,
            reconciliationRevisionId: revision.id,
            reconciliationMeterReadingId: candidate.readingId,
            meterSegmentId: candidate.segmentId,
            inventorySaleMovementId: candidate.movementId,
            quantityLitres: revenue.quantityLitres,
            recognizedRevenueAmount: revenue.recognizedRevenueAmount,
            currency: revenue.currency,
            effectiveAt: new Date(revenue.effectiveAt).toISOString(),
          },
          provenance: {
            actorId: context.actor.actorId,
            membershipId: context.actor.membershipId,
            tenantId: context.tenantId,
            stationId: context.stationId,
            requestId: context.requestId,
          },
        });
      }
      const now = await serverNow(transaction);
      const updated = await transaction.execute<{ version: number }>(sql`
        update app.reconciliations set state='APPROVED', approved_by=${context.actor.membershipId}, approved_at=${now}::timestamptz, version=version+1, updated_at=${now}::timestamptz
        where tenant_id=${context.tenantId} and station_id=${context.stationId} and id=${payload.reconciliationId} and version=${payload.expectedVersion} and state='SUBMITTED'
        returning version
      `);
      if (!updated[0]) throw new AppError('CONFLICT', 'The reconciliation approval became stale');
      const approvedRevision = await transaction.execute<{ id: string }>(sql`
        update app.reconciliation_revisions
        set source_segment_ids=${JSON.stringify(sourceSegmentIds)}::jsonb,
            state='APPROVED', approved_by=${context.actor.membershipId}, approved_at=${now}::timestamptz,
            version=version+1
        where tenant_id=${context.tenantId}
          and station_id=${context.stationId}
          and id=${revision.id}
          and state='PENDING_APPROVAL'
        returning id
      `);
      if (!approvedRevision[0])
        throw new AppError('CONFLICT', 'The reconciliation revision became stale');
      return {
        result: {
          reconciliationId: payload.reconciliationId,
          state: 'APPROVED' as const,
          version: Number(updated[0].version),
          saleMovementIds,
        },
        after: { state: 'APPROVED', saleMovementIds },
      };
    },
  });
}

async function transitionProductionReconciliation(
  request: Request,
  payload: z.infer<typeof basePayload> & { reason?: string },
  commandType: 'SubmitProductionReconciliation' | 'ReturnProductionReconciliation',
  nextState: 'SUBMITTED' | 'RETURNED',
  reason?: string,
) {
  const key = request.headers.get('idempotency-key')?.trim();
  if (!key) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  const context = await contextFor(request, payload);
  return executeForecourtCommand({
    context,
    commandType,
    idempotencyKey: key,
    requestHash: requestHash(payload),
    subjectType: 'Reconciliation',
    subjectId: payload.reconciliationId,
    expectedVersion: payload.expectedVersion,
    reason,
    ports: databaseForecourtPorts(),
    execute: async (transaction) => {
      const header = await loadHeader(transaction, context, payload.reconciliationId);
      let metrics: Awaited<ReturnType<typeof loadMetrics>> | undefined;
      if (nextState === 'SUBMITTED') {
        if (header.state !== 'DRAFT' && header.state !== 'RETURNED')
          throw new AppError(
            'CONFLICT',
            'Only a draft or returned reconciliation can be submitted',
          );
        metrics = await loadMetrics(transaction, context, payload.reconciliationId);
        await requireExplanations(transaction, context, payload.reconciliationId, metrics);
      } else if (header.state !== 'SUBMITTED') {
        throw new AppError('CONFLICT', 'Only a submitted reconciliation can be returned');
      }
      const now = await serverNow(transaction);
      const update =
        nextState === 'SUBMITTED'
          ? sql`update app.reconciliations set state='SUBMITTED', submitted_by=${context.actor.membershipId}, submitted_at=${now}::timestamptz, returned_by=null, returned_at=null, return_reason=null, version=version+1, updated_at=${now}::timestamptz where tenant_id=${context.tenantId} and station_id=${context.stationId} and id=${payload.reconciliationId} and version=${payload.expectedVersion} returning version`
          : sql`update app.reconciliations set state='RETURNED', returned_by=${context.actor.membershipId}, returned_at=${now}::timestamptz, return_reason=${reason}, version=version+1, updated_at=${now}::timestamptz where tenant_id=${context.tenantId} and station_id=${context.stationId} and id=${payload.reconciliationId} and version=${payload.expectedVersion} returning version`;
      const updated = await transaction.execute<{ version: number }>(update);
      if (!updated[0]) throw new AppError('CONFLICT', 'The reconciliation state became stale');
      if (nextState === 'SUBMITTED' && header.state === 'RETURNED') {
        const revisionId = randomUUID();
        await transaction.execute(sql`
          insert into app.reconciliation_revisions
            (id, tenant_id, station_id, reconciliation_id, revision, state, expected_sales,
             accounted_sales, variance, currency, variance_classification, source_segment_ids,
             source_shift_ids)
          select ${revisionId}, tenant_id, station_id, reconciliation_id, coalesce(max(revision), 0) + 1,
                 'READY', ${metrics!.sales.toString()}, ${metrics!.payments.toString()},
                 ${metrics!.salesVariance.toString()}, 'USD',
                 ${metrics!.salesVariance.value.isZero() ? 'INFORMATIONAL' : 'REQUIRES_EXPLANATION'},
                 '[]'::jsonb, coalesce(
                   (
                     select source_shift_ids
                     from app.reconciliation_revisions latest
                     where latest.tenant_id=${context.tenantId}
                       and latest.station_id=${context.stationId}
                       and latest.reconciliation_id=${payload.reconciliationId}
                     order by latest.revision desc
                     limit 1
                   ),
                   '[]'::jsonb
                 )
          from app.reconciliation_revisions
          where tenant_id=${context.tenantId} and station_id=${context.stationId}
            and reconciliation_id=${payload.reconciliationId}
          group by tenant_id, station_id, reconciliation_id
        `);
        await transaction.execute(sql`
          update app.reconciliation_revisions
          set state='SUBMITTED', submitted_by=${context.actor.membershipId}, submitted_at=${now}::timestamptz, version=version+1
          where tenant_id=${context.tenantId} and station_id=${context.stationId} and id=${revisionId}
        `);
        await transaction.execute(sql`
          update app.reconciliation_revisions
          set state='PENDING_APPROVAL', version=version+1
          where tenant_id=${context.tenantId} and station_id=${context.stationId} and id=${revisionId} and state='SUBMITTED'
        `);
      } else {
        if (nextState === 'SUBMITTED') {
          await transaction.execute(sql`
            update app.reconciliation_revisions set state='SUBMITTED', expected_sales=${metrics!.sales.toString()}, accounted_sales=${metrics!.payments.toString()}, variance=${metrics!.salesVariance.toString()}, variance_classification=${metrics!.salesVariance.value.isZero() ? 'INFORMATIONAL' : 'REQUIRES_EXPLANATION'}, submitted_by=${context.actor.membershipId}, submitted_at=${now}::timestamptz, version=version+1
            where tenant_id=${context.tenantId} and station_id=${context.stationId} and reconciliation_id=${payload.reconciliationId} and state='READY'
          `);
          await transaction.execute(sql`
            update app.reconciliation_revisions set state='PENDING_APPROVAL', version=version+1
            where tenant_id=${context.tenantId} and station_id=${context.stationId} and reconciliation_id=${payload.reconciliationId} and state='SUBMITTED'
          `);
        } else {
          await transaction.execute(sql`
            update app.reconciliation_revisions set state='RETURNED', version=version+1
            where tenant_id=${context.tenantId} and station_id=${context.stationId} and reconciliation_id=${payload.reconciliationId} and state in ('SUBMITTED','PENDING_APPROVAL')
          `);
        }
      }
      return {
        result: {
          reconciliationId: payload.reconciliationId,
          state: nextState,
          version: Number(updated[0].version),
        },
        after: { state: nextState, reason: reason ?? null },
      };
    },
  });
}

export async function getProductionReconciliationFromRequest(
  request: Request,
  input: { tenantId: string; stationId: string; reconciliationId: string },
) {
  const context = await contextFor(request, input);
  authorize({
    actor: context.authority.authorization,
    permissionCode: 'reconciliation.view',
    requestedScope: context.scope,
  });
  return withQueryTransaction(context, async (transaction) => {
    const header = await loadHeader(transaction, context, input.reconciliationId);
    const [attendants, readings, payments, expenses, deliveries, dips, cash, explanations] =
      await Promise.all([
        transaction.execute<RecordData['attendants'][number]>(
          sql`select attendant_id as "attendantId" from app.reconciliation_attendants where tenant_id=${context.tenantId} and station_id=${context.stationId} and reconciliation_id=${input.reconciliationId} order by attendant_id`,
        ),
        transaction.execute<RecordData['readings'][number]>(
          sql`select id, nozzle_id as "nozzleId", product_id as "productId", shift_id as "shiftId", opening_reading as "openingReading", closing_reading as "closingReading", litres_sold as "litresSold", selling_price_id as "sellingPriceId", unit_price as "unitPrice", sales_value as "salesValue" from app.reconciliation_meter_readings where tenant_id=${context.tenantId} and station_id=${context.stationId} and reconciliation_id=${input.reconciliationId} order by id`,
        ),
        transaction.execute<RecordData['payments'][number]>(
          sql`select id, method, amount, reference, note, customer_account_id as "customerAccountId", beneficiary_name as "beneficiaryName" from app.reconciliation_payments where tenant_id=${context.tenantId} and station_id=${context.stationId} and reconciliation_id=${input.reconciliationId} order by id`,
        ),
        transaction.execute<RecordData['expenses'][number]>(
          sql`select id, category, description, amount, payment_method as "paymentMethod", person_paid as "personPaid", reference from app.reconciliation_expenses where tenant_id=${context.tenantId} and station_id=${context.stationId} and reconciliation_id=${input.reconciliationId} order by id`,
        ),
        transaction.execute<RecordData['deliveries'][number]>(
          sql`select r.delivery_id as "deliveryId", r.allocation_id as "allocationId", r.product_id as "productId", r.tank_id as "tankId", d.delivery_note_number as "deliveryNoteNumber", d.actual_quantity_litres as "actualQuantityLitres" from app.reconciliation_delivery_refs r join app.fuel_deliveries d on d.tenant_id=r.tenant_id and d.station_id=r.station_id and d.id=r.delivery_id where r.tenant_id=${context.tenantId} and r.station_id=${context.stationId} and r.reconciliation_id=${input.reconciliationId} order by r.id`,
        ),
        transaction.execute<RecordData['dips'][number]>(
          sql`select r.dip_id as "dipId", r.tank_id as "tankId", r.product_id as "productId", d.physical_litres as "physicalLitres", d.measured_at as "measuredAt" from app.reconciliation_dip_refs r join app.tank_dips d on d.tenant_id=r.tenant_id and d.station_id=r.station_id and d.id=r.dip_id where r.tenant_id=${context.tenantId} and r.station_id=${context.stationId} and r.reconciliation_id=${input.reconciliationId} order by r.id`,
        ),
        transaction.execute<NonNullable<RecordData['cash']>>(
          sql`select counted_cash as "countedCash", expected_physical_cash as "expectedPhysicalCash", cash_paid_expenses as "cashPaidExpenses", net_expected_cash as "netExpectedCash", cash_variance as "cashVariance" from app.reconciliation_cash_declarations where tenant_id=${context.tenantId} and station_id=${context.stationId} and reconciliation_id=${input.reconciliationId}`,
        ),
        transaction.execute<RecordData['explanations'][number]>(
          sql`select category, explanation from app.reconciliation_variance_explanations where tenant_id=${context.tenantId} and station_id=${context.stationId} and reconciliation_id=${input.reconciliationId} order by category`,
        ),
      ]);
    const tanks = await transaction.execute<RecordData['tanks'][number]>(sql`
      select t.id as "tankId", t.code, t.product_id as "productId", p.name as "productName",
        t.capacity_litres::text as "capacityLitres",
        t.acceptable_variance_litres::text as "toleranceLitres",
        t.variance_red_litres::text as "redLitres",
        exists (select 1 from app.tank_calibration_points c
          where c.tenant_id = t.tenant_id and c.tank_id = t.id and c.measurement_unit = 'mm') as "hasMillimetreChart"
      from app.tanks t join app.products p on p.tenant_id = t.tenant_id and p.id = t.product_id
      where t.tenant_id=${context.tenantId} and t.station_id=${context.stationId} and t.status='ACTIVE'
      order by p.name, t.code
    `);
    const metrics = await loadMetrics(transaction, context, input.reconciliationId);
    // Tells the review page to hide Approve from the person who submitted the day, using the same
    // rule the approve command enforces.
    const submitter = await transaction.execute<{ submitted_by: string | null }>(sql`
      select submitted_by
      from app.reconciliations
      where tenant_id=${context.tenantId}
        and station_id=${context.stationId}
        and id=${input.reconciliationId}
    `);
    const approvalBlocked =
      header.state === 'SUBMITTED' &&
      submitter[0]?.submitted_by === context.actor.membershipId &&
      (await hasAlternateApprover(transaction, {
        tenantId: context.tenantId,
        stationId: context.stationId,
        excludeMembershipId: context.actor.membershipId,
        permission: 'reconciliation.approve',
      }));
    // Who can be charged at this station, with what they may still spend, so a credit or prepaid
    // row can be entered by name and the person sees the room left before saving.
    const customerAccounts = await transaction.execute<RecordData['customerAccounts'][number]>(sql`
      select a.id, c.display_name as name, a.account_type as "accountType",
        case when a.account_type = 'CREDIT'
          then greatest(coalesce(a.credit_limit, 0) - coalesce(b.balance, 0), 0)::text
          else greatest(coalesce(b.balance, 0), 0)::text end as available
      from app.customer_accounts a
      join app.customers c on c.tenant_id = a.tenant_id and c.id = a.customer_id
      left join lateral (
        select sum(case when l.direction = 'INCREASE' then l.amount else -l.amount end) as balance
        from app.customer_ledger_entries l
        where l.tenant_id = a.tenant_id and l.account_id = a.id
      ) b on true
      where a.tenant_id = ${context.tenantId} and a.status = 'ACTIVE' and c.status = 'ACTIVE'
        and a.account_type in ('CREDIT', 'PREPAID_VALUE')
        and (a.station_scope = 'ALL' or exists (
          select 1 from app.customer_account_stations s
          where s.tenant_id = a.tenant_id and s.account_id = a.id
            and s.station_id = ${context.stationId} and s.active))
      order by c.display_name, a.account_type
    `);
    return {
      ...header,
      version: Number(header.version),
      approvalBlocked,
      customerAccounts,
      attendants,
      readings,
      payments,
      expenses,
      deliveries,
      dips,
      tanks,
      cash: cash[0] ?? null,
      explanations,
      totals: {
        expectedSales: metrics.sales.toString(),
        accountedSales: metrics.payments.toString(),
        salesVariance: metrics.salesVariance.toString(),
        cashVariance: metrics.cashVariance?.toString() ?? null,
        stockVariance: metrics.stockVariance,
      },
    };
  });
}

async function withQueryTransaction<T>(
  context: ForecourtCommandContext,
  work: (transaction: ForecourtTransaction) => Promise<T>,
): Promise<T> {
  return withTenantTransaction(context.authority.transaction, work);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}
