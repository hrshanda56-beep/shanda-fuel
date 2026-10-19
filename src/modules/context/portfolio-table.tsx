import type { ReactNode } from 'react';
import Link from 'next/link';
import { Card, StatusBadge } from '@/design-system/primitives';
import { TableScrollRegion } from '@/design-system/table';
import { formatBusinessDate, formatStatusLabel } from '@/design-system/formatters';
import { Icon } from '@/design-system/icons';
import type { PortfolioFact } from './portfolio-data';
export function PortfolioOperationsTable({
  children,
  count,
}: {
  children?: ReactNode;
  count: number;
}) {
  return (
    <Card as="section" className="panel portfolio-operations">
      <header className="portfolio-panel-heading">
        <h2>
          Station overview <span className="finance-table-count">{count}</span>
        </h2>
        <p className="table-secondary">Operations and approvals across your stations.</p>
      </header>
      <TableScrollRegion label="Operations by station">
        <table className="data-table portfolio-station-table">
          <caption className="sr-only">Operations by station</caption>
          <thead>
            <tr>
              {['Station', 'Business date', 'Operations', 'Approval', 'Shifts', ''].map(
                (label, index) => (
                  <th key={index} scope="col">
                    {label || <span className="sr-only">Open station</span>}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </TableScrollRegion>
    </Card>
  );
}
export type PortfolioStationRowProps = {
  name: string;
  entity: string;
  href: string;
  facts?: readonly PortfolioFact[];
  message?: string;
};
export function PortfolioStationRow({
  name,
  entity,
  href,
  facts,
  message,
}: PortfolioStationRowProps) {
  const value = (label: string) => facts?.find((fact) => fact.label === label)?.value;
  const status = (label: string) => {
    const raw = value(label);
    const state = raw?.replaceAll(' ', '_');
    const tone =
      state && ['RETURNED', 'REJECTED', 'BLOCKED', 'EXCEPTION'].includes(state)
        ? 'warning'
        : state && ['SUBMITTED', 'PENDING_APPROVAL', 'READY_FOR_REVIEW'].includes(state)
          ? 'pending'
          : state && ['CLOSED', 'APPROVED', 'POSTED', 'LOCKED'].includes(state)
            ? 'locked'
            : 'informational';
    return raw ? (
      <StatusBadge tone={tone}>
        {state === 'NO_REVISION' ? 'No submission' : formatStatusLabel(state!)}
      </StatusBadge>
    ) : (
      '—'
    );
  };
  return (
    <tr>
      <th scope="row">
        <Link className="row-link" href={href}>
          {name}
        </Link>
        <span className="table-secondary">{entity}</span>
        {facts
          ?.filter((fact) => fact.href)
          .map((fact, index) => (
            <Link className="table-secondary portfolio-record-link" key={index} href={fact.href!}>
              {formatStatusLabel(fact.value.replaceAll(' ', '_'))} reconciliation
            </Link>
          ))}
      </th>
      {message ? (
        <td colSpan={4} className="portfolio-row-message" role="status">
          {message}
        </td>
      ) : (
        <>
          <td data-label="Business date">
            {value('Business date') ? formatBusinessDate(value('Business date')!) : '—'}
          </td>
          <td data-label="Operations">{status('Operations')}</td>
          <td data-label="Approval">{status('Approval')}</td>
          <td data-label="Shifts" className="cell-numeric">
            {value('Shifts') ?? '—'}
          </td>
        </>
      )}
      <td className="cell-action">
        <Link className="portfolio-open" href={href} aria-label={`Open ${name}`}>
          Open <Icon name="chevron-right" />
        </Link>
      </td>
    </tr>
  );
}
