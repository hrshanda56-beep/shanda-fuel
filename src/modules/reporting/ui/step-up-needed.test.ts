import { describe, expect, it } from 'vitest';

import { stepUpIsNeeded } from './step-up-needed';

describe('stepUpIsNeeded', () => {
  it('recognises both ways the server asks for a fresh identity check', () => {
    expect(stepUpIsNeeded(403, 'Strong authentication is required for this action')).toBe(true);
    expect(
      stepUpIsNeeded(403, 'A current step-up authentication is required for this action'),
    ).toBe(true);
  });
  it('does not turn other refusals into a prompt', () => {
    expect(stepUpIsNeeded(403, 'You are not allowed to export this report')).toBe(false);
    expect(stepUpIsNeeded(401, 'Strong authentication is required for this action')).toBe(false);
    expect(stepUpIsNeeded(500, 'Step-up authentication failed')).toBe(false);
  });
});
