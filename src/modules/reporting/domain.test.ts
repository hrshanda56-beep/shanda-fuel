import { describe, expect, it } from 'vitest';
import {
  averageRealizedPrice,
  buildReportingNeedsAttention,
  customerScopeAvailability,
  deriveCashPosition,
  formatLitres,
  formatMoney,
  sumExact,
} from './domain';

describe('management reporting exact arithmetic', () => {
  it('aggregates decimal strings without IEEE-754 drift', () => {
    expect(sumExact(['0.1', '0.2', '1.005'])).toBe('1.305');
  });

  it('serializes authoritative values at canonical scales', () => {
    expect(formatMoney('12.3')).toBe('12.3000');
    expect(formatLitres('12.3')).toBe('12.300');
    expect(averageRealizedPrice('3', '10')).toBe('3.333333');
  });

  it('returns an empty zero report rather than null arithmetic', () => {
    expect(formatMoney(sumExact([]))).toBe('0.0000');
    expect(formatLitres(sumExact([]))).toBe('0.000');
  });

  it('keeps cash evidence, collection, and banking as separate facts', () => {
    expect(
      deriveCashPosition({
        evidence: '100.00',
        collected: '80.00',
        banked: '50.00',
        variance: '-2.00',
      }),
    ).toEqual({
      cashEvidence: '100.0000',
      collected: '80.0000',
      awaitingCollection: '20.0000',
      banked: '50.0000',
      collectedButNotBanked: '30.0000',
      cashVariance: '-2.0000',
    });
  });

  it('marks station-scoped customer balances unavailable instead of zero', () => {
    expect(customerScopeAvailability()).toBe('AVAILABLE');
    expect(customerScopeAvailability('station-1')).toBe('UNAVAILABLE_STATION_DIMENSION');
  });

  it('projects only non-zero report facts into needs-attention items', () => {
    const items = buildReportingNeedsAttention({
      currency: 'USD',
      grossMargin: null,
      cash: {
        cashEvidence: '100.0000',
        collected: '80.0000',
        awaitingCollection: '20.0000',
        banked: '50.0000',
        collectedButNotBanked: '30.0000',
        cashVariance: '-2.0000',
        collectionIds: [],
        depositIds: [],
      },
      providers: {
        paymentEvidence: '10.0000',
        settlementGross: '10.0000',
        allocatedAmount: '0.0000',
        unallocatedProviderAmount: '10.0000',
        unmatchedEvidenceAmount: '10.0000',
        settlementVariance: '0.0000',
        feesAndDeductions: '0.0000',
        rows: [],
      },
      inventory: {
        expectedLitres: '100.000',
        physicalLitres: '98.500',
        varianceLitres: '-1.500',
        deliveryLitres: '0.000',
        deliveryValue: '0.0000',
        rows: [],
      },
      revenue: {
        currency: 'USD',
        revenueStatus: 'POSTED',
        recognizedRevenue: '100.0000',
        saleCount: 1,
        sales: [],
      },
      costing: {
        currency: 'USD',
        costingStatus: 'UNVALUED',
        originalCogs: null,
        revaluationDelta: null,
        restatedCogs: null,
        saleCount: 1,
        valuedSaleCount: 0,
        unvaluedSaleCount: 1,
        sales: [],
      },
    });

    expect(items.map((item) => item.id)).toEqual([
      'cash-variance',
      'cash-awaiting-collection',
      'cash-awaiting-banking',
      'provider-unmatched-evidence',
      'provider-unallocated-settlement',
      'inventory-variance',
      'gross-margin-unavailable',
    ]);
    expect(items.find((item) => item.id === 'cash-variance')?.detail).toContain('-2.0000 USD');
    expect(items.find((item) => item.id === 'inventory-variance')?.detail).toContain('-1.500 L');
  });

  it('does not invent an issue for zero or fully valued report facts', () => {
    const items = buildReportingNeedsAttention({
      currency: 'USD',
      grossMargin: '0.0000',
      cash: {
        cashEvidence: '0.0000',
        collected: '0.0000',
        awaitingCollection: '0.0000',
        banked: '0.0000',
        collectedButNotBanked: '0.0000',
        cashVariance: '0.0000',
        collectionIds: [],
        depositIds: [],
      },
      providers: {
        paymentEvidence: '0.0000',
        settlementGross: '0.0000',
        allocatedAmount: '0.0000',
        unallocatedProviderAmount: '0.0000',
        unmatchedEvidenceAmount: '0.0000',
        settlementVariance: '0.0000',
        feesAndDeductions: '0.0000',
        rows: [],
      },
      inventory: {
        expectedLitres: '0.000',
        physicalLitres: '0.000',
        varianceLitres: '0.000',
        deliveryLitres: '0.000',
        deliveryValue: '0.0000',
        rows: [],
      },
      revenue: {
        currency: 'USD',
        revenueStatus: 'NO_SALES',
        recognizedRevenue: '0.0000',
        saleCount: 0,
        sales: [],
      },
      costing: {
        currency: 'USD',
        costingStatus: 'COMPLETE',
        originalCogs: '0.0000',
        revaluationDelta: '0.0000',
        restatedCogs: '0.0000',
        saleCount: 0,
        valuedSaleCount: 0,
        unvaluedSaleCount: 0,
        sales: [],
      },
    });

    expect(items).toEqual([]);
  });
});
