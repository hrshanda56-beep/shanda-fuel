import { describe, expect, it } from 'vitest';
import {
  ApplicationStepUpError,
  NetworkStepUpError,
  classifyStepUpFailure,
  stepUpFailureMessage,
} from './staff-step-up-diagnostics';

describe('staff deactivation step-up diagnostics', () => {
  it('distinguishes Clerk cancellation from Clerk rejection', () => {
    expect(classifyStepUpFailure({ code: 'reverification_cancelled' })).toBe(
      'CLERK_REVERIFICATION_CANCELLED',
    );
    expect(classifyStepUpFailure(new Error('Clerk rejected reverification'))).toBe(
      'CLERK_REVERIFICATION_REJECTED',
    );
  });

  it('distinguishes application and network failures', () => {
    expect(classifyStepUpFailure(new ApplicationStepUpError())).toBe('APPLICATION_STEP_UP_FAILURE');
    expect(classifyStepUpFailure(new NetworkStepUpError())).toBe('NETWORK_FAILURE');
  });

  it('keeps failure messages explicit and free of diagnostic details', () => {
    expect(stepUpFailureMessage('APPLICATION_STEP_UP_FAILURE')).toBe(
      'The application rejected Owner step-up. No deactivation was submitted.',
    );
    expect(stepUpFailureMessage('NETWORK_FAILURE')).not.toContain('cookie');
    expect(stepUpFailureMessage('NETWORK_FAILURE')).not.toContain('token');
  });
});
