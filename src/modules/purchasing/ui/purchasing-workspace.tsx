'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { ContextResolution } from '@/modules/context';
import { PageHeader } from '@/design-system/layout';
import { AccessDeniedState, ContextRequiredState } from '@/design-system/primitives';
import type { PurchasingCapabilities } from '../capabilities-types';
import { ChecksPanel } from './checks-panel';
import { ExposurePanel } from './exposure-panel';
import { OrdersPanel } from './orders-panel';
import { SettingsPanel } from './settings-panel';
import { getJson } from './purchasing-client';
import { availableTabs, resolveTab, type PurchasingTab } from './purchasing-tabs';
import type { StationOption, SupplierName } from './purchasing-types';

export function PurchasingWorkspace({
  resolution,
  capabilities,
}: {
  resolution: ContextResolution;
  capabilities: PurchasingCapabilities;
}) {
  const searchParams = useSearchParams();
  const current = resolution.current;
  const tabs = useMemo(() => availableTabs(capabilities), [capabilities]);
  const [tab, setTab] = useState<PurchasingTab | null>(() =>
    resolveTab(searchParams.get('tab'), tabs),
  );
  const [suppliers, setSuppliers] = useState<SupplierName[]>([]);

  const tenantId = current?.organisationId ?? '';
  const legalEntityId = current?.legalEntityId ?? '';

  const stations = useMemo<StationOption[]>(() => {
    for (const org of resolution.available.organisations) {
      if (org.id !== tenantId) continue;
      const entity = org.legalEntities.find((e) => e.id === legalEntityId);
      return entity?.stations.map((s) => ({ id: s.id, name: s.name })) ?? [];
    }
    return [];
  }, [resolution, tenantId, legalEntityId]);

  const needsSuppliers = capabilities.reviewInvoices || capabilities.viewSettings;
  useEffect(() => {
    if (!needsSuppliers || !tenantId || !legalEntityId) return;
    const controller = new AbortController();
    void getJson<SupplierName[]>(
      `/api/suppliers/summary?${new URLSearchParams({ tenantId, legalEntityId })}`,
      'The suppliers could not be loaded.',
      controller.signal,
    )
      .then((rows) => setSuppliers(Array.isArray(rows) ? rows : []))
      .catch(() => undefined);
    return () => controller.abort();
  }, [needsSuppliers, tenantId, legalEntityId]);

  function choose(next: PurchasingTab) {
    setTab(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', next);
      window.history.replaceState(window.history.state, '', url);
    } catch {
      // The tab still works without a shareable link.
    }
  }

  if (!current?.legalEntityId) {
    return (
      <div className="content-grid wide-workspace">
        <ContextRequiredState
          title="Choose a company"
          message="Use the selector above to choose the company whose purchasing you want to see."
        />
      </div>
    );
  }
  if (tabs.length === 0 || !tab) {
    return (
      <div className="content-grid wide-workspace">
        <AccessDeniedState message="You do not have access to purchasing. Ask the owner or a manager to give you access." />
      </div>
    );
  }

  const initialStation =
    current.stationId && stations.some((s) => s.id === current.stationId)
      ? current.stationId
      : null;

  return (
    <div className="content-grid wide-workspace">
      <PageHeader
        eyebrow="Purchasing"
        title="Ordering fuel and checking supplier invoices"
        headingLevel="h2"
        titleId="purchasing-title"
        description="Order fuel from your suppliers, see what has been delivered but not invoiced, and catch invoices that do not match."
      />
      <div className="list-filters content-span" role="group" aria-label="Purchasing sections">
        {tabs.map((item) => (
          <button
            key={item.value}
            type="button"
            className="list-filter"
            aria-pressed={tab === item.value}
            onClick={() => choose(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="content-span">
        {tab === 'orders' ? (
          <OrdersPanel
            tenantId={tenantId}
            legalEntityId={legalEntityId}
            stations={stations}
            initialStationId={initialStation}
            capabilities={capabilities}
          />
        ) : null}
        {tab === 'not-invoiced' ? (
          <ExposurePanel tenantId={tenantId} legalEntityId={legalEntityId} />
        ) : null}
        {tab === 'checks' ? (
          <ChecksPanel tenantId={tenantId} legalEntityId={legalEntityId} suppliers={suppliers} />
        ) : null}
        {tab === 'settings' ? (
          <SettingsPanel
            tenantId={tenantId}
            legalEntityId={legalEntityId}
            suppliers={suppliers}
            capabilities={capabilities}
          />
        ) : null}
      </div>
    </div>
  );
}
