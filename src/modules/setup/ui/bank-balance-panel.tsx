'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { useToast } from '@/design-system/feedback-provider';
import { Modal } from '@/design-system/modal';
import { Button, ErrorState, Field, LoadingState } from '@/design-system/primitives';
import { Select } from '@/design-system/forms';
import { formatUsd } from '@/design-system/formatters';
import { CardEmpty, CardRow, CardRows, SectionCard } from '@/design-system/section-card';

import { friendlySetupError } from '../guided-setup';

type Account = {
  id: string;
  name: string;
  bankName: string;
  accountReference: string;
  balance: string | null;
  asOfDate: string | null;
};
type Loaded = { accounts: Account[]; canRecord: boolean };

/**
 * The balance the bank statement shows, typed in per account. It sits beside the deposits the app
 * records and never changes them. A newer balance replaces the older one on the financial position;
 * the older lines stay on record.
 */
export function BankBalancePanel({
  tenantId,
  stations,
  refreshKey = '',
}: Readonly<{
  tenantId: string;
  stations: ReadonlyArray<{ id: string; name: string; code: string }>;
  /** Changes whenever the bank accounts change, so the list below is read again. */
  refreshKey?: string;
}>) {
  const toast = useToast();
  const [stationId, setStationId] = useState<string | undefined>(
    // With several stations the person chooses; none is picked for them.
    stations.length === 1 ? stations[0]?.id : undefined,
  );
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/setup/bank-balances?tenantId=${tenantId}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const result = (await response.json()) as Loaded & { message?: string };
      if (!response.ok) throw new Error(result.message ?? 'Bank balances could not be loaded.');
      setLoaded(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Bank balances could not be loaded.');
    }
  }, [tenantId]);

  // Read again whenever a bank account is added or changed elsewhere on the page.
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load, refreshKey]);

  async function save(event: FormEvent<HTMLFormElement>, account: Account) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const balance = String(data.get('balance') ?? '')
      .trim()
      .replace(/,/g, '');
    const asOfDate = String(data.get('asOfDate') ?? '');
    if (!/^-?\d+(?:\.\d{1,4})?$/.test(balance))
      return setFormError('Enter the balance as a number, such as 1250.50.');
    if (!asOfDate) return setFormError('Choose the date on the bank statement.');
    if (!stationId) return setFormError('Choose a station first.');
    setBusy(true);
    setFormError(null);
    try {
      const response = await fetch('/api/setup/commands', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          commandType: 'RecordBankBalance',
          tenantId,
          stationId,
          bankAccountId: account.id,
          balance,
          asOfDate,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) return setFormError(friendlySetupError(response.status, result.message));
      setEditing(null);
      toast.success(`${account.name}: balance saved.`);
      await load();
    } catch {
      setFormError('We could not reach the server. Nothing was saved.');
    } finally {
      setBusy(false);
    }
  }

  if (!loaded && !error) return <LoadingState label="Loading bank balances" />;
  if (!loaded) {
    return (
      <ErrorState
        message={error!}
        action={<Button onClick={() => void load()}>Try again</Button>}
      />
    );
  }

  return (
    <SectionCard
      id="payments-bank-balances"
      title="Bank balances"
      note="Type in the balance from the bank statement. The financial position uses it for the money in the bank once every account has one; until then it uses the deposits recorded in the app."
    >
      {loaded.canRecord && stations.length > 1 ? (
        <Field id="balance-station" label="Entering as station" required>
          <Select
            id="balance-station"
            value={stationId ?? ''}
            onChange={(event) => setStationId(event.target.value)}
            placeholder="Choose a station"
            options={stations.map((station) => ({
              value: station.id,
              label: `${station.name} (${station.code})`,
            }))}
          />
        </Field>
      ) : null}
      {loaded.accounts.length === 0 ? (
        <CardEmpty>
          No bank accounts yet. Enter a bank account above, then type in its balance here.
        </CardEmpty>
      ) : (
        <CardRows label="Bank balances">
          {loaded.accounts.map((account) => (
            <CardRow
              key={account.id}
              title={account.name}
              detail={
                <>
                  {account.bankName} · {account.accountReference}
                  <br />
                  {account.balance !== null && account.asOfDate
                    ? `${formatUsd(account.balance)} as at ${account.asOfDate}`
                    : 'No balance typed in yet'}
                </>
              }
              aside={
                loaded.canRecord ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-haspopup="dialog"
                    aria-label={`${account.balance !== null ? 'Update balance' : 'Add balance'} for ${account.name}`}
                    onClick={() => {
                      setFormError(null);
                      setEditing(account);
                    }}
                  >
                    {account.balance !== null ? 'Update balance' : 'Add balance'}
                  </Button>
                ) : null
              }
            />
          ))}
        </CardRows>
      )}
      {!loaded.canRecord ? (
        <p className="sc-message">Only finance, an administrator or the owner can type these in.</p>
      ) : null}
      <Modal
        open={editing !== null}
        onClose={() => !busy && setEditing(null)}
        title={editing ? `Balance for ${editing.name}` : 'Bank balance'}
        presentation="side"
        size="sm"
        dismissible={!busy}
      >
        {editing ? (
          <form
            className="form-stack"
            onSubmit={(event) => void save(event, editing)}
            noValidate
            aria-label={`Type in the balance for ${editing.name}`}
          >
            {formError ? <ErrorState title="This could not be saved" message={formError} /> : null}
            {stations.length > 1 ? (
              <Field id="balance-station" label="Entering as station">
                <Select
                  id="balance-station"
                  value={stationId ?? ''}
                  onChange={(event) => setStationId(event.target.value)}
                  options={stations.map((station) => ({
                    value: station.id,
                    label: `${station.name} (${station.code})`,
                  }))}
                />
              </Field>
            ) : null}
            <Field id={`balance-${editing.id}`} label="Balance on the statement (USD)" required>
              <input id={`balance-${editing.id}`} name="balance" inputMode="decimal" />
            </Field>
            <Field id={`balance-date-${editing.id}`} label="Date on the statement" required>
              <input id={`balance-date-${editing.id}`} name="asOfDate" type="date" />
            </Field>
            <div className="form-actions">
              <Button
                variant="secondary"
                type="button"
                onClick={() => setEditing(null)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type="submit" loading={busy}>
                Save balance
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </SectionCard>
  );
}
