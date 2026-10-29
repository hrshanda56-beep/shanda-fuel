import 'server-only';

import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError, type AppErrorCode } from '../errors';
import { createLogger } from '../logging';
import { withRequestReadScope } from '../security/request-read-scope';

const logger = createLogger({ component: 'http' });

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const requestIds = new WeakMap<Request, string>();

export type ErrorClassification =
  | 'validation'
  | 'unauthenticated'
  | 'forbidden'
  | 'reconciliation_already_exists'
  | 'not_found'
  | 'conflict'
  | 'invariant'
  | 'idempotency_conflict'
  | 'dependency_unavailable'
  | 'internal'
  | 'unexpected';

export type RouteClass =
  | 'auth'
  | 'readiness'
  | 'health'
  | 'forecourt'
  | 'cash'
  | 'inventory'
  | 'provider'
  | 'report'
  | 'customer'
  | 'supplier'
  | 'api'
  | 'web';

export type StatusClass = '1xx' | '2xx' | '3xx' | '4xx' | '5xx';

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

export function classifyRoute(route: string): RouteClass {
  if (route === '/api/health') return 'health';
  if (route === '/api/readiness') return 'readiness';
  if (route === '/api/auth' || route.startsWith('/api/auth/')) return 'auth';
  if (route === '/api/forecourt' || route.startsWith('/api/forecourt/')) return 'forecourt';
  if (route === '/api/cash' || route.startsWith('/api/cash/')) return 'cash';
  if (route === '/api/inventory' || route.startsWith('/api/inventory/')) return 'inventory';
  if (route === '/api/settlements' || route.startsWith('/api/settlements/')) return 'provider';
  if (route === '/api/reports' || route.startsWith('/api/reports/')) return 'report';
  if (route === '/api/customers' || route.startsWith('/api/customers/')) return 'customer';
  if (route === '/api/suppliers' || route.startsWith('/api/suppliers/')) return 'supplier';
  if (route === '/api' || route.startsWith('/api/')) return 'api';
  return 'web';
}

export function classifyStatus(status: number): StatusClass {
  if (status >= 500) return '5xx';
  if (status >= 400) return '4xx';
  if (status >= 300) return '3xx';
  if (status >= 200) return '2xx';
  return '1xx';
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
      STEP_UP_REQUIRED: 'forbidden',
      RECONCILIATION_ALREADY_EXISTS: 'reconciliation_already_exists',
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

/** The five-character Postgres error code (such as 53300) buried under a Drizzle wrapper, if any. */
function sqlState(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = current.cause;
  }
  return undefined;
}

function shouldLogHandledError(error: unknown): boolean {
  const classification = classifyError(error);
  return (
    classification === 'unauthenticated' ||
    classification === 'forbidden' ||
    classification === 'conflict' ||
    classification === 'idempotency_conflict' ||
    classification === 'dependency_unavailable' ||
    classification === 'internal' ||
    classification === 'unexpected'
  );
}

function logLevelForError(error: unknown): 'warn' | 'error' {
  const classification = classifyError(error);
  return classification === 'unauthenticated' ||
    classification === 'forbidden' ||
    classification === 'conflict' ||
    classification === 'idempotency_conflict'
    ? 'warn'
    : 'error';
}

export function observeError(request: Request, error: unknown, event = 'http.request.error'): void {
  if (!shouldLogHandledError(error)) return;
  const fields = {
    signal: 'http_error',
    requestId: getRequestId(request),
    method: request.method,
    route: pathname(request),
    routeClass: classifyRoute(pathname(request)),
    environment: environment(),
    errorType: errorType(error),
    errorClassification: classifyError(error),
    ...(sqlState(error) ? { sqlState: sqlState(error) } : {}),
    ...(error instanceof AppError
      ? { status: error.httpStatus, statusClass: classifyStatus(error.httpStatus) }
      : {}),
  };
  if (logLevelForError(error) === 'warn') logger.warn(event, fields);
  else logger.error(event, fields);
}

export function observeDependencyFailure(request: Request, dependency: string): void {
  logger.error('runtime.dependency.unavailable', {
    signal: 'dependency_failure',
    requestId: getRequestId(request),
    method: request.method,
    route: pathname(request),
    routeClass: classifyRoute(pathname(request)),
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

  // A reference, number or code that is already taken is the person's to change, not a server fault.
  if (sqlState(error) === '23505') {
    return responseWithHeaders(
      {
        error: 'CONFLICT',
        message: 'That reference, number or code is already in use. Check it and try again.',
      },
      409,
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
      // Read reuse ends with this GET. Mutating commands must always see fresh
      // authority, including changes made earlier in the command itself.
      response =
        request.method === 'GET'
          ? await withRequestReadScope(() => Promise.resolve(handler(request, context)))
          : await handler(request, context);
    } catch (error) {
      observeError(request, error, 'http.request.unhandled_error');
      response = responseWithHeaders({ error: 'INTERNAL_ERROR' }, 500, {
        'cache-control': 'no-store',
      });
    }

    response = attachRequestId(response, requestId);
    logger.info('http.request.completed', {
      signal: 'http_request',
      requestId,
      method: request.method,
      route: pathname(request),
      routeClass: classifyRoute(pathname(request)),
      status: response.status,
      statusClass: classifyStatus(response.status),
      durationMs: durationMs(startedAt),
      environment: environment(),
    });
    return response;
  };
}
