'use client';

import { useRef, useState, type FormEvent } from 'react';

import { useToast } from '@/design-system/feedback-provider';
import { Select } from '@/design-system/forms';
import { Modal } from '@/design-system/modal';
import {
  AccessDeniedState,
  Button,
  ErrorState,
  Field,
  LoadingState,
  StatusBadge,
} from '@/design-system/primitives';
import { CardEmpty, CardRow, CardRows, SectionCard } from '@/design-system/section-card';

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
  const toast = useToast();
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
      toast.success(success);
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

  return { run, busy, outcome, clear: () => setOutcome(undefined) };
}

function OutcomeMessage({ outcome }: { outcome?: Outcome }) {
  if (!outcome) return null;
  return <ErrorState title="This could not be saved" message={outcome.message} />;
}

function StatusLabel({ status }: { status: 'ACTIVE' | 'INACTIVE' | string }) {
  return (
    <StatusBadge tone={status === 'ACTIVE' ? 'positive' : 'neutral'}>
      {status === 'ACTIVE' ? 'Active' : 'Inactive'}
    </StatusBadge>
  );
}

type SectionProps = {
  overview: Ready;
  reload: () => void;
  gate: Gate;
  onDenied: () => void;
  /** True while the identity check is open, so the form behind it ignores Escape. */
  checking: boolean;
};

function ProviderSection({ overview, reload, gate, onDenied, checking }: SectionProps) {
  const { run, busy, outcome, clear } = useCommand(reload, onDenied);
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<{ code?: string; name?: string; type?: string }>({});
  const station = overview.stationOptions[0];
  const canAdd = overview.canManagePayments && Boolean(station);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!station) return;
    const data = new FormData(event.currentTarget);
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
      if (saved) setOpen(false);
    });
  }

  return (
    <SectionCard
      id="payments-providers"
      title="Payment providers"
      note="The card, POS and mobile money companies your stations take payments through."
      action={
        canAdd ? (
          <Button
            aria-haspopup="dialog"
            onClick={() => {
              clear();
              setErrors({});
              setOpen(true);
            }}
          >
            Add provider
          </Button>
        ) : null
      }
    >
      {overview.providers.length === 0 ? (
        <CardEmpty>
          No payment providers yet.
          {overview.canManagePayments && !station
            ? ' Add a station before adding a payment provider.'
            : ''}
        </CardEmpty>
      ) : (
        <CardRows label="Payment providers">
          {overview.providers.map((provider) => (
            <CardRow
              key={provider.id}
              title={provider.name}
              detail={`${TYPE_LABEL.get(provider.providerType) ?? provider.providerType} · ${provider.code}`}
              aside={<StatusLabel status={provider.status} />}
            />
          ))}
        </CardRows>
      )}
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="Add a payment provider"
        presentation="side"
        size="sm"
        dismissible={!busy && !checking}
      >
        <form className="form-stack" onSubmit={submit} noValidate aria-label="Add payment provider">
          <OutcomeMessage outcome={outcome} />
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
          <div className="form-actions">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Save provider
            </Button>
          </div>
        </form>
      </Modal>
    </SectionCard>
  );
}

function AccountSection({ overview, reload, gate, onDenied, checking }: SectionProps) {
  const { run, busy, outcome, clear } = useCommand(reload, onDenied);
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const activeProviders = overview.providers.filter((provider) => provider.status === 'ACTIVE');
  const stationName = new Map(overview.stationOptions.map((s) => [s.id, `${s.name} (${s.code})`]));
  const ready = activeProviders.length > 0 && overview.stationOptions.length > 0;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const providerId = String(data.get('providerId') ?? '');
    const stationId = String(data.get('stationId') ?? '');
    const displayName = String(data.get('displayName') ?? '').trim();
    const accountReference = String(data.get('accountReference') ?? '').trim();
    const currency = String(data.get('currency') ?? '')
      .trim()
      .toUpperCase();
    const station = overview.stationOptions.find((option) => option.id === stationId);
    const feePercent = String(data.get('feePercent') ?? '').trim();
    const feeFixed = String(data.get('feeFixed') ?? '').trim();
    const next = {
      feePercent:
        feePercent === '' || (/^\d+(?:\.\d{1,4})?$/.test(feePercent) && Number(feePercent) <= 100)
          ? undefined
          : 'Enter a percentage from 0 to 100, for example 1.5, or leave it empty.',
      feeFixed:
        feeFixed === '' || /^\d+(?:\.\d{1,4})?$/.test(feeFixed)
          ? undefined
          : 'Enter an amount, for example 0.10, or leave it empty.',
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
          feePercent: feePercent || null,
          feeFixed: feeFixed || null,
          metadata: {},
        },
        `${displayName} was added for ${station.name}.`,
      );
      if (saved) setOpen(false);
    });
  }

  return (
    <SectionCard
      id="payments-accounts"
      title="Provider accounts by station"
      note="Electronic payments can only be settled at a station that has a provider account."
      action={
        overview.canManagePayments ? (
          <Button
            aria-haspopup="dialog"
            disabled={!ready}
            onClick={() => {
              clear();
              setErrors({});
              setOpen(true);
            }}
          >
            Add provider account
          </Button>
        ) : null
      }
    >
      {overview.providerAccounts.length === 0 ? (
        <CardEmpty>
          No provider accounts yet.
          {overview.canManagePayments && !ready
            ? activeProviders.length === 0
              ? ' Add a payment provider first, then add its account for a station.'
              : ' Add a station before adding a provider account.'
            : ''}
        </CardEmpty>
      ) : (
        <CardRows label="Provider accounts">
          {overview.providerAccounts.map((account) => (
            <CardRow
              key={account.id}
              title={account.displayName}
              detail={
                <>
                  {account.providerName} · {account.accountReference} · {account.currency} ·{' '}
                  {account.stationId
                    ? (stationName.get(account.stationId) ?? 'Another station')
                    : 'All stations'}
                  {account.feePercent || account.feeFixed
                    ? ` · Charges ${[account.feePercent ? `${Number(account.feePercent)}%` : '', account.feeFixed ? `${Number(account.feeFixed)} each time` : ''].filter(Boolean).join(' + ')}`
                    : ''}
                </>
              }
              aside={<StatusLabel status={account.status} />}
            />
          ))}
        </CardRows>
      )}
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="Add a provider account"
        presentation="side"
        size="sm"
        dismissible={!busy && !checking}
      >
        <form className="form-stack" onSubmit={submit} noValidate aria-label="Add provider account">
          <OutcomeMessage outcome={outcome} />
          <Field id="account-station" label="Station" error={errors.stationId} required>
            <Select
              id="account-station"
              name="stationId"
              defaultValue={
                overview.stationOptions.length === 1 ? overview.stationOptions[0]!.id : ''
              }
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
              defaultValue={activeProviders.length === 1 ? activeProviders[0]!.id : ''}
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
            <input
              id="account-currency"
              name="currency"
              autoComplete="off"
              maxLength={3}
              defaultValue="USD"
            />
          </Field>
          <details className={styles.more}>
            <summary>Charges the provider keeps (optional)</summary>
            <Field
              id="account-fee-percent"
              label="Charge as a percentage (%)"
              hint="What the provider keeps from each settlement, for example 1 for EcoCash at 1%. Leave empty if there is none."
              error={errors.feePercent}
              optional
            >
              <input
                id="account-fee-percent"
                name="feePercent"
                inputMode="decimal"
                autoComplete="off"
              />
            </Field>
            <Field
              id="account-fee-fixed"
              label="Fixed charge each time"
              hint="A flat amount the provider keeps on top, if any."
              error={errors.feeFixed}
              optional
            >
              <input
                id="account-fee-fixed"
                name="feeFixed"
                inputMode="decimal"
                autoComplete="off"
              />
            </Field>
          </details>
          <div className="form-actions">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Save account
            </Button>
          </div>
        </form>
      </Modal>
    </SectionCard>
  );
}

function BankSection({ overview, reload, gate, onDenied, checking }: SectionProps) {
  const { run, busy, outcome, clear } = useCommand(reload, onDenied);
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  // A bank account belongs to the company, not to a station: every station of the company uses it.
  // Any one of the company's stations is only needed to prove the person may act for it.
  const companies = [
    ...new Map(
      overview.stationOptions.map((option) => [
        option.legalEntityId,
        {
          id: option.legalEntityId,
          name: option.legalEntityName ?? 'Company',
          stationId: option.id,
        },
      ]),
    ).values(),
  ];
  const companyName = new Map(companies.map((company) => [company.id, company.name]));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const companyId = String(data.get('companyId') ?? '');
    const company = companies.find((option) => option.id === companyId);
    const station = overview.stationOptions.find((option) => option.id === company?.stationId);
    const name = String(data.get('name') ?? '').trim();
    const bankName = String(data.get('bankName') ?? '').trim();
    const accountReferenceMasked = String(data.get('accountReferenceMasked') ?? '').trim();
    const next = {
      companyId: company ? undefined : 'Choose the company this account belongs to.',
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
        `${name} was added to ${company?.name ?? 'the company'}. All its stations can use it.`,
      );
      if (saved) setOpen(false);
    });
  }

  return (
    <SectionCard
      id="payments-banks"
      title="Bank accounts"
      note="Bank deposits cannot be recorded until a bank account is entered."
      action={
        overview.canManagePayments ? (
          <Button
            aria-haspopup="dialog"
            disabled={overview.stationOptions.length === 0}
            onClick={() => {
              clear();
              setErrors({});
              setOpen(true);
            }}
          >
            Add bank account
          </Button>
        ) : null
      }
    >
      {overview.bankAccounts.length === 0 ? (
        <CardEmpty>No bank accounts yet.</CardEmpty>
      ) : (
        <CardRows label="Bank accounts">
          {overview.bankAccounts.map((bank) => (
            <CardRow
              key={bank.id}
              title={bank.name}
              detail={`${bank.bankName} · ${bank.accountReferenceMasked} · ${bank.currency} · ${companyName.get(bank.legalEntityId) ?? 'Company'}`}
              aside={<StatusLabel status={bank.status} />}
            />
          ))}
        </CardRows>
      )}
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="Add a bank account"
        presentation="side"
        size="sm"
        dismissible={!busy && !checking}
      >
        <form className="form-stack" onSubmit={submit} noValidate aria-label="Add bank account">
          <OutcomeMessage outcome={outcome} />
          <Field
            id="bank-company"
            label="Company"
            hint="The account belongs to the company. All its stations use it."
            error={errors.companyId}
            required
          >
            <Select
              id="bank-company"
              name="companyId"
              defaultValue={companies.length === 1 ? (companies[0]?.id ?? '') : ''}
              placeholder="Choose a company"
              options={companies.map((company) => ({ value: company.id, label: company.name }))}
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
          <div className="form-actions">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Save bank account
            </Button>
          </div>
        </form>
      </Modal>
    </SectionCard>
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
  const section: SectionProps = { overview, reload, gate, onDenied, checking: pending !== null };

  return (
    <div className={styles.stack}>
      <ProviderSection {...section} />
      <AccountSection {...section} />
      <BankSection {...section} />
      <BankBalancePanel
        tenantId={overview.tenantId}
        stations={overview.stationOptions}
        refreshKey={overview.bankAccounts.map((bank) => `${bank.id}:${bank.status}`).join(',')}
      />
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
