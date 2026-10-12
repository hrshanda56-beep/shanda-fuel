export type StepUpClientFailure =
  | 'CLERK_REVERIFICATION_CANCELLED'
  | 'CLERK_REVERIFICATION_REJECTED'
  | 'APPLICATION_STEP_UP_FAILURE'
  | 'NETWORK_FAILURE';

export class ApplicationStepUpError extends Error {
  readonly code = 'application_step_up_failure';

  constructor() {
    super('The application rejected Owner step-up');
    this.name = 'ApplicationStepUpError';
  }
}

export class NetworkStepUpError extends Error {
  readonly code = 'step_up_network_failure';

  constructor() {
    super('The step-up request could not reach the application');
    this.name = 'NetworkStepUpError';
  }
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export function classifyStepUpFailure(error: unknown): StepUpClientFailure {
  const code = errorCode(error);
  if (code === 'reverification_cancelled') return 'CLERK_REVERIFICATION_CANCELLED';
  if (code === 'application_step_up_failure') return 'APPLICATION_STEP_UP_FAILURE';
  if (code === 'step_up_network_failure') return 'NETWORK_FAILURE';
  return 'CLERK_REVERIFICATION_REJECTED';
}

export function stepUpFailureMessage(failure: StepUpClientFailure): string {
  switch (failure) {
    case 'CLERK_REVERIFICATION_CANCELLED':
      return 'Owner reverification was cancelled. No deactivation was submitted.';
    case 'CLERK_REVERIFICATION_REJECTED':
      return 'Clerk could not complete Owner reverification. No deactivation was submitted.';
    case 'APPLICATION_STEP_UP_FAILURE':
      return 'The application rejected Owner step-up. No deactivation was submitted.';
    case 'NETWORK_FAILURE':
      return 'The step-up request could not reach the application. No deactivation was submitted.';
  }
}
