'use client';

import Link from 'next/link';

export function ContextOptionLink({
  tenantId,
  stationId,
  nextPath,
  stationName,
  tenantName,
  stationCode,
}: {
  tenantId: string;
  stationId: string;
  nextPath: string;
  stationName: string;
  tenantName: string;
  stationCode: string;
}) {
  const query = new URLSearchParams({ tenantId, stationId });
  return (
    <Link
      className="context-picker-option"
      href={`${nextPath}?${query.toString()}`}
      onClick={() => {
        document.cookie = `shanda-fuel-tenant-context=${encodeURIComponent(tenantId)}; path=/; max-age=31536000; samesite=lax`;
        document.cookie = `shanda-fuel-station-context=${encodeURIComponent(stationId)}; path=/; max-age=31536000; samesite=lax`;
      }}
    >
      <span>
        <strong>{stationName}</strong>
        <span>
          {tenantName} · {stationCode}
        </span>
      </span>
      <span aria-hidden="true">›</span>
    </Link>
  );
}
