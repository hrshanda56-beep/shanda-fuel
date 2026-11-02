'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { Button, Card, ErrorState, Field, StatusBadge } from '@/design-system/primitives';
import { ExactDecimal } from '@/platform/domain/primitives';
import { formatTileMoney } from '@/modules/reporting/format';
import { StepUpDialog } from '@/modules/setup/ui/step-up-dialog';
import type { StaffBenefitRow } from '../staff-benefit-rows';
import type { StaffPickerOption } from '../staff-picker-options';
import { StaffPicker } from './staff-picker';
import { makeReference, STAFF_CUSTOMER_KIND } from './customer-reference';
import styles from './staff-benefit.module.css';

export type StaffBenefitCustomerOption = { customerId: string; name: string; reference: string };

function usedPercent(spent: string, limit: string): number {
  const cap = Number(limit);
  return cap > 0 ? (Number(spent) / cap) * 100 : 0;
}

const POSITIVE_MONEY = /^(?!0+(?:\.0+)?$)\d{1,16}(?:\.\d{1,2})?$/;

export function StaffBenefitWorkspace({
  tenantId,
  rows,
  customers,
  staff,
  canOpenAccount,
  legalEntityId,
}: {
  tenantId: string;
  /** The company the new staff account belongs to, so its month can be worked out. */
  legalEntityId?: string | undefined;
  rows: readonly StaffBenefitRow[];
  /** Active customers that may be given a staff benefit account. */
  customers: readonly StaffBenefitCustomerOption[];
  /** Active staff (from Settings > Staff) who are not yet on a benefit. */
  staff: readonly StaffPickerOption[];
  canOpenAccount: boolean;
}) {
  const router = useRouter();
  const usedTotal = rows.reduce(
    (sum, row) => sum.add(new ExactDecimal(row.use?.spent ?? '0')),
    new ExactDecimal('0'),
  );
  const owedTotal = rows.reduce(
    (sum, row) => sum.add(new ExactDecimal(row.balance)),
    new ExactDecimal('0'),
  );
  const [membershipId, setMembershipId] = useState('');
  const [limit, setLimit] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [stepUp, setStepUp] = useState(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);

  // One reference per attempt, so a retry after a dropped connection cannot make a second record.
  const reference = useRef<string | null>(null);

  async function save(alreadyConfirmed = false) {
    // Staff are chosen from the staff list, never typed. A staff member who is already kept as a
    // customer record (same name, marked Staff) gets the benefit account on that record; otherwise
    // the record and the benefit account are created together, so a cancelled identity check saves
    // nothing.
    const person = staff.find((option) => option.membershipId === membershipId);
    if (!person) return;
    const existing = customers.find(
      (customer) => customer.name.trim().toLowerCase() === person.name.trim().toLowerCase(),
    );
    reference.current ??= makeReference(person.name);
    const staffBenefit = { staffName: person.name, staffMembershipId: person.membershipId };
    const body = existing
      ? {
          commandType: 'CreateCustomerAccount',
          tenantId,
          customerId: existing.customerId,
          accountType: 'CREDIT',
          currency: 'USD',
          creditLimit: limit.trim(),
          staffBenefit,
        }
      : {
          commandType: 'CreateCustomerWithAccount',
          tenantId,
          accountReference: reference.current,
          displayName: person.name,
          ...(legalEntityId ? { legalEntityId } : {}),
          contactMetadata: { kind: STAFF_CUSTOMER_KIND },
          accountType: 'CREDIT',
          currency: 'USD',
          creditLimit: limit.trim(),
          staffBenefit,
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
        if (!alreadyConfirmed && /step-up/i.test(message)) {
          setStepUp(true);
          return;
        }
        throw new Error(message);
      }
      attempt.current = null;
      reference.current = null;
      setDone(`${person.name} added.`);
      setMembershipId('');
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
    if (!membershipId) return setError('Choose a staff member.');
    if (!POSITIVE_MONEY.test(limit.trim())) {
      return setError('Enter the monthly limit in US dollars, for example 60 or 60.50.');
    }
    void save();
  }

  return (
    <>
      <div className={styles.stack}>
        {rows.length > 0 ? (
          <>
            <section className={styles.summary} aria-label="Totals">
              <Card className={styles.summaryCard}>
                <p className={styles.summaryLabel}>Staff on a benefit</p>
                <p className={styles.summaryValue}>{rows.length}</p>
              </Card>
              <Card className={styles.summaryCard}>
                <p className={styles.summaryLabel}>Used this month</p>
                <p className={styles.summaryValue}>{formatTileMoney(usedTotal.toString())}</p>
              </Card>
              <Card className={styles.summaryCard}>
                <p className={styles.summaryLabel}>Owed in total</p>
                <p className={styles.summaryValue}>{formatTileMoney(owedTotal.toString())}</p>
              </Card>
            </section>
            <div className={styles.people}>
              {rows.map((row) => {
                const percent = row.use ? usedPercent(row.use.spent, row.use.limit) : 0;
                return (
                  <Card key={row.accountId} as="article" className={`panel ${styles.person}`}>
                    <div className={styles.personHead}>
                      <span className={styles.avatar} aria-hidden="true">
                        {row.staffName.trim().charAt(0).toUpperCase()}
                      </span>
                      <div className={styles.personName}>
                        <h2>{row.staffName}</h2>
                        <span>{row.accountReference}</span>
                      </div>
                    </div>
                    {row.use ? (
                      <>
                        <p className={styles.useLine}>
                          <strong>{formatTileMoney(row.use.spent)}</strong>
                          <span className="muted">of {formatTileMoney(row.use.limit)}</span>
                        </p>
                        <div
                          className={styles.bar}
                          role="progressbar"
                          aria-label={`${row.staffName} monthly use`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.min(100, Math.round(percent))}
                        >
                          <span
                            className={styles.barFill}
                            data-level={row.use.over ? 'over' : percent >= 80 ? 'high' : 'ok'}
                            style={{ width: `${Math.min(100, percent)}%` }}
                          />
                        </div>
                      </>
                    ) : (
                      <p className="muted">Use not available yet.</p>
                    )}
                    <div className={styles.personFoot}>
                      {row.use?.over ? (
                        <StatusBadge tone="critical">Over limit</StatusBadge>
                      ) : (
                        <span>
                          {row.use
                            ? `${formatTileMoney(row.use.remaining)} left`
                            : row.limit
                              ? `Limit ${formatTileMoney(row.limit)} a month`
                              : 'Limit not set'}
                        </span>
                      )}
                      <Link href={`/customers/${encodeURIComponent(row.customerId)}`}>
                        Statement
                      </Link>
                    </div>
                  </Card>
                );
              })}
            </div>
          </>
        ) : (
          <Card className={styles.empty}>
            <span className={styles.emptyIcon} aria-hidden="true">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="9" cy="8" r="3.5" />
                <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
                <path d="M18 8v6M15 11h6" />
              </svg>
            </span>
            <h2>No staff benefits yet</h2>
            <p>
              {canOpenAccount
                ? 'Add the first one below.'
                : 'Someone who manages customer accounts can add the first one.'}
            </p>
          </Card>
        )}
        {canOpenAccount ? (
          <Card className="panel">
            <div className="section-heading">
              <h2>Add a staff member</h2>
            </div>
            <form className="form-stack" onSubmit={submit} noValidate>
              <div className={styles.formGrid}>
                <Field
                  id="staff-member"
                  label="Staff member"
                  hint="Choose from your staff. New people are added in Settings > Staff."
                  required
                >
                  <StaffPicker
                    id="staff-member"
                    options={staff}
                    value={membershipId}
                    onChange={setMembershipId}
                  />
                </Field>
                <Field id="staff-limit" label="Monthly limit" required>
                  <div className={styles.money}>
                    <span aria-hidden="true">$</span>
                    <input
                      id="staff-limit"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="60.00"
                      value={limit}
                      onChange={(event) => setLimit(event.target.value)}
                    />
                  </div>
                </Field>
              </div>
              {error ? <ErrorState title="Not saved" message={error} /> : null}
              {done ? <p role="status">{done}</p> : null}
              <div className="form-actions form-actions-end">
                <Button type="submit" loading={busy}>
                  Add staff member
                </Button>
              </div>
            </form>
          </Card>
        ) : null}
      </div>
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
