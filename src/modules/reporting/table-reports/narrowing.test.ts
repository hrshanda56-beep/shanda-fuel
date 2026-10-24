import { describe, expect, it } from 'vitest';
import { applyNarrowing, parseNarrowing } from './narrowing';
import { TABLE_REPORTS } from './definitions';

describe('report narrowing in the address', () => {
  it('reads only the filters the report understands', () => {
    const params = new URLSearchParams('productId=p&supplierId=s&employeeId=');
    expect(parseNarrowing(params, ['product'])).toEqual({ productId: 'p' });
    expect(parseNarrowing(params, ['product', 'supplier', 'employee'])).toEqual({
      productId: 'p',
      supplierId: 's',
    });
  });

  it('replaces earlier choices and keeps unrelated parts of the address', () => {
    const base = new URLSearchParams('tenantId=t&productId=old&supplierId=x');
    const next = applyNarrowing(base, { product: 'new' });
    expect(next.get('productId')).toBe('new');
    expect(next.get('supplierId')).toBeNull();
    expect(next.get('tenantId')).toBe('t');
  });

  it('is declared on the reports that need it', () => {
    const filters = (slug: string) => TABLE_REPORTS.find((r) => r.slug === slug)?.filters ?? [];
    expect(filters('sales-by-attendant')).toEqual(['shift', 'employee']);
    expect(filters('purchases')).toContain('supplier');
    expect(filters('supplier-payments')).toEqual(['supplier']);
  });
});
