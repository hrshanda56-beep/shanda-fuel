import 'server-only';

import { sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { AppError } from '../../platform/errors';
import { isPermissionGranted, type PermissionCode } from '../../platform/security/permissions';
import { ownerMayApproveOwn } from '../../platform/security/separation-of-duties';
import { authorizeInventoryCommand, withInventoryReadContext } from '../inventory/application';
import { classifyCompartmentVariance, classifyDeliveryReceipt } from './domain';
import type { CompartmentVarianceKind, DeliveryReceiptKind } from './domain';
import { productOrderSql } from '../../platform/domain/product-order-sql';

/**
 * Whether the person's role allows this, for deciding which buttons to show. These permissions
 * also need a recent identity check, but that is asked for when they press the button, so a
 * missing check must not hide the button.
 */
function roleAllows(
  context: Parameters<typeof authorizeInventoryCommand>[0],
  permissionCode: PermissionCode,
): boolean {
  return isPermissionGranted({
    actor: context.authority.authorization,
    permissionCode,
    requestedScope: context.scope,
  });
}

const scopeInput = z.object({ tenantId: z.string().uuid(), stationId: z.string().uuid() });

function unitOf(value: string): 'LITRES' | 'KILOGRAMS' {
  return value === 'KILOGRAMS' ? 'KILOGRAMS' : 'LITRES';
}

export type DeliveryListItem = Readonly<{
  id: string;
  deliveryNoteNumber: string;
  deliveredAt: string;
  businessDate: string;
  productName: string;
  /** Litres or kilograms, as set for the fuel. */
  unit: 'LITRES' | 'KILOGRAMS';
  supplierName: string | null;
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
  noteLitres: string;
  receivedLitres: string;
  shortageExcessLitres: string;
  receipt: DeliveryReceiptKind;
  compartmentCount: number;
  hasWaterTest: boolean;
  driverConfirmed: boolean | null;
}>;

/** An active tank the station can receive fuel into. */
export type DeliveryTank = Readonly<{
  id: string;
  code: string;
  productId: string;
  productName: string;
  /** Litres or kilograms, as set for the fuel. */
  unit: 'LITRES' | 'KILOGRAMS';
}>;

/** One line of the loss report: who or what keeps arriving short. */
export type LossReportRow = Readonly<{
  kind: 'SUPPLIER' | 'TRANSPORTER' | 'DRIVER' | 'TRUCK';
  name: string;
  deliveries: number;
  shortDeliveries: number;
  shortLitres: string;
  claimsOpen: number;
}>;

export type DeliveryList = Readonly<{
  /** Confirmed deliveries that came in short, grouped by who brought or sold the fuel. */
  lossReport: readonly LossReportRow[];
  stationTimezone: string;
  waterTestRequired: boolean;
  /** Only owners may change the water test rule, so only they are shown it. */
  canSetWaterTestRule: boolean;
  /** Whether this person may record a delivery; finance can see deliveries but not record them. */
  canRecord: boolean;
  /** Active tanks, for the Record delivery form. */
  tanks: readonly DeliveryTank[];
  deliveries: readonly DeliveryListItem[];
}>;

/** Recent deliveries at the station, newest first, with how complete their detail is. */
export async function queryDeliveryList(input: {
  request: Request;
  tenantId: string;
  stationId: string;
  limit?: number;
}): Promise<DeliveryList> {
  const parsed = scopeInput.parse({ tenantId: input.tenantId, stationId: input.stationId });
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 200);
  return withInventoryReadContext(
    input.request,
    parsed.tenantId,
    parsed.stationId,
    async (transaction, context) => {
      authorizeInventoryCommand(context, 'inventory.view');
      const rows = await transaction.execute<{
        id: string;
        delivery_note_number: string;
        delivered_at: Date | string;
        business_date: string;
        product_name: string;
        unit: string;
        supplier_name: string | null;
        status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
        note_litres: string;
        received_litres: string;
        shortage_excess_litres: string;
        compartment_count: number;
        has_water_test: boolean;
        driver_confirmed: boolean | null;
      }>(sql`
        select d.id, d.delivery_note_number, d.delivered_at, d.business_date,
          p.name as product_name, p.unit as unit, s.legal_name as supplier_name, d.status,
          d.note_quantity_litres::text as note_litres,
          d.actual_quantity_litres::text as received_litres,
          d.shortage_excess_litres::text as shortage_excess_litres,
          (select count(*)::int from app.fuel_delivery_compartments c
            where c.tenant_id = d.tenant_id and c.delivery_id = d.id) as compartment_count,
          exists (select 1 from app.fuel_delivery_water_tests w
            where w.tenant_id = d.tenant_id and w.delivery_id = d.id) as has_water_test,
          (select dc.confirmed from app.fuel_delivery_driver_confirmations dc
            where dc.tenant_id = d.tenant_id and dc.delivery_id = d.id) as driver_confirmed
        from app.fuel_deliveries d
        join app.products p on p.tenant_id = d.tenant_id and p.id = d.product_id
        left join app.suppliers s on s.tenant_id = d.tenant_id and s.id = d.supplier_id
        where d.tenant_id = ${context.tenantId} and d.station_id = ${context.stationId}
        order by d.delivered_at desc, d.id
        limit ${limit}
      `);
      const settings = await transaction.execute<{ water_test_required: boolean }>(sql`
        select water_test_required from app.delivery_settings
        where tenant_id = ${context.tenantId}
      `);
      const tanks = await transaction.execute<{
        id: string;
        code: string;
        product_id: string;
        product_name: string;
        unit: string;
      }>(sql`
        select t.id, t.code, t.product_id, p.name as product_name, p.unit as unit
        from app.tanks t
        join app.products p on p.tenant_id = t.tenant_id and p.id = t.product_id
        where t.tenant_id = ${context.tenantId} and t.station_id = ${context.stationId}
          and t.status = 'ACTIVE'
        order by ${productOrderSql('p')}, t.code
      `);
      const lossRows = await transaction.execute<{
        kind: LossReportRow['kind'];
        name: string;
        deliveries: number;
        short_deliveries: number;
        short_litres: string;
        claims_open: number;
      }>(sql`
        with base as (
          select d.id,
            d.shortage_excess_litres as gap,
            coalesce(c.status, 'NONE') as claim_status,
            s.legal_name as supplier_name,
            coalesce(ts.legal_name, nullif(btrim(d.transporter), '')) as transporter_name,
            nullif(btrim(d.driver), '') as driver_name,
            nullif(upper(btrim(d.truck_registration)), '') as truck_name
          from app.fuel_deliveries d
          left join app.suppliers s on s.tenant_id = d.tenant_id and s.id = d.supplier_id
          left join app.suppliers ts
            on ts.tenant_id = d.tenant_id and ts.id = d.transporter_supplier_id
          left join app.fuel_delivery_loss_claims c
            on c.tenant_id = d.tenant_id and c.delivery_id = d.id
          where d.tenant_id = ${context.tenantId} and d.station_id = ${context.stationId}
            and d.status = 'CONFIRMED'
        ), keyed as (
          select 'SUPPLIER' as kind, supplier_name as name, * from base
          union all select 'TRANSPORTER', transporter_name, * from base
          union all select 'DRIVER', driver_name, * from base
          union all select 'TRUCK', truck_name, * from base
        )
        select kind, name,
          count(*)::int as deliveries,
          (count(*) filter (where gap < 0))::int as short_deliveries,
          coalesce(sum(-gap) filter (where gap < 0), 0)::text as short_litres,
          (count(*) filter (where gap < 0 and claim_status = 'RAISED'))::int as claims_open
        from keyed
        where name is not null
        group by kind, name
        having count(*) filter (where gap < 0) > 0
        order by sum(-gap) filter (where gap < 0) desc, name
        limit 40
      `);
      return {
        lossReport: lossRows.map((row) => ({
          kind: row.kind,
          name: row.name,
          deliveries: row.deliveries,
          shortDeliveries: row.short_deliveries,
          shortLitres: row.short_litres,
          claimsOpen: row.claims_open,
        })),
        stationTimezone: context.stationTimezone,
        waterTestRequired: settings[0]?.water_test_required ?? false,
        canSetWaterTestRule: roleAllows(context, 'tenant.manage'),
        canRecord: roleAllows(context, 'inventory.delivery.manage'),
        tanks: tanks.map((row) => ({
          id: row.id,
          code: row.code,
          productId: row.product_id,
          productName: row.product_name,
          unit: unitOf(row.unit),
        })),
        deliveries: rows.map((row) => ({
          id: row.id,
          deliveryNoteNumber: row.delivery_note_number,
          deliveredAt: new Date(row.delivered_at).toISOString(),
          businessDate: row.business_date,
          productName: row.product_name,
          unit: unitOf(row.unit),
          supplierName: row.supplier_name,
          status: row.status,
          noteLitres: row.note_litres,
          receivedLitres: row.received_litres,
          shortageExcessLitres: row.shortage_excess_litres,
          receipt: classifyDeliveryReceipt(row.note_litres, row.received_litres),
          compartmentCount: row.compartment_count,
          hasWaterTest: row.has_water_test,
          driverConfirmed: row.driver_confirmed,
        })),
      };
    },
  );
}

export type DeliveryDetail = Readonly<{
  stationTimezone: string;
  waterTestRequired: boolean;
  /** Only people who may manage deliveries are offered the Confirm button. */
  canConfirm: boolean;
  /** Tanks of this delivery's fuel that it can go into, for the edit form. */
  tanks: readonly DeliveryTank[];
  delivery: Readonly<{
    id: string;
    deliveryNoteNumber: string;
    deliveredAt: string;
    businessDate: string;
    productId: string;
    productName: string;
    unit: 'LITRES' | 'KILOGRAMS';
    supplierName: string | null;
    transporter: string | null;
    driver: string | null;
    truckRegistration: string | null;
    status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
    /** The purchase order this delivery is linked to, if any. */
    purchaseOrderNumber: string | null;
    /** Why there is no purchase order, when the delivery was recorded without one. */
    noPoReason: string | null;
    noPoNote: string | null;
    supplierId: string | null;
    /** The supplier that carried the fuel, when it is one of the business's suppliers. */
    transporterSupplierId: string | null;
    /** The tank receiving the fuel; null when the delivery is split across several tanks. */
    tankId: string | null;
    noteLitres: string;
    receivedLitres: string;
    shortageExcessLitres: string;
    receipt: DeliveryReceiptKind;
    /** Why the litres received differ from the note; null when they agree or none was given. */
    varianceCause: string | null;
    varianceNote: string | null;
    /** Evidence only. It never changes the litres. */
    loadTemperatureC: string | null;
    /** What the two tank dips say went in, and how far that is from the litres received. */
    dipMeasuredLitres: string | null;
    dipVarianceLitres: string | null;
    /** Litres on the linked purchase order line; null when there is no order. */
    orderedLitres: string | null;
  }>;
  /** Who is held responsible for the loss and how the claim stands; null when none was raised. */
  lossClaim: Readonly<{
    liableParty: string;
    status: string;
    expectedAmount: string | null;
    recoveredAmount: string | null;
    settlementMethod: string | null;
    currency: string | null;
    note: string | null;
    /** NOT_NEEDED, PENDING, APPROVED or REJECTED. */
    approvalStatus: string;
    approvalNote: string | null;
    approvedAt: string | null;
  }> | null;
  /** Only people who may follow up money are offered the claim form. */
  canRecordClaim: boolean;
  /** An administrator or owner, who did not record the last change, may approve a pending claim. */
  canApproveClaim: boolean;
  compartments: readonly Readonly<{
    compartmentNumber: number;
    noteLitres: string;
    receivedLitres: string;
    varianceLitres: string;
    variance: CompartmentVarianceKind;
    seals: readonly Readonly<{ sealNumber: string; intact: boolean }>[];
  }>[];
  waterTest: Readonly<{
    result: 'PASS' | 'FAIL';
    waterReadingMm: string | null;
    notes: string | null;
    testedAt: string;
  }> | null;
  driverConfirmation: Readonly<{
    driverName: string;
    confirmed: boolean;
    confirmedAt: string | null;
    notes: string | null;
  }> | null;
}>;

export async function queryDeliveryDetail(input: {
  request: Request;
  tenantId: string;
  stationId: string;
  deliveryId: string;
}): Promise<DeliveryDetail> {
  const parsed = scopeInput
    .extend({ deliveryId: z.string().uuid() })
    .parse({ tenantId: input.tenantId, stationId: input.stationId, deliveryId: input.deliveryId });
  return withInventoryReadContext(
    input.request,
    parsed.tenantId,
    parsed.stationId,
    async (transaction, context) => {
      authorizeInventoryCommand(context, 'inventory.view');
      const deliveries = await transaction.execute<{
        id: string;
        delivery_note_number: string;
        delivered_at: Date | string;
        business_date: string;
        product_id: string;
        product_name: string;
        unit: string;
        supplier_name: string | null;
        transporter: string | null;
        driver: string | null;
        truck_registration: string | null;
        status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
        no_po_reason: string | null;
        no_po_note: string | null;
        supplier_id: string | null;
        transporter_supplier_id: string | null;
        purchase_order_number: string | null;
        note_litres: string;
        received_litres: string;
        shortage_excess_litres: string;
        variance_cause: string | null;
        variance_note: string | null;
        load_temperature_c: string | null;
        dip_measured_litres: string | null;
        ordered_litres: string | null;
      }>(sql`
        select d.id, d.delivery_note_number, d.delivered_at, d.business_date, d.product_id,
          p.name as product_name, p.unit as unit, s.legal_name as supplier_name, d.transporter, d.driver,
          d.truck_registration, d.status, d.no_po_reason, d.no_po_note, d.supplier_id, d.transporter_supplier_id,
          (select po.order_number
            from app.purchase_order_delivery_links l
            join app.purchase_orders po
              on po.tenant_id = l.tenant_id and po.id = l.purchase_order_id
            where l.tenant_id = d.tenant_id and l.delivery_id = d.id and l.state = 'ACTIVE'
            limit 1) as purchase_order_number,
          d.note_quantity_litres::text as note_litres,
          d.actual_quantity_litres::text as received_litres,
          d.shortage_excess_litres::text as shortage_excess_litres,
          d.variance_cause, d.variance_note, d.load_temperature_c::text as load_temperature_c,
          (select (post.physical_litres - pre.physical_litres)::text
            from app.tank_dips pre, app.tank_dips post
            where pre.tenant_id = d.tenant_id and pre.id = d.pre_delivery_dip_id and pre.voided_at is null
              and post.tenant_id = d.tenant_id and post.id = d.post_delivery_dip_id and post.voided_at is null
          ) as dip_measured_litres,
          (select pol.ordered_litres::text
            from app.purchase_order_delivery_links l2
            join app.purchase_order_lines pol
              on pol.tenant_id = l2.tenant_id and pol.id = l2.purchase_order_line_id
            where l2.tenant_id = d.tenant_id and l2.delivery_id = d.id and l2.state = 'ACTIVE'
            limit 1) as ordered_litres
        from app.fuel_deliveries d
        join app.products p on p.tenant_id = d.tenant_id and p.id = d.product_id
        left join app.suppliers s on s.tenant_id = d.tenant_id and s.id = d.supplier_id
        where d.tenant_id = ${context.tenantId} and d.station_id = ${context.stationId}
          and d.id = ${parsed.deliveryId}
      `);
      const delivery = deliveries[0];
      if (!delivery) throw new AppError('NOT_FOUND', 'The requested delivery was not found');
      const allocations = await transaction.execute<{ tank_id: string }>(sql`
        select tank_id from app.fuel_delivery_allocations
        where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
          and delivery_id = ${parsed.deliveryId}
      `);
      /** Only a delivery going into one tank can be edited as a whole; several tanks cannot. */
      const tankId = allocations.length === 1 ? (allocations[0]?.tank_id ?? null) : null;
      const tanks = await transaction.execute<{
        id: string;
        code: string;
        product_id: string;
        product_name: string;
        unit: string;
      }>(sql`
        select t.id, t.code, t.product_id, p.name as product_name, p.unit as unit
        from app.tanks t
        join app.products p on p.tenant_id = t.tenant_id and p.id = t.product_id
        where t.tenant_id = ${context.tenantId} and t.station_id = ${context.stationId}
          and t.product_id = ${delivery.product_id}
          and (t.status = 'ACTIVE' or t.id = ${tankId})
        order by t.code
      `);
      const compartments = await transaction.execute<{
        id: string;
        compartment_number: number;
        note_litres: string;
        received_litres: string;
        variance_litres: string;
      }>(sql`
        select c.id, c.compartment_number, c.note_litres::text as note_litres,
          c.received_litres::text as received_litres,
          (c.received_litres - c.note_litres)::text as variance_litres
        from app.fuel_delivery_compartments c
        where c.tenant_id = ${context.tenantId} and c.station_id = ${context.stationId}
          and c.delivery_id = ${parsed.deliveryId}
        order by c.compartment_number
      `);
      const seals = await transaction.execute<{
        compartment_id: string;
        seal_number: string;
        intact: boolean;
      }>(sql`
        select s.compartment_id, s.seal_number, s.intact
        from app.fuel_delivery_compartment_seals s
        where s.tenant_id = ${context.tenantId} and s.station_id = ${context.stationId}
          and s.delivery_id = ${parsed.deliveryId}
        order by s.seal_number
      `);
      const waterTests = await transaction.execute<{
        result: 'PASS' | 'FAIL';
        water_reading_mm: string | null;
        notes: string | null;
        tested_at: Date | string;
      }>(sql`
        select result, water_reading_mm::text as water_reading_mm, notes, tested_at
        from app.fuel_delivery_water_tests
        where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
          and delivery_id = ${parsed.deliveryId}
      `);
      const confirmations = await transaction.execute<{
        driver_name: string;
        confirmed: boolean;
        confirmed_at: Date | string | null;
        notes: string | null;
      }>(sql`
        select driver_name, confirmed, confirmed_at, notes
        from app.fuel_delivery_driver_confirmations
        where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
          and delivery_id = ${parsed.deliveryId}
      `);
      const settings = await transaction.execute<{ water_test_required: boolean }>(sql`
        select water_test_required from app.delivery_settings
        where tenant_id = ${context.tenantId}
      `);
      const claims = await transaction.execute<{
        liable_party: string;
        status: string;
        expected_amount: string | null;
        recovered_amount: string | null;
        settlement_method: string | null;
        currency: string | null;
        note: string | null;
        approval_status: string;
        approval_note: string | null;
        approved_at: Date | string | null;
        updated_by: string;
      }>(sql`
        select liable_party, status, expected_amount::text as expected_amount,
          recovered_amount::text as recovered_amount, settlement_method, currency, note,
          approval_status, approval_note, approved_at, updated_by
        from app.fuel_delivery_loss_claims
        where tenant_id = ${context.tenantId} and delivery_id = ${parsed.deliveryId}
      `);
      const claim = claims[0];
      const ownerMaySelfApprove = await ownerMayApproveOwn(transaction, {
        tenantId: context.tenantId,
        stationId: context.stationId,
        membershipId: context.authority.membership.membershipId,
      });
      const dipMeasured = delivery.dip_measured_litres;
      const water = waterTests[0];
      const driver = confirmations[0];
      return {
        lossClaim: claim
          ? {
              liableParty: claim.liable_party,
              status: claim.status,
              expectedAmount: claim.expected_amount,
              recoveredAmount: claim.recovered_amount,
              settlementMethod: claim.settlement_method,
              currency: claim.currency,
              note: claim.note,
              approvalStatus: claim.approval_status,
              approvalNote: claim.approval_note,
              approvedAt: claim.approved_at ? new Date(claim.approved_at).toISOString() : null,
            }
          : null,
        canRecordClaim:
          roleAllows(context, 'delivery.loss.record') &&
          !(
            claim &&
            claim.approval_status === 'APPROVED' &&
            (claim.status === 'SETTLED' || claim.status === 'WRITTEN_OFF')
          ),
        canApproveClaim:
          roleAllows(context, 'delivery.loss.approve') &&
          claim?.approval_status === 'PENDING' &&
          (claim.updated_by !== context.authority.membership.membershipId || ownerMaySelfApprove),
        stationTimezone: context.stationTimezone,
        waterTestRequired: settings[0]?.water_test_required ?? false,
        canConfirm: roleAllows(context, 'inventory.delivery.manage'),
        tanks: tanks.map((row) => ({
          id: row.id,
          code: row.code,
          productId: row.product_id,
          productName: row.product_name,
          unit: unitOf(row.unit),
        })),
        delivery: {
          id: delivery.id,
          deliveryNoteNumber: delivery.delivery_note_number,
          deliveredAt: new Date(delivery.delivered_at).toISOString(),
          businessDate: delivery.business_date,
          productId: delivery.product_id,
          productName: delivery.product_name,
          unit: unitOf(delivery.unit),
          supplierName: delivery.supplier_name,
          transporter: delivery.transporter,
          driver: delivery.driver,
          truckRegistration: delivery.truck_registration,
          status: delivery.status,
          purchaseOrderNumber: delivery.purchase_order_number,
          noPoReason: delivery.no_po_reason,
          noPoNote: delivery.no_po_note,
          supplierId: delivery.supplier_id,
          transporterSupplierId: delivery.transporter_supplier_id,
          tankId,
          noteLitres: delivery.note_litres,
          receivedLitres: delivery.received_litres,
          shortageExcessLitres: delivery.shortage_excess_litres,
          receipt: classifyDeliveryReceipt(delivery.note_litres, delivery.received_litres),
          varianceCause: delivery.variance_cause,
          varianceNote: delivery.variance_note,
          loadTemperatureC: delivery.load_temperature_c,
          orderedLitres: delivery.ordered_litres,
          dipMeasuredLitres: dipMeasured,
          dipVarianceLitres:
            dipMeasured === null
              ? null
              : new Decimal(dipMeasured).sub(new Decimal(delivery.received_litres)).toFixed(),
        },
        compartments: compartments.map((row) => ({
          compartmentNumber: row.compartment_number,
          noteLitres: row.note_litres,
          receivedLitres: row.received_litres,
          varianceLitres: row.variance_litres,
          variance: classifyCompartmentVariance(row.note_litres, row.received_litres),
          seals: seals
            .filter((seal) => seal.compartment_id === row.id)
            .map((seal) => ({ sealNumber: seal.seal_number, intact: seal.intact })),
        })),
        waterTest: water
          ? {
              result: water.result,
              waterReadingMm: water.water_reading_mm,
              notes: water.notes,
              testedAt: new Date(water.tested_at).toISOString(),
            }
          : null,
        driverConfirmation: driver
          ? {
              driverName: driver.driver_name,
              confirmed: driver.confirmed,
              confirmedAt: driver.confirmed_at ? new Date(driver.confirmed_at).toISOString() : null,
              notes: driver.notes,
            }
          : null,
      };
    },
  );
}
