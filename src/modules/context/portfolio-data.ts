import 'server-only';
import { requireAuthenticatedActor } from '@/modules/identity';
import { getOperationsOverviewFromRequest } from '@/modules/forecourt/operations-overview';
import { getInventoryValuationReadModel } from '@/modules/costing/queries';
import { getCashStationSummaryFromRequest } from '@/modules/cash/queries';
import { getSettlementOverviewFromRequest } from '@/modules/settlements/queries';
import { loadActionCenterFacts } from '@/modules/approvals/action-center';
import { buildActionCenter } from '@/modules/approvals';
import type { ContextSelection } from './contracts';
import type { PortfolioArea } from './portfolio';
export type PortfolioFact = { label: string; value: string; href?: string };
export async function loadPortfolioStation(
  request: Request,
  selection: ContextSelection & { stationId: string },
  area: PortfolioArea,
): Promise<PortfolioFact[]> {
  const input = { tenantId: selection.organisationId, stationId: selection.stationId };
  if (area === 'operations' || area === 'reconciliations') {
    const data = await getOperationsOverviewFromRequest(request, input);
    const facts: PortfolioFact[] = [
      { label: 'Business date', value: data.currentBusinessDate },
      { label: 'Operations', value: data.status.close.replaceAll('_', ' ') },
      { label: 'Approval', value: data.status.approval.replaceAll('_', ' ') },
      { label: 'Shifts', value: String(data.shifts.length) },
    ];
    for (const record of data.reconciliations) {
      const params = new URLSearchParams({
        ...input,
        businessDayId: data.selectedBusinessDay?.id ?? '',
        shiftId: record.shiftId ?? '',
        reconciliationId: record.id,
      });
      facts.push({
        label: 'Reconciliation',
        value: record.state.replaceAll('_', ' '),
        href:
          record.shiftId && data.selectedBusinessDay
            ? `/operations/daily?${params}`
            : `/stations/${selection.stationId}/reconciliations?${new URLSearchParams(input)}`,
      });
    }
    return facts;
  }
  if (area === 'valuation') {
    const data = await getInventoryValuationReadModel(request, input);
    return data.streams.map((row) => ({
      label: `${row.tank.code} · ${row.product.name}`,
      value: `${row.quantityLitres} L · ${row.valuationStatus}`,
      href: `/inventory/valuation/streams/${encodeURIComponent(row.tank.id)}/${encodeURIComponent(row.product.id)}?${new URLSearchParams(input)}`,
    }));
  }
  if (area === 'cash') {
    const data = await getCashStationSummaryFromRequest(request, { selection });
    return Object.entries(data.totals).map(([label, value]) => ({
      label: label.replace(/([A-Z])/g, ' $1'),
      value: `${data.currency} ${String(value)}`,
    }));
  }
  if (area === 'settlements') {
    const data = await getSettlementOverviewFromRequest(request, input);
    return [
      { label: 'Settlements', value: String(data.settlements.length) },
      { label: 'Unmatched payments', value: String(data.unmatched.length) },
    ];
  }
  const actor = await requireAuthenticatedActor(request);
  const center = buildActionCenter(await loadActionCenterFacts(request, selection, actor));
  return [
    ...center.items.map((item) => ({
      label: item.area,
      value: `${item.title} — ${item.detail}`,
      href: item.href,
    })),
    ...center.unavailable.map((label) => ({ label, value: 'Unavailable' })),
    ...(center.items.length || center.unavailable.length
      ? []
      : [{ label: 'Work waiting', value: 'Nothing waiting' }]),
  ];
}
