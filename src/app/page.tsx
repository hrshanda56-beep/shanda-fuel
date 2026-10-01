import Link from 'next/link';

import { AppShell } from '@/design-system/app-shell';
import { NeedsAttention, type AttentionItem } from '@/design-system/feedback';
import { MetricCard, PageHeader } from '@/design-system/layout';
import { syntheticNavigationProjection } from '@/design-system/navigation';
import { Card, OfflineBanner, StatusBadge } from '@/design-system/primitives';
import { TableScrollRegion } from '@/design-system/table';
import { ForecourtWorkspace } from '@/modules/forecourt/ui/forecourt-workspace';

/**
 * Today: action-first. What needs attention comes first, a short station
 * summary sits beside it, and the working surfaces follow. All values here are
 * synthetic until the server supplies the session and attention projections.
 * Shared UI patterns live on the design-system reference (/design-system).
 */

const reconciliationHref = '/stations/demo-station/reconciliations/new';

const attentionItems: AttentionItem[] = [
  {
    id: 'close-shift',
    priority: 'critical',
    title: 'Close the current shift',
    detail: 'Confirm meter readings before the reconciliation can be calculated.',
    meta: 'Demo station · Morning shift',
    href: reconciliationHref,
  },
  {
    id: 'delivery-draft',
    priority: 'warning',
    title: 'Review the delivery draft',
    detail: 'Draft evidence is stored locally until the connection is restored.',
    meta: 'Saved on this device',
    href: '/operations/daily',
  },
];

const operations = [
  {
    item: 'Morning shift',
    owner: 'Demo team',
    tone: 'positive',
    status: 'Open',
    href: '#forecourt',
  },
  {
    item: 'Meter close',
    owner: 'Demo supervisor',
    tone: 'warning',
    status: 'Waiting',
    href: reconciliationHref,
  },
] as const;

export default function HomePage() {
  return (
    <AppShell
      navigationProjection={syntheticNavigationProjection}
      context={{
        organisation: 'Demo organisation',
        station: 'Demo station',
        businessDate: '20 Sep 2026',
        shift: 'Morning shift',
      }}
      role="Supervisor"
      userName="Demo user"
      breadcrumbs={[{ label: 'Home' }]}
    >
      <PageHeader
        title="Good morning, Demo user"
        description="Start with what needs attention, then keep the shift moving."
      />

      <div className="today">
        <div className="today-top">
          <OfflineBanner />
          <div className="today-overview">
            <div id="attention">
              <NeedsAttention items={attentionItems} />
            </div>
            <section className="metric-grid metric-list" aria-label="Station summary">
              <MetricCard
                label="Shift progress"
                value="2 of 3"
                meta="Shifts completed today"
                href="#forecourt"
              />
              <MetricCard label="Open tasks" value="4" meta="2 need attention" href="#attention" />
              <MetricCard
                label="Connection"
                value="Draft safe"
                meta="No authoritative action pending"
              />
            </section>
          </div>
        </div>

        <ForecourtWorkspace
          businessDate="20 Sep 2026"
          shiftLabel="Morning shift"
          shiftState="OPEN"
          openNozzles={2}
          sealedNozzles={0}
          reconciliationState="DRAFT"
          connection="online"
          reconciliationHref={reconciliationHref}
        />

        <Card as="section" className="panel" id="operations" aria-labelledby="operations-title">
          <div className="panel-heading">
            <h2 id="operations-title">Operations today</h2>
            <Link className="text-link" href="/operations/daily">
              View all
            </Link>
          </div>
          <TableScrollRegion label="Operations today table">
            <table className="responsive-table">
              <caption className="visually-hidden">Operations today</caption>
              <thead>
                <tr>
                  <th scope="col">Work item</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {operations.map((row) => (
                  <tr key={row.item}>
                    <th scope="row">
                      <Link className="row-link" href={row.href}>
                        {row.item}
                      </Link>
                    </th>
                    <td data-label="Owner">{row.owner}</td>
                    <td data-label="Status">
                      <StatusBadge tone={row.tone}>{row.status}</StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollRegion>
        </Card>
      </div>
    </AppShell>
  );
}
