import Link from 'next/link';
import { AppShell } from '@/design-system/app-shell';
import { Card, StatusBadge } from '@/design-system/primitives';
import { syntheticNavigationProjection } from '@/design-system/navigation';

export default async function ReconciliationListPage({
  params,
  searchParams,
}: {
  params: Promise<{ stationId: string }>;
  searchParams?: Promise<{
    tenantId?: string;
    businessDayId?: string;
    shiftId?: string;
  }>;
}) {
  const { stationId } = await params;
  const search = (await searchParams) ?? {};
  const operationsHref =
    search.tenantId && search.businessDayId && search.shiftId
      ? `/operations/daily?${new URLSearchParams({
          tenantId: search.tenantId,
          stationId,
          businessDayId: search.businessDayId,
          shiftId: search.shiftId,
        }).toString()}`
      : '/operations/daily';
  return (
    <AppShell
      navigationProjection={syntheticNavigationProjection}
      context={{
        organisation: 'TEI Oils',
        station: 'Main service station',
        businessDate: '20 Sep 2026',
        shift: 'Morning shift',
      }}
      role="Supervisor"
      userName="Demo supervisor"
      breadcrumbs={[{ label: 'Reconciliations' }]}
    >
      <div className="page-header">
        <div>
          <p className="eyebrow">Station operations</p>
          <h1>Daily reconciliations</h1>
          <p className="lede">
            One operational date and shift per reconciliation, with sealed meter evidence and
            management control.
          </p>
        </div>
        <StatusBadge tone="informational">Station scoped</StatusBadge>
      </div>
      <Card as="section" className="panel" aria-labelledby="reconciliation-list-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">20 Sep 2026</p>
            <h2 id="reconciliation-list-title">Morning shift</h2>
          </div>
          <StatusBadge tone="informational">DRAFT</StatusBadge>
        </div>
        <p>
          Arcturus Diesel and TEI Oils Petrol · 1 supervisor · 1 attendant · meter close captured.
        </p>
        <Link className="button button-primary" href={`/stations/${stationId}/reconciliations/new`}>
          Open reconciliation
        </Link>
        <Link className="text-link" href={operationsHref}>
          Open daily operations workspace
        </Link>
      </Card>
    </AppShell>
  );
}
