/**
 * Stage 2 of offline drafts: a save that could not reach the server is kept on this device and sent
 * again when the connection is back. The queue only ever replays the exact commands, with the exact
 * idempotency keys, that the screen already tried, so a replay can never post twice. If the record
 * moved on while the device was offline the server refuses the old version; that is shown to the
 * person as a conflict and nothing is overwritten.
 *
 * Everything here is pure apart from the storage and `send` passed in, and every storage call is
 * guarded: a blocked or full store just means "nothing queued".
 */

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const PREFIX = 'shanda-fuel:outbox:';
/** Saves stay on the device until someone sends or discards them, but never beyond this. */
export const OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const OUTBOX_MAX_ENTRIES = 20;

export type QueuedStep = Readonly<{
  commandType: string;
  /** Everything the command needs except the record version, which is filled in when it is sent. */
  body: Readonly<Record<string, unknown>>;
  idempotencyKey: string;
}>;

export type QueuedStatus = 'WAITING' | 'CONFLICT' | 'REJECTED';

export type QueuedSave = Readonly<{
  /** Stable for one save attempt, so queueing the same attempt twice keeps one copy. */
  id: string;
  url: string;
  label: string;
  queuedAt: number;
  steps: readonly QueuedStep[];
  /** Index of the first step the server has not accepted yet. */
  nextIndex: number;
  /** Record version to send with the next step. */
  version: number;
  status: QueuedStatus;
  message?: string;
}>;

/** Thrown by a sender when the request never reached the server (no connection, timeout). */
export class OfflineError extends Error {
  constructor(message = 'There is no connection to the server.') {
    super(message);
    this.name = 'OfflineError';
  }
}

export function outboxStorageKey(parts: readonly (string | undefined | null)[]): string {
  return PREFIX + parts.map((part) => encodeURIComponent(part ?? '-')).join(':');
}

function browserStore(): Store | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isQueuedSave(value: unknown): value is QueuedSave {
  if (value === null || typeof value !== 'object') return false;
  const entry = value as Partial<QueuedSave>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.url === 'string' &&
    typeof entry.label === 'string' &&
    typeof entry.queuedAt === 'number' &&
    typeof entry.nextIndex === 'number' &&
    typeof entry.version === 'number' &&
    (entry.status === 'WAITING' || entry.status === 'CONFLICT' || entry.status === 'REJECTED') &&
    Array.isArray(entry.steps) &&
    entry.steps.every(
      (step) =>
        step !== null &&
        typeof step === 'object' &&
        typeof step.commandType === 'string' &&
        typeof step.idempotencyKey === 'string' &&
        step.body !== null &&
        typeof step.body === 'object',
    ) &&
    entry.nextIndex >= 0 &&
    entry.nextIndex <= entry.steps.length
  );
}

export function listQueued(
  key: string,
  now: number = Date.now(),
  store: Store | null = browserStore(),
): QueuedSave[] {
  if (!store) return [];
  try {
    const raw = store.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      store.removeItem(key);
      return [];
    }
    return parsed.filter(
      (entry): entry is QueuedSave =>
        isQueuedSave(entry) &&
        entry.queuedAt <= now + 60_000 &&
        now - entry.queuedAt <= OUTBOX_MAX_AGE_MS,
    );
  } catch {
    return [];
  }
}

function write(key: string, entries: readonly QueuedSave[], store: Store | null): boolean {
  if (!store) return false;
  try {
    if (entries.length === 0) store.removeItem(key);
    else store.setItem(key, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

/** Queue a save, or refresh it if the same attempt is already queued. False when it cannot be kept. */
export function enqueueSave(
  key: string,
  save: Omit<QueuedSave, 'status' | 'message' | 'queuedAt'> & { queuedAt?: number },
  now: number = Date.now(),
  store: Store | null = browserStore(),
): boolean {
  const others = listQueued(key, now, store).filter((entry) => entry.id !== save.id);
  if (others.length >= OUTBOX_MAX_ENTRIES) return false;
  return write(
    key,
    [...others, { ...save, queuedAt: save.queuedAt ?? now, status: 'WAITING' }],
    store,
  );
}

export function discardQueued(
  key: string,
  id: string,
  now: number = Date.now(),
  store: Store | null = browserStore(),
): void {
  write(
    key,
    listQueued(key, now, store).filter((entry) => entry.id !== id),
    store,
  );
}

/** What the server said to one step. */
export type StepResult =
  | Readonly<{ kind: 'ok'; version: number | null }>
  /** The record changed since the save was typed, or is locked. Needs a person to decide. */
  | Readonly<{ kind: 'conflict'; message: string }>
  /** The server will never accept this as it stands. Needs a person to look. */
  | Readonly<{ kind: 'rejected'; message: string }>
  /** No connection, signed out, busy server: try again later. */
  | Readonly<{ kind: 'retry' }>;

/** How a failed HTTP response should be treated. Pure; 2xx is handled by the caller. */
export function classifyFailure(status: number, message: string): StepResult {
  if (status === 409) return { kind: 'conflict', message };
  if (status === 401 || status === 408 || status === 425 || status === 429 || status >= 500) {
    return { kind: 'retry' };
  }
  return { kind: 'rejected', message };
}

export type SyncOutcome = Readonly<{
  sent: readonly string[];
  conflicts: readonly string[];
  rejected: readonly string[];
  /** Still waiting for a connection. */
  waiting: number;
}>;

/**
 * Send what is queued, oldest first. A queued save stops at the first step the server does not
 * accept; steps before it are never sent again. Nothing is sent for a save that already needs a
 * person (conflict or rejected). Returns what happened so the screen can say so.
 */
export function syncQueued(
  key: string,
  send: (step: QueuedStep, version: number, save: QueuedSave) => Promise<StepResult>,
  now: number = Date.now(),
  store: Store | null = browserStore(),
): Promise<SyncOutcome> {
  // The screen asks to send on load and again when the browser reports it is online. Two runs
  // reading the same storage could send one step twice, so a second request joins the first.
  const running = inFlight.get(key);
  if (running) return running;
  const run = sendQueuedSaves(key, send, now, store).finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

const inFlight = new Map<string, Promise<SyncOutcome>>();

async function sendQueuedSaves(
  key: string,
  send: (step: QueuedStep, version: number, save: QueuedSave) => Promise<StepResult>,
  now: number,
  store: Store | null,
): Promise<SyncOutcome> {
  const sent: string[] = [];
  const conflicts: string[] = [];
  const rejected: string[] = [];
  let entries = listQueued(key, now, store).sort((a, b) => a.queuedAt - b.queuedAt);
  const replace = (next: QueuedSave) => {
    entries = entries.map((entry) => (entry.id === next.id ? next : entry));
    write(key, entries, store);
  };
  let offline = false;

  for (const original of entries) {
    if (offline) break;
    let save = original;
    if (save.status !== 'WAITING') continue;
    while (save.nextIndex < save.steps.length) {
      const step = save.steps[save.nextIndex]!;
      let result: StepResult;
      try {
        result = await send(step, save.version, save);
      } catch {
        result = { kind: 'retry' };
      }
      if (result.kind === 'ok') {
        save = {
          ...save,
          nextIndex: save.nextIndex + 1,
          version: result.version ?? save.version + 1,
        };
        replace(save);
        continue;
      }
      if (result.kind === 'retry') {
        offline = true;
        break;
      }
      save = {
        ...save,
        status: result.kind === 'conflict' ? 'CONFLICT' : 'REJECTED',
        message: result.message,
      };
      replace(save);
      (result.kind === 'conflict' ? conflicts : rejected).push(save.id);
      break;
    }
    if (save.status === 'WAITING' && save.nextIndex >= save.steps.length) {
      sent.push(save.id);
      entries = entries.filter((entry) => entry.id !== save.id);
      write(key, entries, store);
    }
  }

  return {
    sent,
    conflicts,
    rejected,
    waiting: entries.filter((entry) => entry.status === 'WAITING').length,
  };
}
