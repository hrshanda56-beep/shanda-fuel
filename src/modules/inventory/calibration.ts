import { AppError } from '../../platform/errors';
import { DECIMAL_POLICIES, ExactDecimal } from '../../platform/domain/primitives';

/**
 * A tank's calibration chart turns what a dipstick shows (for example 112.5 cm) into litres.
 * Between two chart rows the litres are worked out in a straight line; outside the chart nothing
 * is guessed.
 */
export type CalibrationPoint = Readonly<{ measurement: string; litres: string }>;

const LITRE_STEP = DECIMAL_POLICIES.litres;

function decimal(value: string, label: string): ExactDecimal {
  try {
    return new ExactDecimal(value);
  } catch {
    throw new AppError('VALIDATION_FAILED', `${label} must be a number`);
  }
}

/**
 * Checks a chart a person typed in. Rows are sorted by reading; two rows cannot share a reading,
 * and a deeper reading cannot hold fewer litres than a shallower one.
 */
export function normaliseCalibrationChart(
  points: readonly CalibrationPoint[],
  capacityLitres?: string,
): CalibrationPoint[] {
  if (points.length < 2) {
    throw new AppError('VALIDATION_FAILED', 'A calibration chart needs at least two rows');
  }
  const parsed = points.map((point) => ({
    measurement: decimal(point.measurement, 'Dipstick reading'),
    litres: decimal(point.litres, 'Litres'),
  }));
  for (const row of parsed) {
    if (row.measurement.value.isNegative() || row.litres.value.isNegative()) {
      throw new AppError('VALIDATION_FAILED', 'Readings and litres cannot be negative');
    }
  }
  parsed.sort((a, b) => a.measurement.value.cmp(b.measurement.value));
  for (let index = 1; index < parsed.length; index += 1) {
    const before = parsed[index - 1]!;
    const row = parsed[index]!;
    if (row.measurement.value.eq(before.measurement.value)) {
      throw new AppError(
        'VALIDATION_FAILED',
        `The reading ${row.measurement.toString()} appears more than once`,
      );
    }
    if (row.litres.value.lt(before.litres.value)) {
      throw new AppError(
        'VALIDATION_FAILED',
        `At ${row.measurement.toString()} the tank cannot hold fewer litres than at ${before.measurement.toString()}`,
      );
    }
  }
  if (capacityLitres !== undefined) {
    const capacity = decimal(capacityLitres, 'Capacity').value;
    const largest = parsed[parsed.length - 1]!.litres.value;
    if (largest.gt(capacity)) {
      throw new AppError(
        'VALIDATION_FAILED',
        'The chart holds more litres than the tank capacity. Check the litres column.',
      );
    }
  }
  return parsed.map((row) => ({
    measurement: row.measurement.toString(),
    litres: row.litres.toString(),
  }));
}

/** Litres for a dipstick reading, rounded to the 0.001 litre the books keep. */
export function litresForReading(chart: readonly CalibrationPoint[], reading: string): string {
  const sorted = normaliseCalibrationChart(chart);
  const at = decimal(reading, 'Dipstick reading').value;
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (at.lt(first.measurement) || at.gt(last.measurement)) {
    throw new AppError(
      'VALIDATION_FAILED',
      `A reading of ${reading} is outside this tank's chart (${first.measurement} to ${last.measurement})`,
    );
  }
  for (let index = 1; index < sorted.length; index += 1) {
    const low = sorted[index - 1]!;
    const high = sorted[index]!;
    const lowAt = new ExactDecimal(low.measurement).value;
    const highAt = new ExactDecimal(high.measurement).value;
    if (at.lte(highAt)) {
      const lowLitres = new ExactDecimal(low.litres).value;
      const highLitres = new ExactDecimal(high.litres).value;
      const share = at.sub(lowAt).div(highAt.sub(lowAt));
      const result = lowLitres.add(highLitres.sub(lowLitres).mul(share));
      return new ExactDecimal(result.toFixed(LITRE_STEP.scale)).toString();
    }
  }
  return new ExactDecimal(last.litres).toString();
}

/**
 * Turns lines like "112.5, 18400" (one per row) into chart rows, so a person can paste a
 * chart from a spreadsheet or the tank maker's sheet.
 */
export function parseCalibrationText(text: string): CalibrationPoint[] {
  const rows: CalibrationPoint[] = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (line === '') continue;
    const parts = line.split(/[\s,;\t]+/).filter((part) => part !== '');
    const numbers = parts.map((part) => part.replace(/,/g, ''));
    if (numbers.length !== 2 || !numbers.every((value) => /^\d+(?:\.\d+)?$/.test(value))) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Line ${index + 1} should have a reading and litres, for example 112.5, 18400`,
      );
    }
    rows.push({ measurement: numbers[0]!, litres: numbers[1]! });
  }
  return rows;
}
