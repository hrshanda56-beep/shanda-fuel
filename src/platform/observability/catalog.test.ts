import { describe, expect, it } from 'vitest';
import alerts from '../../../config/observability/alerts.json';
import dashboard from '../../../config/observability/dashboard.json';
import { requiredAlertIds, validateObservabilityCatalog } from './catalog';

describe('observability catalog', () => {
  it('keeps the checked-in alert and dashboard definitions internally consistent', () => {
    expect(validateObservabilityCatalog(alerts, dashboard)).toEqual([]);
  });

  it('requires each launch signal to have an alert definition', () => {
    const configured = new Set(alerts.alerts.map((alert) => alert.id));
    for (const id of requiredAlertIds) expect(configured.has(id)).toBe(true);
  });

  it('rejects dashboard references to missing alerts', () => {
    const invalid = {
      ...dashboard,
      panels: [...dashboard.panels, { id: 'broken', title: 'Broken', alertIds: ['missing'] }],
    };
    expect(validateObservabilityCatalog(alerts, invalid)).toContain(
      'panel broken references unknown alert missing',
    );
  });
});
