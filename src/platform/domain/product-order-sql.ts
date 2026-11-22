import { sql, type SQL } from 'drizzle-orm';

/**
 * SQL fragment for `order by`, for a products table aliased `alias`. Append secondary keys after it,
 * e.g. sql`order by ${productOrderSql('p')}, t.code`. Every column it names must also be in any
 * `group by` of the query.
 */
export function productOrderSql(alias: string): SQL {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) {
    throw new Error('productOrderSql needs a plain SQL alias');
  }
  return sql.raw(
    `${alias}.display_order asc nulls last, ` +
      `case ${alias}.kind when 'DIESEL' then 1 when 'D50' then 1 when 'PETROL' then 2 ` +
      `when 'BLEND' then 2 when 'GAS' then 3 else 4 end, ${alias}.name`,
  );
}
