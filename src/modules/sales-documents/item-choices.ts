import { formatAmount } from './format';
import type { SalesDocumentFuelOption } from './queries';

/** Drops trailing zeros so "2.0600" reads "2.06" in a text box. The value stays exact. */
export const trimZeros = (value: string): string =>
  value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;

export type FuelChoice = {
  value: string;
  label: string;
  fuel: SalesDocumentFuelOption;
  /** The station price to start from, or '' for a plain fuel whose price is typed in. */
  price: string;
  /** Added to the fuel name in the line description, e.g. " - Main Road". */
  suffix: string;
};

/**
 * The fuels offered in "What is it?". Every fuel has a plain option ("Diesel") that is not
 * tied to a station, so any price can be typed in. Fuels with a selling price also get one
 * option per station price as a starting point. When the document is for one station and
 * that station has a price, only its price is offered.
 */
export function buildFuelChoices(
  fuels: readonly SalesDocumentFuelOption[],
  stationId: string | null,
): FuelChoice[] {
  return fuels.flatMap((fuel) => {
    const plain: FuelChoice = {
      value: `${fuel.productId}|`,
      label: fuel.name,
      fuel,
      price: '',
      suffix: '',
    };
    const here = stationId ? fuel.prices.filter((price) => price.stationId === stationId) : [];
    const prices = here.length > 0 ? here : fuel.prices;
    const scoped = here.length > 0;
    const priced = prices.map((price): FuelChoice => {
      const many = !scoped && prices.length > 1;
      return {
        value: `${fuel.productId}|${price.stationId}`,
        label: many
          ? `${fuel.name} - ${price.stationName} (${formatAmount(price.unitPrice, 4, 2)})`
          : `${fuel.name} (${formatAmount(price.unitPrice, 4, 2)})`,
        fuel,
        price: price.unitPrice,
        suffix: many ? ` - ${price.stationName}` : '',
      };
    });
    return [plain, ...priced];
  });
}

/**
 * Which fuel option a saved line came from. A line that still has a station's name and price
 * matches that station's option; any other line for the fuel matches the plain option.
 */
export function matchFuelChoice(
  choices: readonly FuelChoice[],
  line: { productId: string | null; description: string; unitPrice: string },
): string {
  if (!line.productId) return '';
  const same = choices.filter((choice) => choice.fuel.productId === line.productId);
  const exact = same.find(
    (choice) =>
      choice.price !== '' &&
      `${choice.fuel.name}${choice.suffix}` === line.description &&
      trimZeros(choice.price) === trimZeros(line.unitPrice),
  );
  return (exact ?? same.find((choice) => choice.price === ''))?.value ?? '';
}

/** The unit shown for a fuel line. */
export const fuelUnit = (fuel: SalesDocumentFuelOption): string =>
  fuel.unit === 'KILOGRAMS' ? 'kg' : 'L';

/** Common units for an item. Anything else can be typed in. */
export const UNIT_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '', label: 'No unit' },
  { value: 'L', label: 'L (litres)' },
  { value: 'kg', label: 'kg (kilograms)' },
  { value: 'each', label: 'each' },
  { value: 'km', label: 'km' },
  { value: 'trip', label: 'trip' },
  { value: 'hour', label: 'hour' },
  { value: 'day', label: 'day' },
];

/** True when a unit is one of the listed ones (or none), false when it was typed in. */
export const isListedUnit = (unit: string): boolean =>
  UNIT_OPTIONS.some((option) => option.value === unit);
