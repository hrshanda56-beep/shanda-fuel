import { describe, expect, it } from 'vitest';
import {
  isCompleteOwnerDemoFixture,
  type OwnerDemoFixtureSummary,
} from '../../../scripts/demo/owner-demo-fixture';

const completeFixture: OwnerDemoFixtureSummary = {
  stationId: 'bindura-id',
  stationTotalCount: '4',
  stationCount: '4',
  membershipStatus: 'ACTIVE',
  credentialAccountCount: '1',
  ownerScopeCount: '5',
  ownerTenantScopeCount: '1',
  ownerStationCodes: ['ARCTURUS', 'BINDURA', 'GAZEBO', 'MARUTA'],
  postedSaleCount: '1',
  saleMarkerCount: '1',
};

describe('owner-demo fixture completeness', () => {
  it('accepts only the complete canonical fixture', () => {
    expect(isCompleteOwnerDemoFixture([completeFixture])).toBe(true);
  });

  it.each([
    ['missing posted sale', { postedSaleCount: '0' }],
    ['missing credential account', { credentialAccountCount: '0' }],
    ['incomplete owner scopes', { ownerScopeCount: '4' }],
    [
      'duplicate or missing station scope',
      { ownerStationCodes: ['BINDURA', 'BINDURA', 'GAZEBO', 'MARUTA'] },
    ],
    ['inactive membership', { membershipStatus: 'SUSPENDED' }],
    ['missing station', { stationId: null }],
    ['unrelated posted sale', { saleMarkerCount: '0' }],
  ])('rejects %s without treating it as idempotent', (_label, change) => {
    expect(isCompleteOwnerDemoFixture([{ ...completeFixture, ...change }])).toBe(false);
  });

  it('rejects duplicate matching rows', () => {
    expect(isCompleteOwnerDemoFixture([completeFixture, completeFixture])).toBe(false);
  });
});
