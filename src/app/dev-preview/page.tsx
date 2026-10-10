import { TodayOverview } from '../_overview/today-overview';
import { PreviewShell } from './preview-shell';

export const metadata = { title: { absolute: 'Dashboard preview · Shanda Fuel' } };

/**
 * Dashboard with fixture data. Switch with ?scenario=normal|attention|empty|loading|error
 */
export default function DashboardPreview() {
  return (
    <PreviewShell>
      <TodayOverview />
    </PreviewShell>
  );
}
