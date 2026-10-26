import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { ContextRequiredState } from '@/design-system/primitives';
import { getStaffBenefitExpensePreviewFromRequest } from '@/modules/customers/staff-benefit-expense-read';
import { StaffBenefitExpenseWorkspace } from '@/modules/customers/ui/staff-benefit-expense-workspace';

export const metadata = { title: 'Staff fuel benefit cost' };
export const dynamic = 'force-dynamic';

/** Last 12 whole months, newest first, starting with last month. */
function monthChoices(now: Date) {
  const options: { value: string; label: string }[] = [];
  for (let back = 1; back <= 12; back += 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const value = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    options.push({
      value,
      label: date.toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    });
  }
  return options;
}

export default async function Page({ searchParams }: { searchParams: Promise<PageSearch> }) {
  const search = await searchParams;
  const options = monthChoices(new Date());
  const asked = Array.isArray(search.month) ? search.month[0] : search.month;
  const month = options.some((option) => option.value === asked) ? asked! : options[0]!.value;
  return (
    <ServerDataPage
      pathname="/customers/staff-benefit/expense"
      search={search}
      fallback={
        <ContextRequiredState
          title="Choose a work context"
          message="Use the selector above to choose an authorized context."
        />
      }
      load={async (request, resolution) => {
        const current = resolution.current;
        if (!current?.stationId || current.allStations) return null;
        const rows = await getStaffBenefitExpensePreviewFromRequest(request, {
          tenantId: current.organisationId,
          stationId: current.stationId,
          month,
        });
        return { rows };
      }}
      render={(data, resolution) => {
        const current = resolution.current;
        if (!data || !current?.stationId) {
          return (
            <ContextRequiredState
              title="Choose one station"
              message="The cost of staff fuel is worked out for one station at a time. Pick a station in the selector above."
            />
          );
        }
        const rows = data.rows.map(({ reference: _reference, ...row }) => row);
        return (
          <StaffBenefitExpenseWorkspace
            key={JSON.stringify([current, month])}
            tenantId={current.organisationId}
            stationId={current.stationId}
            stationName={data.rows[0]?.stationName ?? 'this station'}
            month={month}
            monthOptions={options}
            rows={rows}
          />
        );
      }}
    />
  );
}
