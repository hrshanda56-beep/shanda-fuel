import { describe, expect, it } from 'vitest';
import { buildContextHref } from '../../context/routes';
import type { ReportFilters } from '../../reporting/filters';
import { profitStatementHref } from './profit-links';

const TENANT = '11111111-1111-4111-8111-111111111111';
const ENTITY_B = '22222222-2222-4222-8222-222222222222';
const filters: ReportFilters = {
  stationIds: [],
  period: 'this-month',
  customFrom: '',
  customTo: '',
};

describe('Profit navigation keeps the legal entity', () => {
  it('sends the legal entity to the full statement', () => {
    const href = profitStatementHref(TENANT, { legalEntityId: ENTITY_B }, filters);
    const params = new URL(href, 'https://example.test').searchParams;
    expect(params.get('tenantId')).toBe(TENANT);
    expect(params.get('legalEntityId')).toBe(ENTITY_B);
  });

  it('leaves the legal entity out only when none is selected', () => {
    const href = profitStatementHref(TENANT, null, filters);
    expect(new URL(href, 'https://example.test').searchParams.has('legalEntityId')).toBe(false);
  });

  it('keeps the legal entity on the Expenses link', () => {
    const href = buildContextHref('/expenses', '', {
      organisationId: TENANT,
      legalEntityId: ENTITY_B,
      allStations: true,
    });
    const params = new URL(href, 'https://example.test').searchParams;
    expect(params.get('legalEntityId')).toBe(ENTITY_B);
    expect(params.get('allStations')).toBe('true');
  });
});
