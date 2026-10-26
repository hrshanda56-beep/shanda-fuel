'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Select } from '@/design-system/forms';
import { Modal } from '@/design-system/modal';
import { Button, ErrorState, Field } from '@/design-system/primitives';
import { StepUpDialog } from '@/modules/setup/ui/step-up-dialog';
import { companyForNewCustomer } from '../company-choice';
import { makeReference, STAFF_CUSTOMER_KIND } from './customer-reference';

type Kind = 'CREDIT' | 'PREPAID_VALUE' | 'PREPAID_LITRES' | 'STAFF';

const KIND_LABELS: Record<Kind, string> = {
  CREDIT: 'Credit account (they buy now, pay later)',
  PREPAID_VALUE: 'Prepaid money (they pay first, spend as they buy)',
  PREPAID_LITRES: 'Prepaid fuel (they pay first for a set number of litres)',
  STAFF: 'Staff fuel benefit (a monthly limit for a staff member)',
};

const POSITIVE_MONEY = /^(?!0+(?:\.0+)?$)\d{1,16}(?:\.\d{1,2})?$/;

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
 * Adds a customer and, when a kind is chosen, opens its first account. With an account it is one
 * command after the identity check, so a refusal or a cancelled check saves nothing at all.
 */
export function AddCustomer({
  tenantId,
  legalEntityId: selectedLegalEntityId,
  companies = [],
  canAdd,
  canOpenAccount,
}: {
  tenantId: string;
  /** The company chosen in the context selector; a customer's credit is with one company. */
  legalEntityId: string | null;
  /** Every company the person may add customers to, for when none is chosen yet. */
  companies?: ReadonlyArray<{ id: string; name: string }>;
  canAdd: boolean;
  canOpenAccount: boolean;
}) {
  const router = useRouter();
  // The staff fuel benefit page links here with ?add=staff so the form opens ready for a staff member.
  const startsAsStaff = useSearchParams().get('add') === 'staff';
  const [open, setOpen] = useState(startsAsStaff);
  // With no company selected at the top and several to choose from, ask before the form opens.
  const [pickedCompany, setPickedCompany] = useState('');
  const [askingCompany, setAskingCompany] = useState(false);
  const { legalEntityId, mustAskFirst } = companyForNewCustomer({
    selected: selectedLegalEntityId,
    companies,
    picked: pickedCompany,
  });
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
      if (kind) {
        // One command, so a refusal or a dropped connection leaves nothing half-saved.
        await post(
          {
            commandType: 'CreateCustomerWithAccount',
            tenantId,
            accountReference: keys.current.reference,
            displayName: customerName,
            contactMetadata: {
              ...(phone.trim() ? { phone: phone.trim() } : {}),
              ...(kind === 'STAFF' ? { kind: STAFF_CUSTOMER_KIND } : {}),
            },
            ...(legalEntityId ? { legalEntityId } : {}),
            accountType: kind === 'STAFF' ? 'CREDIT' : kind,
            currency: 'USD',
            ...(kind === 'CREDIT' || kind === 'STAFF' ? { creditLimit: limit.trim() } : {}),
            ...(kind === 'CREDIT' && days.trim() ? { creditDays: Number(days.trim()) } : {}),
            ...(kind === 'STAFF' ? { staffBenefit: { staffName: staffName.trim() } } : {}),
          },
          keys.current.customer,
        );
      } else {
        await post(
          {
            commandType: 'CreateCustomer',
            tenantId,
            accountReference: keys.current.reference,
            displayName: customerName,
            ...(phone.trim() ? { contactMetadata: { phone: phone.trim() } } : {}),
            ...(legalEntityId ? { legalEntityId } : {}),
          },
          keys.current.customer,
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
      if (!alreadyConfirmed && /step-up/i.test(message)) {
        setStepUpRetry(() => () => void run(true));
      } else {
        setError(`${message} Nothing was saved.`);
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
          if (mustAskFirst) setAskingCompany(true);
          else setOpen(true);
        }}
      >
        Add customer
      </Button>
      <Modal
        open={askingCompany}
        onClose={() => setAskingCompany(false)}
        title="Which company is this customer with?"
        description="A customer's credit is with one company. Choose it first."
        size="sm"
      >
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (!pickedCompany) return;
            setAskingCompany(false);
            setOpen(true);
          }}
        >
          <Field id="add-customer-company" label="Company" required>
            <Select
              id="add-customer-company"
              value={pickedCompany}
              onChange={(event) => setPickedCompany(event.target.value)}
              placeholder="Choose a company"
              options={companies.map((company) => ({ value: company.id, label: company.name }))}
            />
          </Field>
          <div className="form-actions">
            <Button variant="secondary" type="button" onClick={() => setAskingCompany(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!pickedCompany}>
              Continue
            </Button>
          </div>
        </form>
      </Modal>
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
              hint="How many days they have to pay. It sets when each charge falls due and when it counts as overdue."
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
