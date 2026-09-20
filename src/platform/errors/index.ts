export type AppErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
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
