import type { ConfigurationSetupOverview } from './contracts';
import { buildFuelCards, describeDuration, endTimeFrom } from './guided-setup';

export type StationFuelRow = Readonly<{
  productId: string;
  name: string;
  unitWord: 'litres' | 'kilograms';
  /** The price in use, as the exact stored text; null when none is in use. */
  price: string | null;
  /** Plain words when there is no price in use, such as "waiting for approval". */
  priceNote: string | null;
  tanks: readonly string[];
  nozzles: readonly string[];
  done: boolean;
  /** What is still missing, in words. Empty when the fuel is complete. */
  needs: string;
}>;

export type StationShiftRow = Readonly<{ id: string; name: string; when: string }>;

export type StationOverviewView = Readonly<{
  fuels: readonly StationFuelRow[];
  pumps: ReadonlyArray<Readonly<{ id: string; label: string; nozzles: number }>>;
  shifts: readonly StationShiftRow[];
  supervisor: string | null;
  counts: Readonly<{ fuels: number; tanks: number; pumps: number; shifts: number }>;
  /** Things that still stop the station being complete, in words. */
  todo: readonly string[];
}>;

/** "30000.000" reads "30,000"; zeros are dropped only after a decimal point. */
export function quantityText(value: string): string {
  const plain = value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
  return plain.replace(/\B(?=(\d{3})+(?!\d))(?<!\.\d*)/g, ',') || '0';
}
const trimKg = quantityText;

/** One station's setup as a person reads it: fuels with their price, tanks and nozzles, pumps, shifts. */
export function buildStationOverview(data: ConfigurationSetupOverview): StationOverviewView {
  const products = (data.products ?? []).filter((p) => p.status === 'ACTIVE');
  const tanks = (data.tanks ?? []).filter((t) => t.status === 'ACTIVE');
  const pumps = (data.pumps ?? []).filter((p) => p.status === 'ACTIVE');
  const nozzles = (data.nozzles ?? []).filter((n) => n.status === 'ACTIVE');
  const shifts = (data.shiftTemplates ?? []).filter((s) => s.active);
  const cards = new Map(buildFuelCards(data).map((card) => [card.productId, card]));
  const pumpLabel = new Map(pumps.map((p) => [p.id, p.name ? `${p.name}` : `Pump ${p.number}`]));

  const fuels = products.map((product): StationFuelRow => {
    const active = (data.prices ?? []).find(
      (p) => p.productId === product.id && p.state === 'ACTIVE',
    );
    const waiting = (data.prices ?? []).find(
      (p) => p.productId === product.id && p.state !== 'ACTIVE' && p.state !== 'SUPERSEDED',
    );
    const card = cards.get(product.id);
    const unitWord = product.unit === 'KILOGRAMS' ? 'kilograms' : 'litres';
    return {
      productId: product.id,
      name: product.name,
      unitWord,
      price: active?.unitPrice ?? null,
      priceNote: active ? null : waiting ? 'Waiting for approval' : 'No price yet',
      tanks: tanks
        .filter((t) => t.productId === product.id)
        .map((t) => `${t.code} · ${trimKg(t.capacityLitres)} ${unitWord}`),
      nozzles: nozzles
        .filter((n) => n.productId === product.id)
        .map((n) => `${pumpLabel.get(n.pumpId) ?? 'Pump'}, nozzle ${n.number}`),
      done: card?.status === 'done',
      needs:
        card?.status === 'done'
          ? ''
          : (card?.summary.replace(/^Needs /, '').replace(/\.$/, '') ?? ''),
    };
  });

  const supervisor =
    data.supervisors?.find((s) => s.membershipId === data.responsibleSupervisorMembershipId)
      ?.name ?? null;

  const todo: string[] = [];
  if (fuels.length === 0) todo.push('Add a fuel');
  for (const fuel of fuels) if (!fuel.done) todo.push(`${fuel.name}: ${fuel.needs}`);
  if (shifts.length === 0) todo.push('Add a shift');
  if (!supervisor) todo.push('Choose who is in charge');

  return {
    fuels,
    pumps: pumps.map((p) => ({
      id: p.id,
      label: pumpLabel.get(p.id) ?? `Pump ${p.number}`,
      nozzles: nozzles.filter((n) => n.pumpId === p.id).length,
    })),
    shifts: shifts.map((s) => ({
      id: s.id,
      name: s.name,
      when: s.startTime
        ? `${s.startTime.slice(0, 5)} to ${endTimeFrom(s.startTime.slice(0, 5), s.durationMinutes)}`
        : describeDuration(s.durationMinutes),
    })),
    supervisor,
    counts: {
      fuels: fuels.length,
      tanks: tanks.length,
      pumps: pumps.length,
      shifts: shifts.length,
    },
    todo,
  };
}
