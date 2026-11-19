import { describe, expect, it } from 'vitest';
import {
  assessDeliveryVariance,
  checkLossRecovery,
  missingExplanation,
} from './variance-assessment';

const half = { absolute: null, percent: '0.5' };
const none = { absolute: null, percent: null };

function assess(over: Partial<Parameters<typeof assessDeliveryVariance>[0]> = {}) {
  return assessDeliveryVariance({
    noteLitres: '10000',
    receivedLitres: '9888',
    shortageTolerance: half,
    excessTolerance: half,
    dipTolerance: half,
    ...over,
  });
}

describe('assessDeliveryVariance', () => {
  it('works out the shortage on the sample note (10000 on the note, 9888 received)', () => {
    const result = assess();
    expect(result.noteVarianceLitres).toBe('-112');
    expect(result.noteVariance).toBe('SHORT');
    expect(result.allowedNoteLitres).toBe('50');
    expect(result.noteOutOfTolerance).toBe(true);
    expect(result.causeRequired).toBe(true);
  });

  it('needs no explanation inside the allowance, and at exactly the allowance', () => {
    expect(assess({ receivedLitres: '9960' }).causeRequired).toBe(false);
    expect(assess({ receivedLitres: '9950' }).causeRequired).toBe(false);
    expect(assess({ receivedLitres: '9949' }).causeRequired).toBe(true);
  });

  it('flags an excess against its own allowance', () => {
    const result = assess({ receivedLitres: '10100', excessTolerance: none });
    expect(result.noteVariance).toBe('OVER');
    expect(result.causeRequired).toBe(true);
  });

  it('treats a matching delivery as fine, even with no tolerance configured', () => {
    const result = assess({
      receivedLitres: '10000',
      shortageTolerance: none,
      excessTolerance: none,
    });
    expect(result.noteVariance).toBe('OK');
    expect(result.causeRequired).toBe(false);
  });

  it('compares the dips with the litres received', () => {
    const result = assess({
      receivedLitres: '9888',
      dipBeforeLitres: '94',
      dipAfterLitres: '9983',
    });
    expect(result.dipMeasuredLitres).toBe('9889');
    expect(result.dipVarianceLitres).toBe('1');
    expect(result.dipOutOfTolerance).toBe(false);
  });

  it('flags a dip that disagrees with what was received, even when the note matches', () => {
    const result = assess({
      noteLitres: '9888',
      receivedLitres: '9888',
      dipBeforeLitres: '1000',
      dipAfterLitres: '10000',
    });
    expect(result.noteOutOfTolerance).toBe(false);
    expect(result.dipOutOfTolerance).toBe(true);
    expect(result.causeRequired).toBe(true);
  });

  it('skips the dip check unless both dips are given', () => {
    const result = assess({ dipBeforeLitres: '94', dipAfterLitres: null });
    expect(result.dipMeasuredLitres).toBeNull();
    expect(result.dipOutOfTolerance).toBe(false);
  });

  it('shows the order difference without making it a reason to explain', () => {
    const result = assess({ noteLitres: '9888', receivedLitres: '9888', orderedLitres: '10000' });
    expect(result.orderVarianceLitres).toBe('-112');
    expect(result.causeRequired).toBe(false);
  });

  it('keeps exact decimals', () => {
    const result = assess({ noteLitres: '1000.001', receivedLitres: '1000.000' });
    expect(result.noteVarianceLitres).toBe('-0.001');
  });
});

describe('missingExplanation', () => {
  it('asks for a cause only when one is needed', () => {
    expect(missingExplanation({ causeRequired: false }, {})).toBeNull();
    expect(missingExplanation({ causeRequired: true }, {})).toMatch(/Say why/);
    expect(missingExplanation({ causeRequired: true }, { cause: 'TEMPERATURE' })).toBeNull();
  });

  it('wants words when the cause is "something else"', () => {
    expect(missingExplanation({ causeRequired: true }, { cause: 'OTHER', note: '  ' })).toMatch(
      /few words/,
    );
    expect(
      missingExplanation({ causeRequired: true }, { cause: 'OTHER', note: 'Hose burst' }),
    ).toBeNull();
  });
});

describe('checkLossRecovery', () => {
  it('accepts no claim at all', () => {
    expect(checkLossRecovery({ liableParty: 'NONE', status: 'NONE', amount: null })).toBeNull();
  });

  it('wants a responsible party for a claim, and a status for a party', () => {
    expect(checkLossRecovery({ liableParty: 'NONE', status: 'RAISED', amount: null })).toMatch(
      /who is responsible/,
    );
    expect(checkLossRecovery({ liableParty: 'DRIVER', status: 'NONE', amount: null })).toMatch(
      /what happened/,
    );
  });

  it('needs an amount to settle, and only then', () => {
    expect(checkLossRecovery({ liableParty: 'DRIVER', status: 'SETTLED', amount: null })).toMatch(
      /amount/,
    );
    expect(checkLossRecovery({ liableParty: 'DRIVER', status: 'SETTLED', amount: '0' })).toMatch(
      /amount/,
    );
    expect(
      checkLossRecovery({ liableParty: 'DRIVER', status: 'SETTLED', amount: '150.50' }),
    ).toBeNull();
    expect(checkLossRecovery({ liableParty: 'DRIVER', status: 'RAISED', amount: '10' })).toMatch(
      /only kept/,
    );
    expect(
      checkLossRecovery({ liableParty: 'TRANSPORTER', status: 'WRITTEN_OFF', amount: null }),
    ).toBeNull();
  });
});
