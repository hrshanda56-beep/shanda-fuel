'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { Modal } from '@/design-system/modal';
import { SectionCard } from '@/design-system/section-card';
import { Button } from '@/design-system/primitives';
import { WizardNotice, WizardStep } from '@/design-system/wizard';
import { WizardMenu } from '@/design-system/wizard-kit';
import { OpeningBalancesWizard } from '@/modules/opening-balances/ui/opening-wizard';

import type { ConfigurationSetupOverview } from '../contracts';
import { buildFuelCards, friendlySetupError } from '../guided-setup';
import {
  addStaged,
  applyStaged,
  describeStaged,
  discardStaged,
  resolveStandIns,
  saveAllStaged,
  type StagedChange,
} from '../staged-changes';
import {
  advanceBody,
  currentPrice,
  outcomeSentence,
  planPriceChange,
  waitingPrices,
  type UnitWord,
} from '../price-wizard';
import type { FuelFlow, PlannedCommand } from '../station-wizards';
import { PriceWizard } from './price-wizard';
import { PumpWizard } from './pump-wizard';
import styles from './setup.module.css';
import { StationSetupWizard } from './station-setup-wizard';
import { AddFuelWizard, FuelEditWizard, InChargeWizard, ShiftsWizard } from './station-wizards';
import { StepUpDialog } from './step-up-dialog';
import { TankWizard } from './tank-wizard';

type Outcome = { kind: 'success' | 'error'; message: string };

/** While present, every setup save joins a waiting list instead of being sent straight away. */
const StagingContext = createContext<{
  stage: (url: string, body: Record<string, unknown>) => void;
} | null>(null);
type Gate = (save: () => Promise<void>) => void;

const STEP_UP_REUSE_MS = 5 * 60_000;

type ConfigState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; data: ConfigurationSetupOverview };

/** Reads one station's configuration. `refresh` re-reads without replacing the screen. */
export function useStationConfig(tenantId: string, stationId: string) {
  const [state, setState] = useState<ConfigState>({ kind: 'loading' });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(
          `/api/setup/overview?tenantId=${encodeURIComponent(tenantId)}&stationId=${encodeURIComponent(stationId)}`,
          { credentials: 'same-origin', cache: 'no-store', signal: controller.signal },
        );
        if (response.status === 403) {
          setState({ kind: 'unavailable' });
          return;
        }
        if (!response.ok) {
          setState({ kind: 'error' });
          return;
        }
        const body = (await response.json()) as { data?: ConfigurationSetupOverview | null };
        setState(body.data ? { kind: 'ready', data: body.data } : { kind: 'error' });
      } catch {
        if (!controller.signal.aborted) setState({ kind: 'error' });
      }
    })();
    return () => controller.abort();
  }, [tenantId, stationId, nonce]);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);
  const reload = useCallback(() => {
    setState({ kind: 'loading' });
    setNonce((value) => value + 1);
  }, []);
  return { state, refresh, reload };
}

/**
 * Posts one setup command. The idempotency key is stable per logical payload, so a retry after a
 * network failure cannot create a duplicate; it is released only after the command succeeds.
 */
function useSaver(url: string, onSaved: () => void, onDenied: () => void) {
  const keys = useRef(new Map<string, string>());
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();
  const staging = useContext(StagingContext);

  async function save(body: Record<string, unknown>, success: string): Promise<boolean> {
    if (staging) {
      // Nothing is sent here. The change joins the list that is saved once, at the end.
      staging.stage(url, body);
      setOutcome({
        kind: 'success',
        message: 'Added to your changes. Review and save when you are done.',
      });
      return true;
    }
    const logical = JSON.stringify(body);
    const key = keys.current.get(logical) ?? `guided-setup-${crypto.randomUUID()}`;
    keys.current.set(logical, key);
    setBusy(true);
    setOutcome(undefined);
    try {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as { message?: string } | null;
        if (response.status === 403) onDenied();
        setOutcome({
          kind: 'error',
          message: friendlySetupError(response.status, failure?.message),
        });
        return false;
      }
      keys.current.delete(logical);
      setOutcome({ kind: 'success', message: success });
      onSaved();
      return true;
    } catch {
      setOutcome({
        kind: 'error',
        message: 'That could not be saved. Check your connection and try again.',
      });
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { save, busy, outcome };
}

type FormContext = {
  tenantId: string;
  stationId: string;
  data: ConfigurationSetupOverview;
  refresh: () => void;
  gate: Gate;
  /** The real identity check, for the few actions that cannot wait for the review step. */
  confirm: Gate;
  onDenied: () => void;
};

function activeProducts(data: ConfigurationSetupOverview) {
  return (data.products ?? []).filter((p) => p.status === 'ACTIVE');
}
/** The word for a quantity of one fuel: "litres", "kilograms", or both when the fuel is not chosen yet. */
function quantityWord(data: ConfigurationSetupOverview, productId?: string): string {
  const unit = data.products?.find((p) => p.id === productId)?.unit;
  return unit === 'KILOGRAMS' ? 'kilograms' : unit === 'LITRES' ? 'litres' : 'litres or kilograms';
}

/** The matching word for a price: "litre", "kilogram", or both when the fuel is not chosen yet. */
function priceWord(data: ConfigurationSetupOverview, productId?: string): string {
  const unit = data.products?.find((p) => p.id === productId)?.unit;
  return unit === 'KILOGRAMS' ? 'kilogram' : unit === 'LITRES' ? 'litre' : 'litre or kilogram';
}

type ChangeKind = 'price' | 'tanks' | 'pumps' | 'fuel';

/**
 * "What do you want to change for Diesel?" for one fuel, on its own: the question, the options,
 * Cancel. The fuel is named everywhere (#318), and when the station has other fuels the last option
 * switches to one of them, so nobody is stuck on the fuel they opened.
 */
function ChangePart({
  fuelName,
  unitWord,
  otherFuels,
  onPick,
  onSwitch,
  onCancel,
}: {
  fuelName: string;
  unitWord: string;
  otherFuels: { id: string; name: string }[];
  onPick: (kind: ChangeKind) => void;
  onSwitch: () => void;
  onCancel: () => void;
}) {
  return (
    <WizardMenu<ChangeKind | 'switch'>
      title={`What do you want to change for ${fuelName}?`}
      name="fuel-change"
      onPick={(value) => (value === 'switch' ? onSwitch() : onPick(value))}
      onCancel={onCancel}
      options={[
        { value: 'price', label: `The price of ${fuelName}`, detail: `What a ${unitWord} costs` },
        { value: 'tanks', label: `The ${fuelName} tanks`, detail: 'Add or change a tank' },
        {
          value: 'pumps',
          label: 'Pumps & Nozzles',
          detail: `Add or change the ${fuelName} nozzles`,
        },
        {
          value: 'fuel',
          label: `${fuelName} itself`,
          detail: 'Name, type, how it is measured, hide',
        },
        ...(otherFuels.length > 0
          ? [
              {
                value: 'switch' as const,
                label: 'A different fuel',
                detail: otherFuels.map((f) => f.name).join(', '),
              },
            ]
          : []),
      ]}
    />
  );
}

/** The price of one fuel as a one-question-at-a-time flow (#249), then "change something else?". */
function PricePart({
  ctx,
  productId,
  onAnother,
  onFinish,
  onCancel,
}: {
  ctx: FormContext;
  productId: string;
  onAnother: () => void;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const host = useContext(StagingHostContext);
  const staging = useContext(StagingContext);
  const word: UnitWord = priceWord(ctx.data, productId) === 'kilogram' ? 'kilogram' : 'litre';
  const current = currentPrice(ctx.data, productId);
  const waiting = waitingPrices(ctx.data, productId).map((price) => ({
    price,
    label:
      advanceBody({
        tenantId: ctx.tenantId,
        stationId: ctx.stationId,
        price,
        capabilities: ctx.data.capabilities,
      })?.label ?? null,
  }));
  return (
    <PriceWizard
      fuelName={(ctx.data.products ?? []).find((p) => p.id === productId)?.name ?? 'this fuel'}
      word={word}
      current={current?.unitPrice ?? null}
      waiting={waiting}
      canRequest={ctx.data.capabilities.priceRequest}
      outcome={outcomeSentence(ctx.data.capabilities)}
      onStage={(price) =>
        host?.queueChanges(
          planPriceChange({
            tenantId: ctx.tenantId,
            stationId: ctx.stationId,
            productId,
            price,
            capabilities: ctx.data.capabilities,
          }),
        )
      }
      onAdvance={(priceId) => {
        const price = waitingPrices(ctx.data, productId).find((p) => p.id === priceId);
        const next = price
          ? advanceBody({
              tenantId: ctx.tenantId,
              stationId: ctx.stationId,
              price,
              capabilities: ctx.data.capabilities,
            })
          : null;
        if (next) staging?.stage('/api/forecourt/commands', next.body);
      }}
      onAnother={onAnother}
      onFinish={onFinish}
      onCancel={onCancel}
    />
  );
}

/** The pumps and nozzles of one fuel as a one-question-at-a-time flow (#249). */
function PumpPart({
  ctx,
  productId,
  focusMeterStart,
  onAnother,
  onFinish,
  onCancel,
}: {
  ctx: FormContext;
  productId: string;
  focusMeterStart: boolean;
  onAnother: () => void;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const host = useContext(StagingHostContext);
  return (
    <PumpWizard
      tenantId={ctx.tenantId}
      stationId={ctx.stationId}
      productId={productId}
      fuelName={(ctx.data.products ?? []).find((p) => p.id === productId)?.name ?? 'this fuel'}
      fuels={activeProducts(ctx.data).map((p) => ({ id: p.id, name: p.name }))}
      pumps={(ctx.data.pumps ?? []).filter((p) => p.status === 'ACTIVE')}
      nozzles={(ctx.data.nozzles ?? []).filter((n) => n.status === 'ACTIVE')}
      canManage={ctx.data.capabilities.forecourt}
      startWith={focusMeterStart ? 'meter-start' : undefined}
      onStage={(changes) => host?.queueChanges(changes)}
      onAnother={onAnother}
      onFinish={onFinish}
      onCancel={onCancel}
    />
  );
}

/** The tanks of one fuel as a one-question-at-a-time flow (#256), then "change something else?". */
function TankPart({
  ctx,
  productId,
  onAnother,
  onFinish,
  onCancel,
}: {
  ctx: FormContext;
  productId: string;
  onAnother: () => void;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const { save, busy } = useSaver('/api/inventory/commands', ctx.refresh, ctx.onDenied);
  const tanks = (ctx.data.tanks ?? []).filter(
    (t) => t.status === 'ACTIVE' && t.productId === productId,
  );
  return (
    <TankWizard
      tenantId={ctx.tenantId}
      stationId={ctx.stationId}
      productId={productId}
      word={quantityWord(ctx.data, productId)}
      tanks={tanks}
      allCodes={(ctx.data.tanks ?? []).map((t) => t.code)}
      fuels={activeProducts(ctx.data).map((p) => ({ id: p.id, name: p.name, kind: p.kind }))}
      allTanks={ctx.data.tanks ?? []}
      canManage={ctx.data.capabilities.tanks}
      busy={busy}
      save={(body, success) =>
        new Promise<boolean>((resolve) => {
          ctx.gate(async () => resolve(await save(body, success)));
        })
      }
      onAnother={onAnother}
      onFinish={onFinish}
      onCancel={onCancel}
    />
  );
}

/** What the waiting-changes list offers to the screens inside it. */
type StagingHostApi = {
  tenantId: string;
  stationId: string;
  /** The station as it will be once the waiting changes are saved. */
  data: ConfigurationSetupOverview;
  refresh: () => void;
  confirm: Gate;
  onDenied: () => void;
  /** True while the one-question-at-a-time new-station guide is open. */
  guiding: boolean;
  setGuiding: (on: boolean) => void;
  /** Adds the changes a wizard made and opens the review list. */
  addChanges: (changes: StagedChange[]) => void;
  /** Adds changes to the waiting list and leaves the review for later. */
  queueChanges: (changes: StagedChange[]) => void;
  /** How many changes are waiting to be saved. */
  waiting: number;
  /** Opens the list of waiting changes to review and save. */
  review: () => void;
};

const StagingHostContext = createContext<StagingHostApi | null>(null);

/** The station as it will look once the waiting changes are saved, for screens inside the list. */
export function useStagedStation(): ConfigurationSetupOverview | null {
  return useContext(StagingHostContext)?.data ?? null;
}

/** The station as it will be once saved, how many changes wait, and how to open their review. */
export function useStationWaiting(): {
  data: ConfigurationSetupOverview;
  waiting: number;
  review: () => void;
} {
  const host = useContext(StagingHostContext)!;
  return { data: host.data, waiting: host.waiting, review: host.review };
}

/** True while the one-question-at-a-time new-station guide is open. */
export function useStationGuiding(): boolean {
  return useContext(StagingHostContext)?.guiding ?? false;
}

/**
 * The invitation to set a new station up one question at a time, and the guide itself once it is
 * started. It shows only for a station that has no fuel yet.
 */
export function NewStationGuide({ stationName }: { stationName: string }) {
  const host = useContext(StagingHostContext);
  if (!host) return null;
  const { data, guiding, setGuiding } = host;
  if (guiding) {
    return (
      <StationSetupWizard
        tenantId={host.tenantId}
        stationId={host.stationId}
        stationName={stationName}
        data={data}
        onCancel={() => setGuiding(false)}
        onDone={(changes) => {
          host.addChanges(changes);
          setGuiding(false);
        }}
      />
    );
  }
  if (!data.capabilities.products || activeProducts(data).length > 0) return null;
  return (
    <SectionCard
      id="setup-guide"
      title="New station? Set it up one question at a time."
      note="We ask one thing per screen. Nothing is saved until you review it."
      action={
        <Button variant="primary" onClick={() => setGuiding(true)}>
          Start
        </Button>
      }
    />
  );
}

/** One wizard page of a station: a fuel's parts, a new fuel, the shifts, or who is in charge. */
export type WizardPart =
  | {
      kind: 'choose' | 'price' | 'tanks' | 'pumps' | 'fuel';
      productId: string;
      /** Opens a fuel's own page straight on one job, e.g. "Show it again". */
      flow?: FuelFlow;
      /** Opens the pumps wizard on correcting when a meter started working. */
      meterStart?: boolean;
    }
  | { kind: 'addFuel' }
  /** "Which fuel's price do you want to change?", from a link on another page. */
  | { kind: 'pickPrice' }
  /** "Which fuel do you want to change?", from "A different fuel" on a fuel's change menu. */
  | { kind: 'pickFuel' }
  | { kind: 'shifts' }
  | { kind: 'inCharge' }
  | { kind: 'openingBalances' };

/**
 * Draws one wizard page of the station over the page, with nothing of the old screens behind it.
 * Every change it makes joins the page's list of waiting changes.
 */
export function StationWizardPage({
  part,
  stationName,
  onOpenStaff,
  onClose,
}: {
  part: WizardPart;
  stationName: string;
  onOpenStaff?: () => void;
  onClose: () => void;
}) {
  const host = useContext(StagingHostContext)!;
  const staging = useContext(StagingContext)!;
  const [current, setCurrent] = useState<WizardPart>(part);
  const [round, setRound] = useState(0);
  const { data, tenantId, stationId } = host;
  const caps = data.capabilities;
  const ctx: FormContext = {
    tenantId,
    stationId,
    data,
    refresh: host.refresh,
    // Saves wait in the list until it is reviewed, so there is nothing to confirm per answer.
    gate: (save) => void save(),
    confirm: host.confirm,
    onDenied: host.onDenied,
  };
  const stage = (changes: PlannedCommand[]) =>
    changes.forEach((change) => staging.stage(change.url, change.body));
  const choose = (productId: string) => setCurrent({ kind: 'choose', productId });

  const product =
    'productId' in current ? (data.products ?? []).find((p) => p.id === current.productId) : null;
  const title =
    current.kind === 'addFuel'
      ? 'Add a fuel'
      : current.kind === 'pickPrice'
        ? 'Change a price'
        : current.kind === 'pickFuel'
          ? 'Change a fuel'
          : current.kind === 'shifts'
            ? 'Shifts'
            : current.kind === 'inCharge'
              ? 'Who is in charge'
              : current.kind === 'openingBalances'
                ? 'Opening balances'
                : (product?.name ?? 'Fuel');

  let body: ReactNode = null;
  if (current.kind === 'addFuel') {
    body = (
      <AddFuelWizard
        key={round}
        tenantId={tenantId}
        stationId={stationId}
        products={data.products ?? []}
        onStage={stage}
        onFinish={onClose}
        onCancel={onClose}
      />
    );
  } else if (current.kind === 'pickPrice') {
    body = (
      <WizardMenu<string>
        title="Which price do you want to change?"
        name="price-fuel"
        onPick={(productId) => setCurrent({ kind: 'price', productId })}
        onCancel={onClose}
        options={(data.products ?? [])
          .filter((p) => p.status === 'ACTIVE')
          .map((p) => ({ value: p.id, label: p.name }))}
      />
    );
  } else if (current.kind === 'shifts') {
    body = (
      <ShiftsWizard
        key={round}
        tenantId={tenantId}
        stationId={stationId}
        shifts={(data.shiftTemplates ?? []).filter((s) => s.active)}
        canManage={caps.shiftTemplates}
        onStage={stage}
        onAnother={() => setRound((n) => n + 1)}
        onFinish={onClose}
        onCancel={onClose}
      />
    );
  } else if (current.kind === 'openingBalances') {
    // The figures are saved on their own, not through the waiting list, and they need the tanks
    // and cash locations to be saved first.
    body =
      host.waiting > 0 ? (
        <WizardStep
          wizard={{ position: 1, total: 0, captureHeading: () => undefined }}
          title="Save your waiting changes first"
        >
          <WizardNotice>
            You have {host.waiting} {host.waiting === 1 ? 'change' : 'changes'} waiting to be saved.
            Save {host.waiting === 1 ? 'it' : 'them'} first, so any new tank is included, then come
            back to the opening balances.
          </WizardNotice>
          <Button onClick={onClose}>Close</Button>
        </WizardStep>
      ) : (
        <OpeningBalancesWizard
          tenantId={tenantId}
          stationId={stationId}
          stationName={stationName}
          onClose={onClose}
        />
      );
  } else if (current.kind === 'inCharge') {
    body = (
      <InChargeWizard
        tenantId={tenantId}
        stationId={stationId}
        supervisors={data.supervisors ?? []}
        currentId={data.responsibleSupervisorMembershipId}
        canManage={caps.forecourt}
        onOpenStaff={onOpenStaff}
        onStage={stage}
        onFinish={onClose}
        onCancel={onClose}
      />
    );
  } else if (current.kind === 'pickFuel') {
    body = (
      <WizardMenu<string>
        title="Which fuel do you want to change?"
        name="change-fuel"
        onPick={(productId) => choose(productId)}
        onCancel={onClose}
        options={(data.products ?? [])
          .filter((p) => p.status === 'ACTIVE')
          .map((p) => ({ value: p.id, label: p.name }))}
      />
    );
  } else if (current.kind === 'choose') {
    const productId = current.productId;
    body = (
      <ChangePart
        fuelName={product?.name ?? 'this fuel'}
        unitWord={priceWord(data, productId)}
        otherFuels={(data.products ?? [])
          .filter((p) => p.status === 'ACTIVE' && p.id !== productId)
          .map((p) => ({ id: p.id, name: p.name }))}
        onPick={(kind) => setCurrent({ kind, productId })}
        onSwitch={() => setCurrent({ kind: 'pickFuel' })}
        onCancel={onClose}
      />
    );
  } else if (current.kind === 'price') {
    const productId = current.productId;
    body = (
      <PricePart
        ctx={ctx}
        productId={productId}
        onAnother={() => choose(productId)}
        onFinish={onClose}
        onCancel={() => choose(productId)}
      />
    );
  } else if (current.kind === 'tanks') {
    const productId = current.productId;
    body = (
      <TankPart
        ctx={ctx}
        productId={productId}
        onAnother={() => choose(productId)}
        onFinish={onClose}
        onCancel={() => choose(productId)}
      />
    );
  } else if (current.kind === 'pumps') {
    const productId = current.productId;
    body = (
      <PumpPart
        ctx={ctx}
        productId={productId}
        focusMeterStart={Boolean(current.meterStart)}
        onAnother={() => choose(productId)}
        onFinish={onClose}
        onCancel={() => choose(productId)}
      />
    );
  } else if (current.kind === 'fuel' && product) {
    const productId = product.id;
    const direct = Boolean(current.flow);
    body = (
      <FuelEditWizard
        key={round}
        tenantId={tenantId}
        stationId={stationId}
        product={product}
        others={(data.products ?? []).filter((p) => p.id !== productId).map((p) => p.name)}
        canDelete={
          buildFuelCards(data).find((card) => card.productId === productId)?.status !== 'done'
        }
        startWith={current.flow}
        canManage={caps.products}
        onStage={stage}
        onAnother={() => choose(productId)}
        onFinish={onClose}
        onCancel={direct ? onClose : () => choose(productId)}
      />
    );
  }

  return (
    <Modal open onClose={onClose} title={title} presentation="page" size="md">
      {body}
    </Modal>
  );
}

/**
 * Holds every setup change on the screen and saves them together. This is the one place the
 * "Confirm it is you" check and the save button appear: the person fills things in freely, then
 * reviews a plain list of what will change and confirms once. It wraps a whole station page, so
 * the list survives while wizards open and close.
 */
export function StationStaging({
  tenantId,
  stationId,
  serverData,
  refresh,
  children,
}: {
  tenantId: string;
  stationId: string;
  /** Kept for callers that pass it; the list does not need the name. */
  stationName?: string;
  serverData: ConfigurationSetupOverview;
  refresh: () => void;
  children: ReactNode;
}) {
  const [queue, setQueue] = useState<StagedChange[]>([]);
  const realIds = useRef(new Map<string, string>());
  const confirmedUntil = useRef(0);
  const [pending, setPending] = useState<(() => Promise<void>) | null>(null);
  const [reviewing, setReviewing] = useState(false);
  // The one-question-at-a-time guide replaces the checklist while it is open.
  const [guiding, setGuiding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string>();
  // After a save the screen keeps showing the saved items until the fresh read arrives.
  const [settleTo, setSettleTo] = useState<StagedChange[] | null>(null);

  const data = useMemo(() => applyStaged(serverData, queue), [serverData, queue]);
  const staging = useMemo(
    () => ({
      stage: (url: string, body: Record<string, unknown>) => {
        setProblem(undefined);
        setQueue((current) => addStaged(current, url, body));
      },
    }),
    [],
  );

  // Only a fresh read from the server settles the list (adjusting state while rendering, as React
  // documents for state that follows a prop).
  const [seenData, setSeenData] = useState(serverData);
  if (seenData !== serverData) {
    setSeenData(serverData);
    if (settleTo !== null) {
      setQueue(settleTo);
      setSettleTo(null);
    }
  }

  useEffect(() => {
    if (queue.length === 0) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [queue.length]);

  const confirm: Gate = (save) => {
    // Runs only from event handlers, never during render.
    if (Date.now() < confirmedUntil.current) void save();
    else setPending(() => save);
  };
  const onDenied = () => {
    confirmedUntil.current = 0;
  };

  async function saveAll() {
    const sending = queue;
    setSaving(true);
    setProblem(undefined);
    const result = await saveAllStaged(sending, realIds.current);
    setSaving(false);
    if (result.kind === 'saved') {
      setReviewing(false);
      setSettleTo([]);
      refresh();
      return;
    }
    // Whatever was saved before the problem stays saved; the rest waits so it can be fixed.
    const remaining = result.remaining.map((c) => ({
      ...c,
      body: resolveStandIns(c.body, realIds.current),
    }));
    if (remaining.length < sending.length || remaining[0]?.body !== sending[0]?.body) {
      setSettleTo(remaining);
      refresh();
    }
    if (result.kind === 'offline') {
      setProblem(
        'That could not be saved. Check your connection and try again. Nothing after this point was saved.',
      );
      return;
    }
    if (result.status === 403) onDenied();
    const failed = describeStaged(result.remaining[0]!, data, serverData).title;
    setProblem(
      `${failed} could not be saved. ${friendlySetupError(result.status, result.message)}${
        remaining.length < sending.length ? ' Everything before it was saved.' : ''
      }`,
    );
  }

  const lines = queue.map((change) => ({ change, ...describeStaged(change, data, serverData) }));
  const count = queue.length;

  const host = useMemo<StagingHostApi>(
    () => ({
      tenantId,
      stationId,
      data,
      refresh,
      confirm,
      onDenied,
      guiding,
      setGuiding,
      addChanges: (changes) => {
        setProblem(undefined);
        setQueue((current) => [...current, ...changes]);
        setReviewing(true);
      },
      queueChanges: (changes) => {
        setProblem(undefined);
        setQueue((current) => [...current, ...changes]);
      },
      waiting: count,
      review: () => setReviewing(true),
    }),
    // `confirm` and `onDenied` only read refs and set state, so they stay current without being deps.
    [tenantId, stationId, data, refresh, guiding, count],
  );

  return (
    <StagingContext.Provider value={staging}>
      <StagingHostContext.Provider value={host}>{children}</StagingHostContext.Provider>
      {count > 0 && !guiding ? (
        <div className={styles.reviewBar} role="region" aria-label="Changes waiting to be saved">
          <span className={styles.reviewBarText}>
            {count === 1 ? '1 change is waiting.' : `${count} changes are waiting.`} Nothing is
            saved yet.
          </span>
          <Button onClick={() => setReviewing(true)}>Review and save</Button>
        </div>
      ) : null}
      <Modal
        open={reviewing && pending === null}
        onClose={() => !saving && setReviewing(false)}
        title="Review your changes"
        description="This is everything that will be saved. Nothing is saved until you confirm."
        size="md"
        dismissible={!saving}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReviewing(false)} disabled={saving}>
              Keep editing
            </Button>
            <Button loading={saving} disabled={count === 0} onClick={() => confirm(saveAll)}>
              {count === 1 ? 'Save this change' : `Save ${count} changes`}
            </Button>
          </>
        }
      >
        {lines.length === 0 ? (
          <p className={styles.note}>There is nothing waiting to be saved.</p>
        ) : (
          <ul className={styles.reviewList} aria-label="Changes to save">
            {lines.map((line) => (
              <li key={line.change.id} className={styles.reviewItem}>
                <span className={styles.stepText}>
                  <span className={styles.rowTitle}>{line.title}</span>
                  {line.detail ? <span className={styles.rowDetail}>{line.detail}</span> : null}
                </span>
                <Button
                  variant="secondary"
                  disabled={saving}
                  aria-label={`Remove: ${line.title}`}
                  onClick={() => setQueue((current) => discardStaged(current, line.change.id))}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        {problem ? (
          <p className={styles.messageError} role="alert">
            {problem}
          </p>
        ) : null}
      </Modal>
      <StepUpDialog
        open={pending !== null}
        tenantId={tenantId}
        description="Saving your changes needs a fresh identity check. Nothing is saved until you confirm."
        onCancel={() => setPending(null)}
        onVerified={() => {
          confirmedUntil.current = Date.now() + STEP_UP_REUSE_MS;
          const save = pending;
          setPending(null);
          if (save) void save();
        }}
      />
    </StagingContext.Provider>
  );
}

/** The three-dots button of a fuel card and the short list of actions it opens. */
