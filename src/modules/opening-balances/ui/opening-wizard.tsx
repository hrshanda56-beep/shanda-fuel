'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import {
  AccessDeniedState,
  Button,
  ErrorState,
  Field,
  LoadingState,
} from '@/design-system/primitives';
import {
  WizardActions,
  WizardNotice,
  WizardStep,
  WIZARD_REVIEW_HINT,
  WizardSummary,
  WizardSummaryRow,
  useWizard,
} from '@/design-system/wizard';
import { wizardDraftKey } from '@/design-system/wizard-draft';
import {
  WizardAnother,
  WizardConfirm,
  WizardOptions,
  WizardResumeNotice,
  WizardYesNo,
  useWizardDraft,
} from '@/design-system/wizard-kit';
import { tankLabel } from '@/modules/inventory/ui/tank-overview-model';
import { StepUpDialog } from '@/modules/setup/ui/step-up-dialog';

import {
  BLANK_OPENING,
  MAX_REFERENCE,
  STAGE_TEXT,
  buildOpeningCsv,
  checkAmount,
  checkAsOf,
  checkBalance,
  checkDue,
  checkLitres,
  checkPick,
  checkReference,
  countEntered,
  describeIssues,
  isEmpty,
  tanksWithoutValue,
  todo,
  type OpeningAnswers,
  type OpeningIssue,
  type OpeningOptions,
  type Section,
} from '../wizard';

type Screen =
  | 'ask'
  | 'date'
  | Section
  | 'custAsk'
  | 'custPick'
  | 'custAmount'
  | 'custDue'
  | 'custMore'
  | 'suppAsk'
  | 'suppPick'
  | 'suppRef'
  | 'suppAmount'
  | 'suppDue'
  | 'suppMore'
  | 'review'
  | 'draft'
  | 'approved'
  | 'locked';

type Load =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'denied' }
  | { kind: 'ready'; options: OpeningOptions };

type Preview = Readonly<{
  valid: boolean;
  duplicateBatch: { id: string; state: string } | null;
  parserIssues: readonly OpeningIssue[];
  resolutionIssues: readonly OpeningIssue[];
}>;

/** The screens a saved draft may bring the person back to (never the ones after saving). */
const RESUMABLE: readonly Screen[] = ['ask', 'date', 'custAsk', 'suppAsk', 'review'];

/** The screen to rest on when the one showing needs an item picked first. */
function restingScreen(step: Screen): Screen {
  if (RESUMABLE.includes(step) || step === 'draft' || step === 'approved' || step === 'locked') {
    return step;
  }
  if (step === 'tank' || step === 'cash' || step === 'bank') return 'date';
  return step.startsWith('cust') ? 'custAsk' : 'suppAsk';
}

const BLANK_ENTRY = { litres: '', value: '', amount: '', reference: '', due: '' };

/**
 * The opening balances of one station, one question at a time (#250): the fuel in each tank, the
 * cash at each cash location, the bank balances, what customers owe and what suppliers are still
 * owed. The answers are saved as the same draft batch the spreadsheet import makes, then approved
 * and locked, with the same checks and the same identity confirmation.
 */
export function OpeningBalancesWizard({
  tenantId,
  stationId,
  stationName,
  onClose,
}: {
  tenantId: string;
  stationId: string;
  stationName: string;
  onClose: () => void;
}) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(
          `/api/opening-balances?tenantId=${encodeURIComponent(tenantId)}&optionsFor=${encodeURIComponent(stationId)}`,
          { credentials: 'same-origin', cache: 'no-store', signal: controller.signal },
        );
        if (response.status === 403) return setLoad({ kind: 'denied' });
        if (!response.ok) return setLoad({ kind: 'error' });
        const body = (await response.json()) as { options?: OpeningOptions | null };
        setLoad(body.options ? { kind: 'ready', options: body.options } : { kind: 'error' });
      } catch {
        if (!controller.signal.aborted) setLoad({ kind: 'error' });
      }
    })();
    return () => controller.abort();
  }, [tenantId, stationId]);

  if (load.kind === 'loading') return <LoadingState label="Loading what you can enter" />;
  if (load.kind === 'denied') {
    return (
      <AccessDeniedState message="You do not have the right to enter opening balances. Ask the owner." />
    );
  }
  if (load.kind === 'error') {
    return (
      <ErrorState
        title="Opening balances could not be loaded"
        message="Nothing has been changed. Try again in a moment."
        action={<Button onClick={onClose}>Close</Button>}
      />
    );
  }
  return (
    <Questions
      tenantId={tenantId}
      stationName={stationName}
      options={load.options}
      onClose={onClose}
    />
  );
}

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { message?: string };
  return typeof body.message === 'string'
    ? body.message
    : 'That could not be done. Nothing was changed.';
}

async function needsStepUp(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;
  const body = (await response
    .clone()
    .json()
    .catch(() => ({}))) as { code?: string };
  return body.code === 'STEP_UP_REQUIRED';
}

function Questions({
  tenantId,
  stationName,
  options,
  onClose,
}: {
  tenantId: string;
  stationName: string;
  options: OpeningOptions;
  onClose: () => void;
}) {
  const left = todo(options);
  const [answers, setAnswers] = useState<OpeningAnswers>(BLANK_OPENING);
  const [yes, setYes] = useState<boolean | null>(null);
  const [entry, setEntry] = useState(BLANK_ENTRY);
  const [pick, setPick] = useState<string | null>(null);
  const [custYes, setCustYes] = useState<boolean | null>(null);
  const [suppYes, setSuppYes] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [batch, setBatch] = useState<{ id: string; version: number } | null>(null);
  const [stepUp, setStepUp] = useState(false);
  const retry = useRef<(() => void) | null>(null);
  const keys = useRef(new Map<string, string>());

  const wizard = useWizard<Screen>({ start: 'ask', sequence: [], onCancel: onClose });
  const alone = { ...wizard, position: 1, total: 0 };
  const errors = wizard.errors;
  const setE = (patch: Partial<typeof BLANK_ENTRY>) => setEntry((c) => ({ ...c, ...patch }));
  const files = buildOpeningCsv(options, answers);
  const unvalued = tanksWithoutValue(options, answers);

  // Keep the answers on this device until the figures are saved, so a reload does not lose them.
  // A screen in the middle of one item comes back as the question that starts its group, with the
  // answers already given kept.
  const draft = useWizardDraft<Screen, { answers?: OpeningAnswers }>({
    key: wizardDraftKey(['opening', tenantId, options.station.id]),
    version: `${left.tank.length}.${left.cash.length}.${left.bank.length}.${left.customers.length}`,
    steps: RESUMABLE,
    wizard: {
      step: restingScreen(wizard.step),
      index: 0,
      show: (step: Screen, index?: number) => wizard.show(restingScreen(step), index),
    },
    // Nothing entered yet, or already saved to the server, means nothing to keep (an empty object
    // is cleared, not stored).
    answers: isEmpty(answers) || !RESUMABLE.includes(restingScreen(wizard.step)) ? {} : { answers },
    onRestore: (saved) => {
      if (saved.answers) setAnswers(saved.answers);
    },
  });

  /* ------------------------------- where next ------------------------------- */

  function enter(section: Section, index: number): void {
    const item = left[section][index];
    if (!item) return afterSection(section);
    const code = 'code' in item ? item.code : item.name;
    setEntry(
      section === 'tank'
        ? { ...BLANK_ENTRY, ...(answers.tanks[code] ?? {}) }
        : {
            ...BLANK_ENTRY,
            amount: (section === 'cash' ? answers.cash : answers.bank)[code] ?? '',
          },
    );
    wizard.go(section, index);
  }
  function afterSection(section: Section): void {
    if (section === 'tank') return enter('cash', 0);
    if (section === 'cash') return enter('bank', 0);
    return toCustomers();
  }
  function toCustomers() {
    if (left.customers.length === 0) return toSuppliers();
    setCustYes(null);
    wizard.go('custAsk', 0);
  }
  function toSuppliers() {
    if (options.suppliers.length === 0) return wizard.go('review', 0);
    setSuppYes(null);
    wizard.go('suppAsk', 0);
  }

  /** Records or clears the figure of the item on screen, then moves to the next item. */
  function record(section: Section, index: number, value: string | null, code: string) {
    setAnswers((current) => {
      const next = {
        ...current,
        tanks: { ...current.tanks },
        cash: { ...current.cash },
        bank: { ...current.bank },
      };
      const table = section === 'tank' ? next.tanks : section === 'cash' ? next.cash : next.bank;
      if (value === null) delete table[code];
      else if (section === 'tank') next.tanks[code] = { litres: entry.litres, value: entry.value };
      else (table as Record<string, string>)[code] = value;
      return next;
    });
    enter(section, index + 1);
  }

  /* --------------------------------- saving --------------------------------- */

  async function post(body: Record<string, unknown>, key: string): Promise<Response> {
    return fetch('/api/opening-balances', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    });
  }
  const keyFor = (what: string) => {
    const k = keys.current.get(what) ?? `opening-wizard-${crypto.randomUUID()}`;
    keys.current.set(what, k);
    return k;
  };

  async function saveDraft() {
    setBusy(true);
    setProblems([]);
    setFailure(null);
    try {
      const preview = await fetch(
        `/api/opening-balances?tenantId=${encodeURIComponent(tenantId)}`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'text/csv' },
          body: files.csv,
        },
      );
      if (!preview.ok) return setFailure(await readError(preview));
      const checked = (await preview.json()) as Preview;
      if (checked.duplicateBatch) {
        // The same figures were saved before (for instance, then the page was left). Carry on from
        // where that batch is instead of leaving the person at a dead end.
        const { id, state } = checked.duplicateBatch;
        if (state === 'DRAFT') {
          setBatch({ id, version: 0 });
          return wizard.go('draft', 0);
        }
        if (state === 'APPROVED') {
          setBatch({ id, version: 1 });
          return wizard.go('approved', 0);
        }
        if (state === 'LOCKED') return wizard.go('locked', 0);
        return setFailure('These exact figures were already saved. Nothing more was saved.');
      }
      if (!checked.valid) {
        return setProblems(
          describeIssues(files.lines, [...checked.parserIssues, ...checked.resolutionIssues]),
        );
      }
      const response = await post(
        {
          commandType: 'CreateOpeningBalanceBatch',
          tenantId,
          asOfDate: answers.asOf,
          sourceFilename: `Opening balances, ${stationName}`,
          csv: files.csv,
        },
        keyFor(files.csv),
      );
      if (await needsStepUp(response)) {
        retry.current = () => void saveDraft();
        return setStepUp(true);
      }
      if (!response.ok) return setFailure(await readError(response));
      const made = (await response.json()) as { batchId: string; version: number };
      setBatch({ id: made.batchId, version: made.version });
      wizard.go('draft', 0);
    } catch {
      setFailure('That could not be saved. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function advance(commandType: 'ApproveOpeningBalanceBatch' | 'LockOpeningBalanceBatch') {
    if (!batch) return;
    setBusy(true);
    setFailure(null);
    try {
      const response = await post(
        { commandType, tenantId, batchId: batch.id, expectedVersion: batch.version },
        keyFor(`${commandType}:${batch.version}`),
      );
      if (await needsStepUp(response)) {
        retry.current = () => void advance(commandType);
        return setStepUp(true);
      }
      if (!response.ok) return setFailure(await readError(response));
      if (commandType === 'ApproveOpeningBalanceBatch') {
        setBatch({ id: batch.id, version: batch.version + 1 });
        wizard.go('approved', 0);
      } else wizard.go('locked', 0);
    } catch {
      setFailure('That could not be done. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const stepUpDialog = (
    <StepUpDialog
      open={stepUp}
      tenantId={tenantId}
      description="Changing opening balances needs a fresh identity check. Nothing is changed until you confirm."
      confirmLabel="Confirm and continue"
      onCancel={() => {
        retry.current = null;
        setStepUp(false);
      }}
      onVerified={() => {
        const again = retry.current;
        retry.current = null;
        setStepUp(false);
        again?.();
      }}
    />
  );

  const taken = answers.customers.map((c) => c.accountId);
  const customersLeft = left.customers.filter((c) => !taken.includes(c.accountId));
  const element = ((): React.ReactNode => {
    /* -------------------------------- the question -------------------------------- */
    if (wizard.step === 'ask') {
      return (
        <WizardStep
          wizard={alone}
          title="Do you want to add the opening balances now?"
          hint="These are the figures the station starts with: fuel in the tanks, cash, bank, what customers owe and unpaid supplier invoices. You can skip any of them."
        >
          <WizardResumeNotice
            offer={draft.offer}
            onResume={draft.resume}
            onDiscard={draft.discard}
          />
          <WizardYesNo
            label="Add the opening balances now"
            name="opening-ask"
            value={yes}
            onPick={setYes}
          />
          <FieldError text={errors.ask} />
          <WizardActions
            wizard={wizard}
            onContinue={() => {
              if (yes === null) return wizard.setErrors({ ask: 'Choose Yes or No.' });
              if (yes) wizard.go('date', 0);
              else onClose();
            }}
          />
        </WizardStep>
      );
    }

    if (wizard.step === 'date') {
      return (
        <WizardStep
          wizard={alone}
          title="Which day are the figures for?"
          hint="Use the day you counted the fuel and cash."
        >
          <Field id="asOf" label="The day" error={errors.asOf} required>
            <input
              id="asOf"
              type="date"
              value={answers.asOf}
              onChange={(event) => setAnswers((c) => ({ ...c, asOf: event.target.value }))}
            />
          </Field>
          <WizardActions
            wizard={wizard}
            onContinue={() => {
              const found = checkAsOf(answers.asOf);
              wizard.setErrors(found);
              if (Object.keys(found).length === 0) enter('tank', 0);
              else wizard.setFocusId('asOf');
            }}
          />
        </WizardStep>
      );
    }

    /* ----------------------------- one item per screen ----------------------------- */
    if (wizard.step === 'tank') {
      const tank = left.tank[wizard.index];
      if (!tank) return null;
      return (
        <WizardStep
          wizard={alone}
          title={`How much fuel is in ${tankLabel(tank.code)}?`}
          hint={`${tank.fuel}. Tank ${wizard.index + 1} of ${left.tank.length}. It holds up to ${Number(tank.capacityLitres).toLocaleString('en-US')} litres.`}
        >
          <Field id="litres" label="Litres in the tank" error={errors.litres} required>
            <input
              id="litres"
              inputMode="decimal"
              value={entry.litres}
              autoComplete="off"
              onChange={(event) => setE({ litres: event.target.value })}
            />
          </Field>
          <Field
            id="value"
            label="What is that fuel worth in US$?"
            hint="Optional. Leave it empty if you do not know."
            error={errors.value}
            optional
          >
            <input
              id="value"
              inputMode="decimal"
              value={entry.value}
              autoComplete="off"
              onChange={(event) => setE({ value: event.target.value })}
            />
          </Field>
          <WizardActions
            wizard={wizard}
            onContinue={() => {
              const found = checkLitres(entry, tank.capacityLitres);
              wizard.setErrors(found);
              if (Object.keys(found).length > 0) return wizard.setFocusId(Object.keys(found)[0]!);
              record('tank', wizard.index, entry.litres, tank.code);
            }}
            extra={
              <Button
                type="button"
                variant="quiet"
                onClick={() => record('tank', wizard.index, null, tank.code)}
              >
                None
              </Button>
            }
          />
        </WizardStep>
      );
    }

    if (wizard.step === 'cash') {
      const place = left.cash[wizard.index];
      if (!place) return null;
      return (
        <WizardStep
          wizard={alone}
          title={`How much cash is in ${place.name}?`}
          hint={`Cash location ${wizard.index + 1} of ${left.cash.length}. Count it and enter US$.`}
        >
          <Field id="amount" label="Cash in US$" error={errors.amount} required>
            <input
              id="amount"
              inputMode="decimal"
              value={entry.amount}
              autoComplete="off"
              onChange={(event) => setE({ amount: event.target.value })}
            />
          </Field>
          <WizardActions
            wizard={wizard}
            onContinue={() => {
              const found = checkAmount(entry.amount, 'the cash');
              wizard.setErrors(found);
              if (Object.keys(found).length > 0) return wizard.setFocusId('amount');
              record('cash', wizard.index, entry.amount, place.code);
            }}
            extra={
              <Button
                type="button"
                variant="quiet"
                onClick={() => record('cash', wizard.index, null, place.code)}
              >
                None
              </Button>
            }
          />
        </WizardStep>
      );
    }

    if (wizard.step === 'bank') {
      const account = left.bank[wizard.index];
      if (!account) return null;
      return (
        <WizardStep
          wizard={alone}
          title={`What is the balance of ${account.name}?`}
          hint={`${account.bankName}. Bank account ${wizard.index + 1} of ${left.bank.length}. It belongs to the whole company, so it is asked once. A balance of 0 is fine.`}
        >
          <Field id="amount" label="Balance in US$" error={errors.amount} required>
            <input
              id="amount"
              inputMode="decimal"
              value={entry.amount}
              autoComplete="off"
              onChange={(event) => setE({ amount: event.target.value })}
            />
          </Field>
          <WizardActions
            wizard={wizard}
            onContinue={() => {
              const found = checkBalance(entry.amount);
              wizard.setErrors(found);
              if (Object.keys(found).length > 0) return wizard.setFocusId('amount');
              record('bank', wizard.index, entry.amount, account.name);
            }}
            extra={
              <Button
                type="button"
                variant="quiet"
                onClick={() => record('bank', wizard.index, null, account.name)}
              >
                None
              </Button>
            }
          />
        </WizardStep>
      );
    }

    /* ---------------------------------- customers ---------------------------------- */
    if (wizard.step === 'custAsk') {
      return (
        <WizardStep
          wizard={alone}
          title="Did any customers owe you money before today?"
          hint="Customer balances belong to the whole company."
        >
          <WizardYesNo
            label="Customers owing money"
            name="cust-ask"
            value={custYes}
            onPick={setCustYes}
          />
          <FieldError text={errors.ask} />
          <WizardActions
            wizard={wizard}
            onContinue={() => {
              if (custYes === null) return wizard.setErrors({ ask: 'Choose Yes or No.' });
              if (custYes) {
                setPick(null);
                wizard.go('custPick', 0);
              } else toSuppliers();
            }}
          />
        </WizardStep>
      );
    }
    if (wizard.step === 'custPick') {
      return (
        <WizardStep wizard={alone} title="Which customer owes money?">
          <WizardOptions<string>
            label="Customer"
            name="cust-pick"
            value={pick}
            onPick={setPick}
            options={customersLeft.map((c) => ({ value: c.accountId, label: c.name }))}
          />
          <FieldError text={errors.pick} />
          <WizardActions
            wizard={wizard}
            onContinue={() => {
              const found = checkPick(pick, 'a customer');
              if (Object.keys(found).length > 0) return wizard.setErrors(found);
              setEntry(BLANK_ENTRY);
              wizard.go('custAmount', 0);
            }}
          />
        </WizardStep>
      );
    }
    if (wizard.step === 'custAmount') {
      const who = options.customers.find((c) => c.accountId === pick);
      return (
        <WizardStep wizard={alone} title={`How much does ${who?.name ?? 'the customer'} owe?`}>
          <Field id="amount" label="Amount owed in US$" error={errors.amount} required>
            <input
              id="amount"
              inputMode="decimal"
              value={entry.amount}
              autoComplete="off"
              onChange={(event) => setE({ amount: event.target.value })}
            />
          </Field>
          <WizardActions
            wizard={wizard}
            onContinue={() =>
              wizard.advance(checkAmount(entry.amount, 'how much they owe'), 'custDue')
            }
          />
        </WizardStep>
      );
    }
    if (wizard.step === 'custDue') {
      const who = options.customers.find((c) => c.accountId === pick);
      return (
        <WizardStep
          wizard={alone}
          title="When is it due?"
          hint="Optional. Leave it empty if there is no due day."
        >
          <Field id="due" label="Due day" error={errors.due} optional>
            <input
              id="due"
              type="date"
              value={entry.due}
              onChange={(event) => setE({ due: event.target.value })}
            />
          </Field>
          <WizardActions
            wizard={wizard}
            onContinue={() => {
              const found = checkDue(entry.due, answers.asOf);
              wizard.setErrors(found);
              if (Object.keys(found).length > 0 || !who) return wizard.setFocusId('due');
              setAnswers((c) => ({
                ...c,
                customers: [
                  ...c.customers,
                  {
                    accountId: who.accountId,
                    name: who.name,
                    amount: entry.amount,
                    due: entry.due,
                  },
                ],
              }));
              wizard.go('custMore', 0);
            }}
          />
        </WizardStep>
      );
    }
    if (wizard.step === 'custMore') {
      return (
        <WizardAnother
          wizard={alone}
          title="Does another customer owe money?"
          yesLabel="Yes, add another customer"
          noLabel="No, that is all"
          onYes={() => {
            if (customersLeft.length === 0) return toSuppliers();
            setPick(null);
            wizard.go('custPick', 0);
          }}
          onNo={toSuppliers}
        />
      );
    }

    /* ---------------------------------- suppliers ---------------------------------- */
    if (wizard.step === 'suppAsk') {
      return (
        <WizardStep
          wizard={alone}
          title="Do you have unpaid supplier invoices from before today?"
          hint="Supplier invoices belong to the whole company."
        >
          <WizardYesNo
            label="Unpaid supplier invoices"
            name="supp-ask"
            value={suppYes}
            onPick={setSuppYes}
          />
          <FieldError text={errors.ask} />
          <WizardActions
            wizard={wizard}
            onContinue={() => {
              if (suppYes === null) return wizard.setErrors({ ask: 'Choose Yes or No.' });
              if (suppYes) {
                setPick(null);
                wizard.go('suppPick', 0);
              } else wizard.go('review', 0);
            }}
          />
        </WizardStep>
      );
    }
    if (wizard.step === 'suppPick') {
      return (
        <WizardStep wizard={alone} title="Which supplier is still owed?">
          <WizardOptions<string>
            label="Supplier"
            name="supp-pick"
            value={pick}
            onPick={setPick}
            options={options.suppliers.map((s) => ({ value: s.code, label: s.name }))}
          />
          <FieldError text={errors.pick} />
          <WizardActions
            wizard={wizard}
            onContinue={() => {
              const found = checkPick(pick, 'a supplier');
              if (Object.keys(found).length > 0) return wizard.setErrors(found);
              setEntry(BLANK_ENTRY);
              wizard.go('suppRef', 0);
            }}
          />
        </WizardStep>
      );
    }
    if (wizard.step === 'suppRef') {
      return (
        <WizardStep wizard={alone} title="What is the invoice number?">
          <Field
            id="reference"
            label="Invoice number or reference"
            error={errors.reference}
            required
          >
            <input
              id="reference"
              value={entry.reference}
              maxLength={MAX_REFERENCE}
              autoComplete="off"
              onChange={(event) => setE({ reference: event.target.value })}
            />
          </Field>
          <WizardActions
            wizard={wizard}
            onContinue={() =>
              wizard.advance(
                checkReference(
                  entry.reference,
                  answers.suppliers.filter((s) => s.code === pick).map((s) => s.reference),
                ),
                'suppAmount',
              )
            }
          />
        </WizardStep>
      );
    }
    if (wizard.step === 'suppAmount') {
      return (
        <WizardStep wizard={alone} title="How much is still unpaid on it?">
          <Field id="amount" label="Amount in US$" error={errors.amount} required>
            <input
              id="amount"
              inputMode="decimal"
              value={entry.amount}
              autoComplete="off"
              onChange={(event) => setE({ amount: event.target.value })}
            />
          </Field>
          <WizardActions
            wizard={wizard}
            onContinue={() =>
              wizard.advance(checkAmount(entry.amount, 'the unpaid amount'), 'suppDue')
            }
          />
        </WizardStep>
      );
    }
    if (wizard.step === 'suppDue') {
      const who = options.suppliers.find((s) => s.code === pick);
      return (
        <WizardStep
          wizard={alone}
          title="When is it due?"
          hint="Optional. Leave it empty if there is no due day."
        >
          <Field id="due" label="Due day" error={errors.due} optional>
            <input
              id="due"
              type="date"
              value={entry.due}
              onChange={(event) => setE({ due: event.target.value })}
            />
          </Field>
          <WizardActions
            wizard={wizard}
            onContinue={() => {
              const found = checkDue(entry.due, answers.asOf);
              wizard.setErrors(found);
              if (Object.keys(found).length > 0 || !who) return wizard.setFocusId('due');
              setAnswers((c) => ({
                ...c,
                suppliers: [
                  ...c.suppliers,
                  {
                    code: who.code,
                    name: who.name,
                    reference: entry.reference,
                    amount: entry.amount,
                    due: entry.due,
                  },
                ],
              }));
              wizard.go('suppMore', 0);
            }}
          />
        </WizardStep>
      );
    }
    if (wizard.step === 'suppMore') {
      return (
        <WizardAnother
          wizard={alone}
          title="Is there another unpaid invoice?"
          yesLabel="Yes, add another invoice"
          noLabel="No, that is all"
          onYes={() => {
            setPick(null);
            wizard.go('suppPick', 0);
          }}
          onNo={() => wizard.go('review', 0)}
        />
      );
    }

    /* ----------------------------------- check ----------------------------------- */
    if (wizard.step === 'review') {
      return (
        <WizardStep
          wizard={alone}
          title={
            isEmpty(answers)
              ? 'You have not entered any figures'
              : `Check the ${countEntered(answers)} opening ${countEntered(answers) === 1 ? 'figure' : 'figures'}`
          }
          hint={isEmpty(answers) ? undefined : WIZARD_REVIEW_HINT}
        >
          {isEmpty(answers) ? (
            <WizardNotice>
              There is nothing to save. Press Back to enter figures, or Close to leave.
            </WizardNotice>
          ) : (
            <WizardSummary>
              <WizardSummaryRow label="For the day">{answers.asOf}</WizardSummaryRow>
              {files.lines.map((line) => (
                <WizardSummaryRow key={`${line.kind}-${line.label}`} label={line.kind}>
                  {line.label}: {line.amount}
                </WizardSummaryRow>
              ))}
            </WizardSummary>
          )}
          {unvalued.length > 0 ? (
            <WizardNotice>
              {unvalued.join(' and ')} {unvalued.length === 1 ? 'has' : 'have'} fuel but no value.
              You can save it like this, but the station cannot go live until the value is added.
              Press Back to enter it now.
            </WizardNotice>
          ) : null}
          {problems.length > 0 ? (
            <div role="alert" className="field-error">
              <p>These need fixing before they can be saved:</p>
              <ul>
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {failure ? (
            <p className="field-error" role="alert">
              {failure}
            </p>
          ) : null}
          {isEmpty(answers) ? (
            <WizardActions wizard={wizard} continueLabel="Close" onContinue={onClose} />
          ) : (
            <WizardActions
              wizard={wizard}
              continueLabel="Save as a draft"
              busy={busy}
              onContinue={() => void saveDraft()}
            />
          )}
        </WizardStep>
      );
    }

    /* --------------------------- after saving: approve, lock --------------------------- */
    if (wizard.step === 'draft') {
      return (
        <WizardConfirm
          title={`${STAGE_TEXT.draft.title}. Approve the figures?`}
          consequence={`${STAGE_TEXT.draft.body} You can also leave it as a draft and approve it later under Opening balances.`}
          confirmLabel="Approve the figures"
          cancelLabel="Not now"
          busy={busy}
          error={failure}
          onConfirm={() => void advance('ApproveOpeningBalanceBatch')}
          onCancel={onClose}
        />
      );
    }
    if (wizard.step === 'approved') {
      return (
        <WizardConfirm
          title={`${STAGE_TEXT.approved.title}. Lock and post them?`}
          consequence={STAGE_TEXT.approved.body}
          acknowledgement="I understand locked figures cannot be edited."
          confirmLabel="Lock and post"
          cancelLabel="Not now"
          tone="warning"
          busy={busy}
          error={failure}
          onConfirm={() => void advance('LockOpeningBalanceBatch')}
          onCancel={onClose}
        />
      );
    }
    return (
      <WizardStep wizard={alone} title={STAGE_TEXT.locked.title}>
        <WizardNotice>{STAGE_TEXT.locked.body}</WizardNotice>
        <div>
          <Button type="button" onClick={onClose}>
            Done
          </Button>{' '}
          <Link className="button button-secondary" href="/go-live/opening-balances">
            See all batches
          </Link>
        </div>
      </WizardStep>
    );
  })();

  return (
    // This wizard keeps its own progress, so the page-wide draft keeper stays out of the way.
    <div data-no-page-draft="">
      {element}
      {stepUpDialog}
    </div>
  );
}

function FieldError({ text }: { text?: string }) {
  return text ? (
    <p className="field-error" role="alert">
      {text}
    </p>
  ) : null;
}
