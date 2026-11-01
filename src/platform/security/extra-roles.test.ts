import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_CODES, ROLE_CODES } from './permissions';

/**
 * D2: Auditor, Area Manager and Cash Collector. The sets are stated here in full so a change to
 * any of them is a visible, reviewed change (the same sets are written in migration 0094 and
 * compared with the database in an integration test).
 */
const isViewPermission = (code: string) =>
  code === 'tenant.context.select' || /\.view(\.|$)/.test(code);

describe('the extra roles (D2)', () => {
  it('lists them next to the original five', () => {
    expect([...ROLE_CODES]).toEqual([
      'OWNER',
      'ADMINISTRATOR',
      'FINANCE',
      'SUPERVISOR',
      'ATTENDANT',
      'AUDITOR',
      'AREA_MANAGER',
      'CASH_COLLECTOR',
    ]);
  });

  it('gives the auditor every view permission and nothing that acts', () => {
    const auditor = DEFAULT_ROLE_PERMISSIONS.AUDITOR;
    expect(auditor.length).toBeGreaterThan(20);
    expect(auditor.filter((code) => !isViewPermission(code))).toEqual([]);
    expect([...auditor].sort()).toEqual(PERMISSION_CODES.filter(isViewPermission).sort());
    // Nothing that changes, approves, records or exports.
    for (const forbidden of [
      'report.export',
      'reconciliation.submit',
      'reconciliation.approve',
      'expense.approve',
      'price.change.prepare',
      'cash.deposit.confirm',
      'membership.invite',
    ] as const) {
      expect(auditor).not.toContain(forbidden);
    }
  });

  it('gives the area manager the supervisor permissions plus the finance reports', () => {
    const supervisor = DEFAULT_ROLE_PERMISSIONS.SUPERVISOR;
    const manager = DEFAULT_ROLE_PERMISSIONS.AREA_MANAGER;
    for (const code of supervisor) expect(manager).toContain(code);
    expect(manager).toContain('report.finance.view');
    expect(manager.filter((code) => !supervisor.includes(code))).toEqual(['report.finance.view']);
  });

  it('gives the cash collector only what receiving and handing on cash needs', () => {
    expect([...DEFAULT_ROLE_PERMISSIONS.CASH_COLLECTOR].sort()).toEqual(
      [
        'tenant.context.select',
        'station.view',
        'cash.collection.view',
        'cash.collection.receive',
        'cash.handover.submit',
        'cash.handover.accept',
        'cash.deposit.view',
      ].sort(),
    );
  });

  it('keeps an attendant unable to change prices or see finance, unchanged', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.ATTENDANT).not.toContain('price.change.prepare');
    expect(DEFAULT_ROLE_PERMISSIONS.ATTENDANT).not.toContain('report.finance.view');
  });
});
