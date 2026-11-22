'use client';

import { StationDetail } from '../../../modules/setup/ui/station-detail';

const tenantId = 'e2e80000-0000-4000-8000-000000000001';
const station = {
  id: 'e2e80000-0000-4000-8000-000000000021',
  code: 'MAIN',
  name: 'Main Station',
  timezone: 'Africa/Harare',
  status: 'ONBOARDING' as const,
};

/** The real station page, so the setup wizards can be driven without a signed-in shell. */
export function StationPreview() {
  return (
    <StationDetail
      tenantId={tenantId}
      station={station}
      canSetUp
      canEditDetails={false}
      onBack={() => undefined}
      onOpenStaff={() => undefined}
    />
  );
}
