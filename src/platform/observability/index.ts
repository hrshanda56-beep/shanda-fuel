import 'server-only';

import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError, type AppErrorCode } from '../errors';
import { createLogger } from '../logging';

const logger = createLogger({ component: 'http' });

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const requestIds = new WeakMap<Request, string>();

export type ErrorClassification =
  | 'validation'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'invariant'
  | 'idempotency_conflict'
  | 'dependency_unavailable'
  | 'internal'
  | 'unexpected';

export type ApiRouteHandler<TContext = unknown> = (
  request: Request,
  context?: TContext,
) => Response | Promise<Response>;

export type ApiErrorResponseOptions = {
  /** Preserve a route-specific safe message for an internal failure. */
  internalMessage?: string;
  /** Preserve a route-specific public fallback for an expected provider/auth failure. */
  unknownBody?: Record<string, unknown>;
  unknownStatus?: number;
  /** Preserve the route's existing choice to include safe command details. */
  includeDetails?: boolean;
  /** Preserve route-specific response headers such as Cache-Control. */
  headers?: HeadersInit;
};

function environment(): string {
  const value = process.env.APP_ENV ?? process.env.NODE_ENV;
  return value === 'development' ||
    value === 'local' ||
    value === 'test' ||
    value === 'staging' ||
    value === 'production'
    ? value
    : 'unknown';
}

function pathname(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return 'unknown';
  }
}

function safeIncomingRequestId(value: string | null): string | undefined {
  return value && requestIdPattern.test(value) ? value : undefined;
}

/**
 * Resolve one bounded, UUID-shaped correlation ID for the lifetime of a request.
 * Arbitrary incoming header values are never echoed or placed in logs.
 */
export function getRequestId(request: Request): string {
  const existing = requestIds.get(request);
  if (existing) return existing;
  const requestId = safeIncomingRequestId(request.headers.get('x-request-id')) ?? randomUUID();
  requestIds.set(request, requestId);
  return requestId;
}

export function classifyError(error: unknown): ErrorClassification {
  if (error instanceof ZodError) return 'validation';
  if (error instanceof AppError) {
    const byCode: Record<AppErrorCode, ErrorClassification> = {
      VALIDATION_FAILED: 'validation',
      UNAUTHENTICATED: 'unauthenticated',
      FORBIDDEN: 'forbidden',
      NOT_FOUND: 'not_found',
      CONFLICT: 'conflict',
      INVARIANT_VIOLATION: 'invariant',
      IDEMPOTENCY_CONFLICT: 'idempotency_conflict',
      DEPENDENCY_UNAVAILABLE: 'dependency_unavailable',
      INTERNAL_ERROR: 'internal',
    };
    return byCode[error.code];
  }
  return 'unexpected';
}

function errorType(error: unknown): string {
  if (error instanceof ZodError) return 'ZodError';
  if (error instanceof AppError) return 'AppError';
  if (error instanceof Error && error.constructor?.name) return error.constructor.name;
  return typeof error;
}

function shouldLogHandledError(error: unknown): boolean {
  const classification = classifyError(error);
  return (
    classification === 'unauthenticated' ||
    classification === 'forbidden' ||
    classification === 'dependency_unavailable' ||
    classification === 'internal' ||
    classification === 'unexpected'
  );
}

function logLevelForError(error: unknown): 'warn' | 'error' {
  const classification = classifyError(error);
  return classification === 'unauthenticated' || classification === 'forbidden' ? 'warn' : 'error';
}

export function observeError(request: Request, error: unknown, event = 'http.request.error'): void {
  if (!shouldLogHandledError(error)) return;
  const fields = {
    requestId: getRequestId(request),
    method: request.method,
    route: pathname(request),
    environment: environment(),
    errorType: errorType(error),
    errorClassification: classifyError(error),
  };
  if (logLevelForError(error) === 'warn') logger.warn(event, fields);
  else logger.error(event, fields);
}

export function observeDependencyFailure(request: Request, dependency: string): void {
  logger.error('runtime.dependency.unavailable', {
    requestId: getRequestId(request),
    method: request.method,
    route: pathname(request),
    environment: environment(),
    dependency,
    errorClassification: 'dependency_unavailable',
  });
}

function responseWithHeaders(body: unknown, status: number, headers?: HeadersInit): Response {
  const response = NextResponse.json(body, { status, headers });
  return response;
}

/**
 * Convert expected route failures to the existing public API shape and record
 * only an operationally useful, redacted event. Validation and ordinary
 * business-rule failures remain intentionally quiet.
 */
export function apiErrorResponse(
  request: Request,
  error: unknown,
  options: ApiErrorResponseOptions = {},
): Response {
  observeError(request, error);

  if (error instanceof ZodError) {
    return responseWithHeaders(
      { error: 'VALIDATION_FAILED', issues: error.issues },
      400,
      options.headers,
    );
  }

  if (error instanceof AppError) {
    return responseWithHeaders(
      {
        error: error.code,
        message: error.message,
        ...(options.includeDetails ? { details: error.details } : {}),
      },
      error.httpStatus,
      options.headers,
    );
  }

  return responseWithHeaders(
    options.unknownBody ?? {
      error: 'INTERNAL_ERROR',
      ...(options.internalMessage ? { message: options.internalMessage } : {}),
    },
    options.unknownStatus ?? 500,
    options.headers,
  );
}

function attachRequestId(response: Response, requestId: string): Response {
  try {
    response.headers.set('x-request-id', requestId);
    return response;
  } catch {
    // A platform response should be mutable, but preserving the request flow
    // is more important than failing because a logger/header hook misbehaved.
    const headers = new Headers(response.headers);
    headers.set('x-request-id', requestId);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

function durationMs(startedAt: number): number {
  return Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100);
}

/**
 * Shared API wrapper for correlation, safe uncaught-error handling and one
 * completion event. It deliberately does not inspect request bodies/headers.
 */
export function withRequestObservability<TContext>(
  handler: (request: Request, context: TContext) => Response | Promise<Response>,
): (request: Request, context?: TContext) => Promise<Response>;
export function withRequestObservability(
  handler: (request: Request) => Response | Promise<Response>,
): (request: Request, context?: unknown) => Promise<Response>;
export function withRequestObservability<TContext = unknown>(
  handler: ApiRouteHandler<TContext>,
): (request: Request, context?: TContext) => Promise<Response> {
  return async (request, context) => {
    const startedAt = performance.now();
    const requestId = getRequestId(request);
    let response: Response;

    try {
      response = await handler(request, context);
    } catch (error) {
      observeError(request, error, 'http.request.unhandled_error');
      response = responseWithHeaders({ error: 'INTERNAL_ERROR' }, 500, {
        'cache-control': 'no-store',
      });
    }

    response = attachRequestId(response, requestId);
    logger.info('http.request.completed', {
      requestId,
      method: request.method,
      route: pathname(request),
      status: response.status,
      durationMs: durationMs(startedAt),
      environment: environment(),
    });
    return response;
  };
}
