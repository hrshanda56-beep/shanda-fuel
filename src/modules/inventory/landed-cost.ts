import { AppError } from '../../platform/errors';
import { DECIMAL_POLICIES, ExactDecimal } from '../../platform/domain/primitives';

/**
 * Landed cost of a delivery: what the fuel cost, plus freight and any other direct costs, spread
 * over the litres that actually arrived (not the litres on the delivery note). The part of that
 * total that belongs to one tank is its share of the litres.
 */
export type LandedCostInput = Readonly<{
  fuelCost: string;
  freight?: string | undefined;
  otherCosts?: readonly { label: string; amount: string }[] | undefined;
  /** Litres that actually arrived, as counted, for the whole delivery. */
  deliveryLitres: string;
  /** Litres of this delivery that went into the tank being costed. */
  allocationLitres: string;
}>;

export type LandedCost = Readonly<{
  totalCost: string;
  unitCost: string;
  allocationCost: string;
  components: readonly { label: string; amount: string }[];
}>;

function amount(value: string | undefined, label: string): ExactDecimal {
  if (value === undefined || value === '') return new ExactDecimal('0');
  let parsed: ExactDecimal;
  try {
    parsed = new ExactDecimal(value);
  } catch {
    throw new AppError('VALIDATION_FAILED', `${label} must be a number`);
  }
  if (parsed.value.isNegative()) {
    throw new AppError('VALIDATION_FAILED', `${label} cannot be negative`);
  }
  return parsed;
}

export function buildLandedCost(input: LandedCostInput): LandedCost {
  const fuel = amount(input.fuelCost, 'Fuel cost');
  if (fuel.value.lte(0)) {
    throw new AppError('VALIDATION_FAILED', 'Fuel cost must be greater than zero');
  }
  const components: { label: string; amount: string }[] = [
    { label: 'Fuel', amount: fuel.toString() },
  ];
  let total = fuel;
  const freight = amount(input.freight, 'Freight');
  if (freight.value.gt(0)) {
    components.push({ label: 'Freight', amount: freight.toString() });
    total = total.add(freight);
  }
  for (const other of input.otherCosts ?? []) {
    const label = other.label.trim();
    if (!label) throw new AppError('VALIDATION_FAILED', 'Name each extra cost');
    const value = amount(other.amount, label);
    if (value.value.gt(0)) {
      components.push({ label, amount: value.toString() });
      total = total.add(value);
    }
  }
  const delivered = amount(input.deliveryLitres, 'Litres received');
  const allocated = amount(input.allocationLitres, 'Litres in this tank');
  if (delivered.value.lte(0) || allocated.value.lte(0)) {
    throw new AppError('VALIDATION_FAILED', 'Litres received must be greater than zero');
  }
  if (allocated.value.gt(delivered.value)) {
    throw new AppError('INVARIANT_VIOLATION', 'A tank cannot hold more than the delivery brought');
  }
  const unit = total.value.div(delivered.value);
  return {
    totalCost: total.quantize(DECIMAL_POLICIES.money).toString(),
    unitCost: new ExactDecimal(unit.toFixed(DECIMAL_POLICIES.weightedAverageCost.scale)).toString(),
    allocationCost: new ExactDecimal(
      total.value.mul(allocated.value).div(delivered.value).toFixed(DECIMAL_POLICIES.money.scale),
    ).toString(),
    components,
  };
}
