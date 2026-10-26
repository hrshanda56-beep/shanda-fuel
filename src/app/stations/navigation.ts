export function stationReconciliationsPath(stationId: string, tenantId?: string): string {
  const path = `/stations/${encodeURIComponent(stationId)}/reconciliations`;
  return tenantId ? `${path}?tenantId=${encodeURIComponent(tenantId)}` : path;
}
