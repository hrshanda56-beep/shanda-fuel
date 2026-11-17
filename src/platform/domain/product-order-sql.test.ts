import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { productOrderSql } from './product-order-sql';

describe('productOrderSql', () => {
  const render = (alias: string) => new PgDialect().sqlToQuery(productOrderSql(alias)).sql;

  it('orders by display_order, kind rank, then name for the alias', () => {
    const text = render('p');
    expect(text).toContain('p.display_order asc nulls last');
    expect(text).toMatch(/case p\.kind when 'DIESEL' then 1 when 'D50' then 1/);
    expect(text.indexOf('p.display_order')).toBeLessThan(text.indexOf('case p.kind'));
    expect(text.indexOf('case p.kind')).toBeLessThan(text.lastIndexOf('p.name'));
  });

  it('rejects an alias that is not a plain identifier', () => {
    expect(() => productOrderSql('p; drop table x')).toThrow();
  });
});
