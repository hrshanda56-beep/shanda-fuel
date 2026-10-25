'use client';

import { useRef, useState, type FormEvent } from 'react';

import { Select } from '@/design-system/forms';
import {
  AccessDeniedState,
  Button,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  StatusBadge,
} from '@/design-system/primitives';

import type { PaymentProviderRow, SetupOverview } from '../contracts';
import { BankBalancePanel } from './bank-balance-panel';
import styles from './setup.module.css';
import { StepUpDialog } from './step-up-dialog';
import { useSetupOverview } from './use-setup-overview';

type Ready = Extract<SetupOverview, { status: 'ready' }>;

const PROVIDER_TYPES: ReadonlyArray<{ value: PaymentProviderRow['providerType']; label: string }> =
  [
    { value: 'CARD_ACQUIRER', label: 'Card acquirer' },
    { value: 'POS', label: 'POS terminal provider' },
    { value: 'MOBILE_MONEY', label: 'Mobile money' },
    { value: 'OTHER_ELECTRONIC', label: 'Other electronic payment' },
  ];

const TYPE_LABEL = new Map<string, string>(PROVIDER_TYPES.map((t) => [t.value, t.label]));

type Outcome = { kind: 'success' | 'error'; message: string };
type Gate = (save: () => Promise<void>) => void;

// The server's step-up lasts longer; this is only when the screen asks again.
const STEP_UP_REUSE_MS = 5 * 60_000;

/**
 * Post an existing settlement command. The idempotency key is stable per
 * logical payload, so a retry after a network failure cannot create a
 * duplicate; it is released only after the command succeeds.
 */
function useCommand(onDone: () => void, onDenied: () => void) {
  const keys = useRef(new Map<string, string>());
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();

  async function run(body: Record<string, unknown>, success: string): Promise<boolean> {
    const logical = JSON.stringify(body);
    const key = keys.current.get(logical) ?? `setup-ui-${crypto.randomUUID()}`;
    keys.current.set(logical, key);
    setBusy(true);
    setOutcome(undefined);
    try {
      const response = await fetch('/api/settlements/commands', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as { message?: string } | null;
        if (response.status === 403) onDenied();
        const fallback =
          response.status === 403
            ? 'This was not saved. Your confirmation may have expired or you may not have access. Confirm again and retry.'
            : 'That could not be saved. Check the details and try again.';
        setOutcome({ kind: 'error', message: failure?.message || fallback });
        return false;
      }
      keys.current.delete(logical);
      setOutcome({ kind: 'success', message: success });
      onDone();
      return true;
    } catch {
      setOutcome({
        kind: 'error',
        message: 'That could not be saved. Check your connection and try again.',
      });
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { run, busy, outcome };
}

function OutcomeMessage({ outcome }: { outcome?: Outcome }) {
  if (!outcome) return null;
  return (
    <p className={styles.message} role={outcome.kind === 'error' ? 'alert' : 'status'}>
      {outcome.message}
    </p>
  );
}

function ProviderSection({
  overview,
  reload,
  gate,
  onDenied,
}: {
  overview: Ready;
  reload: () => void;
  gate: Gate;
  onDenied: () => void;
}) {
  const { run, busy, outcome } = useCommand(reload, onDenied);
  const [errors, setErrors] = useState<{ code?: string; name?: string; type?: string }>({});
  const station = overview.stationOptions[0];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!station) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const code = String(data.get('code') ?? '').trim();
    const name = String(data.get('name') ?? '').trim();
    const providerType = String(data.get('providerType') ?? '');
    const next = {
      code: code ? undefined : 'Enter a short code, for example ECOCASH.',
      name: name ? undefined : 'Enter the provider name.',
      type: TYPE_LABEL.has(providerType) ? undefined : 'Choose the provider type.',
    };
    setErrors(next);
    if (next.code || next.name || next.type) return;
    gate(async () => {
      const saved = await run(
        {
          commandType: 'CreatePaymentProvider',
          tenantId: overview.tenantId,
          stationId: station.id,
          code,
          name,
          providerType,
          metadata: {},
        },
        `${name} was added.`,
      );
      if (saved) form.reset();
    });
  }

  return (
    <section className={styles.card} aria-labelledby="payments-providers">
      <h3 id="payments-providers" className={styles.cardTitle}>
        Payment providers
      </h3>
      {overview.providers.length === 0 ? (
        <EmptyState
          title="No payment providers entered"
          message="Add the card, POS, or mobile money providers your stations use."
        />
      ) : (
        <ul className={styles.list}>
          {overview.providers.map((provider) => (
            <li key={provider.id} className={styles.row}>
              <div className={styles.rowMain}>
                <span className={styles.rowTitle}>{provider.name}</span>
                <span className={styles.rowDetail}>
                  {TYPE_LABEL.get(provider.providerType) ?? provider.providerType} · {provider.code}
                </span>
              </div>
              <StatusBadge tone={provider.status === 'ACTIVE' ? 'positive' : 'neutral'}>
                {provider.status === 'ACTIVE' ? 'Active' : 'Inactive'}
              </StatusBadge>
            </li>
          ))}
        </ul>
      )}
      {overview.canManagePayments ? (
        station ? (
          <form
            className={styles.form}
            onSubmit={submit}
            noValidate
            aria-label="Add payment provider"
          >
            <Field id="provider-name" label="Provider name" error={errors.name} required>
              <input id="provider-name" name="name" autoComplete="off" maxLength={160} />
            </Field>
            <Field
              id="provider-code"
              label="Provider code"
              hint="A short unique code used in records."
              error={errors.code}
              required
            >
              <input id="provider-code" name="code" autoComplete="off" maxLength={80} />
            </Field>
            <Field id="provider-type" label="Provider type" error={errors.type} required>
              <Select
                id="provider-type"
                name="providerType"
                defaultValue=""
                placeholder="Choose a type"
                options={PROVIDER_TYPES}
              />
            </Field>
            <div className={styles.formActions}>
              <Button type="submit" loading={busy}>
                Add provider
              </Button>
              <OutcomeMessage outcome={outcome} />
            </div>
          </form>
        ) : (
          <p className={styles.note}>Add a station before adding a payment provider.</p>
        )
      ) : null}
    </section>
  );
}

function AccountSection({
  overview,
  reload,
  gate,
  onDenied,
}: {
  overview: Ready;
  reload: () => void;
  gate: Gate;
  onDenied: () => void;
}) {
  const { run, busy, outcome } = useCommand(reload, onDenied);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const activeProviders = overview.providers.filter((provider) => provider.status === 'ACTIVE');
  const stationName = new Map(overview.stationOptions.map((s) => [s.id, `${s.name} (${s.code})`]));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const providerId = String(data.get('providerId') ?? '');
    const stationId = String(data.get('stationId') ?? '');
    const displayName = String(data.get('displayName') ?? '').trim();
    const accountReference = String(data.get('accountReference') ?? '').trim();
    const currency = String(data.get('currency') ?? '')
      .trim()
      .toUpperCase();
    const station = overview.stationOptions.find((option) => option.id === stationId);
    const next = {
      providerId: providerId ? undefined : 'Choose a provider.',
      stationId: station ? undefined : 'Choose a station.',
      displayName: displayName ? undefined : 'Enter a name for this account.',
      accountReference: accountReference ? undefined : 'Enter the merchant or terminal reference.',
      currency: /^[A-Z]{3}$/.test(currency) ? undefined : 'Enter a three-letter currency code.',
    };
    setErrors(next);
    if (Object.values(next).some(Boolean) || !station) return;
    gate(async () => {
      const saved = await run(
        {
          commandType: 'ConfigureProviderAccount',
          tenantId: overview.tenantId,
          stationId: station.id,
          providerId,
          accountReference,
          displayName,
          currency,
          accountStationId: station.id,
          legalEntityId: station.legalEntityId,
          metadata: {},
        },
        `${displayName} was added for ${station.name}.`,
      );
      if (saved) form.reset();
    });
  }

  return (
    <section className={styles.card} aria-labelledby="payments-accounts">
      <h3 id="payments-accounts" className={styles.cardTitle}>
        Provider accounts by station
      </h3>
      {overview.providerAccounts.length === 0 ? (
        <EmptyState
          title="No provider accounts entered"
          message="Electronic payments cannot be settled at a station until it has a provider account."
        />
      ) : (
        <ul className={styles.list}>
          {overview.providerAccounts.map((account) => (
            <li key={account.id} className={styles.row}>
              <div className={styles.rowMain}>
                <span className={styles.rowTitle}>{account.displayName}</span>
                <span className={styles.rowDetail}>
                  {account.providerName} · {account.accountReference} · {account.currency} ·{' '}
                  {account.stationId
                    ? (stationName.get(account.stationId) ?? 'Another station')
                    : 'All stations'}
                </span>
              </div>
              <StatusBadge tone={account.status === 'ACTIVE' ? 'positive' : 'neutral'}>
                {account.status === 'ACTIVE' ? 'Active' : 'Inactive'}
              </StatusBadge>
            </li>
          ))}
        </ul>
      )}
      {overview.canManagePayments ? (
        activeProviders.length === 0 || overview.stationOptions.length === 0 ? (
          <p className={styles.note}>
            {activeProviders.length === 0
              ? 'Add a payment provider first, then add its account for a station.'
              : 'Add a station before adding a provider account.'}
          </p>
        ) : (
          <form
            className={styles.form}
            onSubmit={submit}
            noValidate
            aria-label="Add provider account"
          >
            <Field id="account-station" label="Station" error={errors.stationId} required>
              <Select
                id="account-station"
                name="stationId"
                defaultValue=""
                placeholder="Choose a station"
                options={overview.stationOptions.map((s) => ({
                  value: s.id,
                  label: `${s.name} (${s.code})`,
                }))}
              />
            </Field>
            <Field id="account-provider" label="Provider" error={errors.providerId} required>
              <Select
                id="account-provider"
                name="providerId"
                defaultValue=""
                placeholder="Choose a provider"
                options={activeProviders.map((p) => ({ value: p.id, label: p.name }))}
              />
            </Field>
            <Field id="account-name" label="Account name" error={errors.displayName} required>
              <input id="account-name" name="displayName" autoComplete="off" maxLength={160} />
            </Field>
            <Field
              id="account-reference"
              label="Merchant or terminal reference"
              error={errors.accountReference}
              required
            >
              <input
                id="account-reference"
                name="accountReference"
                autoComplete="off"
                maxLength={160}
              />
            </Field>
            <Field
              id="account-currency"
              label="Currency"
              hint="Three-letter code, for example USD."
              error={errors.currency}
              required
            >
              <input id="account-currency" name="currency" autoComplete="off" maxLength={3} />
            </Field>
            <div className={styles.formActions}>
              <Button type="submit" loading={busy}>
                Add provider account
              </Button>
              <OutcomeMessage outcome={outcome} />
            </div>
          </form>
        )
      ) : null}
    </section>
  );
}

function BankSection({
  overview,
  reload,
  gate,
  onDenied,
}: {
  overview: Ready;
  reload: () => void;
  gate: Gate;
  onDenied: () => void;
}) {
  const { run, busy, outcome } = useCommand(reload, onDenied);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const stationId = String(data.get('stationId') ?? '');
    const station = overview.stationOptions.find((option) => option.id === stationId);
    const name = String(data.get('name') ?? '').trim();
    const bankName = String(data.get('bankName') ?? '').trim();
    const accountReferenceMasked = String(data.get('accountReferenceMasked') ?? '').trim();
    const next = {
      stationId: station ? undefined : 'Choose a station.',
      name: name ? undefined : 'Enter an account name.',
      bankName: bankName ? undefined : 'Enter the bank name.',
      accountReferenceMasked: accountReferenceMasked
        ? undefined
        : 'Enter the masked account reference only.',
    };
    setErrors(next);
    if (Object.values(next).some(Boolean) || !station) return;
    gate(async () => {
      const saved = await run(
        {
          commandType: 'CreateBankAccount',
          tenantId: overview.tenantId,
          stationId: station.id,
          legalEntityId: station.legalEntityId,
          name,
          bankName,
          accountReferenceMasked,
          currency: 'USD',
        },
        `${name} was added for ${station.name}'s legal entity.`,
      );
      if (saved) form.reset();
    });
  }

  return (
    <section className={styles.card} aria-labelledby="payments-banks">
      <h3 id="payments-banks" className={styles.cardTitle}>
        Bank accounts
      </h3>
      {overview.bankAccounts.length === 0 ? (
        <EmptyState
          title="No bank accounts entered"
          message="Bank deposits cannot be recorded until a bank account is entered."
        />
      ) : (
        <ul className={styles.list}>
          {overview.bankAccounts.map((bank) => (
            <li key={bank.id} className={styles.row}>
              <div className={styles.rowMain}>
                <span className={styles.rowTitle}>{bank.name}</span>
                <span className={styles.rowDetail}>
                  {bank.bankName} · {bank.accountReferenceMasked} · {bank.currency}
                </span>
              </div>
              <StatusBadge tone={bank.status === 'ACTIVE' ? 'positive' : 'neutral'}>
                {bank.status === 'ACTIVE' ? 'Active' : 'Inactive'}
              </StatusBadge>
            </li>
          ))}
        </ul>
      )}
      {overview.canManagePayments ? (
        <form className={styles.form} onSubmit={submit} noValidate aria-label="Add bank account">
          <Field id="bank-station" label="Station" error={errors.stationId} required>
            <Select
              id="bank-station"
              name="stationId"
              defaultValue=""
              placeholder="Choose a station"
              options={overview.stationOptions.map((station) => ({
                value: station.id,
                label: `${station.name} (${station.code})`,
              }))}
            />
          </Field>
          <Field id="bank-account-name" label="Account name" error={errors.name} required>
            <input id="bank-account-name" name="name" autoComplete="off" maxLength={160} />
          </Field>
          <Field id="bank-name" label="Bank name" error={errors.bankName} required>
            <input id="bank-name" name="bankName" autoComplete="off" maxLength={160} />
          </Field>
          <Field
            id="bank-reference-masked"
            label="Masked account reference"
            hint="Do not enter the full bank account number."
            error={errors.accountReferenceMasked}
            required
          >
            <input
              id="bank-reference-masked"
              name="accountReferenceMasked"
              autoComplete="off"
              maxLength={160}
            />
          </Field>
          <Field id="bank-currency" label="Currency">
            <input id="bank-currency" value="USD" readOnly aria-readonly="true" />
          </Field>
          <div className={styles.formActions}>
            <Button type="submit" loading={busy} disabled={overview.stationOptions.length === 0}>
              Add bank account
            </Button>
            <OutcomeMessage outcome={outcome} />
          </div>
        </form>
      ) : null}
    </section>
  );
}

export function PaymentsView({ overview, reload }: { overview: Ready; reload: () => void }) {
  const [pending, setPending] = useState<(() => Promise<void>) | null>(null);
  const confirmedUntil = useRef(0);
  if (!overview.canViewPayments) {
    return <AccessDeniedState message="You do not have access to payment setup." />;
  }

  const gate: Gate = (save) => {
    if (Date.now() < confirmedUntil.current) void save();
    else setPending(() => save);
  };
  const onDenied = () => {
    confirmedUntil.current = 0;
  };

  return (
    <div className={styles.stack}>
      <ProviderSection overview={overview} reload={reload} gate={gate} onDenied={onDenied} />
      <AccountSection overview={overview} reload={reload} gate={gate} onDenied={onDenied} />
      <BankSection overview={overview} reload={reload} gate={gate} onDenied={onDenied} />
      <BankBalancePanel tenantId={overview.tenantId} stationId={overview.stationOptions[0]?.id} />
      <StepUpDialog
        open={pending !== null}
        tenantId={overview.tenantId}

        onCancel={() => setPending(null)}
        onVerified={() => {
          confirmedUntil.current = Date.now() + STEP_UP_REUSE_MS;
          const save = pending;
          setPending(null);
          if (save) void save();
        }}
      />
    </div>
  );
}

export function PaymentsPanel() {
  const { state, reload, refresh } = useSetupOverview();
  if (state.kind === 'loading') return <LoadingState label="Loading payment setup" />;
  if (state.kind === 'unavailable') {
    return <AccessDeniedState message="You do not have access to payment setup." />;
  }
  if (state.kind === 'error') {
    return (
      <ErrorState
        title="Payment setup could not be loaded"
        message="Payment setup could not be read just now. Nothing has been changed."
        action={<Button onClick={reload}>Try again</Button>}
      />
    );
  }
  return <PaymentsView overview={state.overview} reload={refresh} />;
}
