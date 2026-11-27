import { describe, expect, it } from 'vitest';

import {
  BLANK_TANK,
  answersFromTank,
  checkLimits,
  checkName,
  checkReminder,
  checkSentence,
  checkSize,
  deleteTankCommand,
  retireTankCommand,
  limitValues,
  plainNumber,
  reminderSentence,
  reorderLevel,
  reorderSuggestions,
  tankCommand,
  tankFuelMismatch,
  withSeparators,
  type TankAnswers,
} from './tank-wizard';

const answers = (patch: Partial<TankAnswers>): TankAnswers => ({ ...BLANK_TANK, ...patch });

describe('number display', () => {
  it('shows whole units without decimals', () => {
    expect(plainNumber('3200.000')).toBe('3200');
    expect(plainNumber('0.500')).toBe('0.5');
    expect(plainNumber('50')).toBe('50');
    expect(plainNumber(null)).toBe('');
  });

  it('groups thousands', () => {
    expect(withSeparators('40000.000')).toBe('40,000');
    expect(withSeparators('1234567')).toBe('1,234,567');
    expect(withSeparators('950')).toBe('950');
  });
});

describe('name and size', () => {
  it('needs a name that no other tank uses', () => {
    expect(checkName('', [])).toHaveProperty('name');
    expect(checkName('T1', ['t1'])).toHaveProperty('name');
    expect(checkName('T2', ['T1'])).toEqual({});
    expect(checkName('x'.repeat(33), [])).toHaveProperty('name');
  });

  it('needs a size above zero', () => {
    expect(checkSize('', 'litres')).toHaveProperty('capacity');
    expect(checkSize('0', 'litres')).toHaveProperty('capacity');
    expect(checkSize('abc', 'litres')).toHaveProperty('capacity');
    expect(checkSize('40,000', 'litres')).toEqual({});
  });
});

describe('the reminder', () => {
  it('suggests shares of the tank in whole units', () => {
    expect(reorderSuggestions('40000').map((s) => [s.percent, s.amount])).toEqual([
      [25, '10000'],
      [20, '8000'],
      [10, '4000'],
    ]);
    expect(reorderSuggestions('')).toEqual([]);
  });

  it('needs an answer, then a level', () => {
    expect(checkReminder(answers({}), 'litres')).toHaveProperty('remind');
    expect(checkReminder(answers({ remind: false }), 'litres')).toEqual({});
    expect(checkReminder(answers({ remind: true }), 'litres')).toHaveProperty('reorderChoice');
    expect(
      checkReminder(answers({ remind: true, reorderChoice: 'p25', capacity: '40000' }), 'litres'),
    ).toEqual({});
  });

  it('keeps an own level inside the tank', () => {
    const base = { remind: true, reorderChoice: 'own' as const, capacity: '40000' };
    expect(checkReminder(answers({ ...base, reorderOwn: '' }), 'litres')).toHaveProperty(
      'reorderOwn',
    );
    expect(checkReminder(answers({ ...base, reorderOwn: '50000' }), 'litres')).toHaveProperty(
      'reorderOwn',
    );
    expect(checkReminder(answers({ ...base, reorderOwn: '5000' }), 'litres')).toEqual({});
  });

  it('turns the answers into the stored level', () => {
    expect(reorderLevel(answers({ remind: false, capacity: '40000' }))).toBeNull();
    expect(reorderLevel(answers({ remind: true, reorderChoice: 'p20', capacity: '40000' }))).toBe(
      '8000',
    );
    expect(reorderLevel(answers({ remind: true, reorderChoice: 'own', reorderOwn: '3,200' }))).toBe(
      '3200',
    );
    expect(reorderLevel(answers({ remind: true, capacity: '40000' }))).toBeNull();
  });
});

describe('the difference check', () => {
  it('needs a choice', () => {
    expect(checkLimits(answers({}), 'litres')).toHaveProperty('limitMode');
    expect(checkLimits(answers({ limitMode: 'usual' }), 'litres')).toEqual({});
  });

  it('keeps the old rules for own limits: both set, urgent not below explain', () => {
    const own = { limitMode: 'own' as const };
    expect(checkLimits(answers({ ...own }), 'litres')).toEqual({
      explain: expect.any(String),
      urgent: expect.any(String),
    });
    expect(checkLimits(answers({ ...own, explain: '100', urgent: '50' }), 'litres')).toHaveProperty(
      'urgent',
    );
    expect(checkLimits(answers({ ...own, explain: '100', urgent: '300' }), 'litres')).toEqual({});
    expect(checkLimits(answers({ ...own, explain: '100', urgent: '100' }), 'litres')).toEqual({});
  });

  it('uses no limit of its own for the standard check', () => {
    expect(limitValues(answers({ limitMode: 'usual', explain: '100', urgent: '300' }))).toEqual({
      difference: null,
      red: null,
    });
    expect(limitValues(answers({ limitMode: 'own', explain: '100', urgent: '300' }))).toEqual({
      difference: '100',
      red: '300',
    });
  });
});

describe('changing a tank', () => {
  it('starts from what the tank has, in whole units', () => {
    const filled = answersFromTank({
      code: 'T2',
      capacityLitres: '40000.000',
      reorderLevelLitres: '3200.000',
      acceptableVarianceLitres: '50.000',
      varianceRedLitres: null,
    });
    expect(filled).toMatchObject({
      name: 'T2',
      capacity: '40000',
      remind: true,
      reorderOwn: '3200',
      limitMode: 'own',
      explain: '50',
    });
  });

  it('shows twice the first amount as the urgent amount when none was set', () => {
    const filled = answersFromTank({
      code: 'T2',
      capacityLitres: '40000.000',
      reorderLevelLitres: null,
      acceptableVarianceLitres: '50.000',
      varianceRedLitres: null,
    });
    expect(filled.urgent).toBe('100');
    expect(checkLimits(filled, 'litres')).toEqual({});
  });

  it('treats a tank with no limits as the standard check', () => {
    const filled = answersFromTank({
      code: 'T1',
      capacityLitres: '10000.000',
      reorderLevelLitres: null,
      acceptableVarianceLitres: null,
      varianceRedLitres: null,
    });
    expect(filled.limitMode).toBe('usual');
    expect(filled.remind).toBe(false);
  });
});

describe('the command that saves', () => {
  const finished = answers({
    name: 'Tank 3',
    capacity: '40000',
    remind: true,
    reorderChoice: 'p25',
    limitMode: 'usual',
  });
  const where = { tenantId: 't', stationId: 's', productId: 'p', existingCodes: ['TANK3'] };

  it('creates a tank with a code that is not taken', () => {
    expect(tankCommand({ answers: finished, ...where })).toEqual({
      commandType: 'CreateTank',
      tenantId: 't',
      stationId: 's',
      productId: 'p',
      code: 'TANK3-2',
      capacityLitres: '40000',
      reorderLevelLitres: '10000',
      acceptableVarianceLitres: null,
      varianceRedLitres: null,
    });
  });

  it('changes a tank without touching its fuel', () => {
    const command = tankCommand({ answers: finished, ...where, tankId: 'tank-1' });
    expect(command).toMatchObject({ commandType: 'UpdateTank', tankId: 'tank-1', code: 'Tank 3' });
    expect(command).not.toHaveProperty('productId');
  });
});

describe('the check screen wording', () => {
  it('says the standard check in plain words, with no colour names', () => {
    const text = checkSentence(answers({ limitMode: 'usual' }), 'litres');
    expect(text).toContain('0.5%');
    expect(text).toContain('1%');
    expect(text.toLowerCase()).not.toMatch(/yellow|red/);
  });

  it('says own limits and the reminder', () => {
    expect(
      checkSentence(answers({ limitMode: 'own', explain: '100', urgent: '1000' }), 'litres'),
    ).toBe('Explain differences over 100 litres; urgent over 1,000 litres');
    expect(
      reminderSentence(
        answers({ remind: true, reorderChoice: 'p25', capacity: '40000' }),
        'litres',
      ),
    ).toBe('Remind me when it falls to 10,000 litres');
    expect(reminderSentence(answers({ remind: false }), 'litres')).toBe('No reminder');
  });
});

describe('a tank put under the wrong fuel (#315)', () => {
  const diesel = { id: 'd', name: 'Diesel', kind: 'DIESEL' };
  const petrol = { id: 'p', name: 'Petrol', kind: 'PETROL' };
  const fuels = [diesel, petrol];

  it('warns when the name points to another fuel at the station', () => {
    expect(tankFuelMismatch('PETROL1', diesel, fuels)).toEqual({ id: 'p', name: 'Petrol' });
    expect(tankFuelMismatch('ULP tank', diesel, fuels)).toEqual({ id: 'p', name: 'Petrol' });
    expect(tankFuelMismatch('Unleaded 2', diesel, fuels)).toEqual({ id: 'p', name: 'Petrol' });
  });

  it('warns about a common fuel word before that fuel has been added', () => {
    expect(tankFuelMismatch('PETROL1', diesel, [diesel])).toEqual({ id: null, name: 'Petrol' });
  });

  it('says nothing when the name fits the fuel or names no fuel', () => {
    expect(tankFuelMismatch('DIESEL1', diesel, fuels)).toBeNull();
    expect(tankFuelMismatch('DSL main', diesel, fuels)).toBeNull();
    expect(tankFuelMismatch('Tank 1', diesel, fuels)).toBeNull();
    expect(tankFuelMismatch('T1', diesel, fuels)).toBeNull();
  });

  it('matches a fuel by its own name, not only common words', () => {
    const premium = { id: 'x', name: 'Premium', kind: 'PETROL' };
    expect(tankFuelMismatch('PREMIUM-A', diesel, [diesel, premium])).toEqual({
      id: 'x',
      name: 'Premium',
    });
  });
});

describe('moving or deleting an unused tank (#315)', () => {
  const finished = answers({
    name: 'PETROL1',
    capacity: '10000',
    remind: false,
    limitMode: 'usual',
  });
  const where = { tenantId: 't', stationId: 's', existingCodes: [] };

  it('sends the new fuel only when it changes', () => {
    const moved = tankCommand({
      answers: finished,
      ...where,
      tankId: 'tank-1',
      productId: 'petrol',
      currentProductId: 'diesel',
    });
    expect(moved).toMatchObject({ commandType: 'UpdateTank', productId: 'petrol' });
    const kept = tankCommand({
      answers: finished,
      ...where,
      tankId: 'tank-1',
      productId: 'diesel',
      currentProductId: 'diesel',
    });
    expect(kept).not.toHaveProperty('productId');
  });

  it('builds the stop-using command', () => {
    expect(retireTankCommand({ tenantId: 't', stationId: 's', tankId: 'tank-1' })).toEqual({
      commandType: 'RetireTank',
      tenantId: 't',
      stationId: 's',
      tankId: 'tank-1',
    });
  });

  it('builds the delete command', () => {
    expect(deleteTankCommand({ tenantId: 't', stationId: 's', tankId: 'tank-1' })).toEqual({
      commandType: 'DeleteTank',
      tenantId: 't',
      stationId: 's',
      tankId: 'tank-1',
    });
  });
});
