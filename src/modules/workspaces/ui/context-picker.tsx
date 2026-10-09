import { Card } from '@/design-system/primitives';
import type { AuthorizedStation, AuthorizedTenant } from '@/modules/authorization/server';
import { ContextOptionLink } from './context-option-link';

export function WorkspaceContextPicker({
  tenants,
  nextPath,
}: {
  tenants: readonly AuthorizedTenant[];
  nextPath: string;
}) {
  return (
    <Card as="section" className="panel context-picker" aria-labelledby="context-picker-title">
      <p className="eyebrow">Work context</p>
      <h1 id="context-picker-title">
        {tenants.length > 1 ? 'Choose an organisation' : 'Where are you working today?'}
      </h1>
      <p>Choose the station for this session. Only stations assigned to your account are shown.</p>
      <div className="context-picker-list">
        {tenants.flatMap((tenant) =>
          tenant.stations.map((station) => (
            <ContextLink
              key={`${tenant.tenantId}-${station.stationId}`}
              tenant={tenant}
              station={station}
              nextPath={nextPath}
            />
          )),
        )}
      </div>
    </Card>
  );
}

function ContextLink({
  tenant,
  station,
  nextPath,
}: {
  tenant: AuthorizedTenant;
  station: AuthorizedStation;
  nextPath: string;
}) {
  return (
    <ContextOptionLink
      tenantId={tenant.tenantId}
      stationId={station.stationId}
      nextPath={nextPath}
      stationName={station.stationName}
      tenantName={tenant.tenantName}
      stationCode={station.stationCode}
    />
  );
}
