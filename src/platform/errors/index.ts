export type AppErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  /** The person may do this but must confirm their identity first. Shown as a check, not a refusal. */
  | 'STEP_UP_REQUIRED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVARIANT_VIOLATION'
  | 'IDEMPOTENCY_CONFLICT'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'INTERNAL_ERROR';

const httpStatusByCode: Record<AppErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  STEP_UP_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVARIANT_VIOLATION: 422,
  IDEMPOTENCY_CONFLICT: 409,
  DEPENDENCY_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly httpStatus: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: AppErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatusByCode[code];
    this.details = details;
  }
}

/**
 * True for a refusal that a read or an availability check treats as "not for you": a missing
 * permission, or a high-risk action that is allowed but needs an identity check first.
 */
export function isAccessRefusal(error: unknown): error is AppError {
  return (
    error instanceof AppError && (error.code === 'FORBIDDEN' || error.code === 'STEP_UP_REQUIRED')
  );
}
