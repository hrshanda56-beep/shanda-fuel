import type { Sql } from 'postgres';
import type { Qa1ScenarioContext } from './fixture';

export type Qa1Snapshot = {
  inventoryMovements: Array<Record<string, any>>;
  costEvents: Array<Record<string, any>>;
  attributions: Array<Record<string, any>>;
  revaluations: Array<Record<string, any>>;
  revaluationLines: Array<Record<string, any>>;
  costProjection: Array<Record<string, any>>;
  deliveries: Array<Record<string, any>>;
  reconciliations: Array<Record<string, any>>;
  revisions: Array<Record<string, any>>;
  reconciliationPayments: Array<Record<string, any>>;
  cashCollections: Array<Record<string, any>>;
  cashCollectionAllocations: Array<Record<string, any>>;
  cashMovements: Array<Record<string, any>>;
  bankDeposits: Array<Record<string, any>>;
  bankDepositAllocations: Array<Record<string, any>>;
  suppliers: Array<Record<string, any>>;
  supplierDocuments: Array<Record<string, any>>;
  supplierPayments: Array<Record<string, any>>;
  supplierAllocations: Array<Record<string, any>>;
  supplierMovements: Array<Record<string, any>>;
  customers: Array<Record<string, any>>;
  customerAccounts: Array<Record<string, any>>;
  customerLedger: Array<Record<string, any>>;
  customerAuthorizations: Array<Record<string, any>>;
  providers: Array<Record<string, any>>;
  providerAccounts: Array<Record<string, any>>;
  settlements: Array<Record<string, any>>;
  settlementAllocations: Array<Record<string, any>>;
  reportSourceIds: {
    reconciliationRevisionIds: string[];
    inventoryMovementIds: string[];
    deliveryIds: string[];
    settlementIds: string[];
  };
  audit: Array<Record<string, any>>;
  idempotency: Array<Record<string, any>>;
  outbox: Array<Record<string, any>>;
};

export async function snapshotQa1(client: Sql, ctx: Qa1ScenarioContext): Promise<Qa1Snapshot> {
  const [
    inventoryMovements,
    costEvents,
    attributions,
    revaluations,
    revaluationLines,
    costProjection,
    deliveries,
    reconciliations,
    revisions,
    reconciliationPayments,
    cashCollections,
    cashCollectionAllocations,
    cashMovements,
    bankDeposits,
    bankDepositAllocations,
    suppliers,
    supplierDocuments,
    supplierPayments,
    supplierAllocations,
    supplierMovements,
    customers,
    customerAccounts,
    customerLedger,
    customerAuthorizations,
    providers,
    providerAccounts,
    settlements,
    settlementAllocations,
    audit,
    idempotency,
    outbox,
  ] = await Promise.all([
    client.unsafe(`
      select id, tank_id, product_id, movement_type, quantity_litres::text as quantity_litres,
             effective_at, business_date, source_type, source_id
      from app.inventory_movements
      where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}'
      order by effective_at, id
    `),
    client.unsafe(`
      select id, tank_id, product_id, event_type, source_type, source_id,
             amount::text as amount, currency, effective_at, business_date
      from app.inventory_cost_events
      where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}'
      order by effective_at, id
    `),
    client.unsafe(`
      select id, inventory_movement_id, meter_segment_id, sale_cost_event_id,
             sale_quantity_litres::text as sale_quantity_litres,
             pre_sale_wac::text as pre_sale_wac, original_cogs::text as original_cogs,
             valuation_status, valuation_basis, replay_fingerprint
      from app.inventory_sale_cost_attributions
      where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}'
      order by effective_at, id
    `),
    client.unsafe(`
      select id, status, source_type, source_id, amount::text as amount, currency
      from app.inventory_cost_revaluations
      where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}'
      order by id
    `),
    client.unsafe(`
      select id, revaluation_id, sale_movement_id, original_cogs::text as original_cogs,
             cogs_delta::text as cogs_delta, cogs_revaluation_event_id
      from app.inventory_cost_revaluation_lines
      where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}'
      order by sale_effective_at, id
    `),
    client.unsafe(`
      select tank_id, product_id, quantity_litres::text as quantity_litres,
             inventory_value::text as inventory_value,
             weighted_average_cost::text as weighted_average_cost,
             currency, valuation_status, projection_version
      from app.inventory_cost_stream_state
      where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}'
      order by tank_id, product_id
    `),
    client.unsafe(`
      select id, product_id, delivery_note_number, delivered_at, business_date,
             note_quantity_litres::text as note_quantity_litres,
             actual_quantity_litres::text as actual_quantity_litres,
             status, currency
      from app.fuel_deliveries
      where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}'
      order by delivered_at, id
    `),
    client.unsafe(`
      select id, business_day_id, shift_id, state, version
      from app.reconciliations
      where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}'
      order by id
    `),
    client.unsafe(`
      select id, reconciliation_id, revision, state, version,
             expected_sales::text as expected_sales, accounted_sales::text as accounted_sales,
             variance::text as variance, source_segment_ids
      from app.reconciliation_revisions
      where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}'
      order by reconciliation_id, revision
    `),
    client.unsafe(`
      select id, reconciliation_id, method, amount::text as amount, reference
      from app.reconciliation_payments
      where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}'
      order by reconciliation_id, id
    `),
    client.unsafe(`
      select id, collection_reference, source_location_id, current_location_id,
             amount::text as amount, state, version
      from app.cash_collections
      where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}'
      order by id
    `),
    client.unsafe(`
      select id, collection_id, reconciliation_id, amount::text as amount
      from app.cash_collection_allocations
      where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}'
      order by id
    `),
    client.unsafe(`
      select id, movement_type, amount::text as amount, from_location_id, to_location_id,
             source_type, source_id, reversal_of_id
      from app.cash_movements
      where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}'
      order by posted_at, id
    `),
    client.unsafe(`
      select id, bank_account_id, amount::text as amount, deposit_reference,
             state, confirmed_amount::text as confirmed_amount,
             confirmation_variance::text as confirmation_variance, bank_reference, version
      from app.bank_deposits
      where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}'
      order by id
    `),
    client.unsafe(`
      select id, deposit_id, collection_id, amount::text as amount
      from app.bank_deposit_allocations
      where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}'
      order by id
    `),
    client.unsafe(`
      select id, code, legal_name, status from app.suppliers
      where tenant_id='${ctx.tenantId}' order by id
    `),
    client.unsafe(`
      select id, supplier_id, document_type, reference_number, amount::text as amount,
             state, version from app.supplier_documents
      where tenant_id='${ctx.tenantId}' order by id
    `),
    client.unsafe(`
      select id, supplier_id, payment_reference, amount::text as amount,
             state, version from app.supplier_payments
      where tenant_id='${ctx.tenantId}' order by id
    `),
    client.unsafe(`
      select id, payment_id, document_id, amount::text as amount, state, reversal_of_id
      from app.supplier_payment_allocations
      where tenant_id='${ctx.tenantId}' order by id
    `),
    client.unsafe(`
      select id, supplier_id, movement_type, amount::text as amount,
             source_type, source_id, reversal_of_id from app.supplier_account_movements
      where tenant_id='${ctx.tenantId}' order by effective_date, id
    `),
    client.unsafe(`
      select id, account_reference, display_name, status from app.customers
      where tenant_id='${ctx.tenantId}' order by id
    `),
    client.unsafe(`
      select id, customer_id, account_type, currency, credit_limit::text as credit_limit, status
      from app.customer_accounts where tenant_id='${ctx.tenantId}' order by id
    `),
    client.unsafe(`
      select id, account_id, account_type, entry_type, direction, amount::text as amount,
             source_type, source_id, source_key from app.customer_ledger_entries
      where tenant_id='${ctx.tenantId}' order by occurred_at, id
    `),
    client.unsafe(`
      select id, account_id, state, requested_litres::text as requested_litres,
             requested_amount::text as requested_amount, used_litres::text as used_litres,
             used_amount::text as used_amount, source_type, source_id
      from app.customer_fuel_authorizations
      where tenant_id='${ctx.tenantId}' order by requested_at, id
    `),
    client.unsafe(`
      select id, code, provider_type, status from app.payment_providers
      where tenant_id='${ctx.tenantId}' order by id
    `),
    client.unsafe(`
      select id, provider_id, account_reference, currency, status from app.provider_accounts
      where tenant_id='${ctx.tenantId}' order by id
    `),
    client.unsafe(`
      select id, provider_account_id, station_id, settlement_reference,
             gross_amount::text as gross_amount, provider_fee_amount::text as provider_fee_amount,
             provider_deduction_amount::text as provider_deduction_amount,
             reported_net_amount::text as reported_net_amount, state, version
      from app.provider_settlements
      where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}' order by id
    `),
    client.unsafe(`
      select id, settlement_id, reconciliation_payment_id, amount::text as amount,
             allocation_key, state from app.provider_settlement_allocations
      where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}' order by id
    `),
    client.unsafe(`
      select id, event_code, request_id, membership_id, actor_id, details from platform.security_events
      where tenant_id='${ctx.tenantId}' order by occurred_at, id
    `),
    client.unsafe(`
      select id, command_type, idempotency_key, request_hash, status, result_payload
      from app.forecourt_idempotency_records
      where tenant_id='${ctx.tenantId}' order by created_at, id
    `),
    client.unsafe(`
      select event_id, station_id, event_type, event_version, aggregate_type, aggregate_id, payload
      from app.forecourt_outbox
      where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}' order by created_at, event_id
    `),
  ]);

  return {
    inventoryMovements,
    costEvents,
    attributions,
    revaluations,
    revaluationLines,
    costProjection,
    deliveries,
    reconciliations,
    revisions,
    reconciliationPayments,
    cashCollections,
    cashCollectionAllocations,
    cashMovements,
    bankDeposits,
    bankDepositAllocations,
    suppliers,
    supplierDocuments,
    supplierPayments,
    supplierAllocations,
    supplierMovements,
    customers,
    customerAccounts,
    customerLedger,
    customerAuthorizations,
    providers,
    providerAccounts,
    settlements,
    settlementAllocations,
    reportSourceIds: {
      reconciliationRevisionIds: revisions.map((row) => row.id),
      inventoryMovementIds: inventoryMovements.map((row) => row.id),
      deliveryIds: deliveries.map((row) => row.id),
      settlementIds: settlements.map((row) => row.id),
    },
    audit,
    idempotency,
    outbox,
  };
}

export async function rowCounts(client: Sql, ctx: Qa1ScenarioContext) {
  const rows = await client.unsafe<
    {
      inventory_movements: string;
      inventory_cost_events: string;
      sale_attributions: string;
      audit: string;
      idempotency: string;
      outbox: string;
    }[]
  >(`
    select
      (select count(*)::text from app.inventory_movements where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}') as inventory_movements,
      (select count(*)::text from app.inventory_cost_events where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}') as inventory_cost_events,
      (select count(*)::text from app.inventory_sale_cost_attributions where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}') as sale_attributions,
      (select count(*)::text from platform.security_events where tenant_id='${ctx.tenantId}') as audit,
      (select count(*)::text from app.forecourt_idempotency_records where tenant_id='${ctx.tenantId}') as idempotency,
      (select count(*)::text from app.forecourt_outbox where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}') as outbox
  `);
  return rows[0]!;
}
