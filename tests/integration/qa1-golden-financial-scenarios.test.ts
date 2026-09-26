import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { ExactDecimal } from '../../src/platform/domain/primitives';
import { createQa1ScenarioContext, QA1_TIMES, type Qa1ScenarioContext } from './qa1/fixture';
import {
  cash,
  confirmDelivery,
  createApprovedSale,
  createDelivery,
  currentRevision,
  forecourt,
  inventory,
  openBusinessDayAndShift,
  postOpeningPosition,
  recordReceiptCost,
  sealMeterSegments,
  startShift,
  supplier,
  customer,
  settlement,
} from './qa1/commands';
import {
  expectConservation,
  expectDecimal,
  expectNoAuthoritativeChange,
  expectOne,
  expectStatus,
} from './qa1/assertions';
import { withAuditFailure } from './qa1/fault-injection';
import { snapshotQa1 } from './qa1/snapshots';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for QA1 integration tests.');

let client: Sql;

function id(body: Record<string, any>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string')
    throw new Error(`QA1 command did not return ${field}: ${JSON.stringify(body)}`);
  return value;
}

async function rows<T>(sql: Sql, query: string): Promise<T[]> {
  return sql.unsafe<T[]>(query);
}

async function createSupplier(ctx: Qa1ScenarioContext, key: string): Promise<string> {
  const result = await supplier(
    ctx,
    {
      commandType: 'CreateSupplier',
      tenantId: ctx.tenantId,
      legalEntityId: ctx.legalEntityId,
      code: `QA1-SUP-${ctx.runId.slice(0, 8)}`,
      legalName: 'QA1 Fuel Supplier',
    },
    key,
  );
  expectStatus(result, 201);
  return id(result.body, 'supplierId');
}

describe('QA1 cross-module golden financial scenarios', () => {
  beforeAll(() => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.BETTER_AUTH_SECRET ??= 'integration-only-better-auth-secret-32-bytes';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-qa1-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-qa1-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
  });

  afterAll(async () => client?.end());

  it('G7 proves retry, conflict, version, isolation, permission, currency, and rollback atomicity', async () => {
    const ctx = await createQa1ScenarioContext(client, 'g7');
    const openBody = {
      commandType: 'OpenBusinessDay',
      tenantId: ctx.tenantId,
      stationId: ctx.stationId,
      businessDayId: ctx.businessDayId,
      expectedVersion: 0,
    };
    const first = await forecourt(ctx, openBody, 'g7-open-day');
    expectStatus(first, 200);
    const retry = await forecourt(ctx, openBody, 'g7-open-day');
    expectStatus(retry, 200);
    expect(retry.body).toEqual(first.body);

    const beforeConflict = await snapshotQa1(client, ctx);
    expect(
      beforeConflict.idempotency.filter((row) => row.idempotency_key === 'g7-open-day'),
    ).toHaveLength(1);
    const conflict = await forecourt(ctx, { ...openBody, expectedVersion: 1 }, 'g7-open-day');
    expect(conflict.response.status).toBe(409);
    const afterConflict = await snapshotQa1(client, ctx);
    expectNoAuthoritativeChange(beforeConflict, afterConflict);

    const stale = await forecourt(ctx, openBody, 'g7-stale-version');
    expect(stale.response.status).toBe(409);
    const crossTenant = await forecourt(
      ctx,
      { ...openBody, tenantId: ctx.otherTenantId },
      'g7-cross-tenant',
      'admin',
    );
    expect(crossTenant.response.status).toBe(403);
    const crossStation = await forecourt(
      ctx,
      { ...openBody, stationId: ctx.outsideStationId },
      'g7-cross-station',
      'supervisor',
    );
    expect(crossStation.response.status).toBe(403);
    const denied = await forecourt(ctx, openBody, 'g7-permission-denied', 'attendant');
    expect(denied.response.status).toBe(403);
    expectNoAuthoritativeChange(beforeConflict, await snapshotQa1(client, ctx));

    const provider = await settlement(
      ctx,
      {
        commandType: 'CreatePaymentProvider',
        tenantId: ctx.tenantId,
        stationId: ctx.stationId,
        code: `QA1-EUR-${ctx.runId.slice(0, 8)}`,
        name: 'QA1 EUR Provider',
        providerType: 'OTHER_ELECTRONIC',
      },
      'g7-provider',
      'admin',
    );
    expectStatus(provider, 201);
    const account = await settlement(
      ctx,
      {
        commandType: 'ConfigureProviderAccount',
        tenantId: ctx.tenantId,
        stationId: ctx.stationId,
        providerId: id(provider.body, 'providerId'),
        accountReference: `QA1-EUR-ACCOUNT-${ctx.runId.slice(0, 8)}`,
        displayName: 'QA1 EUR account',
        currency: 'EUR',
        accountStationId: ctx.stationId,
      },
      'g7-provider-account',
      'admin',
    );
    expectStatus(account, 201);
    const beforeCurrency = await snapshotQa1(client, ctx);
    const currencyMismatch = await settlement(
      ctx,
      {
        commandType: 'RecordProviderSettlement',
        tenantId: ctx.tenantId,
        stationId: ctx.stationId,
        providerAccountId: id(account.body, 'providerAccountId'),
        settlementReference: `QA1-EUR-SETTLEMENT-${ctx.runId.slice(0, 8)}`,
        batchReference: null,
        transactionDate: ctx.businessDate,
        settlementDate: ctx.businessDate,
        currency: 'USD',
        grossAmount: '10.0000',
        providerFeeAmount: '0.0000',
        providerDeductionAmount: '0.0000',
        reportedNetAmount: '10.0000',
        sourceType: 'MANUAL',
        sourceKey: `qa1-eur-${ctx.runId}`,
      },
      'g7-currency-mismatch',
    );
    expect(currencyMismatch.response.status).toBe(400);
    const afterCurrency = await snapshotQa1(client, ctx);
    expectNoAuthoritativeChange(beforeCurrency, afterCurrency);

    const rollbackCtx = await createQa1ScenarioContext(client, 'g7-rollback');
    const beforeRollback = await snapshotQa1(client, rollbackCtx);
    const failed = await withAuditFailure(client, () =>
      forecourt(
        rollbackCtx,
        {
          commandType: 'OpenBusinessDay',
          tenantId: rollbackCtx.tenantId,
          stationId: rollbackCtx.stationId,
          businessDayId: rollbackCtx.businessDayId,
          expectedVersion: 0,
        },
        'g7-faulted-open',
      ),
    );
    expect(failed.response.status).toBe(500);
    const afterRollback = await snapshotQa1(client, rollbackCtx);
    expectNoAuthoritativeChange(beforeRollback, afterRollback);
    const cleanRetry = await forecourt(
      rollbackCtx,
      {
        commandType: 'OpenBusinessDay',
        tenantId: rollbackCtx.tenantId,
        stationId: rollbackCtx.stationId,
        businessDayId: rollbackCtx.businessDayId,
        expectedVersion: 0,
      },
      'g7-faulted-open',
    );
    expectStatus(cleanRetry, 200);
    const rollbackDay = await rows<{ state: string; version: number }>(
      client,
      `select state, version from app.station_business_days where id='${rollbackCtx.businessDayId}'`,
    );
    expect(rollbackDay).toEqual([{ state: 'OPEN', version: 1 }]);
  });

  it('G2 proves late cost revaluation, blocked sale atomicity, and corrected future COGS', async () => {
    const ctx = await createQa1ScenarioContext(client, 'g2');
    const historical = await createApprovedSale(client, ctx, 'g2-historical', {
      saleLitres: '100.000',
      payments: [{ method: 'CASH', amount: '250.0000' }],
      post: true,
      completeShiftAfter: true,
    });
    const originalMovement = await rows<Record<string, any>>(
      client,
      `select * from app.inventory_movements where id in ('${historical.saleMovementIds.join("','")}')`,
    );
    const originalCogs = await rows<Record<string, any>>(
      client,
      `select * from app.inventory_cost_events where source_type='METER_SEGMENT_SALE' and source_id in ('${historical.segmentIds.join("','")}')`,
    );
    const originalAttribution = await rows<Record<string, any>>(
      client,
      `select * from app.inventory_sale_cost_attributions where meter_segment_id in ('${historical.segmentIds.join("','")}')`,
    );
    const beforeLateCost = await snapshotQa1(client, ctx);
    const delivery = await createDelivery(ctx, 'g2-late', {
      quantityLitres: '100.000',
      deliveredAt: '2026-09-25T23:30:00.000Z',
    });
    await confirmDelivery(ctx, delivery.deliveryId, 'g2-late-confirm');
    const unvalued = await rows<{
      valuation_status: string;
      inventory_value: string | null;
      weighted_average_cost: string | null;
    }>(
      client,
      `select valuation_status, inventory_value, weighted_average_cost from app.inventory_cost_stream_state where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}' and tank_id='${ctx.tankId}' and product_id='${ctx.productId}'`,
    );
    expect(unvalued).toEqual([
      { valuation_status: 'UNVALUED', inventory_value: null, weighted_average_cost: null },
    ]);

    const nextShift = await startShift(ctx, 'g2-blocked');
    const blocked = await createApprovedSale(client, ctx, 'g2-blocked-reconciliation', {
      saleLitres: '100.000',
      payments: [{ method: 'CASH', amount: '250.0000' }],
      post: false,
      completeShiftAfter: true,
      existingShiftId: nextShift.shiftId,
      openingReading: '100100.000',
      segmentBoundaryTimes: [QA1_TIMES.blockedSegmentOpen, QA1_TIMES.blockedSegmentClose],
      approve: false,
    }).catch((error: unknown) => ({ error }));
    if ('error' in blocked) throw blocked.error;
    const blockedRevision = await currentRevision(client, ctx, blocked.reconciliationId);
    const blockedBefore = await snapshotQa1(client, ctx);
    const rejected = await forecourt(
      ctx,
      {
        commandType: 'ApproveProductionReconciliation',
        tenantId: ctx.tenantId,
        stationId: ctx.stationId,
        reconciliationId: blocked.reconciliationId,
        expectedVersion: blockedRevision.version,
      },
      'g2-blocked-approve',
      'admin',
    );
    expect(rejected.response.status).toBe(409);
    const blockedAfter = await snapshotQa1(client, ctx);
    expectNoAuthoritativeChange(blockedBefore, blockedAfter);

    const request = await inventory(
      ctx,
      {
        commandType: 'RequestInventoryCostRevaluation',
        tenantId: ctx.tenantId,
        stationId: ctx.stationId,
        tankId: ctx.tankId,
        productId: ctx.productId,
        sourceType: 'FUEL_DELIVERY_ALLOCATION',
        sourceId: delivery.allocationId,
        amount: '200.0000',
        currency: 'USD',
        reason: 'QA1 late supplier cost',
      },
      'g2-revaluation-request',
    );
    expectStatus(request, 200);
    const revaluationId = id(request.body, 'revaluationId');
    const approved = await inventory(
      ctx,
      {
        commandType: 'ApproveInventoryCostRevaluation',
        tenantId: ctx.tenantId,
        stationId: ctx.stationId,
        revaluationId,
      },
      'g2-revaluation-approve',
    );
    expectStatus(approved, 200);
    const posted = await inventory(
      ctx,
      {
        commandType: 'PostInventoryCostRevaluation',
        tenantId: ctx.tenantId,
        stationId: ctx.stationId,
        revaluationId,
      },
      'g2-revaluation-post',
    );
    expectStatus(posted, 200);

    const projection = expectOne(
      await rows<Record<string, any>>(
        client,
        `select quantity_litres, inventory_value, weighted_average_cost, valuation_status from app.inventory_cost_stream_state where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}' and tank_id='${ctx.tankId}' and product_id='${ctx.productId}'`,
      ),
      'QA1 cost projection',
    );
    expectDecimal(projection.quantity_litres, '1000.000', 'revalued quantity');
    expectDecimal(projection.inventory_value, '1090.9091', 'revalued inventory value');
    expectDecimal(projection.weighted_average_cost, '1.09090917', 'revalued WAC');
    expect(projection.valuation_status).toBe('VALUED');
    const revaluationSnapshot = await snapshotQa1(client, ctx);
    const revaluationEnvelope = expectOne(revaluationSnapshot.revaluations, 'revaluation envelope');
    expect(revaluationEnvelope).toMatchObject({ id: revaluationId, status: 'POSTED' });
    expect(revaluationSnapshot.revaluationLines.length).toBeGreaterThanOrEqual(1);
    const revaluationAudit = revaluationSnapshot.audit.filter((row) =>
      row.event_code.startsWith('INVENTORY.COST_REVALUATION_'),
    );
    expect(revaluationAudit).toHaveLength(3);
    expect(
      revaluationAudit.every((row) => row.membership_id === ctx.actors.admin.membershipId),
    ).toBe(true);
    const revaluationLines = revaluationSnapshot.revaluationLines.filter(
      (line) => line.revaluation_id === revaluationId,
    );
    expect(revaluationLines.length).toBeGreaterThanOrEqual(1);
    const cogsDelta = revaluationLines.reduce(
      (sum, line) => sum.add(new ExactDecimal(line.cogs_delta)),
      new ExactDecimal('0'),
    );
    const preLateProjection = expectOne(beforeLateCost.costProjection, 'pre-late cost projection');
    const postLateProjection = expectOne(
      revaluationSnapshot.costProjection,
      'post-revaluation cost projection',
    );
    const endingInventoryResidual = new ExactDecimal(postLateProjection.inventory_value).subtract(
      new ExactDecimal(preLateProjection.inventory_value),
    );
    const lateCostAmount = new ExactDecimal(revaluationEnvelope.amount);
    expectConservation(
      [cogsDelta.toString(), endingInventoryResidual.toString()],
      lateCostAmount.toString(),
      'late cost conservation',
    );
    expectDecimal(cogsDelta.toString(), '9.0909', 'COGS revaluation delta');
    const revaluationEvents = revaluationSnapshot.costEvents.filter(
      (event) =>
        event.event_type === 'COGS_REVALUATION' &&
        event.source_type === 'INVENTORY_COST_REVALUATION_LINE' &&
        revaluationLines.some((line) => line.id === event.source_id),
    );
    expect(revaluationEvents).toHaveLength(revaluationLines.length);
    const revaluationEventById = new Map(revaluationEvents.map((event) => [event.id, event]));
    expect(revaluationLines.map((line) => line.cogs_revaluation_event_id).sort()).toEqual(
      revaluationEvents.map((event) => event.id).sort(),
    );
    expect(revaluationEvents.map((event) => event.source_id).sort()).toEqual(
      revaluationLines.map((line) => line.id).sort(),
    );
    for (const line of revaluationLines) {
      expect(revaluationEventById.get(line.cogs_revaluation_event_id)).toMatchObject({
        id: line.cogs_revaluation_event_id,
        source_id: line.id,
        amount: line.cogs_delta,
      });
    }
    expectDecimal(
      revaluationEvents
        .reduce((sum, event) => sum.add(new ExactDecimal(event.amount)), new ExactDecimal('0'))
        .toString(),
      cogsDelta.toString(),
      'persisted COGS revaluation events',
    );

    expect(
      await rows<Record<string, any>>(
        client,
        `select * from app.inventory_movements where id in ('${historical.saleMovementIds.join("','")}')`,
      ),
    ).toEqual(originalMovement);
    expect(
      await rows<Record<string, any>>(
        client,
        `select * from app.inventory_sale_cost_attributions where meter_segment_id in ('${historical.segmentIds.join("','")}')`,
      ),
    ).toEqual(originalAttribution);
    expect(
      await rows<Record<string, any>>(
        client,
        `select * from app.inventory_cost_events where source_type='METER_SEGMENT_SALE' and source_id in ('${historical.segmentIds.join("','")}')`,
      ),
    ).toEqual(originalCogs);

    const futureShift = await startShift(ctx, 'g2-future');
    const future = await createApprovedSale(client, ctx, 'g2-future', {
      saleLitres: '100.000',
      payments: [{ method: 'CASH', amount: '250.0000' }],
      post: true,
      completeShiftAfter: true,
      existingShiftId: futureShift.shiftId,
      openingReading: '100200.000',
      segmentBoundaryTimes: [QA1_TIMES.futureSegmentOpen, QA1_TIMES.futureSegmentClose],
    });
    const futureCogs = expectOne(
      await rows<{ amount: string }>(
        client,
        `select amount::text as amount from app.inventory_cost_events where source_type='METER_SEGMENT_SALE' and source_id in ('${future.segmentIds.join("','")}')`,
      ),
      'future COGS',
    );
    expectDecimal(futureCogs.amount, '-109.0909', 'future corrected COGS');
  });

  it('G3 proves supplier liability, payment allocation, reversal, and A4 independence', async () => {
    const ctx = await createQa1ScenarioContext(client, 'g3');
    await postOpeningPosition(client, ctx, 'g3-opening');
    const delivery = await createDelivery(ctx, 'g3-delivery', {
      quantityLitres: '500.000',
      deliveredAt: QA1_TIMES.opening,
    });
    await confirmDelivery(ctx, delivery.deliveryId, 'g3-delivery-confirm');
    await recordReceiptCost(ctx, delivery.allocationId, '600.0000', 'g3-receipt-cost');
    const supplierId = await createSupplier(ctx, 'g3-create-supplier');
    const document = await supplier(
      ctx,
      {
        commandType: 'SubmitSupplierDocument',
        tenantId: ctx.tenantId,
        legalEntityId: ctx.legalEntityId,
        supplierId,
        documentType: 'INVOICE',
        referenceNumber: `QA1-INV-${ctx.runId.slice(0, 8)}`,
        documentDate: ctx.businessDate,
        amount: '600.0000',
        deliveryReferences: [{ stationId: ctx.stationId, deliveryId: delivery.deliveryId }],
      },
      'g3-submit-invoice',
    );
    expectStatus(document, 201);
    const documentId = id(document.body, 'documentId');
    expectStatus(
      await supplier(
        ctx,
        {
          commandType: 'PostSupplierDocument',
          tenantId: ctx.tenantId,
          legalEntityId: ctx.legalEntityId,
          documentId,
          expectedVersion: 0,
        },
        'g3-post-invoice',
      ),
      200,
    );
    const payment = await supplier(
      ctx,
      {
        commandType: 'SubmitSupplierPayment',
        tenantId: ctx.tenantId,
        legalEntityId: ctx.legalEntityId,
        supplierId,
        paymentDate: ctx.businessDate,
        reference: `QA1-PAY-${ctx.runId.slice(0, 8)}`,
        amount: '600.0000',
      },
      'g3-submit-payment',
    );
    expectStatus(payment, 201);
    const paymentId = id(payment.body, 'paymentId');
    expectStatus(
      await supplier(
        ctx,
        {
          commandType: 'PostSupplierPayment',
          tenantId: ctx.tenantId,
          legalEntityId: ctx.legalEntityId,
          paymentId,
          expectedVersion: 0,
        },
        'g3-post-payment',
      ),
      200,
    );
    expectStatus(
      await supplier(
        ctx,
        {
          commandType: 'AllocateSupplierPayment',
          tenantId: ctx.tenantId,
          legalEntityId: ctx.legalEntityId,
          paymentId,
          expectedVersion: 1,
          allocations: [{ documentId, amount: '600.0000' }],
        },
        'g3-allocate-payment',
      ),
      200,
    );
    expectStatus(
      await supplier(
        ctx,
        {
          commandType: 'ReverseSupplierPayment',
          tenantId: ctx.tenantId,
          legalEntityId: ctx.legalEntityId,
          paymentId,
          expectedVersion: 2,
          reason: 'QA1 reversal',
        },
        'g3-reverse-payment',
      ),
      200,
    );
    const supplierSnapshot = await snapshotQa1(client, ctx);
    const supplierAllocations = supplierSnapshot.supplierAllocations.filter(
      (allocation) => allocation.payment_id === paymentId,
    );
    expect(supplierAllocations).toHaveLength(2);
    const activeAllocation = expectOne(
      supplierAllocations.filter(
        (allocation) => allocation.state === 'POSTED' && allocation.reversal_of_id === null,
      ),
      'active supplier allocation',
    );
    const reversalAllocation = expectOne(
      supplierAllocations.filter((allocation) => allocation.state === 'REVERSED'),
      'supplier allocation reversal',
    );
    expect(activeAllocation).toMatchObject({
      payment_id: paymentId,
      document_id: documentId,
      amount: '600.0000',
      state: 'POSTED',
    });
    expect(reversalAllocation).toMatchObject({
      payment_id: paymentId,
      document_id: documentId,
      amount: '600.0000',
      state: 'REVERSED',
      reversal_of_id: activeAllocation.id,
    });
    expect(
      expectOne(
        supplierSnapshot.supplierPayments.filter((row) => row.id === paymentId),
        'persisted supplier payment',
      ),
    ).toMatchObject({
      id: paymentId,
      supplier_id: supplierId,
      amount: '600.0000',
      state: 'REVERSED',
    });
    expect(
      expectOne(
        supplierSnapshot.supplierDocuments.filter((row) => row.id === documentId),
        'persisted supplier document',
      ),
    ).toMatchObject({
      id: documentId,
      supplier_id: supplierId,
      amount: '600.0000',
      state: 'POSTED',
    });
    const movement = supplierSnapshot.supplierMovements.filter(
      (row) => row.supplier_id === supplierId,
    );
    expect(movement).toHaveLength(3);
    const invoiceMovement = expectOne(
      movement.filter(
        (row) =>
          row.movement_type === 'INVOICE' &&
          row.source_type === 'SUPPLIER_DOCUMENT' &&
          row.source_id === documentId,
      ),
      'supplier invoice movement',
    );
    const paymentMovement = expectOne(
      movement.filter(
        (row) =>
          row.movement_type === 'PAYMENT' &&
          row.source_type === 'SUPPLIER_PAYMENT' &&
          row.source_id === paymentId,
      ),
      'supplier payment movement',
    );
    const paymentReversalMovement = expectOne(
      movement.filter(
        (row) =>
          row.movement_type === 'PAYMENT_REVERSAL' &&
          row.source_type === 'SUPPLIER_PAYMENT_REVERSAL' &&
          row.source_id === paymentId,
      ),
      'supplier payment reversal movement',
    );
    expect(invoiceMovement.amount).toBe('600.0000');
    expect(paymentMovement.amount).toBe('600.0000');
    expect(paymentReversalMovement).toMatchObject({
      amount: '600.0000',
      reversal_of_id: paymentMovement.id,
    });
    expectConservation(
      [invoiceMovement.amount, `-${paymentMovement.amount}`, paymentReversalMovement.amount],
      '600.0000',
      'supplier payable after payment reversal',
    );
    const a4 = await rows<{ movement_type: string; quantity_litres: string }>(
      client,
      `select movement_type, quantity_litres::text as quantity_litres from app.inventory_movements where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}' and source_id in ('${delivery.deliveryId}', '${delivery.allocationId}') order by id`,
    );
    expect(a4.map((row) => row.movement_type)).toContain('DELIVERY');
    expectDecimal(
      a4.filter((row) => row.movement_type === 'DELIVERY')[0]!.quantity_litres,
      '500.000',
      'A4 delivery quantity',
    );
  });

  it('G4 keeps A5 cash evidence separate from A6 custody and banking evidence', async () => {
    const ctx = await createQa1ScenarioContext(client, 'g4');
    const sale = await createApprovedSale(client, ctx, 'g4-sale', {
      saleLitres: '240.000',
      payments: [{ method: 'CASH', amount: '600.0000' }],
      post: true,
      completeShiftAfter: true,
    });
    const before = await snapshotQa1(client, ctx);
    expect(before.cashCollections).toHaveLength(0);
    const collection = await cash(
      ctx,
      {
        commandType: 'RecordCashCollection',
        tenantId: ctx.tenantId,
        stationId: ctx.stationId,
        collectionReference: `QA1-COL-${ctx.runId.slice(0, 8)}`,
        sourceLocationId: ctx.tillId,
        sources: [{ reconciliationId: sale.reconciliationId, amount: '600.0000' }],
      },
      'g4-collect',
    );
    expectStatus(collection, 201);
    const collectionId = id(collection.body, 'collectionId');
    expectStatus(
      await cash(
        ctx,
        {
          commandType: 'ReceiveCashCollection',
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          collectionId,
          targetLocationId: ctx.safeId,
          expectedVersion: 0,
        },
        'g4-receive',
      ),
      200,
    );
    const deposit = await cash(
      ctx,
      {
        commandType: 'CreateBankDeposit',
        tenantId: ctx.tenantId,
        stationId: ctx.stationId,
        bankAccountId: ctx.bankAccountId,
        sourceLocationId: ctx.safeId,
        depositReference: `QA1-DEP-${ctx.runId.slice(0, 8)}`,
        allocations: [{ collectionId, amount: '600.0000' }],
      },
      'g4-deposit',
    );
    expectStatus(deposit, 201);
    const depositId = id(deposit.body, 'depositId');
    expectStatus(
      await cash(
        ctx,
        {
          commandType: 'ConfirmBankDeposit',
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          depositId,
          expectedVersion: 0,
          confirmedAmount: '600.0000',
          bankReference: `QA1-BANK-${ctx.runId.slice(0, 8)}`,
        },
        'g4-confirm',
      ),
      200,
    );
    const after = await snapshotQa1(client, ctx);
    expect(after.reconciliationPayments).toHaveLength(1);
    expect(after.cashCollections).toHaveLength(1);
    expect(after.cashCollectionAllocations).toEqual([
      expect.objectContaining({
        collection_id: collectionId,
        reconciliation_id: sale.reconciliationId,
        amount: '600.0000',
      }),
    ]);
    expect(after.cashMovements.length).toBeGreaterThanOrEqual(2);
    expect(after.bankDeposits).toHaveLength(1);
    expect(after.bankDepositAllocations).toEqual([
      expect.objectContaining({
        deposit_id: depositId,
        collection_id: collectionId,
        amount: '600.0000',
      }),
    ]);
    expectDecimal(after.bankDeposits[0]!.amount, '600.0000', 'bank deposit');
  });

  it('G5 links credit and prepaid value exactly once without creating duplicate fuel movements', async () => {
    const ctx = await createQa1ScenarioContext(client, 'g5');
    const sale = await createApprovedSale(client, ctx, 'g5-sale', {
      saleLitres: '30.000',
      payments: [
        { method: 'CUSTOMER_CREDIT', amount: '50.0000' },
        { method: 'PREPAID', amount: '25.0000' },
      ],
      post: true,
      completeShiftAfter: true,
    });
    const customerResult = await customer(
      ctx,
      {
        commandType: 'CreateCustomer',
        tenantId: ctx.tenantId,
        accountReference: `QA1-CUST-${ctx.runId.slice(0, 8)}`,
        displayName: 'QA1 Customer',
      },
      'g5-customer',
    );
    expectStatus(customerResult, 201);
    const customerId = id(customerResult.body, 'customerId');
    const credit = await customer(
      ctx,
      {
        commandType: 'CreateCustomerAccount',
        tenantId: ctx.tenantId,
        customerId,
        accountType: 'CREDIT',
        currency: 'USD',
        creditLimit: '100.0000',
      },
      'g5-credit-account',
    );
    const prepaid = await customer(
      ctx,
      {
        commandType: 'CreateCustomerAccount',
        tenantId: ctx.tenantId,
        customerId,
        accountType: 'PREPAID_VALUE',
        currency: 'USD',
      },
      'g5-prepaid-account',
    );
    expectStatus(credit, 201);
    expectStatus(prepaid, 201);
    const prepaidAccountId = id(prepaid.body, 'accountId');
    expectStatus(
      await customer(
        ctx,
        {
          commandType: 'RecordPrepaidTopUp',
          tenantId: ctx.tenantId,
          accountId: prepaidAccountId,
          accountType: 'PREPAID_VALUE',
          amount: { amount: '125.3750', currency: 'USD' },
          source: { sourceType: 'PREPAID_TOPUP', sourceId: `${ctx.runId}` },
          occurredAt: QA1_TIMES.opening,
          businessDate: ctx.businessDate,
        },
        'g5-topup',
      ),
      201,
    );
    const revision = await currentRevision(client, ctx, sale.reconciliationId);
    for (const [suffix, accountId, accountType, litres, amount, method] of [
      ['credit', id(credit.body, 'accountId'), 'CREDIT', '10.000', '50.0000', 'CUSTOMER_CREDIT'],
      ['prepaid', prepaidAccountId, 'PREPAID_VALUE', '5.000', '25.0000', 'PREPAID'],
    ] as const) {
      const authorizationId = randomUUID();
      const requested = await customer(
        ctx,
        {
          commandType: 'RequestCustomerFuelAuthorization',
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          accountId,
          authorizationId,
          requested: { productId: ctx.productId, litres, amount: { amount, currency: 'USD' } },
          requestedAt: QA1_TIMES.futureSegmentOpen,
          source: {
            sourceType: 'A5_RECONCILIATION_CUSTOMER_FUEL',
            sourceId: sale.paymentIds[method]!,
            sourceRevisionId: revision.id,
          },
        },
        `g5-${suffix}-request`,
      );
      expectStatus(requested, 201);
      expectStatus(
        await customer(
          ctx,
          {
            commandType: 'AuthorizeCustomerFuel',
            tenantId: ctx.tenantId,
            stationId: ctx.stationId,
            authorizationId,
            expectedVersion: 0,
          },
          `g5-${suffix}-authorize`,
        ),
        200,
      );
      expectStatus(
        await customer(
          ctx,
          {
            commandType: 'CompleteCustomerFuelTransaction',
            tenantId: ctx.tenantId,
            stationId: ctx.stationId,
            accountId,
            authorizationId,
            entryId: randomUUID(),
            fuelAllocationId: randomUUID(),
            used: { productId: ctx.productId, litres, amount: { amount, currency: 'USD' } },
            evidence: {
              reconciliationId: sale.reconciliationId,
              reconciliationRevisionId: revision.id,
              paymentEvidenceId: sale.paymentIds[method]!,
            },
            occurredAt: QA1_TIMES.futureSegmentClose,
            businessDate: ctx.businessDate,
          },
          `g5-${suffix}-complete`,
        ),
        200,
      );
    }
    const snapshot = await snapshotQa1(client, ctx);
    expect(snapshot.customerAuthorizations).toHaveLength(2);
    expect(
      snapshot.customerLedger.filter(
        (row) => row.source_type === 'A5_RECONCILIATION_CUSTOMER_FUEL',
      ),
    ).toHaveLength(2);
    expect(snapshot.customerAuthorizations.map((row) => row.source_id).sort()).toEqual(
      [sale.paymentIds.CUSTOMER_CREDIT, sale.paymentIds.PREPAID].sort(),
    );
    expect(
      snapshot.customerLedger
        .filter((row) => row.source_type === 'A5_RECONCILIATION_CUSTOMER_FUEL')
        .map((row) => row.source_id)
        .sort(),
    ).toEqual([sale.paymentIds.CUSTOMER_CREDIT, sale.paymentIds.PREPAID].sort());
    expect(snapshot.inventoryMovements.filter((row) => row.movement_type === 'SALE')).toHaveLength(
      1,
    );
    expectDecimal(
      snapshot.inventoryMovements.find((row) => row.movement_type === 'SALE')!.quantity_litres,
      '-30.000',
      'customer sale litres',
    );
    const balance = (accountType: string) =>
      snapshot.customerLedger
        .filter((row) => row.account_type === accountType)
        .reduce(
          (sum, row) =>
            sum.add(
              row.direction === 'DECREASE'
                ? new ExactDecimal(`-${row.amount}`)
                : new ExactDecimal(row.amount),
            ),
          new ExactDecimal('0'),
        )
        .toString();
    expectDecimal(balance('CREDIT'), '50.0000', 'credit linkage');
    expectDecimal(balance('PREPAID_VALUE'), '100.3750', 'prepaid balance');
  });

  it('G6 matches POS and EcoCash evidence to one provider settlement', async () => {
    const ctx = await createQa1ScenarioContext(client, 'g6');
    const sale = await createApprovedSale(client, ctx, 'g6-sale', {
      saleLitres: '160.000',
      payments: [
        { method: 'POS', amount: '250.0000' },
        { method: 'ECOCASH', amount: '150.0000' },
      ],
      post: true,
      completeShiftAfter: true,
    });
    const provider = await settlement(
      ctx,
      {
        commandType: 'CreatePaymentProvider',
        tenantId: ctx.tenantId,
        stationId: ctx.stationId,
        code: `QA1-PROVIDER-${ctx.runId.slice(0, 8)}`,
        name: 'QA1 Provider',
        providerType: 'OTHER_ELECTRONIC',
      },
      'g6-provider',
      'admin',
    );
    expectStatus(provider, 201);
    const account = await settlement(
      ctx,
      {
        commandType: 'ConfigureProviderAccount',
        tenantId: ctx.tenantId,
        stationId: ctx.stationId,
        providerId: id(provider.body, 'providerId'),
        accountReference: `QA1-MERCHANT-${ctx.runId.slice(0, 8)}`,
        displayName: 'QA1 Merchant',
        currency: 'USD',
        accountStationId: ctx.stationId,
      },
      'g6-account',
      'admin',
    );
    expectStatus(account, 201);
    const recorded = await settlement(
      ctx,
      {
        commandType: 'RecordProviderSettlement',
        tenantId: ctx.tenantId,
        stationId: ctx.stationId,
        providerAccountId: id(account.body, 'providerAccountId'),
        settlementReference: `QA1-SETTLE-${ctx.runId.slice(0, 8)}`,
        batchReference: `QA1-BATCH-${ctx.runId.slice(0, 8)}`,
        transactionDate: ctx.businessDate,
        settlementDate: ctx.businessDate,
        currency: 'USD',
        grossAmount: '400.0000',
        providerFeeAmount: '4.0000',
        providerDeductionAmount: '1.0000',
        reportedNetAmount: '395.0000',
        sourceType: 'MANUAL',
        sourceKey: `qa1-settlement-${ctx.runId}`,
        sourceMetadata: {},
      },
      'g6-record',
    );
    expectStatus(recorded, 201);
    const settlementId = id(recorded.body, 'settlementId');
    for (const [index, method] of ['POS', 'ECOCASH'].entries()) {
      const allocation = await settlement(
        ctx,
        {
          commandType: 'AllocateProviderSettlement',
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          settlementId,
          reconciliationPaymentId: sale.paymentIds[method]!,
          amount: method === 'POS' ? '250.0000' : '150.0000',
          allocationKey: `qa1-allocation-${ctx.runId}-${method}`,
          expectedVersion: index,
        },
        `g6-allocate-${method}`,
      );
      expectStatus(allocation, 201);
    }
    expectStatus(
      await settlement(
        ctx,
        {
          commandType: 'ReconcileProviderSettlement',
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          settlementId,
          expectedVersion: 2,
          reason: null,
        },
        'g6-reconcile',
      ),
      200,
    );
    const snapshot = await snapshotQa1(client, ctx);
    const settlementRow = expectOne(snapshot.settlements, 'provider settlement');
    expect(settlementRow.state).toBe('RECONCILED');
    expect(snapshot.settlementAllocations).toHaveLength(2);
    expect(snapshot.settlementAllocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          settlement_id: settlementId,
          reconciliation_payment_id: sale.paymentIds.POS,
          amount: '250.0000',
          allocation_key: `qa1-allocation-${ctx.runId}-POS`,
          state: 'POSTED',
        }),
        expect.objectContaining({
          settlement_id: settlementId,
          reconciliation_payment_id: sale.paymentIds.ECOCASH,
          amount: '150.0000',
          allocation_key: `qa1-allocation-${ctx.runId}-ECOCASH`,
          state: 'POSTED',
        }),
      ]),
    );
    expectConservation(
      snapshot.settlementAllocations
        .filter((row) => row.state === 'POSTED')
        .map((row) => row.amount),
      '400.0000',
      'provider reconciled allocation',
    );
    // Allocation reversal is a tracked product gap: the current deferred A9
    // trigger rejects the reversal row because it matches the row being inserted.
  });
});
