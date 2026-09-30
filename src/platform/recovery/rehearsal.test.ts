import { describe, expect, it } from 'vitest';
import {
  calculateRpo,
  createRecoveryEvidence,
  createRecoveryStartState,
  RecoveryRehearsalError,
  validateRecoveryAppTarget,
  validateRecoveryTarget,
} from './rehearsal';

const tenantA = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  stationId: '22222222-2222-4222-8222-222222222222',
};
const tenantB = {
  tenantId: '33333333-3333-4333-8333-333333333333',
  stationId: '44444444-4444-4444-8444-444444444444',
};
const validInput = {
  appEnvironment: 'staging',
  targetEnvironment: 'staging',
  targetLabel: 'isolated-staging',
  appUrl: 'https://recovery-preview.example.test',
  databaseUrl: 'postgresql://recovery.invalid/shanda_fuel_staging',
  sessionCookie: 'shanda-fuel.session_token=opaque',
  tenantA,
  tenantB,
};

describe('staging recovery rehearsal targeting', () => {
  it('requires an explicit isolated staging target', () => {
    expect(() =>
      validateRecoveryAppTarget({ ...validInput, appEnvironment: 'production' }),
    ).toThrow(RecoveryRehearsalError);
    expect(() => validateRecoveryAppTarget({ ...validInput, targetLabel: 'staging' })).toThrow(
      'isolated-staging',
    );
    expect(() =>
      validateRecoveryAppTarget({ ...validInput, appUrl: 'https://production.example.test' }),
    ).toThrow('production');
  });

  it('rejects production-looking database targets and same-tenant controls', () => {
    expect(() =>
      validateRecoveryTarget({ ...validInput, databaseUrl: 'postgresql://prod-db.invalid/app' }),
    ).toThrow('production');
    expect(() =>
      validateRecoveryTarget({
        ...validInput,
        tenantB: { ...tenantB, tenantId: tenantA.tenantId },
      }),
    ).toThrow('must differ');
  });

  it('rejects URLs that could conceal a different target', () => {
    for (const appUrl of [
      'http://recovery-preview.example.test',
      'https://user:secret@recovery-preview.example.test',
      'https://recovery-preview.example.test/path',
      'https://recovery-preview.example.test?database=production',
    ]) {
      expect(() => validateRecoveryAppTarget({ ...validInput, appUrl })).toThrow();
    }
  });
});

describe('recovery timing evidence', () => {
  it('computes a bounded RPO from known timestamps', () => {
    expect(
      calculateRpo({
        lastKnownGoodAt: '2026-09-30T10:15:00.000Z',
        recoveredThroughAt: '2026-09-30T10:00:00.000Z',
      }),
    ).toMatchObject({
      measurement: 'bounded',
      upperBoundSeconds: 900,
      targetSeconds: 900,
      withinTarget: true,
    });
  });

  it('records RTO and safe evidence without credentials or data bodies', () => {
    const target = validateRecoveryTarget(validInput);
    const state = createRecoveryStartState({
      target,
      runId: 'rehearsal-001',
      lastKnownGoodAt: '2026-09-30T10:00:00.000Z',
      startedAt: '2026-09-30T10:01:00.000Z',
    });
    const evidence = createRecoveryEvidence({
      state,
      endedAt: '2026-09-30T10:04:02.000Z',
      recoveredThroughAt: '2026-09-30T10:00:00.000Z',
      database: {
        status: 'passed',
        readOnlyTransaction: true,
        expectedTables: 5,
        availableTables: 5,
        tenantRows: 2,
        stationRows: 2,
      },
      application: {
        status: 'passed',
        checks: [{ name: 'tenant-a-access', status: 'passed' }],
      },
      objectStorage: {
        status: 'passed',
        backupId: 'backup-001',
        sha256: 'a'.repeat(64),
        byteLength: 32,
      },
    });

    expect(evidence).toMatchObject({
      pass: true,
      rtoSeconds: 182,
      rto: { measuredSeconds: 182, targetSeconds: 14_400, withinTarget: true },
      rpo: { withinTarget: true },
    });
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain('opaque');
    expect(serialized).not.toContain('postgresql://');
    expect(serialized).not.toContain('recovery-preview.example.test/path');
  });

  it('retains a measured RPO miss while failing the overall result', () => {
    const target = validateRecoveryTarget(validInput);
    const state = createRecoveryStartState({
      target,
      runId: 'rpo-miss-001',
      lastKnownGoodAt: '2026-09-30T10:30:00.000Z',
      startedAt: '2026-09-30T10:31:00.000Z',
    });
    const evidence = createRecoveryEvidence({
      state,
      endedAt: '2026-09-30T10:34:02.000Z',
      recoveredThroughAt: '2026-09-30T10:00:00.000Z',
      database: {
        status: 'passed',
        readOnlyTransaction: true,
        expectedTables: 5,
        availableTables: 5,
      },
      application: { status: 'passed', checks: [] },
      objectStorage: { status: 'passed', backupId: 'backup-rpo-miss', sha256: 'b'.repeat(64) },
    });

    expect(evidence.pass).toBe(false);
    expect(evidence.rpo).toMatchObject({
      upperBoundSeconds: 1_800,
      targetSeconds: 900,
      withinTarget: false,
    });
    expect(evidence.rto.measuredSeconds).toBe(182);
  });

  it('retains a measured RTO miss while failing the overall result', () => {
    const target = validateRecoveryTarget(validInput);
    const state = createRecoveryStartState({
      target,
      runId: 'rto-miss-001',
      lastKnownGoodAt: '2026-09-30T10:00:00.000Z',
      startedAt: '2026-09-30T10:01:00.000Z',
    });
    const evidence = createRecoveryEvidence({
      state,
      endedAt: '2026-09-30T14:02:01.000Z',
      recoveredThroughAt: '2026-09-30T10:00:00.000Z',
      database: {
        status: 'passed',
        readOnlyTransaction: true,
        expectedTables: 5,
        availableTables: 5,
      },
      application: { status: 'passed', checks: [] },
      objectStorage: { status: 'passed', backupId: 'backup-rto-miss', sha256: 'c'.repeat(64) },
    });

    expect(evidence.pass).toBe(false);
    expect(evidence.rto).toMatchObject({
      measuredSeconds: 14_461,
      targetSeconds: 14_400,
      withinTarget: false,
    });
    expect(evidence.rpo.withinTarget).toBe(true);
  });

  it('rejects a recovery point later than rehearsal completion', () => {
    const target = validateRecoveryTarget(validInput);
    const state = createRecoveryStartState({
      target,
      runId: 'impossible-point-001',
      lastKnownGoodAt: '2026-09-30T10:00:00.000Z',
      startedAt: '2026-09-30T10:01:00.000Z',
    });

    expect(() =>
      createRecoveryEvidence({
        state,
        endedAt: '2026-09-30T10:04:02.000Z',
        recoveredThroughAt: '2026-09-30T10:04:03.000Z',
        database: {
          status: 'passed',
          readOnlyTransaction: true,
          expectedTables: 5,
          availableTables: 5,
        },
        application: { status: 'passed', checks: [] },
        objectStorage: { status: 'passed', backupId: 'backup-impossible', sha256: 'd'.repeat(64) },
      }),
    ).toThrow('cannot be after');
  });
});
