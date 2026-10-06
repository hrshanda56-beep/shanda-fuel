export type OwnerDemoFixtureSummary = {
  stationId: string | null;
  stationTotalCount: string;
  stationCount: string;
  membershipStatus: string;
  credentialAccountCount: string;
  ownerScopeCount: string;
  ownerTenantScopeCount: string;
  ownerStationCodes: string[];
  postedSaleCount: string;
  saleMarkerCount: string;
};

export function isCompleteOwnerDemoFixture(rows: readonly OwnerDemoFixtureSummary[]): boolean {
  if (rows.length !== 1) return false;
  const row = rows[0]!;
  return (
    row.membershipStatus === 'ACTIVE' &&
    row.stationId !== null &&
    Number(row.stationTotalCount) === 4 &&
    Number(row.stationCount) === 4 &&
    Number(row.credentialAccountCount) === 1 &&
    Number(row.ownerScopeCount) === 5 &&
    Number(row.ownerTenantScopeCount) === 1 &&
    row.ownerStationCodes.join('|') === 'ARCTURUS|BINDURA|GAZEBO|MARUTA' &&
    Number(row.postedSaleCount) === 1 &&
    Number(row.saleMarkerCount) === 1
  );
}
