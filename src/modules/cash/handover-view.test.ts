import { describe, expect, it } from 'vitest';
import { availableHandoverActions, describeHandover, handoverTone } from './handover-view';

const viewer = { membershipId: 'me', canAccept: true, canResolve: true, canSubmit: true };

describe('availableHandoverActions', () => {
  it('lets a receiver accept cash someone else handed over', () => {
    expect(
      availableHandoverActions({ state: 'SUBMITTED', deliveredByMembershipId: 'x' }, viewer),
    ).toEqual(['accept', 'withdraw']);
  });

  it('never offers accept or resolve on your own handover', () => {
    expect(
      availableHandoverActions({ state: 'SUBMITTED', deliveredByMembershipId: 'me' }, viewer),
    ).toEqual(['withdraw']);
    expect(
      availableHandoverActions({ state: 'DISPUTED', deliveredByMembershipId: 'me' }, viewer),
    ).toEqual(['withdraw']);
  });

  it('offers settling only for a handover that does not add up', () => {
    expect(
      availableHandoverActions({ state: 'DISPUTED', deliveredByMembershipId: 'x' }, viewer),
    ).toEqual(['resolve', 'withdraw']);
  });

  it('gives a plain attendant no buttons on other people’s handovers', () => {
    const attendant = { membershipId: 'me', canAccept: false, canResolve: false, canSubmit: true };
    expect(
      availableHandoverActions({ state: 'SUBMITTED', deliveredByMembershipId: 'x' }, attendant),
    ).toEqual([]);
    expect(
      availableHandoverActions({ state: 'SUBMITTED', deliveredByMembershipId: 'me' }, attendant),
    ).toEqual(['withdraw']);
  });

  it('offers nothing once a handover is finished', () => {
    for (const state of ['ACCEPTED', 'RESOLVED', 'CANCELLED']) {
      expect(availableHandoverActions({ state, deliveredByMembershipId: 'x' }, viewer)).toEqual([]);
    }
  });
});

describe('wording', () => {
  it('colours states by what needs attention', () => {
    expect(handoverTone('DISPUTED')).toBe('critical');
    expect(handoverTone('SUBMITTED')).toBe('pending');
    expect(handoverTone('RESOLVED')).toBe('positive');
    expect(handoverTone('CANCELLED')).toBe('neutral');
  });

  it('names who handed over and who received', () => {
    const base = { from: 'Till', to: 'Safe', deliveredByName: 'Tendai', receivedByName: 'Rudo' };
    expect(describeHandover({ ...base, state: 'SUBMITTED' })).toBe(
      'Tendai handed cash from Till to Safe.',
    );
    expect(describeHandover({ ...base, state: 'ACCEPTED' })).toBe(
      'Tendai handed cash from Till to Safe. Received by Rudo.',
    );
  });
});
