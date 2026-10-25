'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { Button, EmptyState, ErrorState, Field, LoadingState } from '@/design-system/primitives';
import { Select } from '@/design-system/forms';
import { formatUsd } from '@/design-system/formatters';

import { friendlySetupError } from '../guided-setup';
import styles from './setup.module.css';

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
}: Readonly<{
  tenantId: string;
  stations: ReadonlyArray<{ id: string; name: string; code: string }>;
}>) {
  const [stationId, setStationId] = useState<string | undefined>(stations[0]?.id);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>, account: Account) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const balance = String(data.get('balance') ?? '')
      .trim()
      .replace(/,/g, '');
    const asOfDate = String(data.get('asOfDate') ?? '');
    if (!/^-?\d+(?:\.\d{1,4})?$/.test(balance))
      return setError('Enter the balance as a number, such as 1250.50.');
    if (!asOfDate) return setError('Choose the date on the bank statement.');
    if (!stationId) return setError('Choose a station first.');
    setBusy(account.id);
    setError(null);
    setSaved(null);
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
      if (!response.ok) return setError(friendlySetupError(response.status, result.message));
      form.reset();
      setSaved(`${account.name}: balance saved.`);
      await load();
    } catch {
      setError('We could not reach the server. Nothing was saved.');
    } finally {
      setBusy(null);
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
    <section className={styles.card} aria-labelledby="payments-bank-balances">
      <h3 id="payments-bank-balances" className={styles.cardTitle}>
        Bank balances
      </h3>
      <p className={styles.rowDetail}>
        Type in the balance from the bank statement. The financial position uses it for the money in
        the bank once every account has one; until then it uses the deposits recorded in the app.
      </p>
      {loaded.canRecord && stations.length > 1 ? (
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
      {loaded.accounts.length === 0 ? (
        <EmptyState
          title="No bank accounts entered"
          message="Enter a bank account above, then type in its balance here."
        />
      ) : (
        <ul className={styles.list}>
          {loaded.accounts.map((account) => (
            <li key={account.id} className={styles.row}>
              <div className={styles.rowMain}>
                <span className={styles.rowTitle}>{account.name}</span>
                <span className={styles.rowDetail}>
                  {account.bankName} · {account.accountReference}
                </span>
                <span className={styles.rowDetail}>
                  {account.balance !== null && account.asOfDate
                    ? `${formatUsd(account.balance)} as at ${account.asOfDate}`
                    : 'No balance typed in yet'}
                </span>
              </div>
              {loaded.canRecord ? (
                <form
                  className={styles.form}
                  onSubmit={(event) => void save(event, account)}
                  noValidate
                  aria-label={`Type in the balance for ${account.name}`}
                >
                  <Field id={`balance-${account.id}`} label="Balance on the statement (USD)">
                    <input id={`balance-${account.id}`} name="balance" inputMode="decimal" />
                  </Field>
                  <Field id={`balance-date-${account.id}`} label="Date on the statement">
                    <input id={`balance-date-${account.id}`} name="asOfDate" type="date" />
                  </Field>
                  <Button type="submit" loading={busy === account.id} disabled={busy !== null}>
                    Save balance
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {!loaded.canRecord ? (
        <p className={styles.rowDetail}>
          Only finance, an administrator or the owner can type these in.
        </p>
      ) : null}
      {error ? <ErrorState message={error} /> : null}
      {saved ? <p role="status">{saved}</p> : null}
    </section>
  );
}
