'use client';

import { useState } from 'react';
import { formatQuantity } from '@/design-system/formatters';
import { Button } from '@/design-system/primitives';
import { InfoTip } from '@/design-system/info-tip';
import type { DeliveryDetail } from '../queries';
import {
  LOSS_LIABLE_PARTIES,
  LOSS_RECOVERY_STATUSES,
  LOSS_SETTLEMENT_METHODS,
  VARIANCE_CAUSE_LABELS,
  checkLossRecovery,
  type LossLiableParty,
  type LossRecoveryStatus,
  type LossSettlementMethod,
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

const METHOD_LABELS: Record<LossSettlementMethod, string> = {
  CASH: 'Paid to us in cash',
  TRANSPORT_BILL: "Taken off the transport company's bill",
  SUPPLIER_BALANCE: 'Taken off what we owe the supplier',
};

export function methodLabel(value: string): string {
  return METHOD_LABELS[value as LossSettlementMethod] ?? value;
}

export function approvalLabel(value: string): string {
  if (value === 'PENDING') return 'Waiting for approval';
  if (value === 'APPROVED') return 'Approved';
  if (value === 'REJECTED') return 'Sent back';
  return '';
}

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
  const [expected, setExpected] = useState(lossClaim?.expectedAmount ?? '');
  const [amount, setAmount] = useState(lossClaim?.recoveredAmount ?? '');
  const [method, setMethod] = useState<LossSettlementMethod | ''>(
    (lossClaim?.settlementMethod as LossSettlementMethod | null | undefined) ?? '',
  );
  const [currency, setCurrency] = useState(lossClaim?.currency ?? 'USD');
  const [reviewNote, setReviewNote] = useState('');
  const [note, setNote] = useState(lossClaim?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unit = delivery.unit;
  const short = delivery.receipt === 'PARTIAL';

  async function save() {
    const expectedText = status === 'RAISED' ? expected.trim() || null : null;
    const recoveredText = status === 'SETTLED' ? amount.trim() || null : null;
    const code = currency.trim().toUpperCase();
    const problem = checkLossRecovery({
      liableParty: party,
      status,
      expectedAmount: expectedText ?? lossClaim?.expectedAmount ?? null,
      recoveredAmount: recoveredText,
      settlementMethod: status === 'SETTLED' && method ? method : null,
      currency: code || null,
    });
    if (problem) return setError(problem);
    if (code && !/^[A-Z]{3}$/.test(code)) {
      return setError('Write the currency as three letters, for example USD.');
    }
    await send({
      commandType: 'RecordDeliveryLossClaim',
      liableParty: party,
      status,
      expectedAmount: expectedText,
      recoveredAmount: recoveredText,
      settlementMethod: status === 'SETTLED' && method ? method : null,
      currency: expectedText || recoveredText ? code : null,
      note: note.trim() || null,
    });
  }

  async function review(decision: 'APPROVED' | 'REJECTED') {
    if (decision === 'REJECTED' && !reviewNote.trim()) {
      return setError('Say why you are sending it back.');
    }
    await send({
      commandType: 'ReviewDeliveryLossClaim',
      decision,
      note: reviewNote.trim() || null,
    });
  }

  async function send(body: Record<string, unknown>) {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch('/api/deliveries/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          ...body,
          tenantId: context.tenantId,
          stationId: context.stationId,
          deliveryId: delivery.id,
        }),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(result.message || 'That could not be saved. Try again.');
      }
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That could not be saved.');
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
        what the tank dips say, and why it happened. Claims are only recorded here: nothing is
        changed in the accounts yet, and an administrator or owner approves each change.
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
                  {status === 'RAISED' ? (
                    <>
                      <label htmlFor="loss-expected">Amount we expect to get back</label>
                      <input
                        id="loss-expected"
                        inputMode="decimal"
                        value={expected}
                        autoComplete="off"
                        onChange={(event) => setExpected(event.target.value)}
                      />
                    </>
                  ) : null}
                  {status === 'SETTLED' ? (
                    <>
                      <label htmlFor="loss-amount">Amount paid back</label>
                      <input
                        id="loss-amount"
                        inputMode="decimal"
                        value={amount}
                        autoComplete="off"
                        onChange={(event) => setAmount(event.target.value)}
                      />
                      <label htmlFor="loss-method">How it was paid back</label>
                      <select
                        id="loss-method"
                        value={method}
                        onChange={(event) =>
                          setMethod(event.target.value as LossSettlementMethod | '')
                        }
                      >
                        <option value="">Choose how</option>
                        {LOSS_SETTLEMENT_METHODS.map((value) => (
                          <option key={value} value={value}>
                            {METHOD_LABELS[value]}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : null}
                  {status === 'RAISED' || status === 'SETTLED' ? (
                    <>
                      <label htmlFor="loss-currency">Currency</label>
                      <input
                        id="loss-currency"
                        value={currency}
                        maxLength={3}
                        autoComplete="off"
                        onChange={(event) => setCurrency(event.target.value.toUpperCase())}
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
        {lossClaim && lossClaim.status !== 'NONE' ? (
          <div className="dd-line dd-line-wide">
            <dt>Where the claim stands</dt>
            <dd>
              {lossClaim.expectedAmount
                ? `Expected back: ${lossClaim.currency ?? ''} ${lossClaim.expectedAmount}. `
                : ''}
              {lossClaim.recoveredAmount
                ? `Paid back: ${lossClaim.currency ?? ''} ${lossClaim.recoveredAmount}${
                    lossClaim.settlementMethod ? `, ${methodLabel(lossClaim.settlementMethod)}` : ''
                  }. `
                : ''}
              {approvalLabel(lossClaim.approvalStatus)}
              {lossClaim.approvalNote ? `: ${lossClaim.approvalNote}` : ''}
              {data.canApproveClaim ? (
                <div className="form-stack">
                  <label htmlFor="loss-review-note">Note (needed if you send it back)</label>
                  <textarea
                    id="loss-review-note"
                    rows={2}
                    maxLength={500}
                    value={reviewNote}
                    onChange={(event) => setReviewNote(event.target.value)}
                  />
                  {error ? <p role="alert">{error}</p> : null}
                  <div>
                    <Button loading={busy} onClick={() => void review('APPROVED')}>
                      Approve
                    </Button>{' '}
                    <Button loading={busy} onClick={() => void review('REJECTED')}>
                      Send back
                    </Button>
                  </div>
                </div>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
