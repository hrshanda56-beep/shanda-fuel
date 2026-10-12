import { MyShiftWorkspace } from '@/modules/forecourt/ui/my-shift-workspace';

import { AttendantShell } from './attendant-shell';

export const metadata = { title: 'My Shift' };

/** The attendant's own home, with the navigation an attendant is really given. */
export default function AttendantPreviewPage() {
  return (
    <AttendantShell>
      <MyShiftWorkspace tenantId="e2e-tenant" stationId="e2e-station" />
    </AttendantShell>
  );
}
