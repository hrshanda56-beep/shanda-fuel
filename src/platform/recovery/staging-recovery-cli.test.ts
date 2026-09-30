import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../../scripts/staging-recovery-rehearsal';

const commonArguments = [
  '--environment',
  'staging',
  '--target-label',
  'isolated-staging',
  '--target-app-url',
  'https://recovery.example.test',
  '--state-file',
  '/tmp/recovery-start.json',
  '--evidence-file',
  '/tmp/recovery-evidence.json',
  '--confirm-recovery-rehearsal',
];

describe('staging recovery rehearsal CLI parsing', () => {
  it('rejects unknown options without reflecting the option or value', () => {
    const unknownOption = '--unknown-recovery-option';
    const secretLikeValue = 'session-token=must-not-appear';

    expect(() => parseArgs([...commonArguments, unknownOption, secretLikeValue])).toThrow(
      'Unknown command-line option.',
    );

    try {
      parseArgs([...commonArguments, unknownOption, secretLikeValue]);
    } catch (error) {
      expect(error).toMatchObject({ message: 'Unknown command-line option.' });
      expect(String(error)).not.toContain(unknownOption);
      expect(String(error)).not.toContain(secretLikeValue);
    }
  });

  it('parses normal start and complete arguments', () => {
    expect(
      parseArgs([
        ...commonArguments,
        '--phase',
        'start',
        '--last-known-good-at',
        '2026-09-30T10:00:00.000Z',
        '--run-id',
        'recovery-run-123',
      ]),
    ).toMatchObject({
      phase: 'start',
      environment: 'staging',
      targetLabel: 'isolated-staging',
      targetAppUrl: 'https://recovery.example.test',
      lastKnownGoodAt: '2026-09-30T10:00:00.000Z',
      runId: 'recovery-run-123',
      confirmed: true,
    });

    expect(
      parseArgs([
        ...commonArguments,
        '--phase',
        'complete',
        '--recovered-through-at',
        '2026-09-30T10:05:00.000Z',
      ]),
    ).toMatchObject({
      phase: 'complete',
      environment: 'staging',
      targetLabel: 'isolated-staging',
      targetAppUrl: 'https://recovery.example.test',
      recoveredThroughAt: '2026-09-30T10:05:00.000Z',
      confirmed: true,
    });
  });
});
