'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { Select } from '@/design-system/forms';
import { PageHeader } from '@/design-system/layout';
import { Button, Card, EmptyState, ErrorState, Field } from '@/design-system/primitives';
import { formatTileMoney } from '@/modules/reporting/format';
import { StepUpDialog } from '@/modules/setup/ui/step-up-dialog';
import type { StaffBenefitRow } from '../staff-benefit-rows';
import { StaffBenefitLabel, StaffBenefitUseSummary } from './staff-benefit-label';

export type StaffBenefitCustomerOption = { customerId: string; name: string; reference: string };

const POSITIVE_MONEY = /^(?!0+(?:\.0+)?$)\d{1,16}(?:\.\d{1,2})?$/;

export function StaffBenefitWorkspace({
  tenantId,
  rows,
  customers,
  canOpenAccount,
}: {
  tenantId: string;
  rows: readonly StaffBenefitRow[];
  /** Active customers that may be given a staff benefit account. */
  customers: readonly StaffBenefitCustomerOption[];
  canOpenAccount: boolean;
}) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState('');
  const [staffName, setStaffName] = useState('');
  const [limit, setLimit] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [stepUp, setStepUp] = useState(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);

  async function save(alreadyConfirmed = false) {
    const body = {
      commandType: 'CreateCustomerAccount',
      tenantId,
      customerId,
      accountType: 'CREDIT',
      currency: 'USD',
      creditLimit: limit.trim(),
      staffBenefit: { staffName: staffName.trim() },
    };
    const fingerprint = JSON.stringify(body);
    if (attempt.current?.fingerprint !== fingerprint) {
      attempt.current = { fingerprint, key: crypto.randomUUID() };
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/customers/commands', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'idempotency-key': attempt.current.key },
        body: JSON.stringify(body),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof result === 'object' && result !== null && 'message' in result
            ? String((result as { message: unknown }).message)
            : 'This could not be saved.';
        if (!alreadyConfirmed && /not authorized|step-up/i.test(message)) {
          setStepUp(true);
          return;
        }
        throw new Error(message);
      }
      attempt.current = null;
      setDone(
        `Staff fuel benefit opened for ${staffName.trim()}. Choose where it can be used on the customer’s page.`,
      );
      setCustomerId('');
      setStaffName('');
      setLimit('');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setDone(null);
    if (!customerId) return setError('Choose the customer record this benefit belongs to.');
    if (!staffName.trim()) return setError('Enter the staff member’s name.');
    if (!POSITIVE_MONEY.test(limit.trim())) {
      return setError('Enter the monthly limit in US dollars, for example 60 or 60.50.');
    }
    void save();
  }

  return (
    <>
      <PageHeader
        title="Staff fuel benefit"
        eyebrow="Customers"
        description="Fuel that staff may take each month, up to a limit. It uses the normal customer account, statement and ageing."
        actions={
          <Link className="button button-secondary" href="/customers">
            All customers
          </Link>
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          title="No staff benefit accounts yet"
          message="Each staff member gets a monthly limit that only an owner or administrator can change."
          action={
            <Link className="button" href="/customers?add=staff">
              Add a staff member
            </Link>
          }
        />
      ) : (
        <div className="stack">
          {rows.map((row) => (
            <Card key={row.accountId} as="article">
              <h2>{row.staffName}</h2>
              <p>
                <StaffBenefitLabel /> <span className="muted">{row.accountReference}</span>
              </p>
              <StaffBenefitUseSummary use={row.use} />
              <p className="muted">
                Monthly limit {row.limit ? formatTileMoney(row.limit) : 'not set'}. Owed in total{' '}
                {formatTileMoney(row.balance)}.
              </p>
              <Link href={`/customers/${encodeURIComponent(row.customerId)}`}>View statement</Link>
            </Card>
          ))}
        </div>
      )}
      {canOpenAccount ? (
        <Card>
          <h2>Open a staff fuel benefit</h2>
          <p className="muted">
            The monthly limit is set now. Changing it later needs the credit limit approval on the
            Customer controls page.
          </p>
          <form onSubmit={submit} noValidate>
            <Field id="staff-customer" label="Customer record" required>
              <Select
                id="staff-customer"
                value={customerId}
                onChange={(event) => setCustomerId(event.target.value)}
                placeholder="Choose a customer"
                options={customers.map((customer) => ({
                  value: customer.customerId,
                  label: `${customer.name} (${customer.reference})`,
                }))}
              />
            </Field>
            <Field id="staff-name" label="Staff member" required>
              <input
                id="staff-name"
                autoComplete="off"
                value={staffName}
                onChange={(event) => setStaffName(event.target.value)}
              />
            </Field>
            <Field id="staff-limit" label="Monthly limit (USD)" required>
              <input
                id="staff-limit"
                inputMode="decimal"
                autoComplete="off"
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
              />
            </Field>
            {error ? <ErrorState title="Not saved" message={error} /> : null}
            {done ? <p role="status">{done}</p> : null}
            <Button type="submit" loading={busy}>
              Open staff fuel benefit
            </Button>
          </form>
        </Card>
      ) : null}
      <StepUpDialog
        open={stepUp}
        tenantId={tenantId}
        description="This change needs a fresh identity check first. Nothing is saved until you confirm."
        confirmLabel="Confirm and continue"
        cancelledMessage="The check was cancelled or did not pass. Nothing was saved."
        onVerified={() => {
          setStepUp(false);
          void save(true);
        }}
        onCancel={() => {
          setStepUp(false);
          setError('The identity check was cancelled, so nothing was saved.');
        }}
      />
    </>
  );
}
