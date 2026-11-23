'use client';

import { useState } from 'react';

import { Select } from '@/design-system/forms';
import { Field, NumericInput } from '@/design-system/primitives';
import {
  WizardActions,
  WizardNotice,
  WizardStep,
  WIZARD_REVIEW_HINT,
  WizardSummary,
  WizardSummaryRow,
  useWizard,
} from '@/design-system/wizard';
import { WizardAnother } from '@/design-system/wizard-kit';

import {
  type Errors,
  checkBankAccountPick,
  checkBankFrom,
  checkBankLine,
  checkBankLinesDistinct,
  checkBankReference,
  checkCollectAmount,
  checkCollectReference,
  checkCollectShift,
  checkCollectWhere,
  checkConfirmAmount,
  checkConfirmDate,
  checkConfirmReason,
  checkConfirmReference,
  checkReceiveCash,
  checkReceiveWhere,
  cleanAmount,
  confirmDiffers,
} from '../cash-sheet-checks';
import { formatMoney } from '@/design-system/formatters';

type Option = { value: string; label: string };

function labelOf(options: readonly Option[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? '';
}

/** The error from a failed save, shown above the buttons of the last screen. */
function SaveError({ message }: { message: string | null }) {
  return message ? (
    <p className="field-error" role="alert">
      {message}
    </p>
  ) : null;
}

/* Collect cash ----------------------------------------------------------------- */

type CollectStep = 'shift' | 'where' | 'amount' | 'reference' | 'review';

export type CollectValue = {
  reconciliationId: string;
  sourceLocationId: string;
  amount: string;
  collectionReference: string;
};

/** Record the cash collected from an approved shift, one question at a time. */
export function CollectCashWizard({
  sources,
  locations,
  paidOutNote,
  money,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  sources: ReadonlyArray<{ reconciliationId: string; businessDate: string; availableCash: string }>;
  locations: readonly Option[];
  /** Said when cash was paid out of the till since the last collection. */
  paidOutNote: string | null;
  money: (value: string) => string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (value: CollectValue) => void;
}) {
  const only = sources.length === 1 ? sources[0] : undefined;
  const [shiftId, setShiftId] = useState(only?.reconciliationId ?? '');
  const [whereId, setWhereId] = useState(locations.length === 1 ? (locations[0]?.value ?? '') : '');
  const [amount, setAmount] = useState(only?.availableCash ?? '');
  const [reference, setReference] = useState('');

  const sequence: readonly CollectStep[] = ['shift', 'where', 'amount', 'reference', 'review'];
  const wizard = useWizard<CollectStep>({ start: 'shift', sequence, onCancel });
  const { step, errors } = wizard;
  const shift = sources.find((source) => source.reconciliationId === shiftId);

  function next() {
    if (step === 'shift') return wizard.advance(checkCollectShift(shiftId), 'where', 'review');
    if (step === 'where') return wizard.advance(checkCollectWhere(whereId), 'amount', 'review');
    if (step === 'amount') {
      return wizard.advance(
        checkCollectAmount(amount, shift?.availableCash ?? '0'),
        'reference',
        'review',
      );
    }
    if (step === 'reference') return wizard.advance(checkCollectReference(reference), 'review');
    onSubmit({
      reconciliationId: shiftId,
      sourceLocationId: whereId,
      amount: cleanAmount(amount),
      collectionReference: reference.trim(),
    });
  }

  return (
    <form
      className="form-stack"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      {step === 'shift' ? (
        <WizardStep
          wizard={wizard}
          title="Which shift is the cash from?"
          hint="Only shifts with approved cash are listed."
        >
          <Field id="collect-shift" label="Shift cash" error={errors['collect-shift']} required>
            <Select
              id="collect-shift"
              value={shiftId}
              onChange={(event) => {
                const picked = sources.find((s) => s.reconciliationId === event.target.value);
                setShiftId(event.target.value);
                // The amount starts at everything available, so most people just confirm it.
                setAmount(picked?.availableCash ?? '');
              }}
              placeholder="Choose a shift"
              options={sources.map((source) => ({
                value: source.reconciliationId,
                label: `${source.businessDate} · ${formatMoney(source.availableCash)} available`,
              }))}
            />
          </Field>
          {paidOutNote ? <WizardNotice>{paidOutNote}</WizardNotice> : null}
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'where' ? (
        <WizardStep
          wizard={wizard}
          title="Where is the cash now?"
          hint="Choose the place it is being kept."
        >
          <Field
            id="collect-where"
            label="Where the cash is"
            error={errors['collect-where']}
            required
          >
            <Select
              id="collect-where"
              value={whereId}
              onChange={(event) => setWhereId(event.target.value)}
              placeholder="Choose a location"
              options={locations}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'amount' ? (
        <WizardStep
          wizard={wizard}
          title="How much cash did you collect?"
          hint={
            shift ? `Up to ${money(shift.availableCash)} is available from this shift.` : undefined
          }
        >
          <NumericInput
            id="collect-amount"
            label="Amount"
            unit="USD"
            inputMode="decimal"
            required
            autoFocus
            error={errors['collect-amount']}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'reference' ? (
        <WizardStep
          wizard={wizard}
          title="What reference should this collection have?"
          hint="Something you can find it by later, such as a bag or slip number."
        >
          <Field
            id="collect-reference"
            label="Reference"
            error={errors['collect-reference']}
            required
          >
            <input
              id="collect-reference"
              autoFocus
              maxLength={80}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'review' ? (
        <WizardStep wizard={wizard} title="Check the collection" hint={WIZARD_REVIEW_HINT}>
          <WizardSummary>
            <WizardSummaryRow label="Shift" onChange={() => wizard.change('shift')}>
              {shift ? shift.businessDate : ''}
            </WizardSummaryRow>
            <WizardSummaryRow label="Cash is at" onChange={() => wizard.change('where')}>
              {labelOf(locations, whereId)}
            </WizardSummaryRow>
            <WizardSummaryRow label="Amount" onChange={() => wizard.change('amount')}>
              {money(cleanAmount(amount))}
            </WizardSummaryRow>
            <WizardSummaryRow label="Reference" onChange={() => wizard.change('reference')}>
              {reference.trim()}
            </WizardSummaryRow>
          </WizardSummary>
          <SaveError message={error} />
          <WizardActions
            wizard={wizard}
            onContinue={next}
            continueLabel="Collect cash"
            busy={busy}
          />
        </WizardStep>
      ) : null}
    </form>
  );
}

/* Receive cash ----------------------------------------------------------------- */

type ReceiveStep = 'cash' | 'where' | 'review';

export type ReceiveValue = { collectionId: string; targetLocationId: string };

/** Confirm that cash handed over from another place has arrived. */
export function ReceiveCashWizard({
  collections,
  locations,
  money,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  collections: ReadonlyArray<{ collectionId: string; collectionReference: string; amount: string }>;
  locations: readonly Option[];
  money: (value: string) => string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (value: ReceiveValue) => void;
}) {
  const [collectionId, setCollectionId] = useState(
    collections.length === 1 ? (collections[0]?.collectionId ?? '') : '',
  );
  const [whereId, setWhereId] = useState('');
  const wizard = useWizard<ReceiveStep>({
    start: 'cash',
    sequence: ['cash', 'where', 'review'],
    onCancel,
  });
  const { step, errors } = wizard;
  const picked = collections.find((c) => c.collectionId === collectionId);

  function next() {
    if (step === 'cash') return wizard.advance(checkReceiveCash(collectionId), 'where', 'review');
    if (step === 'where') return wizard.advance(checkReceiveWhere(whereId), 'review');
    onSubmit({ collectionId, targetLocationId: whereId });
  }

  return (
    <form
      className="form-stack"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      {step === 'cash' ? (
        <WizardStep
          wizard={wizard}
          title="Which cash has arrived?"
          hint="Confirm that cash handed over from another location has arrived."
        >
          <Field id="receive-cash" label="Cash to receive" error={errors['receive-cash']} required>
            <Select
              id="receive-cash"
              value={collectionId}
              onChange={(event) => setCollectionId(event.target.value)}
              placeholder="Choose cash"
              options={collections.map((collection) => ({
                value: collection.collectionId,
                label: `${collection.collectionReference} · ${formatMoney(collection.amount)}`,
              }))}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'where' ? (
        <WizardStep
          wizard={wizard}
          title="Where did it arrive?"
          hint="Choose the place it is now kept."
        >
          <Field
            id="receive-where"
            label="Receiving location"
            error={errors['receive-where']}
            required
          >
            <Select
              id="receive-where"
              value={whereId}
              onChange={(event) => setWhereId(event.target.value)}
              placeholder="Choose where it arrived"
              options={locations}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'review' ? (
        <WizardStep wizard={wizard} title="Check the cash received" hint={WIZARD_REVIEW_HINT}>
          <WizardSummary>
            <WizardSummaryRow label="Cash" onChange={() => wizard.change('cash')}>
              {picked ? `${picked.collectionReference} · ${money(picked.amount)}` : ''}
            </WizardSummaryRow>
            <WizardSummaryRow label="Arrived at" onChange={() => wizard.change('where')}>
              {labelOf(locations, whereId)}
            </WizardSummaryRow>
          </WizardSummary>
          <SaveError message={error} />
          <WizardActions
            wizard={wizard}
            onContinue={next}
            continueLabel="Receive cash"
            busy={busy}
          />
        </WizardStep>
      ) : null}
    </form>
  );
}

/* Bank cash -------------------------------------------------------------------- */

type BankStep = 'account' | 'cash' | 'more' | 'from' | 'reference' | 'review';

export type BankValue = {
  bankAccountId: string;
  sourceLocationId: string;
  depositReference: string;
  allocations: Array<{ collectionId: string; amount: string }>;
};

type Bankable = {
  collectionId: string;
  collectionReference: string;
  availableAtStation: string;
  currentLocationId: string;
};

/** Record cash taken to the bank. The cash lines repeat: pick cash, then "add more cash?". */
export function BankCashWizard({
  accounts,
  collections,
  locations,
  initialCollectionId,
  money,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  accounts: readonly Option[];
  collections: readonly Bankable[];
  locations: readonly Option[];
  /** Cash already chosen when the person came from a row's "Bank" button. */
  initialCollectionId?: string;
  money: (value: string) => string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (value: BankValue) => void;
}) {
  const start = collections.find((c) => c.collectionId === initialCollectionId);
  const [accountId, setAccountId] = useState(
    accounts.length === 1 ? (accounts[0]?.value ?? '') : '',
  );
  const [lines, setLines] = useState<Array<{ collectionId: string; amount: string }>>([
    { collectionId: start?.collectionId ?? '', amount: start?.availableAtStation ?? '' },
  ]);
  const [fromId, setFromId] = useState(start?.currentLocationId ?? '');
  const [fromTouched, setFromTouched] = useState(false);
  const [reference, setReference] = useState('');

  const sequence: readonly BankStep[] = ['account', 'cash', 'more', 'from', 'reference', 'review'];
  const wizard = useWizard<BankStep>({ start: 'account', sequence, onCancel });
  const { step, index, errors } = wizard;
  const available = (id: string) => collections.find((c) => c.collectionId === id);
  const line = lines[index] ?? { collectionId: '', amount: '' };

  function setLine(patch: Partial<(typeof lines)[number]>) {
    setLines((current) => current.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function next() {
    if (step === 'account') {
      return wizard.advance(checkBankAccountPick(accountId), 'cash', 'review');
    }
    if (step === 'cash') {
      const found = checkBankLine(line, available(line.collectionId)?.availableAtStation ?? '0');
      const distinct = Object.keys(found).length
        ? {}
        : checkBankLinesDistinct(lines.slice(0, index + 1));
      const all = { ...found, ...distinct };
      if (Object.keys(all).length === 0) {
        // The place the cash is follows the first cash picked, until the person chooses one.
        const first = available(lines[0]?.collectionId ?? '');
        if (!fromTouched && first) setFromId(first.currentLocationId);
      }
      return wizard.advance(all, 'more', 'review');
    }
    if (step === 'from') return wizard.advance(checkBankFrom(fromId), 'reference', 'review');
    if (step === 'reference') return wizard.advance(checkBankReference(reference), 'review');
    onSubmit({
      bankAccountId: accountId,
      sourceLocationId: fromId,
      depositReference: reference.trim(),
      allocations: lines.map((l) => ({
        collectionId: l.collectionId,
        amount: cleanAmount(l.amount),
      })),
    });
  }

  const chosen = new Set(lines.filter((_, i) => i !== index).map((l) => l.collectionId));
  const total = lines.length;

  return (
    <form
      className="form-stack"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      {step === 'account' ? (
        <WizardStep
          wizard={wizard}
          title="Which bank account is it going into?"
          hint="Record the cash you are taking to the bank."
        >
          <Field id="bank-account" label="Bank account" error={errors['bank-account']} required>
            <Select
              id="bank-account"
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              placeholder="Choose an account"
              options={accounts}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'cash' ? (
        <WizardStep
          wizard={wizard}
          title={
            total > 1
              ? `Which cash is going in? (${index + 1} of ${total})`
              : 'Which cash is going in?'
          }
          hint="Pick the cash and how much of it you are taking."
        >
          <Field id="bank-cash" label="Cash" error={errors['bank-cash']} required>
            <Select
              id="bank-cash"
              value={line.collectionId}
              onChange={(event) => {
                const picked = available(event.target.value);
                setLine({
                  collectionId: event.target.value,
                  amount: picked?.availableAtStation ?? '',
                });
              }}
              placeholder="Choose cash"
              options={collections
                .filter((c) => !chosen.has(c.collectionId))
                .map((c) => ({
                  value: c.collectionId,
                  label: `${c.collectionReference} · ${formatMoney(c.availableAtStation)}`,
                }))}
            />
          </Field>
          <NumericInput
            id="bank-amount"
            label="Amount"
            unit="USD"
            inputMode="decimal"
            required
            error={errors['bank-amount']}
            value={line.amount}
            onChange={(event) => setLine({ amount: event.target.value })}
          />
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'more' ? (
        <WizardAnother
          wizard={wizard}
          title="Add more cash to this deposit?"
          hint="You can put cash from several collections into one deposit."
          yesLabel="Yes, add more cash"
          noLabel="No, that is all"
          onYes={() => {
            if (lines.length >= collections.length) {
              wizard.setErrors({});
              return wizard.go('from');
            }
            setLines((current) => [...current, { collectionId: '', amount: '' }]);
            wizard.go('cash', lines.length);
          }}
          onNo={() => wizard.go('from')}
        />
      ) : null}
      {step === 'from' ? (
        <WizardStep
          wizard={wizard}
          title="Where are you taking the cash from?"
          hint="Choose the place the cash is being kept now."
        >
          <Field id="bank-from" label="Taking the cash from" error={errors['bank-from']} required>
            <Select
              id="bank-from"
              value={fromId}
              onChange={(event) => {
                setFromTouched(true);
                setFromId(event.target.value);
              }}
              placeholder="Choose a location"
              options={locations}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'reference' ? (
        <WizardStep
          wizard={wizard}
          title="What is the deposit reference?"
          hint="The bank or deposit reference, for example from the deposit slip."
        >
          <Field
            id="bank-reference"
            label="Deposit reference"
            error={errors['bank-reference']}
            required
          >
            <input
              id="bank-reference"
              autoFocus
              maxLength={80}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'review' ? (
        <WizardStep wizard={wizard} title="Check the deposit" hint={WIZARD_REVIEW_HINT}>
          <WizardSummary>
            <WizardSummaryRow label="Bank account" onChange={() => wizard.change('account')}>
              {labelOf(accounts, accountId)}
            </WizardSummaryRow>
            {lines.map((l, i) => (
              <WizardSummaryRow
                key={`${l.collectionId}-${i}`}
                label={lines.length > 1 ? `Cash ${i + 1}` : 'Cash'}
                onChange={() => wizard.change('cash', i)}
              >
                {available(l.collectionId)?.collectionReference ?? ''} ·{' '}
                {money(cleanAmount(l.amount))}
              </WizardSummaryRow>
            ))}
            <WizardSummaryRow label="Taking the cash from" onChange={() => wizard.change('from')}>
              {labelOf(locations, fromId)}
            </WizardSummaryRow>
            <WizardSummaryRow label="Deposit reference" onChange={() => wizard.change('reference')}>
              {reference.trim()}
            </WizardSummaryRow>
          </WizardSummary>
          <SaveError message={error} />
          <WizardActions wizard={wizard} onContinue={next} continueLabel="Bank cash" busy={busy} />
        </WizardStep>
      ) : null}
    </form>
  );
}

/* Confirm a bank deposit ------------------------------------------------------- */

type ConfirmStep = 'deposit' | 'amount' | 'reference' | 'date' | 'reason' | 'review';

export type ConfirmValue = {
  depositId: string;
  confirmedAmount: string;
  bankReference: string;
  bankDate: string;
  differenceReason: string;
};

type Confirmable = {
  depositId: string;
  depositReference: string;
  amount: string;
  bankAccountName: string;
};

/** Match a deposit to the bank statement. */
export function ConfirmDepositWizard({
  deposits,
  initialDepositId,
  today,
  money,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  deposits: readonly Confirmable[];
  /** When the person came from one deposit's own button, that deposit is already chosen. */
  initialDepositId?: string;
  /** Today in the station's time, as a date, so a future bank date is refused. */
  today: string;
  money: (value: string) => string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (value: ConfirmValue) => void;
}) {
  const preset = initialDepositId ?? (deposits.length === 1 ? deposits[0]?.depositId : undefined);
  const [depositId, setDepositId] = useState(preset ?? '');
  const deposit = deposits.find((d) => d.depositId === depositId);
  const [amount, setAmount] = useState(deposit?.amount ?? '');
  const [bankReference, setBankReference] = useState('');
  const [bankDate, setBankDate] = useState('');
  const [reason, setReason] = useState('');

  const differs = confirmDiffers(deposit?.amount ?? '', amount);
  const sequence: readonly ConfirmStep[] = [
    ...(preset ? [] : (['deposit'] as const)),
    'amount',
    'reference',
    'date',
    ...(differs ? (['reason'] as const) : []),
    'review',
  ];
  const wizard = useWizard<ConfirmStep>({
    start: preset ? 'amount' : 'deposit',
    sequence,
    onCancel,
  });
  const { step, errors } = wizard;

  function next() {
    if (step === 'deposit') {
      const found: Errors = depositId
        ? {}
        : { 'confirm-deposit': 'Choose the deposit to confirm.' };
      return wizard.advance(found, 'amount');
    }
    if (step === 'amount') {
      const needsReason = confirmDiffers(deposit?.amount ?? '', amount) && !reason.trim();
      return wizard.advance(
        checkConfirmAmount(amount),
        'reference',
        needsReason ? undefined : 'review',
      );
    }
    if (step === 'reference') {
      return wizard.advance(checkConfirmReference(bankReference), 'date', 'review');
    }
    if (step === 'date') {
      return wizard.advance(
        checkConfirmDate(bankDate, today),
        differs ? 'reason' : 'review',
        'review',
      );
    }
    if (step === 'reason') {
      return wizard.advance(checkConfirmReason(deposit?.amount ?? '', amount, reason), 'review');
    }
    onSubmit({
      depositId,
      confirmedAmount: cleanAmount(amount),
      bankReference: bankReference.trim(),
      bankDate,
      differenceReason: differs ? reason.trim() : '',
    });
  }

  return (
    <form
      className="form-stack"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      {step === 'deposit' ? (
        <WizardStep
          wizard={wizard}
          title="Which deposit are you confirming?"
          hint="Match each deposit to your bank statement."
        >
          <Field id="confirm-deposit" label="Deposit" error={errors['confirm-deposit']} required>
            <Select
              id="confirm-deposit"
              value={depositId}
              onChange={(event) => {
                const picked = deposits.find((d) => d.depositId === event.target.value);
                setDepositId(event.target.value);
                setAmount(picked?.amount ?? '');
              }}
              placeholder="Choose a deposit"
              options={deposits.map((d) => ({
                value: d.depositId,
                label: `${d.depositReference} · ${formatMoney(d.amount)} · ${d.bankAccountName}`,
              }))}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'amount' ? (
        <WizardStep
          wizard={wizard}
          title="What amount does the bank show?"
          hint={
            deposit
              ? `${deposit.depositReference} was recorded as ${money(deposit.amount)}.`
              : undefined
          }
        >
          <NumericInput
            id="confirm-amount"
            label="Amount the bank shows"
            unit="USD"
            inputMode="decimal"
            required
            autoFocus
            error={errors['confirm-amount']}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'reference' ? (
        <WizardStep
          wizard={wizard}
          title="What is the bank reference?"
          hint="The reference on the bank statement."
        >
          <Field
            id="confirm-reference"
            label="Bank reference"
            error={errors['confirm-reference']}
            required
          >
            <input
              id="confirm-reference"
              autoFocus
              maxLength={80}
              value={bankReference}
              onChange={(event) => setBankReference(event.target.value)}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'date' ? (
        <WizardStep
          wizard={wizard}
          title="What date does the bank show?"
          hint="The date the bank shows for this deposit. You can leave it empty."
        >
          <Field
            id="confirm-date"
            label="Date on the bank statement"
            error={errors['confirm-date']}
          >
            <input
              id="confirm-date"
              type="date"
              autoFocus
              max={today}
              value={bankDate}
              onChange={(event) => setBankDate(event.target.value)}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'reason' ? (
        <WizardStep
          wizard={wizard}
          title="Why is the amount different?"
          hint={`The bank shows ${money(cleanAmount(amount))} but the deposit was ${money(deposit?.amount ?? '0')}.`}
        >
          <Field id="confirm-reason" label="Reason" error={errors['confirm-reason']} required>
            <textarea
              id="confirm-reason"
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
        <WizardStep wizard={wizard} title="Check the confirmation" hint={WIZARD_REVIEW_HINT}>
          <WizardSummary>
            <WizardSummaryRow label="Deposit">
              {deposit ? `${deposit.depositReference} · ${money(deposit.amount)}` : ''}
            </WizardSummaryRow>
            <WizardSummaryRow
              label="Amount the bank shows"
              onChange={() => wizard.change('amount')}
            >
              {money(cleanAmount(amount))}
            </WizardSummaryRow>
            <WizardSummaryRow label="Bank reference" onChange={() => wizard.change('reference')}>
              {bankReference.trim()}
            </WizardSummaryRow>
            <WizardSummaryRow label="Date on the statement" onChange={() => wizard.change('date')}>
              {bankDate || 'Not given'}
            </WizardSummaryRow>
            {differs ? (
              <WizardSummaryRow
                label="Why it is different"
                onChange={() => wizard.change('reason')}
              >
                {reason.trim()}
              </WizardSummaryRow>
            ) : null}
          </WizardSummary>
          <WizardNotice>
            The deposit slip must be attached before the bank can confirm it. Once confirmed, the
            cash shows as Banked, or Banked with difference when the amounts do not match.
          </WizardNotice>
          <SaveError message={error} />
          <WizardActions
            wizard={wizard}
            onContinue={next}
            continueLabel="Confirm deposit"
            busy={busy}
          />
        </WizardStep>
      ) : null}
    </form>
  );
}
