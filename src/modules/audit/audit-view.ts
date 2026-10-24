/**
 * Turns signed audit records into something a manager can read: who did what, when, and what
 * changed. Pure; the server code that reads the records lives in ./queries.
 */

export type AuditChange = Readonly<{ field: string; before: string | null; after: string | null }>;

export type AuditItem = Readonly<{
  id: string;
  occurredAt: string;
  who: string;
  /** "Cash: Submit cash handover" */
  action: string;
  /** The area on its own, for filtering. */
  area: string;
  subject: string | null;
  reason: string | null;
  changes: readonly AuditChange[];
  /** True when only the new values were recorded (nothing to compare with). */
  created: boolean;
}>;

export type StoredAuditRow = Readonly<{
  id: string;
  eventCode: string;
  occurredAt: string;
  actorName: string | null;
  details: unknown;
}>;

const SENSITIVE_KEY = /(token|secret|password|passcode|signature|credential|api[-_]?key|otp)/i;
const HIDDEN = 'Hidden';
const MAX_CHANGES = 40;

function words(text: string): string {
  const spaced = text
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** "CASH.SubmitCashHandover" becomes area "Cash" and action "Cash: Submit cash handover". */
export function describeAction(code: string): { area: string; action: string } {
  const dot = code.indexOf('.');
  if (dot <= 0) return { area: 'General', action: words(code) };
  const area = words(code.slice(0, dot));
  return { area, action: `${area}: ${words(code.slice(dot + 1)).toLowerCase()}` };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type Flat = Map<string, { value: string | null; hidden: boolean }>;

function scalar(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function flatten(value: unknown, prefix: string, out: Flat): void {
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix} ${words(key).toLowerCase()}` : words(key);
      const hidden = SENSITIVE_KEY.test(key);
      if (isRecord(child) && !hidden) flatten(child, path, out);
      else out.set(path, { value: scalar(child), hidden });
    }
    return;
  }
  if (prefix) out.set(prefix, { value: scalar(value), hidden: false });
}

/**
 * The fields that differ between the old and new values, or every new value when nothing came
 * before. Secret-looking fields are compared as they are but shown only as "Hidden".
 */
export function diffAudit(before: unknown, after: unknown): AuditChange[] {
  const old: Flat = new Map();
  const next: Flat = new Map();
  flatten(before, '', old);
  flatten(after, '', next);
  const fields = [...new Set([...old.keys(), ...next.keys()])];
  const changes: AuditChange[] = [];
  for (const field of fields) {
    const was = old.get(field);
    const now = next.get(field);
    const hidden = Boolean(was?.hidden || now?.hidden);
    if ((was?.value ?? null) === (now?.value ?? null)) continue;
    changes.push({
      field,
      before: hidden ? (was?.value ? HIDDEN : null) : (was?.value ?? null),
      after: hidden ? (now?.value ? HIDDEN : null) : (now?.value ?? null),
    });
  }
  return changes.slice(0, MAX_CHANGES);
}

export function toAuditItem(row: StoredAuditRow): AuditItem {
  const details = isRecord(row.details) ? row.details : {};
  const { area, action } = describeAction(row.eventCode);
  const hasBefore = details.before !== undefined && details.before !== null;
  const subjectType = typeof details.subjectType === 'string' ? details.subjectType : null;
  const subjectId = typeof details.subjectId === 'string' ? details.subjectId : null;
  return {
    id: row.id,
    occurredAt: row.occurredAt,
    who: row.actorName?.trim() || 'Unknown person',
    action,
    area,
    subject:
      subjectType && subjectId
        ? `${words(subjectType)} ${subjectId.length > 24 ? `${subjectId.slice(0, 8)}…` : subjectId}`
        : subjectType
          ? words(subjectType)
          : null,
    reason: typeof details.reason === 'string' && details.reason.trim() ? details.reason : null,
    changes: diffAudit(details.before, details.after),
    created: !hasBefore,
  };
}
