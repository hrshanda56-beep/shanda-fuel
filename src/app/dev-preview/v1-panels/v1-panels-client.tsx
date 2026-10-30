'use client';

import { PageContainer } from '@/design-system/layout';
import { AuditPanel } from '../../../modules/audit/ui/audit-panel';
import { CashHandoverSheet } from '../../../modules/cash/ui/cash-handover-panel';
import { DocumentAttachments } from '../../../modules/documents/ui/document-attachments';
import { AlertSettingsPanel } from '../../../modules/setup/ui/alert-settings-panel';

const tenantId = 'e2e90000-0000-4000-8000-000000000001';
const stationId = 'e2e90000-0000-4000-8000-000000000021';

export function V1PanelsPreviewClient() {
  return (
    <main>
      <PageContainer width="wide">
        <h1>New screens</h1>
        <CashHandoverSheet
          open
          onClose={() => undefined}
          context={{ organisationId: tenantId, stationId, allStations: false }}
          currentMembershipId="me"
          canSubmit
          canAccept
          canResolve
          hidden={false}
          onChanged={async () => undefined}
          locations={[
            { locationId: 'till', name: 'Station till' },
            { locationId: 'safe', name: 'Station safe' },
          ]}
          handovers={[
            {
              handoverId: 'h1',
              fromLocationId: 'till',
              toLocationId: 'safe',
              expectedAmount: '500',
              countedAmount: '500',
              variance: '0',
              state: 'SUBMITTED',
              version: 0,
              reason: null,
              resolutionNote: null,
              deliveredByMembershipId: 'tendai',
              deliveredByName: 'Tendai Moyo',
              receivedByName: null,
              submittedAt: '2026-10-21T08:00:00Z',
            },
            {
              handoverId: 'h2',
              fromLocationId: 'till',
              toLocationId: 'safe',
              expectedAmount: '300',
              countedAmount: '250',
              variance: '-50',
              state: 'DISPUTED',
              version: 0,
              reason: 'Customer was short-changed',
              resolutionNote: null,
              deliveredByMembershipId: 'tendai',
              deliveredByName: 'Tendai Moyo',
              receivedByName: null,
              submittedAt: '2026-10-21T09:00:00Z',
            },
          ]}
        />
        <AuditPanel tenantId={tenantId} />
        <DocumentAttachments
          tenantId={tenantId}
          stationId={stationId}
          subjectType="FUEL_DELIVERY"
          subjectId="e2e90000-0000-4000-8000-0000000000d1"
          defaultKind="DELIVERY_NOTE"
          title="Delivery note and photos"
        />
        <AlertSettingsPanel tenantId={tenantId} stationId={stationId} />
      </PageContainer>
    </main>
  );
}
