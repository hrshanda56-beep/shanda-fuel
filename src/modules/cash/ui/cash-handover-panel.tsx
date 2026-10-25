'use client';

import { useRef, useState, type FormEvent } from 'react';
import type { ContextSelection } from '@/modules/context';
import { Select } from '../../../design-system/forms';
import {
  Button,
  Card,
  EmptyState,
  Field,
  NumericInput,
  StatusBadge,
} from '../../../design-system/primitives';
import { formatTileMoney } from '../../reporting/format';
import styles from './cash-handover.module.css';
import {
  HANDOVER_STATE_LABELS,
  availableHandoverActions,
  describeHandover,
  handoverTone,
  type HandoverAction,
} from '../handover-view';

export type HandoverSummary = {
  handoverId: string;
  fromLocationId: string;
  toLocationId: string;
  expectedAmount: string;
  countedAmount: string | null;
  variance: string | null;
  state: string;
  version: number;
  reason: string | null;
  resolutionNote: string | null;
  deliveredByMembershipId: string;
  deliveredByName: string;
  receivedByName: string | null;
  submittedAt: string | null;
};

type Props = {
  context: ContextSelection;
  handovers: readonly HandoverSummary[];
  locations: readonly { locationId: string; name: string }[];
  currentMembershipId: string;
  canSubmit: boolean;
  canAccept: boolean;
  canResolve: boolean;
  hidden: boolean;
  onChanged: () => Promise<void>;
};

const ACTION_LABELS: Readonly<Record<HandoverAction, string>> = {
  accept: 'I received this cash',
  resolve: 'Settle',
  withdraw: 'Withdraw',
};

/**
 * Cash changing hands inside a station: an attendant hands the day's cash to the supervisor, and
 * the supervisor hands it on to the admin or owner. Each step needs a different person to accept.
 */
export function CashHandoverPanel(props: Props) {
  const { context, handovers, locations, onChanged } = props;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [counted, setCounted] = useState('');
  const [expected, setExpected] = useState('');
  const [settling, setSettling] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());
  const name = (id: string) => locations.find((l) => l.locationId === id)?.name ?? 'Unknown place';
  const money = (value: string) => (props.hidden ? '••••••' : formatTileMoney(value));
  const mismatch = counted !== '' && expected !== '' && Number(counted) !== Number(expected);

  async function send(payload: Record<string, unknown>, done: string): Promise<boolean> {
    const signature = JSON.stringify(payload);
    const key = keys.current.get(signature) ?? crypto.randomUUID();
    keys.current.set(signature, key);
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/cash/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': key },
        credentials: 'same-origin',
        body: JSON.stringify({ ...payload, context }),
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) {
        const fallback =
          response.status === 403
            ? 'You are not allowed to do this one.'
            : 'That could not be saved. Nothing was changed.';
        setMessage({ tone: 'error', text: result.message || fallback });
        return false;
      }
      keys.current.delete(signature);
      setMessage({ tone: 'ok', text: done });
      await onChanged();
      return true;
    } catch {
      setMessage({ tone: 'error', text: 'We could not reach the server. Nothing was changed.' });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const reason = String(data.get('reason') ?? '').trim();
    const ok = await send(
      {
        commandType: 'SubmitCashHandover',
        fromLocationId: String(data.get('fromLocationId')),
        toLocationId: String(data.get('toLocationId')),
        expectedAmount: String(data.get('expectedAmount')),
        countedAmount: String(data.get('countedAmount')),
        ...(reason ? { reason } : {}),
      },
      'Cash handed over. The other person now needs to accept it.',
    );
    if (ok) {
      form.reset();
      setCounted('');
      setExpected('');
    }
  }

  async function act(handover: HandoverSummary, action: HandoverAction, note?: string) {
    const base = { handoverId: handover.handoverId, expectedVersion: handover.version };
    if (action === 'accept') {
      await send({ commandType: 'AcceptCashHandover', ...base }, 'Cash accepted.');
    } else if (action === 'withdraw') {
      await send({ commandType: 'CancelCashHandover', ...base }, 'Handover withdrawn.');
    } else if (
      await send(
        { commandType: 'ResolveCashHandover', ...base, resolutionNote: note },
        'Handover settled.',
      )
    ) {
      setSettling(null);
    }
  }

  const viewer = {
    membershipId: props.currentMembershipId,
    canAccept: props.canAccept,
    canResolve: props.canResolve,
    canSubmit: props.canSubmit,
  };
  const open = handovers.filter((h) => h.state === 'SUBMITTED' || h.state === 'DISPUTED');
  const recent = handovers.filter((h) => h.state !== 'SUBMITTED' && h.state !== 'DISPUTED');

  return (
    <Card as="section" className="panel cash-panel" aria-labelledby="cash-handover-title">
      <div className="panel-heading">
        <div>
          <h2 id="cash-handover-title">Handing over cash</h2>
        </div>
      </div>

      {message ? (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className="field-hint">
          {message.text}
        </p>
      ) : null}

      {props.canSubmit ? (
        <form onSubmit={submit} className={styles.form}>
          <div className={styles.route}>
            <Field id="handover-from" label="Cash is coming from" required>
              <Select
                id="handover-from"
                name="fromLocationId"
                defaultValue=""
                placeholder="Choose where the cash is now"
                options={locations.map((l) => ({ value: l.locationId, label: l.name }))}
              />
            </Field>
            <span className={styles.arrow} aria-hidden="true">
              →
            </span>
            <Field id="handover-to" label="Handing it to" required>
              <Select
                id="handover-to"
                name="toLocationId"
                defaultValue=""
                placeholder="Choose where it is going"
                options={locations.map((l) => ({ value: l.locationId, label: l.name }))}
              />
            </Field>
          </div>
          <div className={styles.amounts}>
            <NumericInput
              id="handover-expected"
              name="expectedAmount"
              label="Amount that should be handed over"
              required
              inputMode="decimal"
              value={expected}
              onChange={(event) => setExpected(event.target.value)}
            />
            <NumericInput
              id="handover-counted"
              name="countedAmount"
              label="Amount you actually counted"
              required
              inputMode="decimal"
              value={counted}
              onChange={(event) => setCounted(event.target.value)}
            />
          </div>
          {mismatch ? (
            <Field
              id="handover-reason"
              label="Why is it different?"
              hint="The person receiving the cash will see this."
              required
            >
              <textarea id="handover-reason" name="reason" rows={2} maxLength={500} />
            </Field>
          ) : null}
          <div className={styles.actions}>
            <Button type="submit" disabled={busy}>
              Hand over cash
            </Button>
          </div>
        </form>
      ) : null}

      <section className={styles.waiting} aria-label="Waiting for action">
        <h3>Waiting for action</h3>
        {open.length === 0 ? (
          <EmptyState title="Nothing waiting" message="No cash is waiting to be accepted." />
        ) : (
          <ul className={styles.list} aria-label="Handovers waiting for action">
            {open.map((h) => (
              <HandoverRow
                key={h.handoverId}
                handover={h}
                from={name(h.fromLocationId)}
                to={name(h.toLocationId)}
                money={money}
                actions={availableHandoverActions(h, viewer)}
                busy={busy}
                settling={settling === h.handoverId}
                onStartSettle={() => setSettling(h.handoverId)}
                onAct={(action, note) => void act(h, action, note)}
              />
            ))}
          </ul>
        )}
      </section>

      {recent.length > 0 ? (
        <section className={styles.recent}>
          <h3>Last 14 days</h3>
          <ul className={styles.list} aria-label="Recent handovers">
            {recent.map((h) => (
              <HandoverRow
                key={h.handoverId}
                handover={h}
                from={name(h.fromLocationId)}
                to={name(h.toLocationId)}
                money={money}
                actions={[]}
                busy={busy}
                settling={false}
                onStartSettle={() => undefined}
                onAct={() => undefined}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </Card>
  );
}

function HandoverRow(props: {
  handover: HandoverSummary;
  from: string;
  to: string;
  money: (value: string) => string;
  actions: HandoverAction[];
  busy: boolean;
  settling: boolean;
  onStartSettle: () => void;
  onAct: (action: HandoverAction, note?: string) => void;
}) {
  const { handover: h } = props;
  const [note, setNote] = useState('');
  return (
    <li className="card">
      <p>
        <StatusBadge tone={handoverTone(h.state)}>
          {HANDOVER_STATE_LABELS[h.state] ?? h.state}
        </StatusBadge>{' '}
        <strong>{props.money(h.countedAmount ?? h.expectedAmount)}</strong>
        {h.variance && h.variance !== '0' ? (
          <> (should have been {props.money(h.expectedAmount)})</>
        ) : null}
      </p>
      <p>
        {describeHandover({
          from: props.from,
          to: props.to,
          deliveredByName: h.deliveredByName,
          receivedByName: h.receivedByName,
          state: h.state,
        })}
      </p>
      {h.reason ? <p>Reason given: {h.reason}</p> : null}
      {h.resolutionNote ? <p>How it was settled: {h.resolutionNote}</p> : null}
      {props.settling ? (
        <div className="stack">
          <Field id={`settle-${h.handoverId}`} label="How was this settled?" required>
            <textarea
              id={`settle-${h.handoverId}`}
              rows={2}
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          <Button
            disabled={props.busy || note.trim().length < 3}
            onClick={() => props.onAct('resolve', note.trim())}
          >
            Save and settle
          </Button>
        </div>
      ) : (
        props.actions.map((action) => (
          <Button
            key={action}
            variant={action === 'withdraw' ? 'quiet' : 'secondary'}
            disabled={props.busy}
            onClick={() => (action === 'resolve' ? props.onStartSettle() : props.onAct(action))}
          >
            {ACTION_LABELS[action]}
          </Button>
        ))
      )}
    </li>
  );
}
