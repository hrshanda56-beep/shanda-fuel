import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import { SettlementWorkspace } from '@/modules/settlements/ui/settlement-workspace';

export const metadata = { title: 'Provider payouts' };

export default async function SettlementsPage({
  params,
}: {
  params: Promise<{ stationId: string }>;
}) {
  const { stationId } = await params;
  return (
    <AppShell>
      <SettlementWorkspace stationId={stationId} />
    </AppShell>
  );
}
