import { describe, expect, it } from 'vitest';

import { staffDeactivationResponseStatus } from '../../../modules/staff/revocation';

describe('staff deactivation response status', () => {
  it('returns success only when provider revocation completed', () => {
    expect(staffDeactivationResponseStatus({ sessionsRevoked: true })).toBe(200);
  });

  it('returns dependency failure when provider revocation did not complete', () => {
    expect(staffDeactivationResponseStatus({ sessionsRevoked: false })).toBe(503);
  });
});
