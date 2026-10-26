import { describe, expect, it } from 'vitest';
import { OPENING_BALANCE_CSV_HEADERS, parseCsvRecords, parseOpeningBalanceCsv } from './domain';

const header = OPENING_BALANCE_CSV_HEADERS.join(',');

function row(
  values: Partial<Record<(typeof OPENING_BALANCE_CSV_HEADERS)[number], string>>,
): string {
  return OPENING_BALANCE_CSV_HEADERS.map((key) => {
    const value = values[key] ?? '';
    return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  }).join(',');
}

describe('opening balance CSV import', () => {
  it('parses all supported domains with exact decimal values', () => {
    const csv = [
      header,
      row({
        line_key: 'supplier-001',
        line_type: 'SUPPLIER_INVOICE',
        legal_entity_reference: 'Shanda Fuel Ltd',
        supplier_code: 'SUP-001',
        reference: 'INV-1001',
        effective_date: '2026-10-01',
        due_date: '2026-10-31',
        amount: '1234.5678',
        currency: 'USD',
      }),
      row({
        line_key: 'customer-001',
        line_type: 'CUSTOMER_CHARGE',
        customer_reference: 'CUST-001',
        account_reference: 'CUST-001',
        reference: 'CHARGE-001',
        effective_date: '2026-10-01',
        amount: '99.1000',
        currency: 'USD',
      }),
      row({
        line_key: 'cash-001',
        line_type: 'CASH_BALANCE',
        station_code: 'ST-001',
        cash_location_code: 'TILL-1',
        effective_date: '2026-10-01',
        amount: '500.0000',
        currency: 'USD',
      }),
      row({
        line_key: 'bank-001',
        line_type: 'BANK_BALANCE',
        legal_entity_reference: 'Shanda Fuel Ltd',
        bank_account_name: 'Operating USD',
        effective_date: '2026-10-01',
        amount: '0.0000',
        currency: 'USD',
      }),
      row({
        line_key: 'tank-001',
        line_type: 'TANK_STOCK',
        station_code: 'ST-001',
        tank_code: 'DIESEL-1',
        effective_date: '2026-10-01',
        quantity_litres: '1250.500',
        inventory_value: '1875.7500',
        currency: 'USD',
      }),
    ].join('\n');

    const result = parseOpeningBalanceCsv(csv);

    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(5);
    expect(result.rows[0]).toMatchObject({ amount: '1234.5678', dueDate: '2026-10-31' });
    expect(result.rows[3]).toMatchObject({ amount: '0.0000', lineType: 'BANK_BALANCE' });
    expect(result.rows[4]).toMatchObject({
      quantityLitres: '1250.500',
      inventoryValue: '1875.7500',
    });
  });

  it('supports quoted commas and escaped quotes in notes', () => {
    const csv = `${header}\n${row({
      line_key: 'cash-quoted',
      line_type: 'CASH_BALANCE',
      station_code: 'ST-001',
      cash_location_code: 'SAFE-1',
      effective_date: '2026-10-01',
      amount: '10',
      currency: 'USD',
      notes: 'Counted, reconciled, and marked "opening"',
    })}`;

    const result = parseOpeningBalanceCsv(csv);

    expect(result.issues).toEqual([]);
    expect(result.rows[0]?.notes).toBe('Counted, reconciled, and marked "opening"');
  });

  it('rejects duplicate keys, unsupported currency, invalid dates, and missing facts', () => {
    const csv = [
      header,
      row({
        line_key: 'duplicate',
        line_type: 'BANK_BALANCE',
        legal_entity_reference: 'Shanda Fuel Ltd',
        bank_account_name: 'Operating USD',
        effective_date: '2026-02-30',
        amount: '1.00000',
        currency: 'ZAR',
      }),
      row({
        line_key: 'duplicate',
        line_type: 'TANK_STOCK',
        station_code: 'ST-001',
        tank_code: 'DIESEL-1',
        effective_date: '2026-10-01',
        quantity_litres: '0',
        currency: 'USD',
      }),
    ].join('\n');

    const result = parseOpeningBalanceCsv(csv);
    const messages = result.issues.map((issue) => issue.message);

    expect(messages).toEqual(
      expect.arrayContaining([
        "line_key 'duplicate' is duplicated.",
        'effective_date must be a real YYYY-MM-DD date.',
        'Only USD is supported for go-live opening balances.',
        'amount has too many digits.',
        'quantity_litres must be greater than zero.',
      ]),
    );
  });

  it('rejects malformed CSV quoting before resolving any rows', () => {
    const parsed = parseCsvRecords(`${header}\n"not closed`);

    expect(parsed.records).toHaveLength(1);
    expect(parsed.issues).toEqual([
      expect.objectContaining({ message: 'The CSV has an unterminated quoted field.' }),
    ]);
  });
});
