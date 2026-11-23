import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { ContextRequiredState, LoadingState } from '@/design-system/primitives';
import { businessToday } from '@/modules/reporting/period';
import {
  getSalesDocumentCapabilitiesFromRequest,
  getSalesDocumentCustomersFromRequest,
  getSalesDocumentFromRequest,
  getSalesDocumentFuelOptionsFromRequest,
  getSalesDocumentProfileFromRequest,
  listSalesDocumentsFromRequest,
} from '@/modules/sales-documents/queries';
import {
  SalesDocumentsWorkspace,
  type SalesDocumentsInitial,
} from '@/modules/sales-documents/ui/sales-documents-workspace';

export const metadata = { title: 'Quotes & invoices' };
export const dynamic = 'force-dynamic';

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({ searchParams }: { searchParams: Promise<PageSearch> }) {
  const search = await searchParams;
  const viewId = first(search.doc);
  const editId = first(search.edit);
  const newType = first(search.new) === 'INVOICE' ? 'INVOICE' : 'QUOTATION';
  const wantsNew = first(search.new) !== undefined;
  const openId = [viewId, editId].find((id) => id && UUID.test(id));

  return (
    <ServerDataPage
      pathname="/sales-documents"
      search={search}
      fallback={<LoadingState label="Loading" />}
      load={async (request, resolution): Promise<Omit<SalesDocumentsInitial, never> | null> => {
        const current = resolution.current;
        if (!current?.legalEntityId) return null;
        const scope = { tenantId: current.organisationId, legalEntityId: current.legalEntityId };
        const [capabilities, profile] = await Promise.all([
          getSalesDocumentCapabilitiesFromRequest(request, scope),
          getSalesDocumentProfileFromRequest(request, scope),
        ]);
        const organisation = resolution.available.organisations.find(
          (item) => item.id === current.organisationId,
        );
        const entity = organisation?.legalEntities.find(
          (item) => item.id === current.legalEntityId,
        );
        const mode =
          editId && openId === editId
            ? 'edit'
            : viewId && openId === viewId
              ? 'view'
              : wantsNew
                ? 'new'
                : 'list';
        const [rows, customers, fuels, detail] = await Promise.all([
          mode === 'list' ? listSalesDocumentsFromRequest(request, { ...scope, limit: 200 }) : [],
          mode === 'new' || mode === 'edit'
            ? getSalesDocumentCustomersFromRequest(request, scope)
            : [],
          mode === 'new' || mode === 'edit'
            ? getSalesDocumentFuelOptionsFromRequest(request, scope)
            : [],
          openId ? getSalesDocumentFromRequest(request, { ...scope, documentId: openId }) : null,
        ]);
        return {
          ...scope,
          defaultCompanyName: entity?.name ?? organisation?.name ?? '',
          capabilities,
          profile,
          customers,
          fuels,
          rows,
          mode,
          newType,
          detail,
          today: businessToday(),
          stationId: current.stationId && !current.allStations ? current.stationId : null,
        };
      }}
      render={(data, resolution) =>
        data ? (
          <SalesDocumentsWorkspace key={JSON.stringify(resolution.current)} initial={data} />
        ) : (
          <ContextRequiredState
            title="Choose a company"
            message="Pick a company in the selector above to make quotations and invoices."
          />
        )
      }
    />
  );
}
