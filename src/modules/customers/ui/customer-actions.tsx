'use client';

import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Select } from '@/design-system/forms';
import { Modal } from '@/design-system/modal';
import { Button, ErrorState, Field } from '@/design-system/primitives';
import { formatTileMoney } from '@/modules/reporting/format';
import { StepUpDialog } from '@/modules/setup/ui/step-up-dialog';
import type { CustomerAccount, CustomerSummary } from './types';

export type ActionStation = { id: string; name: string; code: string };
export type ActionProduct = { id: string; code: string; name: string };

type Sheet = 'payment' | 'topup' | 'account' | 'suspend' | 'reactivate';

type AccountKind = CustomerAccount['accountType'];

const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  CREDIT: 'Credit account (they buy now, pay later)',
  PREPAID_VALUE: 'Prepaid money (they pay first, spend as they buy)',
  PREPAID_LITRES: 'Prepaid fuel (they pay first for a set number of litres)',
};

// Business days and "today" follow the station's timezone, not the browser's.
const BUSINESS_TIME_ZONE = 'Africa/Harare';

function todayInStationTime(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE }).format(new Date());
}

function whenOccurred(date: string): string {
  return date === todayInStationTime() ? new Date().toISOString() : `${date}T12:00:00+02:00`;
}

/** Normalises what a person typed to an exact decimal string, or null when it is not a positive amount. */
function parsePositive(value: string, decimals: number): string | null {
  const text = value.trim().replace(/,/g, '');
  if (!new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(text)) return null;
  if (!/[1-9]/.test(text)) return null;
  return text;
}

const prepaidAccounts = (customer: CustomerSummary) =>
  customer.accounts.filter(
    (account) => account.accountType !== 'CREDIT' && account.status === 'ACTIVE',
  );

export function CustomerActions({
  customer,
  tenantId,
  currentStationId,
  stations,
  fuelProducts,
  post,
  onDone,
  trailing,
}: {
  customer: CustomerSummary;
  tenantId: string;
  currentStationId: string | null;
  stations: ActionStation[];
  fuelProducts: ActionProduct[];
  post: (input: Record<string, unknown>, idempotencyKey: string) => Promise<unknown>;
  /** Rendered last in the same row, e.g. a link back to the list. */
  trailing?: ReactNode;
  onDone: (message: string) => void;
}) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  // Some actions need a fresh identity check; the form stays as it was while the person confirms.
  const [stepUpRetry, setStepUpRetry] = useState<(() => void) | null>(null);

  const [amount, setAmount] = useState('');
  const [litres, setLitres] = useState('');
  const [date, setDate] = useState(todayInStationTime);
  const [note, setNote] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [driver, setDriver] = useState('');
  const [voucher, setVoucher] = useState('');
  const [stationId, setStationId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [productId, setProductId] = useState('');
  const [newKind, setNewKind] = useState<AccountKind | ''>('');
  const [creditLimit, setCreditLimit] = useState('');

  // The same attempt keeps its key, so a retry after a dropped connection cannot post twice.
  const attempt = useRef<{ fingerprint: string; key: string; sourceId: string } | null>(null);

  const caps = customer.capabilities;
  const creditAccount = customer.accounts.find(
    (account) => account.accountType === 'CREDIT' && account.status === 'ACTIVE',
  );
  const topUpAccounts = prepaidAccounts(customer);
  const existingKinds = new Set(customer.accounts.map((account) => account.accountType));
  const openableKinds = (['CREDIT', 'PREPAID_VALUE', 'PREPAID_LITRES'] as const).filter(
    (kind) => !existingKinds.has(kind),
  );
  const currency = customer.accounts[0]?.currency ?? 'USD';
  const isActive = customer.status === 'ACTIVE';

  const showPayment = caps.recordPayment && Boolean(creditAccount);
  const showTopUp = caps.topUp && isActive && topUpAccounts.length > 0;
  const showOpen = caps.openAccount && isActive && openableKinds.length > 0;
  const showSuspend = caps.manageCustomer && customer.status === 'ACTIVE';
  const showReactivate = caps.manageCustomer && customer.status === 'SUSPENDED';

  if (!showPayment && !showTopUp && !showOpen && !showSuspend && !showReactivate) return null;

  const topUpTarget = topUpAccounts.find((account) => account.accountId === accountId);
  const stationsToChoose = stations;

  function open(next: Sheet) {
    setError(null);
    setFieldError(null);
    setAmount('');
    setLitres('');
    setNote('');
    setVehicle('');
    setDriver('');
    setVoucher('');
    setCreditLimit('');
    setDate(todayInStationTime());
    setStationId(
      stationsToChoose.some((station) => station.id === currentStationId)
        ? (currentStationId ?? '')
        : '',
    );
    setAccountId(next === 'topup' ? (topUpAccounts[0]?.accountId ?? '') : '');
    setProductId(fuelProducts.length === 1 ? (fuelProducts[0]?.id ?? '') : '');
    setNewKind(openableKinds.length === 1 ? (openableKinds[0] ?? '') : '');
    setSheet(next);
  }

  function close() {
    if (!busy) setSheet(null);
  }

  async function send(
    input: Record<string, unknown>,
    successMessage: string,
    sourceKind?: 'CUSTOMER_PAYMENT' | 'PREPAID_TOPUP',
    alreadyConfirmed = false,
  ) {
    const fingerprint = JSON.stringify(input);
    if (attempt.current?.fingerprint !== fingerprint) {
      attempt.current = { fingerprint, key: crypto.randomUUID(), sourceId: crypto.randomUUID() };
    }
    const body = sourceKind
      ? { ...input, source: { sourceType: sourceKind, sourceId: attempt.current.sourceId } }
      : input;
    setBusy(true);
    setError(null);
    try {
      await post(body, attempt.current.key);
      attempt.current = null;
      setSheet(null);
      onDone(successMessage);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'This could not be saved.';
      if (!alreadyConfirmed && /not authorized|step-up/i.test(message)) {
        setStepUpRetry(() => () => void send(input, successMessage, sourceKind, true));
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  // Optional details about the transaction. The person who approved it and a supporting document
  // are added afterwards on the Account controls page.
  function entryDetailsFromForm(): { entryDetails?: Record<string, string> } {
    const details: Record<string, string> = {
      ...(vehicle.trim() ? { vehicleRegistration: vehicle.trim() } : {}),
      ...(driver.trim() ? { driverName: driver.trim() } : {}),
      ...(voucher.trim() ? { voucherNumber: voucher.trim() } : {}),
    };
    return Object.keys(details).length > 0 ? { entryDetails: details } : {};
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFieldError(null);
    const who = customer.displayName;

    if (sheet === 'payment' && creditAccount) {
      const value = parsePositive(amount, 2);
      if (!value) return setFieldError('Enter the amount received, for example 250.00.');
      if (!stationId) return setFieldError('Choose the station where the money was received.');
      await send(
        {
          commandType: 'RecordCustomerPayment',
          tenantId,
          accountId: creditAccount.accountId,
          receivingStationId: stationId,
          amount: { amount: value, currency: creditAccount.currency },
          occurredAt: whenOccurred(date),
          businessDate: date,
          ...(note.trim() ? { note: note.trim() } : {}),
          ...entryDetailsFromForm(),
        },
        `Payment of ${formatTileMoney(value, creditAccount.currency)} from ${who} recorded.`,
        'CUSTOMER_PAYMENT',
      );
    }

    if (sheet === 'topup' && topUpTarget) {
      if (topUpTarget.accountType === 'PREPAID_VALUE') {
        const value = parsePositive(amount, 2);
        if (!value) return setFieldError('Enter the amount paid in, for example 500.00.');
        await send(
          {
            commandType: 'RecordPrepaidTopUp',
            tenantId,
            accountId: topUpTarget.accountId,
            accountType: 'PREPAID_VALUE',
            amount: { amount: value, currency: topUpTarget.currency },
            occurredAt: whenOccurred(date),
            businessDate: date,
            ...entryDetailsFromForm(),
          },
          `${formatTileMoney(value, topUpTarget.currency)} added to ${who}’s prepaid money.`,
          'PREPAID_TOPUP',
        );
      } else {
        const value = parsePositive(litres, 3);
        if (!value) return setFieldError('Enter the litres paid for, for example 200.');
        if (!productId) return setFieldError('Choose which fuel the litres are for.');
        const fuel = fuelProducts.find((product) => product.id === productId);
        await send(
          {
            commandType: 'RecordPrepaidTopUp',
            tenantId,
            accountId: topUpTarget.accountId,
            accountType: 'PREPAID_LITRES',
            productId,
            litres: value,
            occurredAt: whenOccurred(date),
            businessDate: date,
            ...entryDetailsFromForm(),
          },
          `${value} litres of ${fuel?.name ?? 'fuel'} added for ${who}.`,
          'PREPAID_TOPUP',
        );
      }
    }

    if (sheet === 'account') {
      if (!newKind) return setFieldError('Choose the kind of account to open.');
      let limit: string | null = null;
      if (newKind === 'CREDIT') {
        limit = parsePositive(creditLimit, 2);
        if (!limit) return setFieldError('Enter the most this customer may owe, for example 1000.');
      }
      await send(
        {
          commandType: 'CreateCustomerAccount',
          tenantId,
          customerId: customer.customerId,
          accountType: newKind,
          currency,
          ...(limit ? { creditLimit: limit } : {}),
        },
        `Account opened for ${who}. Choose where it can be used under “Where this customer can buy fuel”.`,
      );
    }

    if (sheet === 'suspend' || sheet === 'reactivate') {
      await send(
        {
          commandType: sheet === 'suspend' ? 'DeactivateCustomer' : 'ActivateCustomer',
          tenantId,
          customerId: customer.customerId,
          expectedVersion: customer.version,
        },
        sheet === 'suspend' ? `${who} is suspended.` : `${who} can buy fuel again.`,
      );
    }
  }

  const titles: Record<Sheet, string> = {
    payment: 'Record a payment',
    topup: 'Add prepaid money or fuel',
    account: 'Open an account',
    suspend: `Suspend ${customer.displayName}?`,
    reactivate: `Reactivate ${customer.displayName}?`,
  };
  const submitLabels: Record<Sheet, string> = {
    payment: 'Record payment',
    topup: 'Add to account',
    account: 'Open account',
    suspend: 'Suspend customer',
    reactivate: 'Reactivate customer',
  };

  return (
    <>
      <div className="customer-actions" role="group" aria-label="Customer actions">
        {showPayment ? (
          <Button aria-haspopup="dialog" onClick={() => open('payment')}>
            Record a payment
          </Button>
        ) : null}
        {showTopUp ? (
          <Button
            variant={showPayment ? 'secondary' : 'primary'}
            aria-haspopup="dialog"
            onClick={() => open('topup')}
          >
            {topUpAccounts.every((account) => account.accountType === 'PREPAID_LITRES')
              ? 'Add prepaid fuel'
              : 'Add prepaid money'}
          </Button>
        ) : null}
        {showOpen ? (
          <Button variant="secondary" aria-haspopup="dialog" onClick={() => open('account')}>
            Open an account
          </Button>
        ) : null}
        {showSuspend ? (
          <Button variant="secondary" aria-haspopup="dialog" onClick={() => open('suspend')}>
            Suspend customer
          </Button>
        ) : null}
        {showReactivate ? (
          <Button aria-haspopup="dialog" onClick={() => open('reactivate')}>
            Reactivate customer
          </Button>
        ) : null}
        {trailing}
      </div>

      <Modal
        open={sheet !== null && stepUpRetry === null}
        onClose={close}
        title={sheet ? titles[sheet] : 'Customer action'}
        presentation={sheet === 'suspend' || sheet === 'reactivate' ? 'dialog' : 'side'}
        role={sheet === 'suspend' || sheet === 'reactivate' ? 'alertdialog' : 'dialog'}
        size="sm"
        dismissible={!busy}
      >
        <form className="form-stack" onSubmit={submit} noValidate>
          {error ? <ErrorState title="This could not be saved" message={error} /> : null}

          {sheet === 'payment' && creditAccount ? (
            <>
              <p className="field-hint">
                {creditAccount.balance === null
                  ? `This lowers what ${customer.displayName} owes. The amount they owe is not recorded.`
                  : creditAccount.balance.trim().startsWith('-')
                    ? `${customer.displayName} has already paid ${formatTileMoney(creditAccount.balance.replace('-', ''), creditAccount.currency)} more than they owe. A new payment adds to that.`
                    : `This lowers what ${customer.displayName} owes. They currently owe ${formatTileMoney(creditAccount.balance, creditAccount.currency)}.`}
              </p>
              <Field
                id="action-amount"
                label={`Amount received (${creditAccount.currency})`}
                required
              >
                <input
                  id="action-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </Field>
              <Field id="action-station" label="Where was the money received?" required>
                <Select
                  id="action-station"
                  value={stationId}
                  onChange={(event) => setStationId(event.target.value)}
                  placeholder="Choose a station"
                  options={stationsToChoose.map((station) => ({
                    value: station.id,
                    label: `${station.name} (${station.code})`,
                  }))}
                />
              </Field>
              <Field id="action-date" label="Date received" required>
                <input
                  id="action-date"
                  type="date"
                  max={todayInStationTime()}
                  value={date}
                  onChange={(event) => setDate(event.target.value || todayInStationTime())}
                />
              </Field>
              <Field id="action-note" label="Note" optional hint="For example a receipt number.">
                <input
                  id="action-note"
                  maxLength={500}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </Field>
              <Field id="action-vehicle" label="Vehicle registration" optional>
                <input
                  id="action-vehicle"
                  maxLength={20}
                  autoComplete="off"
                  value={vehicle}
                  onChange={(event) => setVehicle(event.target.value)}
                />
              </Field>
              <Field id="action-driver" label="Driver's name" optional>
                <input
                  id="action-driver"
                  maxLength={120}
                  autoComplete="off"
                  value={driver}
                  onChange={(event) => setDriver(event.target.value)}
                />
              </Field>
              <Field
                id="action-voucher"
                label="Voucher or slip number"
                optional
                hint="Who approved it, and a photo of the slip, can be added afterwards under Credit limits and transaction details."
              >
                <input
                  id="action-voucher"
                  maxLength={60}
                  autoComplete="off"
                  value={voucher}
                  onChange={(event) => setVoucher(event.target.value)}
                />
              </Field>
            </>
          ) : null}

          {sheet === 'topup' ? (
            <>
              {topUpAccounts.length > 1 ? (
                <Field id="action-account" label="Which account?" required>
                  <Select
                    id="action-account"
                    value={accountId}
                    onChange={(event) => setAccountId(event.target.value)}
                    options={topUpAccounts.map((account) => ({
                      value: account.accountId,
                      label:
                        account.accountType === 'PREPAID_VALUE' ? 'Prepaid money' : 'Prepaid fuel',
                    }))}
                  />
                </Field>
              ) : null}
              {topUpTarget?.accountType === 'PREPAID_LITRES' ? (
                <>
                  <Field id="action-product" label="Which fuel?" required>
                    <Select
                      id="action-product"
                      value={productId}
                      onChange={(event) => setProductId(event.target.value)}
                      placeholder="Choose a fuel"
                      options={fuelProducts.map((product) => ({
                        value: product.id,
                        label: product.name,
                      }))}
                    />
                  </Field>
                  <Field id="action-litres" label="Litres paid for" required>
                    <input
                      id="action-litres"
                      inputMode="decimal"
                      autoComplete="off"
                      value={litres}
                      onChange={(event) => setLitres(event.target.value)}
                    />
                  </Field>
                </>
              ) : (
                <Field
                  id="action-amount"
                  label={`Amount paid in (${topUpTarget?.currency ?? currency})`}
                  required
                >
                  <input
                    id="action-amount"
                    inputMode="decimal"
                    autoComplete="off"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                </Field>
              )}
              <Field id="action-date" label="Date paid" required>
                <input
                  id="action-date"
                  type="date"
                  max={todayInStationTime()}
                  value={date}
                  onChange={(event) => setDate(event.target.value || todayInStationTime())}
                />
              </Field>
              <Field id="action-vehicle" label="Vehicle registration" optional>
                <input
                  id="action-vehicle"
                  maxLength={20}
                  autoComplete="off"
                  value={vehicle}
                  onChange={(event) => setVehicle(event.target.value)}
                />
              </Field>
              <Field id="action-driver" label="Driver's name" optional>
                <input
                  id="action-driver"
                  maxLength={120}
                  autoComplete="off"
                  value={driver}
                  onChange={(event) => setDriver(event.target.value)}
                />
              </Field>
              <Field
                id="action-voucher"
                label="Voucher or slip number"
                optional
                hint="Who approved it, and a photo of the slip, can be added afterwards under Credit limits and transaction details."
              >
                <input
                  id="action-voucher"
                  maxLength={60}
                  autoComplete="off"
                  value={voucher}
                  onChange={(event) => setVoucher(event.target.value)}
                />
              </Field>
            </>
          ) : null}

          {sheet === 'account' ? (
            <>
              <Field id="action-kind" label="What kind of account?" required>
                <Select
                  id="action-kind"
                  value={newKind}
                  onChange={(event) => setNewKind(event.target.value as AccountKind)}
                  placeholder="Choose one"
                  options={openableKinds.map((kind) => ({
                    value: kind,
                    label: ACCOUNT_KIND_LABELS[kind],
                  }))}
                />
              </Field>
              {newKind === 'CREDIT' ? (
                <Field
                  id="action-limit"
                  label={`Most they may owe at one time (${currency})`}
                  hint="This is the credit limit."
                  required
                >
                  <input
                    id="action-limit"
                    inputMode="decimal"
                    autoComplete="off"
                    value={creditLimit}
                    onChange={(event) => setCreditLimit(event.target.value)}
                  />
                </Field>
              ) : null}
              <p className="field-hint">
                After opening it, choose which stations it can be used at under “Where this customer
                can buy fuel”.
              </p>
            </>
          ) : null}

          {sheet === 'suspend' ? (
            <p>
              {customer.displayName} will not be able to buy fuel until you reactivate them. What
              they owe and their balances stay as they are.
            </p>
          ) : null}
          {sheet === 'reactivate' ? (
            <p>{customer.displayName} will be able to buy fuel again.</p>
          ) : null}

          {fieldError ? (
            <p className="field-error" role="alert">
              {fieldError}
            </p>
          ) : null}

          <div className="form-actions">
            <Button variant="secondary" type="button" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={sheet === 'suspend' ? 'danger' : 'primary'}
              loading={busy}
            >
              {sheet ? submitLabels[sheet] : 'Save'}
            </Button>
          </div>
        </form>
      </Modal>
      <StepUpDialog
        open={stepUpRetry !== null}
        tenantId={tenantId}
        description="This change needs a fresh identity check first. Nothing is saved until you confirm."
        confirmLabel="Confirm and continue"
        cancelledMessage="The check was cancelled or did not pass. Nothing was saved."
        onVerified={() => {
          const retry = stepUpRetry;
          setStepUpRetry(null);
          retry?.();
        }}
        onCancel={() => {
          setStepUpRetry(null);
          setError('The identity check was cancelled, so nothing was saved.');
        }}
      />
    </>
  );
}
