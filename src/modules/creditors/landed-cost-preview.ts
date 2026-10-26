import Decimal from 'decimal.js';

export type PreviewLine = {
  lineType: 'FUEL' | 'TRANSPORT' | 'OTHER_DIRECT_COST';
  quantity: string;
  unitPrice: string;
  /** The delivery this fuel line is for, when one was chosen. */
  deliveryId: string;
};

export type PreviewDelivery = {
  id: string;
  deliveryNoteNumber: string;
  /** Litres actually received, not the litres on the delivery note. */
  receivedLitres: string;
};

export type LandedCostPreview = {
  deliveryId: string;
  deliveryNoteNumber: string;
  receivedLitres: string;
  purchaseCost: string;
  directCosts: string;
  totalCost: string;
  /** (purchase + direct costs) / litres actually received, to 4 decimals. */
  perLitre: string;
};

const EXACT = /^\d+(?:\.\d+)?$/;

function amount(line: PreviewLine): Decimal | null {
  const quantity = line.quantity.trim();
  const price = line.unitPrice.trim();
  if (!EXACT.test(quantity) || !EXACT.test(price)) return null;
  return new Decimal(quantity).mul(price);
}

/**
 * The landed cost of each delivery the invoice covers: what was paid for the fuel plus transport
 * and other direct costs, divided by the litres that actually arrived (so a shortage raises the
 * cost per litre). Direct costs not tied to a delivery go to the only delivery on the invoice;
 * with several deliveries they cannot be told apart and are left out of the preview.
 */
export function previewLandedCost(
  lines: readonly PreviewLine[],
  deliveries: readonly PreviewDelivery[],
): LandedCostPreview[] {
  const linked = [
    ...new Set(
      lines.filter((line) => line.lineType === 'FUEL' && line.deliveryId).map((l) => l.deliveryId),
    ),
  ];
  const only = linked.length === 1 ? linked[0] : undefined;
  const results: LandedCostPreview[] = [];
  for (const deliveryId of linked) {
    const delivery = deliveries.find((candidate) => candidate.id === deliveryId);
    if (!delivery || !EXACT.test(delivery.receivedLitres)) continue;
    const received = new Decimal(delivery.receivedLitres);
    if (received.lte(0)) continue;
    let purchase = new Decimal(0);
    let direct = new Decimal(0);
    for (const line of lines) {
      const value = amount(line);
      if (!value) continue;
      if (line.lineType === 'FUEL' && line.deliveryId === deliveryId)
        purchase = purchase.add(value);
      else if (line.lineType !== 'FUEL' && only === deliveryId) direct = direct.add(value);
    }
    if (purchase.lte(0)) continue;
    const total = purchase.add(direct);
    results.push({
      deliveryId,
      deliveryNoteNumber: delivery.deliveryNoteNumber,
      receivedLitres: delivery.receivedLitres,
      purchaseCost: purchase.toFixed(4),
      directCosts: direct.toFixed(4),
      totalCost: total.toFixed(4),
      perLitre: total.div(received).toFixed(4, Decimal.ROUND_HALF_UP),
    });
  }
  return results;
}
