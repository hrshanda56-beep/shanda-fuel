import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { appSchema } from './namespaces';
import { legalEntities, stations, tenants, memberships } from './a1';

const id = () =>
  uuid('id')
    .default(sql`gen_random_uuid()`)
    .primaryKey();
const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id);
const utcTimestamp = (name: string) => timestamp(name, { withTimezone: true });

export const products = appSchema.table(
  'products',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('products_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('products_tenant_code_uidx').on(table.tenantId, table.code),
    index('products_tenant_status_idx').on(table.tenantId, table.status),
  ],
);

export const pumps = appSchema.table(
  'pumps',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    number: text('number').notNull(),
    name: text('name'),
    status: text('status').notNull().default('ACTIVE'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('pumps_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('pumps_tenant_station_id_uidx').on(table.tenantId, table.stationId, table.id),
    unique('pumps_tenant_station_number_uidx').on(table.tenantId, table.stationId, table.number),
    index('pumps_tenant_station_idx').on(table.tenantId, table.stationId),
    foreignKey({
      columns: [table.tenantId, table.stationId],
      foreignColumns: [stations.tenantId, stations.id],
      name: 'pumps_tenant_station_fk',
    }),
  ],
);

export const nozzles = appSchema.table(
  'nozzles',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    pumpId: uuid('pump_id').notNull(),
    number: text('number').notNull(),
    productId: uuid('product_id').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('nozzles_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('nozzles_tenant_station_id_uidx').on(table.tenantId, table.stationId, table.id),
    unique('nozzles_tenant_pump_number_uidx').on(table.tenantId, table.pumpId, table.number),
    index('nozzles_tenant_station_idx').on(table.tenantId, table.stationId),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.pumpId],
      foreignColumns: [pumps.tenantId, pumps.stationId, pumps.id],
      name: 'nozzles_tenant_station_pump_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'nozzles_tenant_product_fk',
    }),
  ],
);

export const meters = appSchema.table(
  'meters',
  {
    id: id(),
    tenantId: tenantId(),
    serialNumber: text('serial_number').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('meters_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('meters_tenant_serial_uidx').on(table.tenantId, table.serialNumber),
  ],
);

export const meterInstallations = appSchema.table(
  'meter_installations',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    nozzleId: uuid('nozzle_id').notNull(),
    meterId: uuid('meter_id').notNull(),
    effectiveFrom: utcTimestamp('effective_from').notNull(),
    effectiveTo: utcTimestamp('effective_to'),
    installedBy: uuid('installed_by').notNull(),
    replacementReason: text('replacement_reason'),
    version: integer('version').notNull().default(0),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('meter_installations_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('meter_installations_tenant_station_id_uidx').on(
      table.tenantId,
      table.stationId,
      table.id,
    ),
    index('meter_installations_tenant_nozzle_effective_idx').on(
      table.tenantId,
      table.nozzleId,
      table.effectiveFrom,
    ),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.nozzleId],
      foreignColumns: [nozzles.tenantId, nozzles.stationId, nozzles.id],
      name: 'meter_installations_tenant_nozzle_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.meterId],
      foreignColumns: [meters.tenantId, meters.id],
      name: 'meter_installations_tenant_meter_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.installedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'meter_installations_installed_by_fk',
    }),
  ],
);

export const stationBusinessDays = appSchema.table(
  'station_business_days',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    businessDate: text('business_date').notNull(),
    state: text('state').notNull().default('NOT_STARTED'),
    version: integer('version').notNull().default(0),
    openedAt: utcTimestamp('opened_at'),
    closedAt: utcTimestamp('closed_at'),
    closedReason: text('closed_reason'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('station_business_days_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('station_business_days_tenant_station_id_uidx').on(
      table.tenantId,
      table.stationId,
      table.id,
    ),
    unique('station_business_days_station_date_uidx').on(
      table.tenantId,
      table.stationId,
      table.businessDate,
    ),
    index('station_business_days_station_state_idx').on(
      table.tenantId,
      table.stationId,
      table.state,
    ),
    foreignKey({
      columns: [table.tenantId, table.stationId],
      foreignColumns: [stations.tenantId, stations.id],
      name: 'station_business_days_station_fk',
    }),
  ],
);

export const shifts = appSchema.table(
  'shifts',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    businessDayId: uuid('business_day_id').notNull(),
    state: text('state').notNull().default('PLANNED'),
    plannedStartAt: utcTimestamp('planned_start_at').notNull(),
    plannedEndAt: utcTimestamp('planned_end_at').notNull(),
    businessDate: text('business_date').notNull(),
    version: integer('version').notNull().default(0),
    openedAt: utcTimestamp('opened_at'),
    meterClosedAt: utcTimestamp('meter_closed_at'),
    completedAt: utcTimestamp('completed_at'),
    notOperatedReason: text('not_operated_reason'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('shifts_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('shifts_tenant_station_id_uidx').on(table.tenantId, table.stationId, table.id),
    index('shifts_station_day_state_idx').on(
      table.tenantId,
      table.stationId,
      table.businessDayId,
      table.state,
    ),
    foreignKey({
      columns: [table.tenantId, table.stationId],
      foreignColumns: [stations.tenantId, stations.id],
      name: 'shifts_station_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.businessDayId],
      foreignColumns: [
        stationBusinessDays.tenantId,
        stationBusinessDays.stationId,
        stationBusinessDays.id,
      ],
      name: 'shifts_business_day_fk',
    }),
  ],
);

export const sellingPrices = appSchema.table(
  'selling_prices',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    productId: uuid('product_id').notNull(),
    effectiveFrom: utcTimestamp('effective_from').notNull(),
    effectiveTo: utcTimestamp('effective_to'),
    unitPrice: numeric('unit_price', { precision: 20, scale: 6 }).notNull(),
    currency: text('currency').notNull().default('USD'),
    state: text('state').notNull().default('DRAFT'),
    requestedBy: uuid('requested_by').notNull(),
    approvedBy: uuid('approved_by'),
    approvedAt: utcTimestamp('approved_at'),
    activatedAt: utcTimestamp('activated_at'),
    version: integer('version').notNull().default(0),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('selling_prices_tenant_id_id_uidx').on(table.tenantId, table.id),
    index('selling_prices_effective_lookup_idx').on(
      table.tenantId,
      table.stationId,
      table.productId,
      table.effectiveFrom,
    ),
    foreignKey({
      columns: [table.tenantId, table.stationId],
      foreignColumns: [stations.tenantId, stations.id],
      name: 'selling_prices_station_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'selling_prices_product_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.requestedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'selling_prices_requested_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.approvedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'selling_prices_approved_by_fk',
    }),
  ],
);

export const meterBoundaries = appSchema.table(
  'meter_boundaries',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    nozzleId: uuid('nozzle_id').notNull(),
    meterInstallationId: uuid('meter_installation_id').notNull(),
    businessDayId: uuid('business_day_id').notNull(),
    shiftId: uuid('shift_id').notNull(),
    reason: text('reason').notNull(),
    readingStatus: text('reading_status').notNull(),
    readingValue: numeric('reading_value', { precision: 18, scale: 3 }),
    unavailableReason: text('unavailable_reason'),
    effectiveAt: utcTimestamp('effective_at').notNull(),
    confirmedAt: utcTimestamp('confirmed_at').notNull(),
    confirmedBy: uuid('confirmed_by').notNull(),
    enteredBy: uuid('entered_by').notNull(),
    attendantId: uuid('attendant_id').notNull(),
    onBehalfOf: uuid('on_behalf_of'),
    exceptionReason: text('exception_reason'),
    version: integer('version').notNull().default(0),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('meter_boundaries_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('meter_boundaries_tenant_station_id_uidx').on(table.tenantId, table.stationId, table.id),
    index('meter_boundaries_operational_lookup_idx').on(
      table.tenantId,
      table.nozzleId,
      table.effectiveAt,
    ),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.nozzleId],
      foreignColumns: [nozzles.tenantId, nozzles.stationId, nozzles.id],
      name: 'meter_boundaries_nozzle_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.meterInstallationId],
      foreignColumns: [
        meterInstallations.tenantId,
        meterInstallations.stationId,
        meterInstallations.id,
      ],
      name: 'meter_boundaries_installation_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.businessDayId],
      foreignColumns: [
        stationBusinessDays.tenantId,
        stationBusinessDays.stationId,
        stationBusinessDays.id,
      ],
      name: 'meter_boundaries_business_day_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.shiftId],
      foreignColumns: [shifts.tenantId, shifts.stationId, shifts.id],
      name: 'meter_boundaries_shift_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.confirmedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'meter_boundaries_confirmed_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.enteredBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'meter_boundaries_entered_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.attendantId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'meter_boundaries_attendant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.onBehalfOf],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'meter_boundaries_on_behalf_of_fk',
    }),
  ],
);

export const meterSegments = appSchema.table(
  'meter_segments',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    nozzleId: uuid('nozzle_id').notNull(),
    meterInstallationId: uuid('meter_installation_id').notNull(),
    businessDayId: uuid('business_day_id').notNull(),
    shiftId: uuid('shift_id').notNull(),
    openingBoundaryId: uuid('opening_boundary_id').notNull(),
    closingBoundaryId: uuid('closing_boundary_id').notNull(),
    productId: uuid('product_id').notNull(),
    attendantId: uuid('attendant_id').notNull(),
    enteredBy: uuid('entered_by').notNull(),
    onBehalfOf: uuid('on_behalf_of'),
    correctionOfSegmentId: uuid('correction_of_segment_id'),
    reversalOfSegmentId: uuid('reversal_of_segment_id'),
    openingReading: numeric('opening_reading', { precision: 18, scale: 3 }).notNull(),
    closingReading: numeric('closing_reading', { precision: 18, scale: 3 }).notNull(),
    litres: numeric('litres', { precision: 18, scale: 3 }).notNull(),
    unitPrice: numeric('unit_price', { precision: 20, scale: 6 }).notNull(),
    expectedSaleValue: numeric('expected_sale_value', { precision: 20, scale: 4 }).notNull(),
    currency: text('currency').notNull().default('USD'),
    boundaryReason: text('boundary_reason').notNull(),
    segmentStartAt: utcTimestamp('segment_start_at').notNull(),
    segmentEndAt: utcTimestamp('segment_end_at').notNull(),
    sealedAt: utcTimestamp('sealed_at').notNull(),
    version: integer('version').notNull().default(0),
    controlledException: boolean('controlled_exception').notNull().default(false),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('meter_segments_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('meter_segments_tenant_station_id_uidx').on(table.tenantId, table.stationId, table.id),
    unique('meter_segments_opening_boundary_uidx').on(
      table.tenantId,
      table.stationId,
      table.openingBoundaryId,
    ),
    unique('meter_segments_closing_boundary_uidx').on(
      table.tenantId,
      table.stationId,
      table.closingBoundaryId,
    ),
    index('meter_segments_reconciliation_lookup_idx').on(
      table.tenantId,
      table.businessDayId,
      table.stationId,
    ),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.nozzleId],
      foreignColumns: [nozzles.tenantId, nozzles.stationId, nozzles.id],
      name: 'meter_segments_nozzle_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.meterInstallationId],
      foreignColumns: [
        meterInstallations.tenantId,
        meterInstallations.stationId,
        meterInstallations.id,
      ],
      name: 'meter_segments_installation_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.openingBoundaryId],
      foreignColumns: [meterBoundaries.tenantId, meterBoundaries.stationId, meterBoundaries.id],
      name: 'meter_segments_opening_boundary_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.closingBoundaryId],
      foreignColumns: [meterBoundaries.tenantId, meterBoundaries.stationId, meterBoundaries.id],
      name: 'meter_segments_closing_boundary_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'meter_segments_product_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.businessDayId],
      foreignColumns: [
        stationBusinessDays.tenantId,
        stationBusinessDays.stationId,
        stationBusinessDays.id,
      ],
      name: 'meter_segments_business_day_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.shiftId],
      foreignColumns: [shifts.tenantId, shifts.stationId, shifts.id],
      name: 'meter_segments_shift_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.attendantId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'meter_segments_attendant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.enteredBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'meter_segments_entered_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.onBehalfOf],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'meter_segments_on_behalf_of_fk',
    }),
  ],
);

export const reconciliations = appSchema.table(
  'reconciliations',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    businessDayId: uuid('business_day_id').notNull(),
    state: text('state').notNull().default('DRAFT'),
    version: integer('version').notNull().default(0),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('reconciliations_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('reconciliations_business_day_uidx').on(
      table.tenantId,
      table.stationId,
      table.businessDayId,
    ),
    unique('reconciliations_tenant_station_id_uidx').on(table.tenantId, table.stationId, table.id),
    index('reconciliations_station_state_idx').on(table.tenantId, table.stationId, table.state),
    foreignKey({
      columns: [table.tenantId, table.stationId],
      foreignColumns: [stations.tenantId, stations.id],
      name: 'reconciliations_station_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.businessDayId],
      foreignColumns: [
        stationBusinessDays.tenantId,
        stationBusinessDays.stationId,
        stationBusinessDays.id,
      ],
      name: 'reconciliations_business_day_fk',
    }),
  ],
);

export const reconciliationRevisions = appSchema.table(
  'reconciliation_revisions',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    reconciliationId: uuid('reconciliation_id').notNull(),
    revision: integer('revision').notNull(),
    state: text('state').notNull().default('READY'),
    expectedSales: numeric('expected_sales', { precision: 20, scale: 4 }).notNull(),
    accountedSales: numeric('accounted_sales', { precision: 20, scale: 4 }).notNull(),
    variance: numeric('variance', { precision: 20, scale: 4 }).notNull(),
    currency: text('currency').notNull().default('USD'),
    varianceClassification: text('variance_classification').notNull(),
    varianceExplanation: text('variance_explanation'),
    declarations: jsonb('declarations')
      .notNull()
      .default(sql`'[]'::jsonb`),
    sourceSegmentIds: jsonb('source_segment_ids')
      .notNull()
      .default(sql`'[]'::jsonb`),
    sourceShiftIds: jsonb('source_shift_ids')
      .notNull()
      .default(sql`'[]'::jsonb`),
    sourceRevisionId: uuid('source_revision_id'),
    correctionOfRevisionId: uuid('correction_of_revision_id'),
    submittedBy: uuid('submitted_by'),
    approvedBy: uuid('approved_by'),
    postedBy: uuid('posted_by'),
    lockedBy: uuid('locked_by'),
    submittedAt: utcTimestamp('submitted_at'),
    approvedAt: utcTimestamp('approved_at'),
    postedAt: utcTimestamp('posted_at'),
    lockedAt: utcTimestamp('locked_at'),
    version: integer('version').notNull().default(0),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('reconciliation_revisions_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('reconciliation_revisions_tenant_station_id_uidx').on(
      table.tenantId,
      table.stationId,
      table.id,
    ),
    unique('reconciliation_revisions_number_uidx').on(
      table.tenantId,
      table.reconciliationId,
      table.revision,
    ),
    index('reconciliation_revisions_state_idx').on(table.tenantId, table.state),
    check(
      'reconciliation_revisions_variance_classification_ck',
      sql`${table.varianceClassification} in ('INFORMATIONAL', 'REQUIRES_EXPLANATION', 'BLOCKING')`,
    ),
    check('reconciliation_revisions_currency_ck', sql`${table.currency} = 'USD'`),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.reconciliationId],
      foreignColumns: [reconciliations.tenantId, reconciliations.stationId, reconciliations.id],
      name: 'reconciliation_revisions_reconciliation_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.submittedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'reconciliation_revisions_submitted_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.approvedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'reconciliation_revisions_approved_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.postedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'reconciliation_revisions_posted_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.lockedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'reconciliation_revisions_locked_by_fk',
    }),
  ],
);

export const paymentDeclarations = appSchema.table(
  'payment_declarations',
  {
    id: id(),
    tenantId: tenantId(),
    reconciliationRevisionId: uuid('reconciliation_revision_id').notNull(),
    category: text('category').notNull(),
    amount: numeric('amount', { precision: 20, scale: 4 }).notNull(),
    currency: text('currency').notNull().default('USD'),
    declaredBy: uuid('declared_by').notNull(),
    reason: text('reason'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('payment_declarations_tenant_id_id_uidx').on(table.tenantId, table.id),
    index('payment_declarations_revision_idx').on(table.tenantId, table.reconciliationRevisionId),
    check(
      'payment_declarations_category_ck',
      sql`${table.category} in ('CASH', 'ELECTRONIC', 'CUSTOMER_ACCOUNT', 'PREPAID', 'BENEFIT_INTERNAL', 'OTHER')`,
    ),
    check('payment_declarations_amount_ck', sql`${table.amount} >= 0`),
    check('payment_declarations_currency_ck', sql`${table.currency} = 'USD'`),
    foreignKey({
      columns: [table.tenantId, table.reconciliationRevisionId],
      foreignColumns: [reconciliationRevisions.tenantId, reconciliationRevisions.id],
      name: 'payment_declarations_revision_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.declaredBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'payment_declarations_declared_by_fk',
    }),
  ],
);

export const forecourtIdempotencyRecords = appSchema.table(
  'forecourt_idempotency_records',
  {
    id: id(),
    tenantId: tenantId(),
    commandType: text('command_type').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    status: text('status').notNull().default('IN_PROGRESS'),
    resultPayload: jsonb('result_payload').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    completedAt: utcTimestamp('completed_at'),
  },
  (table) => [
    unique('forecourt_idempotency_tenant_command_key_uidx').on(
      table.tenantId,
      table.commandType,
      table.idempotencyKey,
    ),
    index('forecourt_idempotency_tenant_created_idx').on(table.tenantId, table.createdAt),
    check('forecourt_idempotency_status_ck', sql`${table.status} in ('IN_PROGRESS', 'COMPLETED')`),
    check(
      'forecourt_idempotency_key_ck',
      sql`btrim(${table.idempotencyKey}) <> '' and btrim(${table.requestHash}) <> ''`,
    ),
  ],
);

export const forecourtOutbox = appSchema.table(
  'forecourt_outbox',
  {
    eventId: uuid('event_id').primaryKey(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    eventType: text('event_type').notNull(),
    eventVersion: integer('event_version').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    publishedAt: utcTimestamp('published_at'),
  },
  (table) => [
    unique('forecourt_outbox_tenant_event_uidx').on(table.tenantId, table.eventId),
    index('forecourt_outbox_unpublished_idx').on(table.tenantId, table.createdAt),
    foreignKey({
      columns: [table.tenantId, table.stationId],
      foreignColumns: [stations.tenantId, stations.id],
      name: 'forecourt_outbox_station_fk',
    }),
  ],
);
