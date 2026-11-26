import { formatUnitPriceText } from '@/design-system/formatters';

import type {
  ConfigurationSetupOverview,
  SetupNozzle,
  SetupProduct,
  SetupPump,
  SetupShiftTemplate,
  SetupTank,
} from './contracts';

/**
 * Setup changes are collected on the screen and saved together at the end, after one identity
 * check. This module is the pure part of that: it keeps the list of waiting changes, shows them
 * on top of what is already saved, describes them in plain words, and replays them in order.
 *
 * A thing that does not exist yet (a new tank, pump, nozzle…) gets a stand-in id while it waits.
 * When the list is saved, each stand-in is swapped for the real id the server hands back, so a
 * nozzle can be added to a pump that was only created a moment earlier.
 */
export type StagedChange = Readonly<{
  /** Identifies this entry in the list; also the stable idempotency key for the save. */
  id: string;
  url: string;
  body: Readonly<Record<string, unknown>>;
  /** Present when this change creates something: the stand-in id other changes may point at. */
  standIn?: string;
}>;

export const STAND_IN_PREFIX = 'staged:';
export const isStandIn = (id: string | null | undefined): boolean =>
  typeof id === 'string' && id.startsWith(STAND_IN_PREFIX);

type Body = Record<string, unknown>;
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const type = (change: StagedChange): string => str(change.body.commandType);

/** The field of a command's answer that carries the id of the thing it created. */
const CREATED_ID_FIELD: Record<string, string> = {
  CreateProduct: 'productId',
  CreateTank: 'tankId',
  CreatePump: 'pumpId',
  CreateNozzle: 'nozzleId',
  DraftPriceChange: 'priceId',
};
export const createdIdField = (commandType: string): string | undefined =>
  CREATED_ID_FIELD[commandType];

/** The field of a delete command that names the thing it removes. */
const DELETE_TARGET: Record<string, string> = {
  DeleteTank: 'tankId',
  DeletePump: 'pumpId',
  DeleteNozzle: 'nozzleId',
};

/** Which earlier waiting change a new one replaces, so editing twice never queues twice. */
function replaceKey(change: { body: Body }): string | null {
  const body = change.body;
  switch (str(body.commandType)) {
    case 'SetProductKind':
    case 'RenameProduct':
    case 'SetProductUnit':
    case 'SetProductStatus':
      return `${str(body.commandType)}:${str(body.productId)}`;
    case 'UpdateTank':
      return `UpdateTank:${str(body.tankId)}`;
    case 'UpdatePump':
      return `UpdatePump:${str(body.pumpId)}`;
    case 'UpdateNozzle':
      return `UpdateNozzle:${str(body.nozzleId)}`;
    case 'SetMeterWorkingSince':
      return `SetMeterWorkingSince:${str(body.nozzleId)}`;
    case 'SetResponsibleSupervisor':
      return 'SetResponsibleSupervisor';
    case 'AdvancePrice':
      return `AdvancePrice:${str(body.priceId)}`;
    case 'DefineShiftTemplate':
      return `Shift:${str(body.shiftTemplateId)}`;
    default:
      return null;
  }
}

const mentions = (value: unknown, needle: string): boolean => {
  if (typeof value === 'string') return value === needle;
  if (Array.isArray(value)) return value.some((item) => mentions(item, needle));
  if (value && typeof value === 'object') {
    return Object.values(value).some((item) => mentions(item, needle));
  }
  return false;
};

/** Drops a waiting change, and every waiting change that depends on the thing it would create. */
export function discardStaged(queue: readonly StagedChange[], id: string): StagedChange[] {
  const gone = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    const standIns = queue.filter((c) => gone.has(c.id) && c.standIn).map((c) => c.standIn!);
    for (const change of queue) {
      if (gone.has(change.id)) continue;
      if (standIns.some((standIn) => mentions(change.body, standIn))) {
        gone.add(change.id);
        grew = true;
      }
    }
  }
  return queue.filter((c) => !gone.has(c.id));
}

let counter = 0;
const nextId = (): string => `${Date.now().toString(36)}-${(counter += 1).toString(36)}`;

/**
 * Adds a change to the waiting list. A change to something that is itself still waiting is folded
 * into that entry; a repeat edit of the same saved thing replaces the earlier edit.
 */
export function addStaged(
  queue: readonly StagedChange[],
  url: string,
  body: Readonly<Body>,
): StagedChange[] {
  const commandType = str(body.commandType);
  const next: StagedChange[] = [...queue];

  // Folding into a thing that is only waiting to be created.
  const targetOf = (field: string) => (isStandIn(str(body[field])) ? str(body[field]) : '');
  const foldInto = (standIn: string, patch: (entry: Body) => Body): boolean => {
    const index = next.findIndex((c) => c.standIn === standIn);
    if (index < 0) return false;
    next[index] = { ...next[index]!, body: patch({ ...next[index]!.body }) };
    return true;
  };
  const { commandType: _ignored, tenantId: _t, stationId: _s, ...fields } = body;
  void _ignored;
  void _t;
  void _s;

  if (commandType === 'UpdateTank') {
    const standIn = targetOf('tankId');
    const { tankId: _tankId, ...rest } = fields;
    void _tankId;
    if (standIn && foldInto(standIn, (entry) => ({ ...entry, ...rest }))) return next;
  }
  if (commandType === 'UpdatePump') {
    const standIn = targetOf('pumpId');
    const { pumpId: _pumpId, ...rest } = fields;
    void _pumpId;
    if (standIn && foldInto(standIn, (entry) => ({ ...entry, ...rest }))) return next;
  }
  if (commandType === 'UpdateNozzle') {
    const standIn = targetOf('nozzleId');
    const { nozzleId: _nozzleId, ...rest } = fields;
    void _nozzleId;
    if (standIn && foldInto(standIn, (entry) => ({ ...entry, ...rest }))) return next;
  }
  if (commandType === 'SetMeterWorkingSince') {
    const standIn = targetOf('nozzleId');
    if (
      standIn &&
      foldInto(standIn, (entry) => ({
        ...entry,
        meterWorkingSinceDate: body.meterWorkingSinceDate,
      }))
    ) {
      return next;
    }
  }
  if (
    ['SetProductKind', 'RenameProduct', 'SetProductUnit', 'SetProductStatus'].includes(commandType)
  ) {
    const standIn = targetOf('productId');
    if (standIn) {
      const { productId: _productId, ...rest } = fields;
      void _productId;
      const patch: Body =
        commandType === 'SetProductKind'
          ? { kind: rest.kind, blendPercent: rest.blendPercent }
          : commandType === 'RenameProduct'
            ? { name: rest.name }
            : commandType === 'SetProductUnit'
              ? { unit: rest.unit }
              : {};
      if (commandType === 'SetProductStatus') {
        // Hiding a fuel that was never saved just means it is never created.
        const index = next.findIndex((c) => c.standIn === standIn);
        if (index >= 0 && rest.status !== 'ACTIVE') return discardStaged(next, next[index]!.id);
      }
      if (foldInto(standIn, (entry) => ({ ...entry, ...patch }))) return next;
    }
  }
  if (commandType === 'DeleteProduct' && isStandIn(str(body.productId))) {
    const index = next.findIndex((c) => c.standIn === body.productId);
    return index >= 0 ? discardStaged(next, next[index]!.id) : next;
  }
  // Deleting a tank, pump or nozzle (#315). One that is only waiting to be created is simply never
  // created; for a saved one, waiting changes to it are dropped, since it is going anyway.
  const deleted = DELETE_TARGET[commandType];
  if (deleted) {
    const target = str(body[deleted]);
    if (isStandIn(target)) {
      const index = next.findIndex((c) => c.standIn === target);
      return index >= 0 ? discardStaged(next, next[index]!.id) : next;
    }
    const kept = next.filter((c) => !mentions(c.body, target));
    if (kept.some((c) => c.url === url && JSON.stringify(c.body) === JSON.stringify(body))) {
      return kept;
    }
    const id = nextId();
    return [...kept, { id: `staged-${id}`, url, body: { ...body } }];
  }

  // Taking a price further (send, approve, start using) adds steps to the one entry for that price.
  if (commandType === 'AdvancePrice') {
    const index = next.findIndex(
      (c) => type(c) === 'AdvancePrice' && c.body.priceId === body.priceId,
    );
    if (index >= 0) {
      const first = next[index]!;
      const have = Array.isArray(first.body.steps) ? (first.body.steps as string[]) : [];
      const add = (Array.isArray(body.steps) ? (body.steps as string[]) : []).filter(
        (step) => !have.includes(step),
      );
      next[index] = { ...first, body: { ...first.body, steps: [...have, ...add] } };
      return next;
    }
  }

  // A shift added on this screen and then changed or removed before saving.
  if (commandType === 'DefineShiftTemplate') {
    const key = replaceKey({ body: body as Body })!;
    const index = next.findIndex((c) => replaceKey(c) === key);
    if (index >= 0) {
      const first = next[index]!;
      const wasNew = first.body.expectedVersion === 0;
      if (wasNew && body.active === false) return next.filter((_, i) => i !== index);
      next[index] = {
        ...first,
        body: { ...body, expectedVersion: first.body.expectedVersion },
      };
      return next;
    }
  }

  const key = replaceKey({ body: body as Body });
  if (key) {
    const index = next.findIndex((c) => replaceKey(c) === key);
    if (index >= 0) {
      next[index] = { ...next[index]!, body: { ...body } };
      return next;
    }
  }

  // The same thing entered twice is one change.
  const logical = JSON.stringify(body);
  if (next.some((c) => c.url === url && JSON.stringify(c.body) === logical)) return next;

  const id = nextId();
  const standIn = createdIdField(commandType) ? `${STAND_IN_PREFIX}${id}` : undefined;
  next.push({ id: `staged-${id}`, url, body: { ...body }, ...(standIn ? { standIn } : {}) });
  return next;
}

const PRICE_STATE_AFTER: Record<string, string> = {
  RequestPriceChange: 'PENDING_APPROVAL',
  ApprovePriceChange: 'APPROVED',
  PreparePriceActivation: 'PENDING_STATION_ACTIVATION',
  ActivatePriceChange: 'ACTIVE',
};

const sameId = (a: string, b: string) => a === b;

/** Shows the waiting changes on top of the saved setup, as though they had already been saved. */
export function applyStaged(
  data: ConfigurationSetupOverview,
  queue: readonly StagedChange[],
): ConfigurationSetupOverview {
  if (queue.length === 0) return data;
  let products: SetupProduct[] = [...(data.products ?? [])];
  let tanks: SetupTank[] = [...(data.tanks ?? [])];
  let pumps: SetupPump[] = [...(data.pumps ?? [])];
  let nozzles: SetupNozzle[] = [...(data.nozzles ?? [])];
  let shifts: SetupShiftTemplate[] = [...(data.shiftTemplates ?? [])];
  let prices = [...(data.prices ?? [])];
  let responsible = data.responsibleSupervisorMembershipId;
  const patch = <T extends { id: string }>(list: T[], id: string, change: Partial<T>): T[] =>
    list.map((item) => (sameId(item.id, id) ? { ...item, ...change } : item));

  for (const change of queue) {
    const b = change.body;
    switch (type(change)) {
      case 'CreateProduct':
        products.push({
          id: change.standIn!,
          code: str(b.code),
          name: str(b.name),
          status: 'ACTIVE',
          kind: (b.kind as string | null | undefined) ?? null,
          blendPercent: (b.blendPercent as number | null | undefined) ?? null,
          displayOrder: null,
          unit: b.unit === 'KILOGRAMS' ? 'KILOGRAMS' : 'LITRES',
        });
        break;
      case 'SetProductKind':
        products = patch(products, str(b.productId), {
          kind: b.kind as string | null,
          blendPercent: (b.blendPercent as number | null | undefined) ?? null,
        });
        break;
      case 'RenameProduct':
        products = patch(products, str(b.productId), { name: str(b.name) });
        break;
      case 'SetProductUnit':
        products = patch(products, str(b.productId), {
          unit: b.unit === 'KILOGRAMS' ? 'KILOGRAMS' : 'LITRES',
        });
        break;
      case 'SetProductStatus':
        products = patch(products, str(b.productId), { status: str(b.status) });
        break;
      case 'DeleteProduct':
        products = products.filter((p) => p.id !== str(b.productId));
        break;
      case 'DraftPriceChange':
        prices.push({
          id: change.standIn!,
          productId: str(b.productId),
          unitPrice: str(b.unitPrice),
          currency: str(b.currency) || 'USD',
          state: 'DRAFT',
          effectiveFrom: str(b.effectiveFrom),
          version: 0,
        });
        break;
      case 'AdvancePrice': {
        const steps = Array.isArray(b.steps) ? (b.steps as string[]) : [];
        const last = steps[steps.length - 1];
        const state = last ? PRICE_STATE_AFTER[last] : undefined;
        if (state) prices = patch(prices, str(b.priceId), { state });
        break;
      }
      case 'CreateTank':
        tanks.push({
          id: change.standIn!,
          code: str(b.code),
          productId: str(b.productId),
          capacityLitres: str(b.capacityLitres),
          reorderLevelLitres: (b.reorderLevelLitres as string | null | undefined) ?? null,
          acceptableVarianceLitres:
            (b.acceptableVarianceLitres as string | null | undefined) ?? null,
          varianceRedLitres: (b.varianceRedLitres as string | null | undefined) ?? null,
          status: 'ACTIVE',
          unused: true,
        });
        break;
      case 'UpdateTank':
        tanks = patch(tanks, str(b.tankId), {
          ...(str(b.productId) ? { productId: str(b.productId) } : {}),
          code: str(b.code),
          capacityLitres: str(b.capacityLitres),
          reorderLevelLitres: (b.reorderLevelLitres as string | null | undefined) ?? null,
          acceptableVarianceLitres:
            (b.acceptableVarianceLitres as string | null | undefined) ?? null,
          varianceRedLitres: (b.varianceRedLitres as string | null | undefined) ?? null,
        });
        break;
      case 'DeleteTank':
        tanks = tanks.filter((t) => t.id !== str(b.tankId));
        break;
      case 'CreatePump':
        pumps.push({
          id: change.standIn!,
          number: str(b.number),
          name: (b.name as string | null | undefined) ?? null,
          status: 'ACTIVE',
          unused: true,
        });
        break;
      case 'DeletePump':
        pumps = pumps.filter((p) => p.id !== str(b.pumpId));
        nozzles = nozzles.filter((n) => n.pumpId !== str(b.pumpId));
        break;
      case 'DeleteNozzle':
        nozzles = nozzles.filter((n) => n.id !== str(b.nozzleId));
        break;
      case 'RetirePump':
        pumps = patch(pumps, str(b.pumpId), { status: 'INACTIVE' });
        nozzles = nozzles.map((n) =>
          n.pumpId === str(b.pumpId) ? { ...n, status: 'INACTIVE' } : n,
        );
        break;
      case 'RetireNozzle':
        nozzles = patch(nozzles, str(b.nozzleId), { status: 'INACTIVE' });
        break;
      case 'UpdatePump':
        pumps = patch(pumps, str(b.pumpId), {
          number: str(b.number),
          name: (b.name as string | null | undefined) ?? null,
        });
        break;
      case 'CreateNozzle':
        nozzles.push({
          id: change.standIn!,
          pumpId: str(b.pumpId),
          number: str(b.number),
          productId: str(b.productId),
          status: 'ACTIVE',
          meterSerialNumber: str(b.meterSerialNumber) || null,
          meterWorkingSince: str(b.meterWorkingSinceDate) || null,
          meterWorkingSinceEditable: true,
          unused: true,
        });
        break;
      case 'UpdateNozzle':
        nozzles = patch(nozzles, str(b.nozzleId), { number: str(b.number) });
        break;
      case 'SetMeterWorkingSince':
        nozzles = patch(nozzles, str(b.nozzleId), {
          meterWorkingSince: str(b.meterWorkingSinceDate) || null,
        });
        break;
      case 'DefineShiftTemplate': {
        const id = str(b.shiftTemplateId);
        const row: Partial<SetupShiftTemplate> = {
          code: str(b.code),
          name: str(b.name),
          startTime: str(b.startTime) || null,
          durationMinutes: Number(b.durationMinutes) || 0,
          active: b.active !== false,
        };
        if (shifts.some((s) => s.id === id)) shifts = patch(shifts, id, row);
        else shifts.push({ id, version: 0, ...row } as SetupShiftTemplate);
        break;
      }
      case 'SetResponsibleSupervisor':
        responsible = str(b.membershipId);
        break;
    }
  }
  return {
    ...data,
    products,
    tanks,
    pumps,
    nozzles,
    shiftTemplates: shifts,
    prices,
    responsibleSupervisorMembershipId: responsible,
  };
}

const litres = (value: unknown): string => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 3 }) : str(value);
};

/** One plain-words line per waiting change. Never shows ids. */
export function describeStaged(
  change: StagedChange,
  data: ConfigurationSetupOverview,
  /** What is saved now. A delete is described from it, since the preview no longer has the item. */
  saved: ConfigurationSetupOverview = data,
): { title: string; detail?: string } {
  const b = change.body;
  const fuel = (id: unknown) => data.products?.find((p) => p.id === id)?.name ?? 'the fuel';
  const pump = (id: unknown) => data.pumps?.find((p) => p.id === id)?.number;
  switch (type(change)) {
    case 'CreateProduct':
      return { title: `Add fuel: ${str(b.name)}` };
    case 'SetProductKind':
      return { title: `Set the type of ${fuel(b.productId)}` };
    case 'RenameProduct':
      return { title: `Rename a fuel to ${str(b.name)}` };
    case 'SetProductUnit':
      return {
        title: `Measure ${fuel(b.productId)} in ${b.unit === 'KILOGRAMS' ? 'kilograms' : 'litres'}`,
      };
    case 'SetProductStatus':
      return {
        title: `${b.status === 'ACTIVE' ? 'Show' : 'Hide'} ${fuel(b.productId)}`,
      };
    case 'DeleteProduct':
      return {
        title: `Delete ${saved.products?.find((p) => p.id === b.productId)?.name ?? fuel(b.productId)}`,
      };
    case 'DraftPriceChange': {
      const unit =
        data.products?.find((p) => p.id === b.productId)?.unit === 'KILOGRAMS' ? 'kg' : 'L';
      return {
        title: `New price for ${fuel(b.productId)}: ${formatUnitPriceText(str(b.unitPrice), unit)}`,
      };
    }
    case 'AdvancePrice': {
      const steps = Array.isArray(b.steps) ? (b.steps as string[]) : [];
      const price = data.prices?.find((p) => p.id === b.priceId);
      const name = fuel(price?.productId);
      const last = steps[steps.length - 1];
      const verb =
        last === 'ActivatePriceChange'
          ? steps.includes('ApprovePriceChange')
            ? 'Approve and start using'
            : 'Start using'
          : last === 'ApprovePriceChange'
            ? 'Approve'
            : last === 'PreparePriceActivation'
              ? 'Get ready to use'
              : 'Send for approval:';
      return { title: `${verb} the price for ${name}`.replace(':  ', ': ') };
    }
    case 'CreateTank':
      return {
        title: `Add tank: ${str(b.code)}`,
        detail: `${fuel(b.productId)}, holds ${litres(b.capacityLitres)}`,
      };
    case 'UpdateTank': {
      const tank = data.tanks?.find((t) => t.id === b.tankId);
      const moved = str(b.productId) && tank && str(b.productId) !== tank.productId;
      return {
        title: `Change tank: ${str(b.code)}`,
        detail: moved
          ? `Now holds ${fuel(b.productId)} (was ${fuel(tank.productId)}), ${litres(b.capacityLitres)}`
          : `Holds ${litres(b.capacityLitres)}`,
      };
    }
    case 'DeleteTank': {
      const tank = saved.tanks?.find((t) => t.id === b.tankId);
      return {
        title: `Delete tank: ${tank?.code ?? 'a tank'}`,
        detail: tank ? fuel(tank.productId) : undefined,
      };
    }
    case 'DeletePump': {
      const count = saved.nozzles?.filter((n) => n.pumpId === b.pumpId).length ?? 0;
      return {
        title: `Delete pump ${saved.pumps?.find((p) => p.id === b.pumpId)?.number ?? ''}`.trim(),
        detail: count > 0 ? `And its ${count === 1 ? 'nozzle' : `${count} nozzles`}` : undefined,
      };
    }
    case 'DeleteNozzle': {
      const nozzle = saved.nozzles?.find((n) => n.id === b.nozzleId);
      const onPump = saved.pumps?.find((p) => p.id === nozzle?.pumpId)?.number;
      return {
        title: `Delete nozzle ${nozzle?.number ?? ''}`.trim(),
        detail: nozzle
          ? `${fuel(nozzle.productId)}${onPump ? `, on pump ${onPump}` : ''}`
          : undefined,
      };
    }
    case 'RetirePump': {
      const count = saved.nozzles?.filter((n) => n.pumpId === b.pumpId).length ?? 0;
      return {
        title:
          `Stop using pump ${saved.pumps?.find((p) => p.id === b.pumpId)?.number ?? ''}`.trim(),
        detail:
          count > 0
            ? `And its ${count === 1 ? 'nozzle' : `${count} nozzles`}. Past records are kept.`
            : 'Past records are kept.',
      };
    }
    case 'RetireNozzle': {
      const nozzle = saved.nozzles?.find((n) => n.id === b.nozzleId);
      const onPump = saved.pumps?.find((p) => p.id === nozzle?.pumpId)?.number;
      return {
        title: `Stop using nozzle ${nozzle?.number ?? ''}`.trim(),
        detail: nozzle
          ? `${fuel(nozzle.productId)}${onPump ? `, on pump ${onPump}` : ''}. Past records are kept.`
          : undefined,
      };
    }
    case 'CreatePump':
      return { title: `Add pump ${str(b.number)}` };
    case 'UpdatePump':
      return {
        title: `Change pump ${str(b.number)}`,
        detail: str(b.name) ? `Called ${str(b.name)}` : 'No name',
      };
    case 'CreateNozzle':
      return {
        title: `Add nozzle ${str(b.number)}${pump(b.pumpId) ? ` on pump ${pump(b.pumpId)}` : ''}`,
        detail: `${fuel(b.productId)}${b.meterWorkingSinceDate ? `, meter working from ${str(b.meterWorkingSinceDate)}` : ''}`,
      };
    case 'UpdateNozzle':
      return {
        title: `Change nozzle to ${str(b.number)}`,
        detail: pump(data.nozzles?.find((n) => n.id === b.nozzleId)?.pumpId)
          ? `On pump ${pump(data.nozzles?.find((n) => n.id === b.nozzleId)?.pumpId)}`
          : undefined,
      };
    case 'SetMeterWorkingSince': {
      const nozzle = data.nozzles?.find((n) => n.id === b.nozzleId);
      return {
        title: `Meter working from ${str(b.meterWorkingSinceDate)}`,
        detail: nozzle ? `Nozzle ${nozzle.number}` : undefined,
      };
    }
    case 'DefineShiftTemplate':
      return {
        title:
          b.active === false
            ? `Remove shift: ${str(b.name)}`
            : b.expectedVersion === 0
              ? `Add shift: ${str(b.name)}`
              : `Change shift: ${str(b.name)}`,
        detail: b.active === false ? undefined : `Starts at ${str(b.startTime)}`,
      };
    case 'SetResponsibleSupervisor': {
      const name = data.supervisors?.find((s) => s.membershipId === b.membershipId)?.name;
      return { title: `Put ${name ?? 'the supervisor'} in charge of the station` };
    }
    default:
      return { title: 'A change to this station' };
  }
}

/** Swaps every stand-in id in a command for the real id the server gave it. */
export function resolveStandIns<T>(value: T, real: ReadonlyMap<string, string>): T {
  if (typeof value === 'string') return (real.get(value) ?? value) as unknown as T;
  if (Array.isArray(value)) return value.map((item) => resolveStandIns(item, real)) as unknown as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, resolveStandIns(v, real)]),
    ) as T;
  }
  return value;
}

/** A short fingerprint, so editing a waiting change after a failed save never reuses its old key. */
function fingerprint(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

export type SaveAllResult =
  | { kind: 'saved' }
  | {
      kind: 'stopped';
      failedId: string;
      status: number;
      message?: string;
      remaining: StagedChange[];
    }
  | { kind: 'offline'; remaining: StagedChange[] };

/**
 * Saves the waiting changes one after another, in the order they were entered, and stops at the
 * first one the server refuses. Whatever was saved before that stays saved and leaves the list.
 */
export async function saveAllStaged(
  queue: readonly StagedChange[],
  real: Map<string, string>,
  send: typeof fetch = fetch,
  onSaved?: (id: string) => void,
): Promise<SaveAllResult> {
  for (let index = 0; index < queue.length; index += 1) {
    const change = queue[index]!;
    const resolved = resolveStandIns(change.body, real);

    // A price's steps go out one after another, each on the version the last one produced.
    const steps =
      type(change) === 'AdvancePrice' && Array.isArray(resolved.steps)
        ? (resolved.steps as string[])
        : null;
    const calls: Body[] = steps
      ? steps.map((commandType, i) => ({
          commandType,
          tenantId: resolved.tenantId,
          stationId: resolved.stationId,
          priceId: resolved.priceId,
          expectedVersion: Number(resolved.expectedVersion ?? 0) + i,
        }))
      : [resolved as Body];

    for (let step = 0; step < calls.length; step += 1) {
      const body = calls[step]!;
      // What is left of this entry if the server stops it part-way.
      const rest = (): StagedChange[] => {
        const tail = queue.slice(index + 1) as StagedChange[];
        if (!steps || step === 0) return [change, ...tail];
        return [
          {
            ...change,
            body: {
              ...change.body,
              steps: steps.slice(step),
              expectedVersion: Number(resolved.expectedVersion ?? 0) + step,
            },
          },
          ...tail,
        ];
      };
      let response: Response;
      try {
        response = await send(change.url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': `guided-setup-${change.id}-${fingerprint(JSON.stringify(body))}`,
          },
          body: JSON.stringify(body),
        });
      } catch {
        return { kind: 'offline', remaining: rest() };
      }
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as { message?: string } | null;
        return {
          kind: 'stopped',
          failedId: change.id,
          status: response.status,
          message: failure?.message,
          remaining: rest(),
        };
      }
      const field = createdIdField(type(change));
      if (change.standIn && field) {
        const answer = (await response.json().catch(() => null)) as Record<string, unknown> | null;
        const created =
          answer && typeof answer[field] === 'string' ? (answer[field] as string) : null;
        if (created) real.set(change.standIn, created);
      }
    }
    onSaved?.(change.id);
  }
  return { kind: 'saved' };
}
