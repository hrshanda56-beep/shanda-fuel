'use client';

import { useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Select } from '@/design-system/forms';
import { Modal } from '@/design-system/modal';
import { Button, ErrorState, Field } from '@/design-system/primitives';
import { StepUpDialog } from '@/modules/setup/ui/step-up-dialog';
import { companyForNewCustomer } from '../company-choice';
import { makeReference, STAFF_CUSTOMER_KIND } from './customer-reference';
import { AddCustomerWizard, type NewCustomerValue } from './add-customer-wizard';

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
  existingNames = [],
}: {
  tenantId: string;
  /** The company chosen in the context selector; a customer's credit is with one company. */
  legalEntityId: string | null;
  /** Every company the person may add customers to, for when none is chosen yet. */
  companies?: ReadonlyArray<{ id: string; name: string }>;
  canAdd: boolean;
  canOpenAccount: boolean;
  /** Names already in use, so a second customer with the same name is noticed before saving. */
  existingNames?: readonly string[];
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
  // Kept so the guide can come back on its check screen after the identity check hides the dialog.
  const [draft, setDraft] = useState<NewCustomerValue | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepUpRetry, setStepUpRetry] = useState<(() => void) | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Keeps one key per create so a retry after a dropped connection cannot make two customers.
  const keys = useRef<{ customer: string; account: string; reference: string } | null>(null);

  if (!canAdd) return null;

  function reset() {
    setDraft(null);
    setError(null);
    keys.current = null;
  }

  function close() {
    if (!busy) setOpen(false);
  }

  async function run(value: NewCustomerValue, alreadyConfirmed = false) {
    const { kind, name, staffName, phone, limit, days } = value;
    const customerName = kind === 'STAFF' ? staffName.trim() : name.trim();
    keys.current ??= {
      customer: crypto.randomUUID(),
      account: crypto.randomUUID(),
      reference: makeReference(customerName),
    };
    // Opening an account needs a fresh identity check. Ask before the first write so the customer
    // is never saved when the person then cancels or the check fails.
    if (kind && !alreadyConfirmed) {
      setStepUpRetry(() => () => void run(value, true));
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
        setStepUpRetry(() => () => void run(value, true));
      } else {
        setError(`${message} Nothing was saved.`);
      }
    } finally {
      setBusy(false);
    }
  }

  function submit(value: NewCustomerValue) {
    setDone(null);
    if (!legalEntityId) {
      setError('Choose a company in the selector at the top first. Nothing was saved.');
      return;
    }
    setDraft(value);
    void run(value);
  }

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
        presentation="page"
        backLabel="Customers"
        size="sm"
        dismissible={!busy}
      >
        <AddCustomerWizard
          canOpenAccount={canOpenAccount}
          initialKind={startsAsStaff && canOpenAccount ? 'STAFF' : ''}
          initial={draft}
          existingNames={existingNames}
          busy={busy}
          error={error}
          onCancel={close}
          onSubmit={submit}
        />
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
