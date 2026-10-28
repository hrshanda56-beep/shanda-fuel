import { ExactDecimal } from '../../platform/domain/primitives';

/** One authoritative book-stock calculation for a tank on a station business date. */
export function expectedClosingStock(input: {
  openingLitres: string;
  deliveriesLitres: string;
  litresSold: string;
  approvedAdjustmentsLitres?: string;
}): string {
  return new ExactDecimal(input.openingLitres)
    .add(new ExactDecimal(input.deliveriesLitres))
    .add(new ExactDecimal(input.approvedAdjustmentsLitres ?? '0'))
    .subtract(new ExactDecimal(input.litresSold))
    .quantize({ name: 'Litres', precision: 18, scale: 3 })
    .value.toFixed(3);
}
