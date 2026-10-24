import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { ContextRequiredState, LoadingState } from '@/design-system/primitives';
import {
  getExpenseReferenceFromRequest,
  getExpenseSummaryFromRequest,
  listExpensesFromRequest,
} from '@/modules/expenses/queries';
import { ExpenseWorkspace, type ExpenseInitial } from '@/modules/expenses/ui/expense-workspace';
import { monthRange, todayInBusinessTime } from '@/modules/expenses/ui/expense-format';

export const metadata = { title: 'Expenses' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<PageSearch> }) {
  const search = await searchParams;
  return (
    <ServerDataPage
      pathname="/expenses"
      search={search}
      fallback={<LoadingState label="Loading" />}
      load={async (request, resolution): Promise<Omit<ExpenseInitial, 'resolution'> | null> => {
        const current = resolution.current;
        if (!current?.legalEntityId) return null;
        const scope = {
          tenantId: current.organisationId,
          legalEntityId: current.legalEntityId,
          ...(current.stationId && !current.allStations ? { stationId: current.stationId } : {}),
        };
        const range = monthRange(todayInBusinessTime());
        const [list, summary, reference] = await Promise.all([
          listExpensesFromRequest(request, { ...scope, limit: 200 }),
          getExpenseSummaryFromRequest(request, { ...scope, ...range }),
          getExpenseReferenceFromRequest(request, scope),
        ]);
        return {
          items: list.items as unknown as ExpenseInitial['items'],
          summary: summary as unknown as ExpenseInitial['summary'],
          reference: reference as unknown as ExpenseInitial['reference'],
        };
      }}
      render={(data, resolution) =>
        data ? (
          <ExpenseWorkspace
            key={JSON.stringify(resolution.current)}
            initial={{ resolution, ...data }}
          />
        ) : (
          <ContextRequiredState
            title="Choose a company"
            message="Pick a company in the selector above to see its expenses."
          />
        )
      }
    />
  );
}
