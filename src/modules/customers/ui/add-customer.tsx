'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Select } from '@/design-system/forms';
import { Modal } from '@/design-system/modal';
import { Button, ErrorState, Field } from '@/design-system/primitives';
import { StepUpDialog } from '@/modules/setup/ui/step-up-dialog';

type Kind = 'CREDIT' | 'PREPAID_VALUE' | 'PREPAID_LITRES' | 'STAFF';

const KIND_LABELS: Record<Kind, string> = {
  CREDIT: 'Credit account (they buy now, pay later)',
  PREPAID_VALUE: 'Prepaid money (they pay first, spend as they buy)',
  PREPAID_LITRES: 'Prepaid fuel (they pay first for a set number of litres)',
  STAFF: 'Staff fuel benefit (a monthly limit for a staff member)',
};

const POSITIVE_MONEY = /^(?!0+(?:\.0+)?$)\d{1,16}(?:\.\d{1,2})?$/;

/** A short code people never have to type: letters from the name plus a few digits. */
function makeReference(name: string): string {
  const letters = name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
  const digits = String(Math.floor(1000 + Math.random() * 9000));
  return `${letters || 'CUST'}-${digits}`;
}

async function post(input: Record<string, unknown>, key: string): Promise<unknown> {
  const response = await fetch('/api/customers/commands', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify(input),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof result === 'object' && result !== null && 'message' in result
        ? String((result as { message: unknown }).message)
        : 'This could not be saved.';
    throw new Error(message);
  }
  return result;
}

/**
 * Adds a customer and, when a kind is chosen, opens its first account. The customer record is
 * created once; if opening the account then fails the form says so and a retry only repeats the
 * account step, so no duplicate customer is made.
 */
export function AddCustomer({
  tenantId,
  legalEntityId,
  canAdd,
  canOpenAccount,
}: {
  tenantId: string;
  /** The company chosen in the context selector; a customer's credit is with one company. */
  legalEntityId: string | null;
  canAdd: boolean;
  canOpenAccount: boolean;
}) {
  const router = useRouter();
  // The staff fuel benefit page links here with ?add=staff so the form opens ready for a staff member.
  const startsAsStaff = useSearchParams().get('add') === 'staff';
  const [open, setOpen] = useState(startsAsStaff);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [kind, setKind] = useState<Kind | ''>(startsAsStaff ? 'STAFF' : '');
  const [limit, setLimit] = useState('');
  const [days, setDays] = useState('');
  const [staffName, setStaffName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [stepUpRetry, setStepUpRetry] = useState<(() => void) | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Keeps one key per create so a retry after a dropped connection cannot make two customers.
  const created = useRef<{ customerId: string } | null>(null);
  const keys = useRef<{ customer: string; account: string; reference: string } | null>(null);

  if (!canAdd) return null;

  function reset() {
    setName('');
    setPhone('');
    setKind('');
    setLimit('');
    setDays('');
    setStaffName('');
    setError(null);
    setFieldError(null);
    created.current = null;
    keys.current = null;
  }

  function close() {
    if (!busy) setOpen(false);
  }

  async function run(alreadyConfirmed = false) {
    const customerName = kind === 'STAFF' ? staffName.trim() : name.trim();
    keys.current ??= {
      customer: crypto.randomUUID(),
      account: crypto.randomUUID(),
      reference: makeReference(customerName),
    };
    // Opening an account needs a fresh identity check. Ask before the first write so the customer
    // is never saved when the person then cancels or the check fails.
    if (kind && !alreadyConfirmed) {
      setStepUpRetry(() => () => void run(true));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!created.current) {
        const result = (await post(
          {
            commandType: 'CreateCustomer',
            tenantId,
            accountReference: keys.current.reference,
            displayName: customerName,
            ...(phone.trim() ? { contactMetadata: { phone: phone.trim() } } : {}),
            ...(legalEntityId ? { legalEntityId } : {}),
          },
          keys.current.customer,
        )) as { customerId: string };
        created.current = { customerId: result.customerId };
      }
      if (kind) {
        await post(
          {
            commandType: 'CreateCustomerAccount',
            tenantId,
            customerId: created.current.customerId,
            accountType: kind === 'STAFF' ? 'CREDIT' : kind,
            currency: 'USD',
            ...(kind === 'CREDIT' || kind === 'STAFF' ? { creditLimit: limit.trim() } : {}),
            ...(kind === 'CREDIT' && days.trim() ? { creditDays: Number(days.trim()) } : {}),
            ...(kind === 'STAFF' ? { staffBenefit: { staffName: staffName.trim() } } : {}),
          },
          keys.current.account,
        );
      }
      setDone(
        kind
          ? `${customerName} was added and the account is open. Choose where it can be used on the customer’s page.`
          : `${customerName} was added. Open an account for them from their row.`,
      );
      setOpen(false);
      reset();
      router.refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'This could not be saved.';
      if (!alreadyConfirmed && /not authorized|step-up/i.test(message)) {
        setStepUpRetry(() => () => void run(true));
      } else if (created.current) {
        setError(
          `${customerName} was added, but the account could not be opened: ${message} Press save again to retry the account.`,
        );
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setFieldError(null);
    setDone(null);
    if (!legalEntityId) {
      return setFieldError('Choose a company in the selector at the top first.');
    }
    if (kind === 'STAFF') {
      if (!staffName.trim()) return setFieldError('Enter the staff member’s name.');
    } else if (!name.trim()) {
      return setFieldError('Enter the customer’s name.');
    }
    if ((kind === 'CREDIT' || kind === 'STAFF') && !POSITIVE_MONEY.test(limit.trim())) {
      return setFieldError(
        kind === 'STAFF'
          ? 'Enter the monthly limit in US dollars, for example 60 or 60.50.'
          : 'Enter the most this customer may owe, for example 1000.',
      );
    }
    if (kind === 'CREDIT' && days.trim() && !/^\d{1,3}$/.test(days.trim())) {
      return setFieldError('Enter the usual days to pay as a whole number, for example 30.');
    }
    if (kind === 'CREDIT' && Number(days.trim()) > 365) {
      return setFieldError('The usual days to pay cannot be more than 365.');
    }
    void run();
  }

  const kinds = Object.keys(KIND_LABELS) as Kind[];

  return (
    <>
      <Button
        aria-haspopup="dialog"
        onClick={() => {
          reset();
          setDone(null);
          setOpen(true);
        }}
      >
        Add customer
      </Button>
      {done ? <p role="status">{done}</p> : null}
      <Modal
        open={open && stepUpRetry === null}
        onClose={close}
        title="Add a customer"
        presentation="side"
        size="sm"
        dismissible={!busy}
      >
        <form className="form-stack" onSubmit={submit} noValidate>
          {error ? <ErrorState title="This could not be saved" message={error} /> : null}
          {canOpenAccount ? (
            <Field id="add-customer-kind" label="What kind of account?" optional>
              <Select
                id="add-customer-kind"
                value={kind}
                onChange={(event) => setKind(event.target.value as Kind | '')}
                placeholder="Just add the customer for now"
                options={kinds.map((item) => ({ value: item, label: KIND_LABELS[item] }))}
              />
            </Field>
          ) : null}
          {kind === 'STAFF' ? (
            <Field id="add-customer-staff" label="Staff member" required>
              <input
                id="add-customer-staff"
                maxLength={200}
                autoComplete="off"
                value={staffName}
                onChange={(event) => setStaffName(event.target.value)}
              />
            </Field>
          ) : (
            <Field id="add-customer-name" label="Customer name" required>
              <input
                id="add-customer-name"
                maxLength={200}
                autoComplete="off"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
          )}
          <Field id="add-customer-phone" label="Phone number" optional>
            <input
              id="add-customer-phone"
              type="tel"
              maxLength={200}
              autoComplete="off"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </Field>
          {kind === 'CREDIT' || kind === 'STAFF' ? (
            <Field
              id="add-customer-limit"
              label={
                kind === 'STAFF' ? 'Monthly limit (USD)' : 'Most they may owe at one time (USD)'
              }
              hint={kind === 'STAFF' ? undefined : 'This is the credit limit.'}
              required
            >
              <input
                id="add-customer-limit"
                inputMode="decimal"
                autoComplete="off"
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
              />
            </Field>
          ) : null}
          {kind === 'CREDIT' ? (
            <Field
              id="add-customer-days"
              label="Usual days to pay"
              hint="Only a note for your team. It does not stop a sale."
              optional
            >
              <input
                id="add-customer-days"
                inputMode="numeric"
                autoComplete="off"
                value={days}
                onChange={(event) => setDays(event.target.value)}
              />
            </Field>
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
            <Button type="submit" loading={busy}>
              Save customer
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
