import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../platform/errors';
import { isPermissionGranted, type PermissionCode } from '../../platform/security/permissions';
import { authorizeInventoryCommand, withInventoryReadContext } from '../inventory/application';
import { classifyCompartmentVariance, classifyDeliveryReceipt } from './domain';
import type { CompartmentVarianceKind, DeliveryReceiptKind } from './domain';

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

export type DeliveryListItem = Readonly<{
  id: string;
  deliveryNoteNumber: string;
  deliveredAt: string;
  businessDate: string;
  productName: string;
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
}>;

export type DeliveryList = Readonly<{
  stationTimezone: string;
  waterTestRequired: boolean;
  /** Only owners may change the water test rule, so only they are shown it. */
  canSetWaterTestRule: boolean;
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
          p.name as product_name, s.legal_name as supplier_name, d.status,
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
      }>(sql`
        select t.id, t.code, t.product_id, p.name as product_name
        from app.tanks t
        join app.products p on p.tenant_id = t.tenant_id and p.id = t.product_id
        where t.tenant_id = ${context.tenantId} and t.station_id = ${context.stationId}
          and t.status = 'ACTIVE'
        order by p.name, t.code
      `);
      return {
        stationTimezone: context.stationTimezone,
        waterTestRequired: settings[0]?.water_test_required ?? false,
        canSetWaterTestRule: roleAllows(context, 'tenant.manage'),
        tanks: tanks.map((row) => ({
          id: row.id,
          code: row.code,
          productId: row.product_id,
          productName: row.product_name,
        })),
        deliveries: rows.map((row) => ({
          id: row.id,
          deliveryNoteNumber: row.delivery_note_number,
          deliveredAt: new Date(row.delivered_at).toISOString(),
          businessDate: row.business_date,
          productName: row.product_name,
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
    /** The tank receiving the fuel; null when the delivery is split across several tanks. */
    tankId: string | null;
    noteLitres: string;
    receivedLitres: string;
    shortageExcessLitres: string;
    receipt: DeliveryReceiptKind;
  }>;
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
        supplier_name: string | null;
        transporter: string | null;
        driver: string | null;
        truck_registration: string | null;
        status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
        no_po_reason: string | null;
        no_po_note: string | null;
        supplier_id: string | null;
        purchase_order_number: string | null;
        note_litres: string;
        received_litres: string;
        shortage_excess_litres: string;
      }>(sql`
        select d.id, d.delivery_note_number, d.delivered_at, d.business_date, d.product_id,
          p.name as product_name, s.legal_name as supplier_name, d.transporter, d.driver,
          d.truck_registration, d.status, d.no_po_reason, d.no_po_note, d.supplier_id,
          (select po.order_number
            from app.purchase_order_delivery_links l
            join app.purchase_orders po
              on po.tenant_id = l.tenant_id and po.id = l.purchase_order_id
            where l.tenant_id = d.tenant_id and l.delivery_id = d.id and l.state = 'ACTIVE'
            limit 1) as purchase_order_number,
          d.note_quantity_litres::text as note_litres,
          d.actual_quantity_litres::text as received_litres,
          d.shortage_excess_litres::text as shortage_excess_litres
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
      }>(sql`
        select t.id, t.code, t.product_id, p.name as product_name
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
      const water = waterTests[0];
      const driver = confirmations[0];
      return {
        stationTimezone: context.stationTimezone,
        waterTestRequired: settings[0]?.water_test_required ?? false,
        canConfirm: roleAllows(context, 'inventory.delivery.manage'),
        tanks: tanks.map((row) => ({
          id: row.id,
          code: row.code,
          productId: row.product_id,
          productName: row.product_name,
        })),
        delivery: {
          id: delivery.id,
          deliveryNoteNumber: delivery.delivery_note_number,
          deliveredAt: new Date(delivery.delivered_at).toISOString(),
          businessDate: delivery.business_date,
          productId: delivery.product_id,
          productName: delivery.product_name,
          supplierName: delivery.supplier_name,
          transporter: delivery.transporter,
          driver: delivery.driver,
          truckRegistration: delivery.truck_registration,
          status: delivery.status,
          purchaseOrderNumber: delivery.purchase_order_number,
          noPoReason: delivery.no_po_reason,
          noPoNote: delivery.no_po_note,
          supplierId: delivery.supplier_id,
          tankId,
          noteLitres: delivery.note_litres,
          receivedLitres: delivery.received_litres,
          shortageExcessLitres: delivery.shortage_excess_litres,
          receipt: classifyDeliveryReceipt(delivery.note_litres, delivery.received_litres),
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
