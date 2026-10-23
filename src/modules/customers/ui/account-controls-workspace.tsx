'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Select } from '@/design-system/forms';
import { Modal } from '@/design-system/modal';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
} from '@/design-system/primitives';
import { formatTileMoney } from '@/modules/reporting/format';
import { StepUpDialog } from '@/modules/setup/ui/step-up-dialog';
import type { CustomerAccount, CustomerSummary, CustomerTransaction } from './types';

export type AccountControlsStation = {
  id: string;
  name: string;
  code: string;
  legalEntityId: string;
};
export type AccountControlsApproverOption = { membershipId: string; name: string };

type EntryDetailsRow = {
  ledgerEntryId: string;
  vehicleRegistration: string | null;
  driverName: string | null;
  voucherNumber: string | null;
  approvedByMembershipId: string | null;
  documentId: string | null;
};
type OverrideRow = {
  id: string;
  previousLimit: string;
  newLimit: string;
  approvedByMembershipId: string;
  reason: string;
  recordedAt: string;
};

const TIME_ZONE = 'Africa/Harare';

function formatDay(value: string): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: TIME_ZONE }).format(
    new Date(value),
  );
}

function errorText(result: unknown, fallback: string): string {
  if (typeof result === 'object' && result !== null && 'message' in result) {
    const message = (result as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

/** An exact positive amount as typed, or null. No floating-point maths is ever done on it. */
function parseAmount(value: string): string | null {
  const text = value.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,4})?$/.test(text) || !/[1-9]/.test(text)) return null;
  return text;
}

function activate(event: KeyboardEvent, action: () => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    action();
  }
}

const ENTRY_LABELS: Record<CustomerTransaction['entryType'], string> = {
  CREDIT_FUEL_CHARGE: 'Fuel charged',
  CUSTOMER_PAYMENT: 'Payment',
  PREPAID_TOPUP: 'Prepaid top-up',
  PREPAID_FUEL_USAGE: 'Fuel usage',
  ADJUSTMENT: 'Adjustment',
  REVERSAL: 'Reversal',
};

async function postCommand(input: Record<string, unknown>, key: string) {
  const response = await fetch('/api/customers/commands', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify(input),
  });
  const result: unknown = await response.json();
  if (!response.ok) throw new Error(errorText(result, 'This could not be saved.'));
  return result;
}

export function AccountControlsWorkspace({
  tenantId,
  currentStationId,
  customers,
  stations,
  approvers,
  canOverrideLimit,
  canRecordDetails,
}: {
  tenantId: string;
  currentStationId: string | null;
  customers: CustomerSummary[];
  stations: AccountControlsStation[];
  approvers: AccountControlsApproverOption[];
  canOverrideLimit: boolean;
  canRecordDetails: boolean;
}) {
  const creditCustomers = customers.filter((customer) =>
    customer.accounts.some((account) => account.accountType === 'CREDIT'),
  );
  const approverName = (id: string | null) =>
    id
      ? (approvers.find((approver) => approver.membershipId === id)?.name ?? 'A staff member')
      : null;

  const [limitTarget, setLimitTarget] = useState<{
    customer: CustomerSummary;
    account: CustomerAccount;
  } | null>(null);
  const [selectedId, setSelectedId] = useState(creditCustomers[0]?.customerId ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  // The limits shown here are updated after a change, without a full reload.
  const [limits, setLimits] = useState<Record<string, string>>({});

  return (
    <div className="customer-workspace">
      <Card aria-label="Credit limits">
        <h2>Credit limits</h2>
        <p className="field-hint">
          The most each credit customer may owe at one time. A change needs an approver and a
          reason, and is kept on record.
        </p>
        {message ? (
          <p className="field-hint" role="status">
            {message}
          </p>
        ) : null}
        {creditCustomers.length === 0 ? (
          <EmptyState
            layout="block"
            icon="users"
            title="No credit customers yet"
            message="Customers with a credit account will appear here."
          />
        ) : (
          <div className="list-table customer-table">
            <div className="list-head" aria-hidden="true">
              <span>Customer</span>
              <span>Owes us</span>
              <span>Credit limit</span>
              <span>Can still take</span>
            </div>
            <ul className="list-rows" aria-label="Credit customers">
              {creditCustomers.map((customer) => {
                const account = customer.accounts.find((item) => item.accountType === 'CREDIT')!;
                const limit = limits[account.accountId] ?? account.creditLimit;
                const open = () => canOverrideLimit && setLimitTarget({ customer, account });
                return (
                  <li key={customer.customerId} className="customer-item">
                    <div
                      className="list-row customer-row"
                      role={canOverrideLimit ? 'button' : undefined}
                      tabIndex={canOverrideLimit ? 0 : undefined}
                      aria-haspopup={canOverrideLimit ? 'dialog' : undefined}
                      aria-label={
                        canOverrideLimit
                          ? `Change credit limit for ${customer.displayName}`
                          : undefined
                      }
                      onClick={open}
                      onKeyDown={(event) => activate(event, open)}
                    >
                      <span className="list-name">
                        <span>
                          <strong>{customer.displayName}</strong>
                          <small>{customer.accountReference}</small>
                        </span>
                      </span>
                      <span className="list-cell" data-label="Owes us">
                        {account.balance === null
                          ? '—'
                          : formatTileMoney(account.balance, account.currency)}
                      </span>
                      <span className="list-cell" data-label="Credit limit">
                        {limit === null ? 'Not set' : formatTileMoney(limit, account.currency)}
                      </span>
                      <span className="list-cell" data-label="Can still take">
                        {limits[account.accountId] !== undefined
                          ? 'Reload to update'
                          : account.availableCredit === null
                            ? 'Not set'
                            : formatTileMoney(account.availableCredit, account.currency)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {!canOverrideLimit && creditCustomers.length > 0 ? (
          <p className="field-hint">Changing a credit limit needs permission from management.</p>
        ) : null}
      </Card>

      <Card aria-label="Details of each transaction">
        <h2>Details of each transaction</h2>
        <p className="field-hint">
          For a customer account: the vehicle, driver, voucher or slip number and who approved it.
        </p>
        {creditCustomers.length === 0 ? (
          <EmptyState
            layout="block"
            icon="users"
            title="Nothing to show yet"
            message="Pick a customer here once credit customers exist."
          />
        ) : (
          <>
            <Field id="controls-customer" label="Customer">
              <Select
                id="controls-customer"
                value={selectedId}
                onChange={(event) => setSelectedId(event.target.value)}
                options={creditCustomers.map((customer) => ({
                  value: customer.customerId,
                  label: `${customer.displayName} (${customer.accountReference})`,
                }))}
              />
            </Field>
            {selectedId ? (
              <CustomerEntries
                key={`${selectedId}-${version}`}
                tenantId={tenantId}
                customer={creditCustomers.find((item) => item.customerId === selectedId)!}
                currentStationId={currentStationId}
                stations={stations}
                approvers={approvers}
                approverName={approverName}
                canRecordDetails={canRecordDetails}
                onSaved={(text) => {
                  setMessage(text);
                  setVersion((value) => value + 1);
                }}
              />
            ) : null}
          </>
        )}
      </Card>

      <LimitDialog
        target={limitTarget}
        tenantId={tenantId}
        approvers={approvers}
        onClose={() => setLimitTarget(null)}
        onSaved={(accountId, newLimit, text) => {
          setLimits((previous) => ({ ...previous, [accountId]: newLimit }));
          setMessage(text);
          setVersion((value) => value + 1);
          setLimitTarget(null);
        }}
      />
      <p className="field-hint">
        <Link href="/customers">Back to customers</Link>
      </p>
    </div>
  );
}

function CustomerEntries({
  tenantId,
  customer,
  currentStationId,
  stations,
  approvers,
  approverName,
  canRecordDetails,
  onSaved,
}: {
  tenantId: string;
  customer: CustomerSummary;
  currentStationId: string | null;
  stations: AccountControlsStation[];
  approvers: AccountControlsApproverOption[];
  approverName: (id: string | null) => string | null;
  canRecordDetails: boolean;
  onSaved: (message: string) => void;
}) {
  const account = customer.accounts.find((item) => item.accountType === 'CREDIT');
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | {
        status: 'ready';
        transactions: CustomerTransaction[];
        details: EntryDetailsRow[];
        overrides: OverrideRow[];
      }
  >({ status: 'loading' });
  const [target, setTarget] = useState<CustomerTransaction | null>(null);

  const load = useCallback(async () => {
    if (!account) return;
    try {
      const params = new URLSearchParams({ tenantId, customerId: customer.customerId });
      const [summary, controls] = await Promise.all([
        fetch(`/api/customers/summary?${params}`, {
          cache: 'no-store',
          credentials: 'same-origin',
        }),
        fetch(
          `/api/customers/account-controls?tenantId=${tenantId}&accountId=${account.accountId}`,
          {
            cache: 'no-store',
            credentials: 'same-origin',
          },
        ),
      ]);
      const summaryBody = (await summary.json()) as { customers?: CustomerSummary[] };
      const controlsBody = (await controls.json()) as {
        entryDetails?: EntryDetailsRow[];
        overrides?: OverrideRow[];
      };
      if (!summary.ok) throw new Error(errorText(summaryBody, 'The activity could not be loaded.'));
      if (!controls.ok)
        throw new Error(errorText(controlsBody, 'The details could not be loaded.'));
      setState({
        status: 'ready',
        transactions: (summaryBody.customers?.[0]?.recentTransactions ?? []).filter(
          (transaction) => transaction.accountId === account.accountId,
        ),
        details: controlsBody.entryDetails ?? [],
        overrides: controlsBody.overrides ?? [],
      });
    } catch (cause) {
      setState({
        status: 'error',
        message: cause instanceof Error ? cause.message : 'This could not be loaded.',
      });
    }
  }, [account, customer.customerId, tenantId]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  if (state.status === 'loading') return <LoadingState label="Loading activity" />;
  if (state.status === 'error') return <ErrorState message={state.message} />;

  return (
    <>
      {state.transactions.length === 0 ? (
        <EmptyState
          layout="block"
          icon="users"
          title="No activity yet"
          message="Fuel charged and payments for this customer will appear here."
        />
      ) : (
        <ul className="list-rows" aria-label="Recent account activity">
          {state.transactions.map((transaction) => {
            const recorded = state.details.find((row) => row.ledgerEntryId === transaction.id);
            const canOpen = canRecordDetails && !recorded;
            const open = () => canOpen && setTarget(transaction);
            return (
              <li key={transaction.id} className="customer-item">
                <div
                  className="list-row customer-row"
                  role={canOpen ? 'button' : undefined}
                  tabIndex={canOpen ? 0 : undefined}
                  aria-haspopup={canOpen ? 'dialog' : undefined}
                  onClick={open}
                  onKeyDown={(event) => activate(event, open)}
                >
                  <span className="list-name">
                    <span>
                      <strong>{ENTRY_LABELS[transaction.entryType]}</strong>
                      <small>{formatDay(transaction.occurredAt)}</small>
                    </span>
                  </span>
                  <span className="list-cell" data-label="Amount">
                    {transaction.amount === null
                      ? '—'
                      : formatTileMoney(transaction.amount, transaction.currency)}
                  </span>
                  <span className="list-cell" data-label="Details">
                    {recorded
                      ? [
                          recorded.vehicleRegistration && `Vehicle ${recorded.vehicleRegistration}`,
                          recorded.driverName && `Driver ${recorded.driverName}`,
                          recorded.voucherNumber && `Voucher ${recorded.voucherNumber}`,
                          recorded.approvedByMembershipId &&
                            `Approved by ${approverName(recorded.approvedByMembershipId)}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : canOpen
                        ? 'Add vehicle, driver and voucher'
                        : 'Not recorded'}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <h3 className="field-hint">Credit limit changes</h3>
      {state.overrides.length === 0 ? (
        <p className="field-hint">The credit limit has not been changed since it was set.</p>
      ) : (
        <ul className="customer-activity" aria-label="Credit limit changes">
          {state.overrides.map((row) => (
            <li key={row.id}>
              <span>{formatDay(row.recordedAt)}</span>
              <span>
                {formatTileMoney(row.previousLimit, account?.currency ?? 'USD')} to{' '}
                {formatTileMoney(row.newLimit, account?.currency ?? 'USD')} · approved by{' '}
                {approverName(row.approvedByMembershipId)}
              </span>
              <strong>{row.reason}</strong>
            </li>
          ))}
        </ul>
      )}

      <DetailsDialog
        transaction={target}
        tenantId={tenantId}
        customerLegalEntityId={customer.legalEntityId}
        currentStationId={currentStationId}
        stations={stations}
        approvers={approvers}
        onClose={() => setTarget(null)}
        onSaved={() => {
          setTarget(null);
          onSaved('Details saved.');
        }}
      />
    </>
  );
}

/** Runs a save; if the server asks for a fresh identity check, shows it and retries once. */
function useSaver(tenantId: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);

  const save = useCallback(async function run(
    input: Record<string, unknown>,
    onDone: () => void,
    confirmed = false,
  ) {
    const fingerprint = JSON.stringify(input);
    if (attempt.current?.fingerprint !== fingerprint) {
      attempt.current = { fingerprint, key: crypto.randomUUID() };
    }
    setBusy(true);
    setError(null);
    try {
      await postCommand(input, attempt.current.key);
      attempt.current = null;
      onDone();
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : 'This could not be saved.';
      if (!confirmed && /not authorized|step-up/i.test(text)) {
        setRetry(() => () => void run(input, onDone, true));
      } else {
        setError(text);
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const dialog = (
    <StepUpDialog
      open={retry !== null}
      tenantId={tenantId}
      description="This change needs a fresh identity check first. Nothing is saved until you confirm."
      confirmLabel="Confirm and continue"
      cancelledMessage="The check was cancelled or did not pass. Nothing was saved."
      onVerified={() => {
        const next = retry;
        setRetry(null);
        next?.();
      }}
      onCancel={() => {
        setRetry(null);
        setError('The identity check was cancelled, so nothing was saved.');
      }}
    />
  );
  return { busy, error, setError, save, dialog, waiting: retry !== null };
}

function LimitDialog({
  target,
  tenantId,
  approvers,
  onClose,
  onSaved,
}: {
  target: { customer: CustomerSummary; account: CustomerAccount } | null;
  tenantId: string;
  approvers: AccountControlsApproverOption[];
  onClose: () => void;
  onSaved: (accountId: string, newLimit: string, message: string) => void;
}) {
  const [limit, setLimit] = useState('');
  const [approverId, setApproverId] = useState('');
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const saver = useSaver(tenantId);
  const targetKey = target?.account.accountId ?? null;
  const [lastKey, setLastKey] = useState<string | null>(null);
  if (targetKey !== lastKey) {
    setLastKey(targetKey);
    setLimit('');
    setApproverId('');
    setReason('');
    setFieldError(null);
    saver.setError(null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!target) return;
    const value = parseAmount(limit);
    if (!value) return setFieldError('Enter the new limit, for example 2500.00.');
    if (!approverId) return setFieldError('Choose who approved this change.');
    if (!reason.trim()) return setFieldError('Say why the limit is being changed.');
    setFieldError(null);
    void saver.save(
      {
        commandType: 'OverrideCustomerCreditLimit',
        tenantId,
        accountId: target.account.accountId,
        expectedVersion: target.account.version,
        newLimit: value,
        approvedByMembershipId: approverId,
        reason: reason.trim(),
      },
      () =>
        onSaved(
          target.account.accountId,
          value,
          `Credit limit for ${target.customer.displayName} is now ${formatTileMoney(value, target.account.currency)}.`,
        ),
    );
  }

  return (
    <>
      <Modal
        open={target !== null && !saver.waiting}
        onClose={() => !saver.busy && onClose()}
        title={
          target ? `Change credit limit for ${target.customer.displayName}` : 'Change credit limit'
        }
        presentation="side"
        size="sm"
        dismissible={!saver.busy}
      >
        <form className="form-stack" onSubmit={submit} noValidate>
          {saver.error ? (
            <ErrorState title="This could not be saved" message={saver.error} />
          ) : null}
          {target ? (
            <p className="field-hint">
              The limit is now{' '}
              {target.account.creditLimit === null
                ? 'not set'
                : formatTileMoney(target.account.creditLimit, target.account.currency)}
              .
            </p>
          ) : null}
          <Field
            id="limit-new"
            label={`New credit limit (${target?.account.currency ?? 'USD'})`}
            required
          >
            <input
              id="limit-new"
              inputMode="decimal"
              autoComplete="off"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
            />
          </Field>
          <Field id="limit-approver" label="Who approved this?" required>
            <Select
              id="limit-approver"
              value={approverId}
              onChange={(event) => setApproverId(event.target.value)}
              placeholder="Choose a person"
              options={approvers.map((approver) => ({
                value: approver.membershipId,
                label: approver.name,
              }))}
            />
          </Field>
          <Field id="limit-reason" label="Why is the limit changing?" required>
            <textarea
              id="limit-reason"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          {fieldError ? (
            <p className="field-error" role="alert">
              {fieldError}
            </p>
          ) : null}
          <div className="form-actions">
            <Button variant="secondary" type="button" onClick={onClose} disabled={saver.busy}>
              Cancel
            </Button>
            <Button type="submit" loading={saver.busy}>
              Change limit
            </Button>
          </div>
        </form>
      </Modal>
      {saver.dialog}
    </>
  );
}

function DetailsDialog({
  transaction,
  tenantId,
  customerLegalEntityId,
  currentStationId,
  stations,
  approvers,
  onClose,
  onSaved,
}: {
  transaction: CustomerTransaction | null;
  tenantId: string;
  customerLegalEntityId: string | null;
  currentStationId: string | null;
  stations: AccountControlsStation[];
  approvers: AccountControlsApproverOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const choices = stations.filter(
    (station) => !customerLegalEntityId || station.legalEntityId === customerLegalEntityId,
  );
  const [vehicle, setVehicle] = useState('');
  const [driver, setDriver] = useState('');
  const [voucher, setVoucher] = useState('');
  const [approverId, setApproverId] = useState('');
  const [stationId, setStationId] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const saver = useSaver(tenantId);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const key = transaction?.id ?? null;
  if (key !== lastKey) {
    setLastKey(key);
    setVehicle('');
    setDriver('');
    setVoucher('');
    setApproverId('');
    setFieldError(null);
    setStationId(
      choices.some((station) => station.id === currentStationId) ? (currentStationId ?? '') : '',
    );
    saver.setError(null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!transaction) return;
    if (!stationId) return setFieldError('Choose the station where this happened.');
    const details = {
      ...(vehicle.trim() ? { vehicleRegistration: vehicle.trim() } : {}),
      ...(driver.trim() ? { driverName: driver.trim() } : {}),
      ...(voucher.trim() ? { voucherNumber: voucher.trim() } : {}),
      ...(approverId ? { approvedByMembershipId: approverId } : {}),
    };
    if (Object.keys(details).length === 0) {
      return setFieldError('Fill in at least one of the details.');
    }
    setFieldError(null);
    void saver.save(
      {
        commandType: 'RecordCustomerEntryDetails',
        tenantId,
        stationId,
        ledgerEntryId: transaction.id,
        details,
      },
      onSaved,
    );
  }

  return (
    <>
      <Modal
        open={transaction !== null && !saver.waiting}
        onClose={() => !saver.busy && onClose()}
        title="Add details to this transaction"
        presentation="side"
        size="sm"
        dismissible={!saver.busy}
      >
        <form className="form-stack" onSubmit={submit} noValidate>
          {saver.error ? (
            <ErrorState title="This could not be saved" message={saver.error} />
          ) : null}
          <p className="field-hint">
            Details cannot be changed once saved, so check them before you press Save.
          </p>
          <Field id="details-station" label="Which station was it at?" required>
            <Select
              id="details-station"
              value={stationId}
              onChange={(event) => setStationId(event.target.value)}
              placeholder="Choose a station"
              options={choices.map((station) => ({
                value: station.id,
                label: `${station.name} (${station.code})`,
              }))}
            />
          </Field>
          <Field id="details-vehicle" label="Vehicle registration" optional>
            <input
              id="details-vehicle"
              maxLength={20}
              autoComplete="off"
              value={vehicle}
              onChange={(event) => setVehicle(event.target.value)}
            />
          </Field>
          <Field id="details-driver" label="Driver's name" optional>
            <input
              id="details-driver"
              maxLength={120}
              autoComplete="off"
              value={driver}
              onChange={(event) => setDriver(event.target.value)}
            />
          </Field>
          <Field id="details-voucher" label="Voucher or slip number" optional>
            <input
              id="details-voucher"
              maxLength={60}
              autoComplete="off"
              value={voucher}
              onChange={(event) => setVoucher(event.target.value)}
            />
          </Field>
          <Field id="details-approver" label="Who approved it?" optional>
            <Select
              id="details-approver"
              value={approverId}
              onChange={(event) => setApproverId(event.target.value)}
              placeholder="Not recorded"
              options={approvers.map((approver) => ({
                value: approver.membershipId,
                label: approver.name,
              }))}
            />
          </Field>
          {fieldError ? (
            <p className="field-error" role="alert">
              {fieldError}
            </p>
          ) : null}
          <div className="form-actions">
            <Button variant="secondary" type="button" onClick={onClose} disabled={saver.busy}>
              Cancel
            </Button>
            <Button type="submit" loading={saver.busy}>
              Save details
            </Button>
          </div>
        </form>
      </Modal>
      {saver.dialog}
    </>
  );
}
