import { TodayOverview } from '../_overview/today-overview';
import { PreviewShell } from './preview-shell';

export const metadata = { title: { absolute: 'Dashboard preview · Shanda Fuel' } };

/**
 * Dashboard with SAMPLE fixture data (development only). Switch with
 * ?scenario=normal|attention|unapproved|empty|loading|error:
 * normal = nonzero figures incl. a cash shortage; attention = approved zeros;
 * unapproved = activity but nothing approved yet ("—").
 */
export default function DashboardPreview() {
  return (
    <PreviewShell>
      <TodayOverview />
    </PreviewShell>
  );
}
