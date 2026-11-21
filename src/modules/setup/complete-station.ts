import type { ConfigurationSetupOverview } from './contracts';
import { planPriceAdvance } from './guided-setup';

/** True when this person may still move a waiting price a step closer to being in use. */
function canTakeFurther(
  state: string,
  caps: ConfigurationSetupOverview['capabilities'] | undefined,
): boolean {
  return caps ? planPriceAdvance(state, caps).commands.length > 0 : false;
}

/**
 * What a station still needs before it can trade, as a list of small jobs, each one opened in the
 * matching wizard (#251). It reads the station as it will be once the waiting changes are saved,
 * so finishing a job makes the next one appear. Pure; the screen only draws what this decides.
 */
export type TaskPart =
  | { kind: 'addFuel' }
  | { kind: 'price' | 'tanks' | 'pumps'; productId: string }
  | { kind: 'shifts' }
  /** Invite someone to work at the station. */
  | { kind: 'invite' }
  /** A payment provider account for the station (and the provider, if there is none yet). */
  | { kind: 'provider' }
  /** A bank account for the station's company. */
  | { kind: 'bank' }
  /** The fuel already in the tanks, entered through the opening-balances wizard. */
  | { kind: 'opening' };

export type StationTask = Readonly<{
  key: string;
  label: string;
  part: TaskPart;
  /** True when the job needs the waiting changes saved first (a new tank must exist). */
  afterSave?: true;
}>;

/** What the readiness check says is missing outside the station's own setup. */
export type StationNeeds = Readonly<{
  /** Nobody works at the station yet (needed to go live). */
  staff: boolean;
  /** No payment provider account (not needed to go live, but asked about). */
  providerAccount: boolean;
  /** No bank account for the company (not needed to go live, but asked about). */
  bankAccount: boolean;
  /** A tank has no opening quantity (not needed to go live, but asked about). */
  openingStock: boolean;
}>;

export const NO_NEEDS: StationNeeds = {
  staff: false,
  providerAccount: false,
  bankAccount: false,
  openingStock: false,
};

/**
 * The jobs left for this station, in the order they are asked: the station's own setup first, then
 * who works there, payment accounts and, once everything is saved, the opening stock. `needs`
 * comes from the readiness check, because those are not part of the station's own setup.
 */
export function stationTasks(
  data: Pick<
    ConfigurationSetupOverview,
    'products' | 'prices' | 'tanks' | 'nozzles' | 'shiftTemplates'
  > &
    Partial<Pick<ConfigurationSetupOverview, 'capabilities'>>,
  needs: StationNeeds,
): readonly StationTask[] {
  const products = (data.products ?? []).filter((p) => p.status === 'ACTIVE');
  const prices = data.prices ?? [];
  const tanks = (data.tanks ?? []).filter((t) => t.status === 'ACTIVE');
  const nozzles = (data.nozzles ?? []).filter((n) => n.status === 'ACTIVE');
  const tasks: StationTask[] = [];

  if (products.length === 0) {
    tasks.push({ key: 'fuel', label: 'Add a fuel', part: { kind: 'addFuel' } });
  }
  for (const product of products) {
    // A price counts once it is in use, or while it waits for someone else. A price this person
    // can still take a step further (for example one a cut-off save left prepared but not started)
    // is asked for again: the price wizard then offers to finish it.
    const priced = prices.some(
      (p) =>
        p.productId === product.id &&
        p.state !== 'SUPERSEDED' &&
        (p.state === 'ACTIVE' || !canTakeFurther(p.state, data.capabilities)),
    );
    if (!priced) {
      tasks.push({
        key: `price:${product.id}`,
        label: `A price for ${product.name}`,
        part: { kind: 'price', productId: product.id },
      });
    }
    if (!tanks.some((t) => t.productId === product.id)) {
      tasks.push({
        key: `tanks:${product.id}`,
        label: `A tank for ${product.name}`,
        part: { kind: 'tanks', productId: product.id },
      });
    }
    if (!nozzles.some((n) => n.productId === product.id)) {
      tasks.push({
        key: `pumps:${product.id}`,
        label: `A pump and nozzle for ${product.name}`,
        part: { kind: 'pumps', productId: product.id },
      });
    }
  }
  if ((data.shiftTemplates ?? []).every((s) => !s.active)) {
    tasks.push({ key: 'shifts', label: 'A shift', part: { kind: 'shifts' } });
  }
  if (needs.staff) {
    tasks.push({ key: 'staff', label: 'Someone working at the station', part: { kind: 'invite' } });
  }
  if (needs.providerAccount) {
    tasks.push({ key: 'provider', label: 'A payment account', part: { kind: 'provider' } });
  }
  if (needs.bankAccount) {
    tasks.push({ key: 'bank', label: 'A bank account', part: { kind: 'bank' } });
  }
  if (needs.openingStock) {
    tasks.push({
      key: 'opening',
      label: 'The fuel already in the tanks',
      part: { kind: 'opening' },
      afterSave: true,
    });
  }
  return tasks;
}

/**
 * The jobs not yet offered, in order; `offered` holds the keys already shown once. A job that
 * needs the waiting changes saved first is held back until `saved` is true.
 */
export function nextTask(
  tasks: readonly StationTask[],
  offered: ReadonlySet<string>,
  saved = true,
): StationTask | null {
  return tasks.find((task) => !offered.has(task.key) && (saved || !task.afterSave)) ?? null;
}

/** "A price for Diesel, a tank for Diesel and a shift" for the opening sentence. */
export function sayTasks(tasks: readonly StationTask[]): string {
  const labels = tasks.map((task) => task.label.charAt(0).toLowerCase() + task.label.slice(1));
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}
