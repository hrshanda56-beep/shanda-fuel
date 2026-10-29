import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors';
import {
  apiErrorResponse,
  classifyRoute,
  classifyStatus,
  getRequestId,
  withRequestObservability,
} from './index';

const validRequestId = '11111111-1111-4111-8111-111111111111';

function request(headers?: HeadersInit): Request {
  return new Request('https://fuel.example.test/api/example', {
    method: 'POST',
    headers,
  });
}

describe('server observability', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes route and status dimensions for provider-neutral queries', () => {
    expect(classifyRoute('/api/auth/sign-in')).toBe('auth');
    expect(classifyRoute('/api/readiness')).toBe('readiness');
    expect(classifyRoute('/api/settlements/summary')).toBe('provider');
    expect(classifyRoute('/dashboard')).toBe('web');
    expect(classifyStatus(200)).toBe('2xx');
    expect(classifyStatus(404)).toBe('4xx');
    expect(classifyStatus(503)).toBe('5xx');
  });

  it('preserves a bounded valid request ID and rejects malformed or unbounded values', () => {
    const preserved = request({ 'x-request-id': validRequestId });
    expect(getRequestId(preserved)).toBe(validRequestId);

    const malformed = request({ 'x-request-id': 'not-a-request-id' });
    const malformedId = getRequestId(malformed);
    expect(malformedId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(malformedId).not.toBe('not-a-request-id');

    const unbounded = request({ 'x-request-id': 'x'.repeat(10_000) });
    expect(getRequestId(unbounded)).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('emits one structured completion event with correlation, status, route, and duration', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const response = await withRequestObservability(
      async () => new Response('ok', { status: 201 }),
    )(request({ 'x-request-id': validRequestId }));

    expect(response.status).toBe(201);
    expect(response.headers.get('x-request-id')).toBe(validRequestId);
    expect(info).toHaveBeenCalledTimes(1);
    const record = JSON.parse(String(info.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(record).toMatchObject({
      level: 'info',
      message: 'http.request.completed',
      signal: 'http_request',
      requestId: validRequestId,
      method: 'POST',
      route: '/api/example',
      routeClass: 'api',
      status: 201,
      statusClass: '2xx',
      environment: expect.any(String),
      timestamp: expect.any(String),
    });
    expect(record.durationMs).toEqual(expect.any(Number));
  });

  it('preserves a normal response body and status while adding the request ID', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const response = await withRequestObservability(
      async () => new Response('original response body', { status: 202 }),
    )(request({ 'x-request-id': validRequestId }));

    expect(response.status).toBe(202);
    expect(await response.text()).toBe('original response body');
    expect(response.headers.get('x-request-id')).toBe(validRequestId);
  });

  it('preserves an existing Set-Cookie header while adding the request ID', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const response = await withRequestObservability(
      async () =>
        new Response('signed-in', {
          status: 200,
          headers: { 'set-cookie': 'session=opaque; Path=/; HttpOnly; Secure' },
        }),
    )(request({ 'x-request-id': validRequestId }));

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBe('session=opaque; Path=/; HttpOnly; Secure');
    expect(response.headers.get('x-request-id')).toBe(validRequestId);
  });

  it('preserves redirect Location and status while adding the request ID', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const response = await withRequestObservability(
      async () => new Response(null, { status: 303, headers: { Location: '/login' } }),
    )(request({ 'x-request-id': validRequestId }));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
    expect(response.headers.get('x-request-id')).toBe(validRequestId);
  });

  it('reconstructs an otherwise immutable response without losing its body or headers', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const original = new Response('reconstructed body', {
      status: 206,
      headers: { 'set-cookie': 'session=opaque; Path=/' },
    });
    vi.spyOn(original.headers, 'set').mockImplementation(() => {
      throw new Error('headers are immutable');
    });

    const response = await withRequestObservability(async () => original)(
      request({ 'x-request-id': validRequestId }),
    );

    expect(response).not.toBe(original);
    expect(response.status).toBe(206);
    expect(await response.text()).toBe('reconstructed body');
    expect(response.headers.get('set-cookie')).toBe('session=opaque; Path=/');
    expect(response.headers.get('x-request-id')).toBe(validRequestId);
  });

  it('correlates uncaught errors without exposing messages or sensitive values', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await withRequestObservability(async () => {
      throw new Error('password=super-secret token=private-token');
    })(request({ 'x-request-id': validRequestId }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'INTERNAL_ERROR' });
    expect(response.headers.get('x-request-id')).toBe(validRequestId);
    expect(error).toHaveBeenCalledTimes(1);
    const record = JSON.parse(String(error.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(record).toMatchObject({
      message: 'http.request.unhandled_error',
      requestId: validRequestId,
      errorClassification: 'unexpected',
      errorType: 'Error',
    });
    expect(JSON.stringify(record)).not.toContain('super-secret');
    expect(JSON.stringify(record)).not.toContain('private-token');
  });

  it('logs forbidden and unauthenticated failures at WARN while keeping validation quiet', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const authResponse = apiErrorResponse(
      request({ 'x-request-id': validRequestId }),
      new AppError('FORBIDDEN', 'not allowed', { password: 'do-not-log' }),
      { includeDetails: true },
    );
    expect(authResponse.status).toBe(403);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({
      level: 'warn',
      message: 'http.request.error',
      signal: 'http_error',
      requestId: validRequestId,
      errorClassification: 'forbidden',
      status: 403,
      statusClass: '4xx',
    });
    expect(JSON.stringify(warn.mock.calls[0])).not.toContain('do-not-log');

    warn.mockClear();
    const unauthenticatedResponse = apiErrorResponse(
      request({ 'x-request-id': validRequestId }),
      new AppError('UNAUTHENTICATED', 'authentication required'),
    );
    expect(unauthenticatedResponse.status).toBe(401);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({
      level: 'warn',
      errorClassification: 'unauthenticated',
    });

    const validationResponse = apiErrorResponse(
      request({ 'x-request-id': validRequestId }),
      new AppError('VALIDATION_FAILED', 'invalid input'),
    );
    expect(validationResponse.status).toBe(400);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it('logs the Postgres error code hidden under a query wrapper, and nothing else from it', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const postgres = Object.assign(new Error('remaining connection slots are reserved'), {
      code: '53300',
    });
    const wrapped = new Error('Failed query: select secret', { cause: postgres });
    apiErrorResponse(request({ 'x-request-id': validRequestId }), wrapped);

    const record = JSON.parse(String(error.mock.calls[0]?.[0]));
    expect(record.sqlState).toBe('53300');
    expect(JSON.stringify(record)).not.toContain('select secret');
  });

  it('answers a duplicate-value database error with a 409 and no database detail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const duplicate = Object.assign(new Error('duplicate key value violates "secret_idx"'), {
      code: '23505',
    });
    const response = apiErrorResponse(
      request({ 'x-request-id': validRequestId }),
      new Error('Failed query: insert into app.things', { cause: duplicate }),
    );
    expect(response.status).toBe(409);
    const body = await response.text();
    expect(body).toContain('CONFLICT');
    expect(body).not.toMatch(/secret_idx|app\.things/);
  });

  it('keeps dependency, internal, and unexpected failures at ERROR severity', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const dependencyResponse = apiErrorResponse(
      request({ 'x-request-id': validRequestId }),
      new AppError('DEPENDENCY_UNAVAILABLE', 'database unavailable', { secret: 'do-not-log' }),
    );
    const internalResponse = apiErrorResponse(
      request({ 'x-request-id': validRequestId }),
      new AppError('INTERNAL_ERROR', 'internal failure'),
    );
    await withRequestObservability(async () => {
      throw new Error('unexpected failure');
    })(request({ 'x-request-id': validRequestId }));

    expect(dependencyResponse.status).toBe(503);
    expect(internalResponse.status).toBe(500);
    expect(error).toHaveBeenCalledTimes(3);
    const records = error.mock.calls.map((call) => JSON.parse(String(call[0])));
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: 'error', errorClassification: 'dependency_unavailable' }),
        expect.objectContaining({ level: 'error', errorClassification: 'internal' }),
        expect.objectContaining({ level: 'error', errorClassification: 'unexpected' }),
      ]),
    );
    expect(JSON.stringify(records)).not.toContain('do-not-log');
  });

  it('logs conflicts as warn-level operational signals without exposing details', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = apiErrorResponse(
      request({ 'x-request-id': validRequestId }),
      new AppError('IDEMPOTENCY_CONFLICT', 'duplicate command', { payload: 'private' }),
    );

    expect(response.status).toBe(409);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({
      signal: 'http_error',
      errorClassification: 'idempotency_conflict',
      statusClass: '4xx',
    });
    expect(JSON.stringify(warn.mock.calls[0])).not.toContain('private');
  });

  it('does not break request flow when the log sink throws', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {
      throw new Error('sink unavailable');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('sink unavailable');
    });

    const response = await withRequestObservability(async () => {
      throw new Error('unexpected');
    })(request({ 'x-request-id': validRequestId }));

    expect(response.status).toBe(500);
    expect(response.headers.get('x-request-id')).toBe(validRequestId);
  });
});
