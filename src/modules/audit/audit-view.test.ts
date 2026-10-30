import { describe, expect, it } from 'vitest';
import { describeAction, diffAudit, toAuditItem } from './audit-view';

describe('describeAction', () => {
  it('reads codes in either style as plain words', () => {
    expect(describeAction('CASH.SubmitCashHandover')).toEqual({
      area: 'Cash',
      action: 'Cash: submit cash handover',
    });
    expect(describeAction('INVENTORY.TANK_DIP_RECORDED')).toEqual({
      area: 'Fuel and stock',
      action: 'Fuel and stock: tank dip recorded',
    });
    expect(describeAction('LOGIN')).toEqual({ area: 'General', action: 'Login' });
  });

  it('uses the same plain area names as the filter, never the internal ones (C4)', () => {
    expect(describeAction('FORECOURT.OpenBusinessDay').action).toBe(
      'Daily operations: open business day',
    );
    expect(describeAction('SETTLEMENT.Confirm').area).toBe('Card and mobile payments');
    expect(describeAction('SETUP.SaveTank').area).toBe('Station setup');
    expect(describeAction('FORECOURT.OpenBusinessDay').action).not.toContain('Forecourt');
  });
});

describe('diffAudit', () => {
  it('lists only the fields that changed, nested ones included', () => {
    expect(
      diffAudit(
        { price: '1.50', limits: { daily: '100', weekly: '500' }, status: 'ACTIVE' },
        { price: '1.60', limits: { daily: '100', weekly: '400' }, status: 'ACTIVE' },
      ),
    ).toEqual([
      { field: 'Price', before: '1.50', after: '1.60' },
      { field: 'Limits weekly', before: '500', after: '400' },
    ]);
  });

  it('shows every new value when nothing came before', () => {
    expect(diffAudit(undefined, { amount: '12.00', note: '' })).toEqual([
      { field: 'Amount', before: null, after: '12.00' },
    ]);
  });

  it('shows removed fields', () => {
    expect(diffAudit({ creditLimit: '1000' }, { creditLimit: null })).toEqual([
      { field: 'Credit limit', before: '1000', after: null },
    ]);
  });

  it('never shows secrets', () => {
    const changes = diffAudit({ apiKey: 'abc', pin: '1' }, { apiKey: 'xyz', pin: '1' });
    expect(changes).toEqual([{ field: 'Api key', before: 'Hidden', after: 'Hidden' }]);
    expect(JSON.stringify(changes)).not.toContain('abc');
  });

  it('caps a very long list', () => {
    const after = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`f${i}`, String(i)]));
    expect(diffAudit({}, after)).toHaveLength(40);
  });
});

describe('toAuditItem', () => {
  it('builds a readable item', () => {
    const item = toAuditItem({
      id: 'e1',
      eventCode: 'SUPPLIER.SUPPLIER_CREDIT_LIMIT_SET',
      occurredAt: '2026-10-21T08:00:00.000Z',
      actorName: ' Rudo ',
      details: {
        subjectType: 'Supplier',
        subjectId: '11111111-2222-3333-4444-555555555555',
        before: { creditLimit: '100' },
        after: { creditLimit: '200' },
        reason: 'Renegotiated',
      },
    });
    expect(item).toMatchObject({
      who: 'Rudo',
      area: 'Supplier',
      subject: 'Supplier',
      reason: 'Renegotiated',
      created: false,
      changes: [{ field: 'Credit limit', before: '100', after: '200' }],
    });
  });

  it('copes with a record that has no details', () => {
    expect(
      toAuditItem({
        id: 'e2',
        eventCode: 'AUTH.LOGIN',
        occurredAt: '2026-10-21T08:00:00.000Z',
        actorName: null,
        details: null,
      }),
    ).toMatchObject({ who: 'Unknown person', changes: [], created: true, subject: null });
  });

  it('names what the event touched when the name is known', () => {
    const id = '11111111-2222-3333-4444-555555555555';
    const item = toAuditItem(
      {
        id: 'e3',
        eventCode: 'STATION.UPDATED',
        occurredAt: '2026-10-21T08:00:00.000Z',
        actorName: 'Rudo',
        details: { subjectType: 'Station', subjectId: id },
      },
      new Map([[`Station:${id}`, 'Bindura']]),
    );
    expect(item.subject).toBe('Station Bindura');
  });

  it('keeps a short reference but never shows a cut-off machine id', () => {
    const base = {
      id: 'e4',
      eventCode: 'X.Y',
      occurredAt: '2026-10-21T08:00:00.000Z',
      actorName: 'R',
    };
    expect(
      toAuditItem({ ...base, details: { subjectType: 'Supplier', subjectId: 'SUP-001' } }).subject,
    ).toBe('Supplier SUP-001');
    expect(
      toAuditItem({
        ...base,
        details: { subjectType: 'Station', subjectId: '11111111-2222-3333-4444-555555555555' },
      }).subject,
    ).toBe('Station');
  });
});

describe('names instead of identifiers', () => {
  it('turns an identifier value into the name of what it points at, or a plain word', async () => {
    const { nameChangeValues } = await import('./audit-view');
    const id = '11111111-2222-4333-8444-555555555555';
    const other = '66666666-7777-4888-8999-aaaaaaaaaaaa';
    const changes = nameChangeValues(
      [
        { field: 'Product id', before: other, after: id },
        { field: 'Unit price', before: '1.9500', after: '1.9900' },
        { field: 'Note', before: null, after: 'raised' },
      ],
      new Map([[id, 'Diesel']]),
    );
    expect(changes).toEqual([
      { field: 'Product', before: 'A record', after: 'Diesel' },
      { field: 'Unit price', before: '1.9500', after: '1.9900' },
      { field: 'Note', before: null, after: 'raised' },
    ]);
    // With no names at all an identifier still never shows.
    expect(nameChangeValues([{ field: 'Station id', before: null, after: id }])[0]?.after).toBe(
      'A record',
    );
  });
});
