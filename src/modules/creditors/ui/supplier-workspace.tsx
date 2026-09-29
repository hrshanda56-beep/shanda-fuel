'use client';

import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusBadge,
} from '../../../design-system/primitives';
import { TableScrollRegion } from '../../../design-system/table';

type SupplierSummary = {
  supplierId: string;
  code: string;
  legalName: string;
  current: string;
  overdue: string;
  total: string;
};

export function SupplierWorkspace({
  tenantId,
  legalEntityId,
}: {
  tenantId: string;
  legalEntityId: string;
}) {
  const [rows, setRows] = useState<SupplierSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh(signal?: AbortSignal) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/suppliers/summary?tenantId=${tenantId}&legalEntityId=${legalEntityId}`,
        { cache: 'no-store', signal },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? 'Supplier balances could not be loaded');
      setRows(result);
    } catch (cause) {
      if (!signal?.aborted)
        setError(cause instanceof Error ? cause.message : 'Supplier balances could not be loaded');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `/api/suppliers/summary?tenantId=${tenantId}&legalEntityId=${legalEntityId}`,
          { cache: 'no-store', signal: controller.signal },
        );
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.message ?? 'Supplier balances could not be loaded');
        setRows(result);
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : 'Supplier balances could not be loaded',
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [tenantId, legalEntityId]);

  return (
    <div className="content-grid">
      <Card as="section" className="panel" aria-labelledby="supplier-creditors-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Supplier creditors</p>
            <h1 id="supplier-creditors-title">Payables position</h1>
          </div>
          <StatusBadge tone="informational">Legal-entity scoped</StatusBadge>
        </div>
        {loading ? <LoadingState label="Loading supplier balances" /> : null}
        {error ? (
          <ErrorState
            message={error}
            action={<Button onClick={() => void refresh()}>Retry</Button>}
          />
        ) : null}
        {!loading && !error && rows.length === 0 ? (
          <EmptyState
            title="No suppliers yet"
            message="Supplier master data will appear after onboarding."
          />
        ) : null}
        {!loading && !error && rows.length > 0 ? (
          <TableScrollRegion label="Supplier creditor balances">
            <table className="responsive-table">
              <caption className="visually-hidden">Supplier creditor balances</caption>
              <thead>
                <tr>
                  <th scope="col">Supplier</th>
                  <th scope="col">Current</th>
                  <th scope="col">Overdue</th>
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.supplierId}>
                    <td data-label="Supplier">
                      <strong>{row.code}</strong>
                      <br />
                      {row.legalName}
                    </td>
                    <td data-label="Current" className="numeric">
                      ${row.current}
                    </td>
                    <td data-label="Overdue" className="numeric">
                      ${row.overdue}
                    </td>
                    <td data-label="Total" className="numeric">
                      ${row.total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollRegion>
        ) : null}
      </Card>
    </div>
  );
}
