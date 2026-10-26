export type OrderLine = {
  lineId: string;
  lineNumber: number;
  productId: string;
  productCode: string;
  productName: string;
  orderedLitres: string;
  agreedUnitPrice: string | null;
  status: string;
  receivedLitres: string;
  pendingLitres: string;
  openLitres: string;
  overReceiptLitres: string;
  shortClosedLitres: string | null;
};

export type PurchaseOrder = {
  purchaseOrderId: string;
  orderNumber: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  orderDate: string;
  expectedDeliveryDate: string | null;
  notes: string | null;
  state: string;
  displayState: string;
  version: number;
  revisionNo: number;
  submittedAt: string | null;
  approvedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  closedAt: string | null;
  closeReason: string | null;
  lines: OrderLine[];
};

export type OrderDelivery = {
  linkId: string;
  purchaseOrderLineId: string;
  deliveryId: string;
  deliveryNoteNumber: string;
  deliveryStatus: string;
  actualQuantityLitres: string;
  state: string;
  linkedAt: string;
  unlinkedAt: string | null;
  unlinkReason: string | null;
};

export type OrderRevision = {
  revisionNo: number;
  reason: string | null;
  createdAt: string;
};

export type PurchaseOrderDetailData = PurchaseOrder & {
  /** True when you sent this order and someone else could approve it, so you may not. */
  approvalBlockedForYou?: boolean;
  /** True when you sent this order and nobody else could approve it, so you give a reason. */
  approvalIsSelf?: boolean;
  deliveries: OrderDelivery[];
  revisions: OrderRevision[];
};

export type OrderReference = {
  suppliers: { id: string; code: string; legalName: string }[];
  products: { id: string; code: string; name: string }[];
  linkableDeliveries: {
    id: string;
    deliveryNoteNumber: string;
    productId: string;
    status: string;
    actualQuantityLitres: string;
    businessDate: string;
  }[];
};

export type StationOption = { id: string; name: string };

export type ExposureDelivery = {
  deliveryId: string;
  deliveryNoteNumber: string;
  businessDate: string;
  state: string;
  acceptedLitres: string;
  netBilledLitres: string;
  unbilledLitres: string;
  overBilledLitres: string;
  valuation: 'PRICED' | 'UNPRICED';
  unbilledValue: string | null;
  note: string | null;
};

export type ExposureSupplier = {
  supplierId: string | null;
  legalName: string | null;
  supplierUnassigned: boolean;
  unbilledLitres: string;
  unbilledValue: string;
  unpricedUnbilledLitres: string;
  deliveries: ExposureDelivery[];
};

export type ExposureData = {
  asOf: string;
  suppliers: ExposureSupplier[];
  totals: { unbilledLitres: string; unbilledValue: string; unpricedUnbilledLitres: string };
};

export type CheckFinding = {
  code: string;
  severity: 'EXCEPTION' | 'INFO';
  message: string;
};

export type CheckRow = {
  deliveryId: string;
  deliveryNoteNumber: string;
  businessDate: string;
  supplierId: string | null;
  supplierUnassigned: boolean;
  noteLitres: string;
  acceptedLitres: string;
  receivedVsNoteLitres: string;
  invoicedLitres: string | null;
  invoicedVsAcceptedLitres: string | null;
  invoicedUnitPrice: string | null;
  receiptUnitCost: string | null;
  purchaseOrderNumber: string | null;
  purchaseOrderUnitPrice: string | null;
  priceBasis: 'PURCHASE_ORDER' | 'RECEIPT_COST' | null;
  priceDifference: string | null;
  exceeded: boolean;
  toleranceAction: string;
  findings: CheckFinding[];
  skipped: string[];
};

export type ChecksData = { asOf: string; deliveries: CheckRow[] };

export type SupplierName = { supplierId: string; code: string; legalName: string };

export type PolicyView = {
  version: number;
  quantityToleranceLitres: string | null;
  quantityTolerancePercent: string | null;
  priceTolerancePercent: string | null;
  amountTolerance: string | null;
  overReceiptToleranceLitres: string | null;
  overReceiptTolerancePercent: string | null;
  toleranceAction: string | null;
  vatMode: string | null;
  defaultVatRate: string | null;
  requireInvoiceLines: boolean | null;
};

export type PolicyData = {
  configured: boolean;
  tenantPolicy: PolicyView | null;
  supplierOverride: PolicyView | null;
  suppliersWithOverrides: string[];
  resolved: {
    quantityToleranceLitres: string | null;
    quantityTolerancePercent: string | null;
    priceTolerancePercent: string | null;
    amountTolerance: string | null;
    overReceiptToleranceLitres: string | null;
    overReceiptTolerancePercent: string | null;
    toleranceAction: string;
    vatMode: string;
    defaultVatRate: string | null;
    requireInvoiceLines: boolean;
  };
};
