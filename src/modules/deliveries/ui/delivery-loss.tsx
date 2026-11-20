'use client';

import { useState } from 'react';
import { formatQuantity } from '@/design-system/formatters';
import { Button } from '@/design-system/primitives';
import { InfoTip } from '@/design-system/info-tip';
import type { DeliveryDetail } from '../queries';
import {
  LOSS_LIABLE_PARTIES,
  LOSS_RECOVERY_STATUSES,
  VARIANCE_CAUSE_LABELS,
  checkLossRecovery,
  type LossLiableParty,
  type LossRecoveryStatus,
  type VarianceCause,
} from '../variance-assessment';

const PARTY_LABELS: Record<LossLiableParty, string> = {
  NONE: 'Nobody yet',
  DRIVER: 'The driver',
  TRANSPORTER: 'The transport company',
  SUPPLIER: 'The fuel supplier',
  OTHER: 'Someone else',
};

const STATUS_LABELS: Record<LossRecoveryStatus, string> = {
  NONE: 'No claim',
  RAISED: 'Claim raised',
  SETTLED: 'Paid back',
  WRITTEN_OFF: 'Written off',
};

export function partyLabel(value: string): string {
  return PARTY_LABELS[value as LossLiableParty] ?? value;
}

export function statusLabel(value: string): string {
  return STATUS_LABELS[value as LossRecoveryStatus] ?? value;
}

/**
 * True when there is something to explain: the litres received are not the litres on the note.
 * A delivery that matched its note has no loss section.
 */
export function hasLoss(delivery: DeliveryDetail['delivery']): boolean {
  return delivery.receipt !== 'FULL' || delivery.varianceCause !== null;
}

/**
 * The loss section of a delivery: what the note said, what arrived, what the dips say went into
 * the tank, the reason given, and who is held responsible. The system never decides who pays; it
 * keeps the owner's answer.
 */
export function DeliveryLoss({
  data,
  context,
  onSaved,
}: {
  data: DeliveryDetail;
  context: { tenantId: string; stationId: string };
  onSaved: () => void;
}) {
  const { delivery, lossClaim } = data;
  const [party, setParty] = useState<LossLiableParty>(
    (lossClaim?.liableParty as LossLiableParty | undefined) ?? 'NONE',
  );
  const [status, setStatus] = useState<LossRecoveryStatus>(
    (lossClaim?.status as LossRecoveryStatus | undefined) ?? 'NONE',
  );
  const [amount, setAmount] = useState(lossClaim?.recoveredAmount ?? '');
  const [note, setNote] = useState(lossClaim?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unit = delivery.unit;
  const short = delivery.receipt === 'PARTIAL';

  async function save() {
    const problem = checkLossRecovery({
      liableParty: party,
      status,
      amount: status === 'SETTLED' ? amount.trim() || null : null,
    });
    if (problem) return setError(problem);
    setError(null);
    setBusy(true);
    try {
      const response = await fetch('/api/deliveries/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          commandType: 'RecordDeliveryLossClaim',
          tenantId: context.tenantId,
          stationId: context.stationId,
          deliveryId: delivery.id,
          liableParty: party,
          status,
          recoveredAmount: status === 'SETTLED' ? amount.trim() : null,
          currency: status === 'SETTLED' ? 'USD' : null,
          note: note.trim() || null,
        }),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(result.message || 'The claim could not be saved. Try again.');
      }
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The claim could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dd-section" aria-labelledby="dd-loss">
      <div className="dd-section-head">
        <h3 id="dd-loss">{short ? '5. The shortage' : '5. The difference'}</h3>
      </div>
      <InfoTip>
        The tank is credited with the fuel that really arrived. This shows the gap against the note,
        what the tank dips say, and why it happened.
      </InfoTip>
      <dl className="dd-lines">
        {delivery.orderedLitres !== null ? (
          <div className="dd-line">
            <dt>Ordered</dt>
            <dd>{formatQuantity(delivery.orderedLitres, unit)} on the purchase order</dd>
          </div>
        ) : null}
        <div className="dd-line">
          <dt>Note against received</dt>
          <dd>
            {formatQuantity(delivery.noteLitres, unit)} on the note,{' '}
            {formatQuantity(delivery.receivedLitres, unit)} received (
            {formatQuantity(delivery.shortageExcessLitres.replace('-', ''), unit)}{' '}
            {short ? 'short' : 'extra'})
          </dd>
        </div>
        {delivery.dipMeasuredLitres !== null ? (
          <div className="dd-line">
            <dt>What the dips say</dt>
            <dd>
              {formatQuantity(delivery.dipMeasuredLitres, unit)} went into the tank
              {delivery.dipVarianceLitres && Number(delivery.dipVarianceLitres) !== 0
                ? `, ${formatQuantity(delivery.dipVarianceLitres.replace('-', ''), unit)} ${
                    delivery.dipVarianceLitres.startsWith('-') ? 'less' : 'more'
                  } than received`
                : ', the same as received'}
            </dd>
          </div>
        ) : null}
        <div className="dd-line">
          <dt>Reason given</dt>
          <dd>
            {delivery.varianceCause ? (
              <>
                {VARIANCE_CAUSE_LABELS[delivery.varianceCause as VarianceCause] ??
                  delivery.varianceCause}
                {delivery.varianceNote ? `. ${delivery.varianceNote}` : ''}
              </>
            ) : (
              <span className="dd-empty">None needed, the gap is within the allowance</span>
            )}
          </dd>
        </div>
        {delivery.loadTemperatureC !== null ? (
          <div className="dd-line">
            <dt>Load temperature</dt>
            <dd>{delivery.loadTemperatureC}°C</dd>
          </div>
        ) : null}
        {short ? (
          <div className="dd-line dd-line-wide">
            <dt>Who pays for it</dt>
            <dd>
              {data.canRecordClaim ? (
                <div className="form-stack">
                  <label htmlFor="loss-party">Held responsible</label>
                  <select
                    id="loss-party"
                    value={party}
                    onChange={(event) => {
                      const next = event.target.value as LossLiableParty;
                      setParty(next);
                      if (next === 'NONE') setStatus('NONE');
                      else if (status === 'NONE') setStatus('RAISED');
                    }}
                  >
                    {LOSS_LIABLE_PARTIES.map((value) => (
                      <option key={value} value={value}>
                        {PARTY_LABELS[value]}
                      </option>
                    ))}
                  </select>
                  {party !== 'NONE' ? (
                    <>
                      <label htmlFor="loss-status">What happened to the claim</label>
                      <select
                        id="loss-status"
                        value={status}
                        onChange={(event) => setStatus(event.target.value as LossRecoveryStatus)}
                      >
                        {LOSS_RECOVERY_STATUSES.filter((value) => value !== 'NONE').map((value) => (
                          <option key={value} value={value}>
                            {STATUS_LABELS[value]}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : null}
                  {status === 'SETTLED' ? (
                    <>
                      <label htmlFor="loss-amount">Amount paid back (USD)</label>
                      <input
                        id="loss-amount"
                        inputMode="decimal"
                        value={amount}
                        autoComplete="off"
                        onChange={(event) => setAmount(event.target.value)}
                      />
                    </>
                  ) : null}
                  <label htmlFor="loss-note">Note (optional)</label>
                  <textarea
                    id="loss-note"
                    rows={2}
                    maxLength={500}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                  {error ? <p role="alert">{error}</p> : null}
                  <div>
                    <Button loading={busy} onClick={() => void save()}>
                      Save
                    </Button>
                  </div>
                </div>
              ) : lossClaim ? (
                <>
                  {partyLabel(lossClaim.liableParty)}: {statusLabel(lossClaim.status)}
                  {lossClaim.recoveredAmount
                    ? ` (${lossClaim.currency ?? ''} ${lossClaim.recoveredAmount})`
                    : ''}
                </>
              ) : (
                <span className="dd-empty">No claim has been raised</span>
              )}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
