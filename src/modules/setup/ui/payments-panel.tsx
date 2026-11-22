'use client';

import { useRef, useState } from 'react';

import { useToast } from '@/design-system/feedback-provider';
import { Modal } from '@/design-system/modal';
import {
  AccessDeniedState,
  Button,
  ErrorState,
  LoadingState,
  StatusBadge,
} from '@/design-system/primitives';
import { CardEmpty, CardRow, CardRows, SectionCard } from '@/design-system/section-card';

import type { PaymentProviderRow, SetupOverview } from '../contracts';
import { BankBalancePanel } from './bank-balance-panel';
import {
  AccountWizard,
  BankWizard,
  ProviderWizard,
  type AccountValue,
  type BankValue,
  type ProviderValue,
} from './payment-wizards';
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
  const station = overview.stationOptions[0];
  const canAdd = overview.canManagePayments && Boolean(station);

  function submit(value: ProviderValue) {
    if (!station) return;
    gate(async () => {
      const saved = await run(
        {
          commandType: 'CreatePaymentProvider',
          tenantId: overview.tenantId,
          stationId: station.id,
          code: value.code,
          name: value.name,
          providerType: value.type,
          metadata: {},
        },
        `${value.name} was added.`,
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
        presentation="page"
        backLabel="Payments"
        size="sm"
        dismissible={!busy && !checking}
      >
        {open ? (
          <ProviderWizard
            types={PROVIDER_TYPES}
            busy={busy}
            error={outcome?.message ?? null}
            onCancel={() => setOpen(false)}
            onSubmit={submit}
          />
        ) : null}
      </Modal>
    </SectionCard>
  );
}

function AccountSection({ overview, reload, gate, onDenied, checking }: SectionProps) {
  const { run, busy, outcome, clear } = useCommand(reload, onDenied);
  const [open, setOpen] = useState(false);
  const activeProviders = overview.providers.filter((provider) => provider.status === 'ACTIVE');
  const stationName = new Map(overview.stationOptions.map((s) => [s.id, `${s.name} (${s.code})`]));
  const ready = activeProviders.length > 0 && overview.stationOptions.length > 0;

  function submit(value: AccountValue) {
    const station = overview.stationOptions.find((option) => option.id === value.stationId);
    if (!station) return;
    gate(async () => {
      const saved = await run(
        {
          commandType: 'ConfigureProviderAccount',
          tenantId: overview.tenantId,
          stationId: station.id,
          providerId: value.providerId,
          accountReference: value.reference,
          displayName: value.name,
          currency: value.currency,
          accountStationId: station.id,
          legalEntityId: station.legalEntityId,
          feePercent: value.feePercent || null,
          feeFixed: value.feeFixed || null,
          metadata: {},
        },
        `${value.name} was added for ${station.name}.`,
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
        presentation="page"
        backLabel="Payments"
        size="sm"
        dismissible={!busy && !checking}
      >
        {open ? (
          <AccountWizard
            stations={overview.stationOptions.map((s) => ({
              value: s.id,
              label: `${s.name} (${s.code})`,
            }))}
            providers={activeProviders.map((p) => ({ value: p.id, label: p.name }))}
            busy={busy}
            error={outcome?.message ?? null}
            onCancel={() => setOpen(false)}
            onSubmit={submit}
          />
        ) : null}
      </Modal>
    </SectionCard>
  );
}

function BankSection({ overview, reload, gate, onDenied, checking }: SectionProps) {
  const { run, busy, outcome, clear } = useCommand(reload, onDenied);
  const [open, setOpen] = useState(false);
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

  function submit(value: BankValue) {
    const company = companies.find((option) => option.id === value.companyId);
    const station = overview.stationOptions.find((option) => option.id === company?.stationId);
    if (!station) return;
    gate(async () => {
      const saved = await run(
        {
          commandType: 'CreateBankAccount',
          tenantId: overview.tenantId,
          stationId: station.id,
          legalEntityId: station.legalEntityId,
          name: value.name,
          bankName: value.bankName,
          accountReferenceMasked: value.masked,
          currency: 'USD',
        },
        `${value.name} was added to ${company?.name ?? 'the company'}. All its stations can use it.`,
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
        presentation="page"
        backLabel="Payments"
        size="sm"
        dismissible={!busy && !checking}
      >
        {open ? (
          <BankWizard
            companies={companies.map((company) => ({ value: company.id, label: company.name }))}
            busy={busy}
            error={outcome?.message ?? null}
            onCancel={() => setOpen(false)}
            onSubmit={submit}
          />
        ) : null}
      </Modal>
    </SectionCard>
  );
}

/** Asks for the identity check before a save, and remembers it for a few minutes. */
function useStepUpGate(tenantId: string) {
  const [pending, setPending] = useState<(() => Promise<void>) | null>(null);
  const confirmedUntil = useRef(0);
  const gate: Gate = (save) => {
    if (Date.now() < confirmedUntil.current) void save();
    else setPending(() => save);
  };
  const onDenied = () => {
    confirmedUntil.current = 0;
  };
  const dialog = (
    <StepUpDialog
      open={pending !== null}
      tenantId={tenantId}
      onCancel={() => setPending(null)}
      onVerified={() => {
        confirmedUntil.current = Date.now() + STEP_UP_REUSE_MS;
        const save = pending;
        setPending(null);
        if (save) void save();
      }}
    />
  );
  return { gate, onDenied, checking: pending !== null, dialog };
}

/**
 * One payment job inside the complete-this-station loop (#251): the payment provider and its
 * account for the station, or the company's bank account. The same wizards, commands and identity
 * check as the Payments page; `onClose` is called when the job is saved or left.
 */
export function PaymentJob({
  overview,
  stationId,
  job,
  reload,
  onClose,
}: {
  overview: Ready;
  stationId: string;
  job: 'provider' | 'bank';
  /** Re-reads the setup after something was saved. */
  reload: () => void;
  onClose: () => void;
}) {
  const { gate, onDenied, checking, dialog } = useStepUpGate(overview.tenantId);
  const station = overview.stationOptions.find((option) => option.id === stationId);
  const activeProviders = overview.providers.filter((provider) => provider.status === 'ACTIVE');
  // No provider yet: it is added first, then its account for this station.
  const [needsProvider] = useState(activeProviders.length === 0);
  const [addedProvider, setAddedProvider] = useState(false);
  const shared: SectionProps = { overview, reload, gate, onDenied, checking };
  const { run, busy, outcome } = useCommand(reload, onDenied);

  if (!station) return null;
  const page = (title: string, body: React.ReactNode) => (
    <>
      <Modal
        open
        onClose={() => !busy && !checking && onClose()}
        title={title}
        presentation="page"
        size="sm"
        dismissible={!busy && !checking}
      >
        {body}
      </Modal>
      {dialog}
    </>
  );

  if (job === 'bank') {
    return page(
      'Add a bank account',
      <BankWizard
        companies={[{ value: station.legalEntityId, label: station.legalEntityName ?? 'Company' }]}
        busy={busy}
        error={outcome?.message ?? null}
        onCancel={onClose}
        onSubmit={(value) =>
          gate(async () => {
            const saved = await run(
              {
                commandType: 'CreateBankAccount',
                tenantId: overview.tenantId,
                stationId: station.id,
                legalEntityId: station.legalEntityId,
                name: value.name,
                bankName: value.bankName,
                accountReferenceMasked: value.masked,
                currency: 'USD',
              },
              `${value.name} was added. All the company's stations can use it.`,
            );
            if (saved) onClose();
          })
        }
      />,
    );
  }

  if (needsProvider && !addedProvider) {
    return page(
      'Add a payment provider',
      <ProviderWizard
        types={PROVIDER_TYPES}
        busy={busy}
        error={outcome?.message ?? null}
        onCancel={onClose}
        onSubmit={(value) =>
          gate(async () => {
            const saved = await run(
              {
                commandType: 'CreatePaymentProvider',
                tenantId: overview.tenantId,
                stationId: station.id,
                code: value.code,
                name: value.name,
                providerType: value.type,
                metadata: {},
              },
              `${value.name} was added.`,
            );
            if (saved) setAddedProvider(true);
          })
        }
      />,
    );
  }

  // The provider just added appears once the setup is re-read.
  if (activeProviders.length === 0) {
    return page('Add a payment account', <LoadingState label="Loading the new provider" />);
  }
  return page(
    'Add a payment account',
    <AccountWizard
      stations={[{ value: station.id, label: `${station.name} (${station.code})` }]}
      providers={activeProviders.map((provider) => ({ value: provider.id, label: provider.name }))}
      busy={busy}
      error={outcome?.message ?? null}
      onCancel={onClose}
      onSubmit={(value) =>
        gate(async () => {
          const saved = await run(
            {
              commandType: 'ConfigureProviderAccount',
              tenantId: overview.tenantId,
              stationId: station.id,
              providerId: value.providerId,
              accountReference: value.reference,
              displayName: value.name,
              currency: value.currency,
              accountStationId: station.id,
              legalEntityId: station.legalEntityId,
              feePercent: value.feePercent || null,
              feeFixed: value.feeFixed || null,
              metadata: {},
            },
            `${value.name} was added for ${station.name}.`,
          );
          if (saved) onClose();
        })
      }
    />,
  );
}

export function PaymentsView({ overview, reload }: { overview: Ready; reload: () => void }) {
  const { gate, onDenied, checking, dialog } = useStepUpGate(overview.tenantId);
  if (!overview.canViewPayments) {
    return <AccessDeniedState message="You do not have access to payment setup." />;
  }
  const section: SectionProps = { overview, reload, gate, onDenied, checking };

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
      {dialog}
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
