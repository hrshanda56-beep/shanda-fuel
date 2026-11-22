'use client';

import { useState } from 'react';

import { Select } from '@/design-system/forms';
import { Button, Field, NumericInput } from '@/design-system/primitives';
import {
  WizardActions,
  WizardStep,
  WIZARD_REVIEW_HINT,
  WizardSummary,
  WizardSummaryRow,
  useWizard,
  type WizardErrors,
} from '@/design-system/wizard';
import { formatTileMoney } from '@/modules/reporting/format';

import {
  checkDetailsStation,
  checkLimitApprover,
  checkLimitReason,
  checkNewLimit,
  hasAnyDetail,
  parseLimit,
  type EntryDetails,
} from '../account-controls-checks';

type Approver = { membershipId: string; name: string };

function SaveError({ message }: { message: string | null }) {
  return message ? (
    <p className="field-error" role="alert">
      {message}
    </p>
  ) : null;
}

/* Change a credit limit -------------------------------------------------------- */

type LimitStep = 'limit' | 'approver' | 'reason' | 'review';

export type LimitValue = { limit: string; approverId: string; reason: string };

/** Change one customer's credit limit: the new limit, who approved it, why, then check. */
export function CreditLimitWizard({
  customerName,
  currentLimit,
  currency,
  approvers,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  customerName: string;
  currentLimit: string | null;
  currency: string;
  approvers: readonly Approver[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (value: LimitValue) => void;
}) {
  const [limit, setLimit] = useState('');
  const [approverId, setApproverId] = useState('');
  const [reason, setReason] = useState('');
  const wizard = useWizard<LimitStep>({
    start: 'limit',
    sequence: ['limit', 'approver', 'reason', 'review'],
    onCancel,
  });
  const { step, errors } = wizard;
  const money = (value: string) => formatTileMoney(value, currency);
  const approverName = approvers.find((a) => a.membershipId === approverId)?.name ?? '';

  function next() {
    if (step === 'limit') return wizard.advance(checkNewLimit(limit), 'approver', 'review');
    if (step === 'approver') {
      return wizard.advance(checkLimitApprover(approverId), 'reason', 'review');
    }
    if (step === 'reason') return wizard.advance(checkLimitReason(reason), 'review');
    onSubmit({ limit: parseLimit(limit) ?? '', approverId, reason: reason.trim() });
  }

  return (
    <form
      className="form-stack"
      noValidate
      aria-label={`Change credit limit for ${customerName}`}
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      {step === 'limit' ? (
        <WizardStep
          wizard={wizard}
          title={`What should ${customerName}'s credit limit be?`}
          hint={`The limit is now ${currentLimit === null ? 'not set' : money(currentLimit)}. It is the most they may owe at one time.`}
        >
          <NumericInput
            id="limit-new"
            label={`New credit limit (${currency})`}
            inputMode="decimal"
            required
            autoFocus
            error={errors['limit-new']}
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
          />
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'approver' ? (
        <WizardStep
          wizard={wizard}
          title="Who approved this change?"
          hint="A change to a credit limit needs an approver, and is kept on record."
        >
          <Field id="limit-approver" label="Approved by" error={errors['limit-approver']} required>
            <Select
              id="limit-approver"
              value={approverId}
              onChange={(event) => setApproverId(event.target.value)}
              placeholder="Choose a person"
              options={approvers.map((a) => ({ value: a.membershipId, label: a.name }))}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'reason' ? (
        <WizardStep wizard={wizard} title="Why is the limit changing?">
          <Field id="limit-reason" label="Reason" error={errors['limit-reason']} required>
            <textarea
              id="limit-reason"
              rows={3}
              maxLength={500}
              autoFocus
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'review' ? (
        <WizardStep wizard={wizard} title="Check the new limit" hint={WIZARD_REVIEW_HINT}>
          <WizardSummary>
            <WizardSummaryRow label="Customer">{customerName}</WizardSummaryRow>
            <WizardSummaryRow label="Limit now">
              {currentLimit === null ? 'Not set' : money(currentLimit)}
            </WizardSummaryRow>
            <WizardSummaryRow label="New limit" onChange={() => wizard.change('limit')}>
              {money(parseLimit(limit) ?? '0')}
            </WizardSummaryRow>
            <WizardSummaryRow label="Approved by" onChange={() => wizard.change('approver')}>
              {approverName}
            </WizardSummaryRow>
            <WizardSummaryRow label="Reason" onChange={() => wizard.change('reason')}>
              {reason.trim()}
            </WizardSummaryRow>
          </WizardSummary>
          <SaveError message={error} />
          <WizardActions
            wizard={wizard}
            onContinue={next}
            continueLabel="Change limit"
            busy={busy}
          />
        </WizardStep>
      ) : null}
    </form>
  );
}

/* Add details to a transaction ------------------------------------------------- */

type DetailsStep = 'station' | 'vehicle' | 'driver' | 'voucher' | 'approver' | 'review';

export type DetailsValue = EntryDetails & { stationId: string };

/** Add the vehicle, driver, voucher and approver to one transaction. Every detail can be skipped. */
export function EntryDetailsWizard({
  stations,
  initialStationId,
  approvers,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  stations: ReadonlyArray<{ id: string; name: string; code: string }>;
  initialStationId: string;
  approvers: readonly Approver[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (value: DetailsValue) => void;
}) {
  const [stationId, setStationId] = useState(initialStationId);
  const [vehicle, setVehicle] = useState('');
  const [driver, setDriver] = useState('');
  const [voucher, setVoucher] = useState('');
  const [approverId, setApproverId] = useState('');
  // The station is asked unless it is already known (from the page, or the only one).
  const askStation = !initialStationId && stations.length !== 1;
  const [problem, setProblem] = useState<string | null>(null);
  const sequence: readonly DetailsStep[] = [
    ...(askStation ? (['station'] as const) : []),
    'vehicle',
    'driver',
    'voucher',
    'approver',
    'review',
  ];
  const wizard = useWizard<DetailsStep>({
    start: askStation ? 'station' : 'vehicle',
    sequence,
    onCancel,
  });
  const { step, errors } = wizard;
  const details: EntryDetails = { vehicle, driver, voucher, approverId };
  const station = stations.find((s) => s.id === (stationId || stations[0]?.id));
  const effectiveStation = station?.id ?? '';

  function skip(to: DetailsStep, clear: () => void) {
    clear();
    wizard.go(to);
  }

  function next() {
    if (step === 'station') {
      return wizard.advance(checkDetailsStation(stationId), 'vehicle', 'review');
    }
    if (step === 'vehicle') return wizard.advance({}, 'driver', 'review');
    if (step === 'driver') return wizard.advance({}, 'voucher', 'review');
    if (step === 'voucher') return wizard.advance({}, 'approver', 'review');
    if (step === 'approver') return wizard.advance({}, 'review');
    if (!hasAnyDetail(details)) {
      setProblem('Fill in at least one of the details. Details cannot be changed once saved.');
      return;
    }
    setProblem(null);
    onSubmit({ ...details, stationId: effectiveStation });
  }

  const skipButton = (to: DetailsStep, clear: () => void) => (
    <Button type="button" variant="quiet" onClick={() => skip(to, clear)}>
      Skip
    </Button>
  );

  const textStep = (
    id: string,
    title: string,
    label: string,
    value: string,
    set: (v: string) => void,
    max: number,
    nextStep: DetailsStep,
    hint?: string,
  ) => (
    <WizardStep wizard={wizard} title={title} hint={hint ?? 'You can skip this.'}>
      <Field id={id} label={label} optional error={(errors as WizardErrors)[id]}>
        <input
          id={id}
          autoFocus
          autoComplete="off"
          maxLength={max}
          value={value}
          onChange={(event) => set(event.target.value)}
        />
      </Field>
      <WizardActions
        wizard={wizard}
        onContinue={next}
        extra={skipButton(nextStep, () => set(''))}
      />
    </WizardStep>
  );

  return (
    <form
      className="form-stack"
      noValidate
      aria-label="Add details to this transaction"
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      {step === 'station' ? (
        <WizardStep
          wizard={wizard}
          title="Which station was it at?"
          hint="Details cannot be changed once saved, so check them before you save."
        >
          <Field id="details-station" label="Station" error={errors['details-station']} required>
            <Select
              id="details-station"
              value={stationId}
              onChange={(event) => setStationId(event.target.value)}
              placeholder="Choose a station"
              options={stations.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'vehicle'
        ? textStep(
            'details-vehicle',
            'What was the vehicle registration?',
            'Vehicle registration',
            vehicle,
            setVehicle,
            20,
            'driver',
          )
        : null}
      {step === 'driver'
        ? textStep(
            'details-driver',
            "What is the driver's name?",
            "Driver's name",
            driver,
            setDriver,
            120,
            'voucher',
          )
        : null}
      {step === 'voucher'
        ? textStep(
            'details-voucher',
            'What is the voucher or slip number?',
            'Voucher or slip number',
            voucher,
            setVoucher,
            60,
            'approver',
          )
        : null}
      {step === 'approver' ? (
        <WizardStep wizard={wizard} title="Who approved it?" hint="You can skip this.">
          <Field id="details-approver" label="Approved by" optional>
            <Select
              id="details-approver"
              value={approverId}
              onChange={(event) => setApproverId(event.target.value)}
              placeholder="Not recorded"
              options={approvers.map((a) => ({ value: a.membershipId, label: a.name }))}
            />
          </Field>
          <WizardActions
            wizard={wizard}
            onContinue={next}
            extra={skipButton('review', () => setApproverId(''))}
          />
        </WizardStep>
      ) : null}
      {step === 'review' ? (
        <WizardStep
          wizard={wizard}
          title="Check the details"
          hint={`${WIZARD_REVIEW_HINT} Details cannot be changed once saved.`}
        >
          <WizardSummary>
            {askStation ? (
              <WizardSummaryRow label="Station" onChange={() => wizard.change('station')}>
                {station ? `${station.name} (${station.code})` : ''}
              </WizardSummaryRow>
            ) : null}
            <WizardSummaryRow
              label="Vehicle registration"
              onChange={() => wizard.change('vehicle')}
            >
              {vehicle.trim() || 'Not recorded'}
            </WizardSummaryRow>
            <WizardSummaryRow label="Driver's name" onChange={() => wizard.change('driver')}>
              {driver.trim() || 'Not recorded'}
            </WizardSummaryRow>
            <WizardSummaryRow
              label="Voucher or slip number"
              onChange={() => wizard.change('voucher')}
            >
              {voucher.trim() || 'Not recorded'}
            </WizardSummaryRow>
            <WizardSummaryRow label="Approved by" onChange={() => wizard.change('approver')}>
              {approvers.find((a) => a.membershipId === approverId)?.name ?? 'Not recorded'}
            </WizardSummaryRow>
          </WizardSummary>
          <SaveError message={problem ?? error} />
          <WizardActions
            wizard={wizard}
            onContinue={next}
            continueLabel="Save details"
            busy={busy}
          />
        </WizardStep>
      ) : null}
    </form>
  );
}
