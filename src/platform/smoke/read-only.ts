export const READ_ONLY_HTTP_METHODS = ['GET', 'HEAD'] as const;
export type ReadOnlyHttpMethod = (typeof READ_ONLY_HTTP_METHODS)[number];
export type SmokeEnvironment = 'staging' | 'production';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const APPROVED_OPERATIONS_OVERVIEW_PATH = '/api/forecourt/operations/overview';

export type ReadOnlySmokeCode =
  | 'authentication_not_configured'
  | 'forbidden'
  | 'malformed_response'
  | 'network_error'
  | 'readiness_failure'
  | 'server_error'
  | 'timeout'
  | 'unexpected_redirect'
  | 'unexpected_status'
  | 'cross_tenant_denial_mismatch'
  | 'tenant_context_not_configured'
  | 'invalid_configuration'
  | 'unsupported_method';

export type SafeCheckResult = {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  required: boolean;
  httpStatus?: number;
  requestId?: string;
  elapsedMs: number;
  code?: ReadOnlySmokeCode;
};

export type ReadOnlySmokeEvidence = {
  schemaVersion: 'shanda-fuel.read-only-smoke.v1';
  targetEnvironment: SmokeEnvironment | 'unknown';
  deploymentId?: string;
  commit?: string;
  timestamp: string;
  pass: boolean;
  checks: SafeCheckResult[];
};

export type TenantContext = {
  tenantId: string;
  stationId: string;
};

export type ReadOnlySmokeTarget = {
  environment: SmokeEnvironment;
  baseUrl: string;
  confirmProduction?: boolean;
  timeoutMs?: number;
  sessionCookie?: string;
  deploymentId?: string;
  commit?: string;
  tenantA: TenantContext;
  tenantB?: TenantContext;
};

export type ReadOnlySmokeCliOptions = ReadOnlySmokeTarget & {
  environment: SmokeEnvironment;
  baseUrl: string;
  confirmProduction: boolean;
};

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class ReadOnlySmokeError extends Error {
  readonly code: ReadOnlySmokeCode;

  constructor(code: ReadOnlySmokeError['code'], message: string) {
    super(message);
    this.name = 'ReadOnlySmokeError';
    this.code = code;
  }
}

export function isReadOnlyHttpMethod(method: string): method is ReadOnlyHttpMethod {
  return READ_ONLY_HTTP_METHODS.includes(method as ReadOnlyHttpMethod);
}

function assertReadOnlyHttpMethod(method: string): asserts method is ReadOnlyHttpMethod {
  if (!isReadOnlyHttpMethod(method)) {
    throw new ReadOnlySmokeError(
      'unsupported_method',
      'The read-only harness permits only GET and HEAD requests.',
    );
  }
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function safeIdentifier(value: string | undefined): string | undefined {
  if (!value || !SAFE_IDENTIFIER_PATTERN.test(value)) return undefined;
  return value;
}

function validateSafeIdentifier(name: string, value: string | undefined): void {
  if (value !== undefined && !safeIdentifier(value)) {
    throw new ReadOnlySmokeError(
      'invalid_configuration',
      `${name} must contain only safe identifier characters.`,
    );
  }
}

function safeRequestId(value: string | null): string | undefined {
  return value && isUuid(value) ? value : undefined;
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ReadOnlySmokeError('invalid_configuration', 'The target base URL is invalid.');
  }

  if (url.protocol !== 'https:') {
    throw new ReadOnlySmokeError(
      'invalid_configuration',
      'The read-only harness requires an HTTPS target.',
    );
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new ReadOnlySmokeError(
      'invalid_configuration',
      'The target base URL must contain only an HTTPS origin.',
    );
  }

  return url.origin;
}

function validateTenantContext(name: string, context: TenantContext): void {
  if (!isUuid(context.tenantId) || !isUuid(context.stationId)) {
    throw new ReadOnlySmokeError(
      'invalid_configuration',
      `${name} tenant and station IDs must be UUIDs.`,
    );
  }
}

export function validateReadOnlySmokeTarget(input: ReadOnlySmokeTarget): ReadOnlySmokeTarget {
  if (input.environment !== 'staging' && input.environment !== 'production') {
    throw new ReadOnlySmokeError(
      'invalid_configuration',
      'The target environment must be explicitly staging or production.',
    );
  }
  if (input.environment === 'production' && input.confirmProduction !== true) {
    throw new ReadOnlySmokeError(
      'invalid_configuration',
      'Production verification requires --confirm-readonly-production.',
    );
  }

  const timeoutMs = input.timeoutMs ?? 10_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 60_000) {
    throw new ReadOnlySmokeError(
      'invalid_configuration',
      'Timeout must be an integer between 10 and 60000 milliseconds.',
    );
  }

  const baseUrl = normalizeBaseUrl(input.baseUrl);
  validateTenantContext('Tenant A', input.tenantA);
  if (input.tenantB) {
    validateTenantContext('Tenant B', input.tenantB);
    if (input.tenantB.tenantId.toLowerCase() === input.tenantA.tenantId.toLowerCase()) {
      throw new ReadOnlySmokeError(
        'invalid_configuration',
        'Tenant B must identify a different tenant from Tenant A.',
      );
    }
  }

  validateSafeIdentifier('Deployment ID', input.deploymentId);
  validateSafeIdentifier('Commit identifier', input.commit);

  if (input.sessionCookie !== undefined && CONTROL_CHARACTER_PATTERN.test(input.sessionCookie)) {
    throw new ReadOnlySmokeError(
      'invalid_configuration',
      'The session cookie contains invalid control characters.',
    );
  }

  return {
    ...input,
    baseUrl,
    confirmProduction: input.confirmProduction === true,
    timeoutMs,
    deploymentId: input.deploymentId,
    commit: input.commit,
  };
}

export type ReadOnlyRequestOptions = {
  authenticated?: boolean;
};

export type ReadOnlyHttpClient = {
  get(url: string | URL, options?: ReadOnlyRequestOptions): Promise<Response>;
  head(url: string | URL, options?: ReadOnlyRequestOptions): Promise<Response>;
};

type ReadOnlyHttpClientOptions = {
  fetcher?: FetchLike;
  timeoutMs: number;
  sessionCookie?: string;
};

function safeHeaders(options: ReadOnlyRequestOptions, sessionCookie: string | undefined): Headers {
  const headers = new Headers({ accept: 'application/json' });
  if (options.authenticated && sessionCookie) headers.set('cookie', sessionCookie);
  return headers;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function createReadOnlyHttpClient(options: ReadOnlyHttpClientOptions): ReadOnlyHttpClient {
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (!fetcher) {
    throw new ReadOnlySmokeError('invalid_configuration', 'The runtime does not provide fetch.');
  }

  async function request(
    method: string,
    url: string | URL,
    requestOptions: ReadOnlyRequestOptions,
  ) {
    assertReadOnlyHttpMethod(method);
    const controller = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        controller.abort();
        reject(new ReadOnlySmokeError('timeout', 'The read-only request timed out.'));
      }, options.timeoutMs);
    });

    try {
      return await Promise.race([
        fetcher(url, {
          method,
          headers: safeHeaders(requestOptions, options.sessionCookie),
          redirect: 'manual',
          signal: controller.signal,
        }),
        timeout,
      ]);
    } catch (error) {
      if (error instanceof ReadOnlySmokeError) throw error;
      if (isAbortError(error)) {
        throw new ReadOnlySmokeError('timeout', 'The read-only request timed out.');
      }
      throw new ReadOnlySmokeError('network_error', 'The read-only request failed.');
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  return {
    get: (url, requestOptions = {}) => request('GET', url, requestOptions),
    head: (url, requestOptions = {}) => request('HEAD', url, requestOptions),
  };
}

function endpointUrl(baseUrl: string, path: string, params: Record<string, string>): string {
  const url = new URL(path, `${baseUrl}/`);
  url.search = new URLSearchParams(params).toString();
  return url.toString();
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100);
}

function responseCode(response: Response, readiness: boolean): ReadOnlySmokeCode | undefined {
  if (response.status >= 300 && response.status < 400) return 'unexpected_redirect';
  if (response.status === 401) return 'authentication_not_configured';
  if (response.status === 403) return 'forbidden';
  if (response.status >= 500) return readiness ? 'readiness_failure' : 'server_error';
  return undefined;
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The body is intentionally never exposed by the harness.
  }
}

async function runPublicCheck(
  name: string,
  request: () => Promise<Response>,
  validateBody: (body: unknown) => boolean,
  readiness: boolean,
): Promise<SafeCheckResult> {
  const startedAt = performance.now();
  try {
    const response = await request();
    const resultBase = {
      name,
      required: true,
      httpStatus: response.status,
      requestId: safeRequestId(response.headers.get('x-request-id')),
      elapsedMs: elapsedMilliseconds(startedAt),
    };
    const statusCode = responseCode(response, readiness);
    if (statusCode) {
      await cancelResponseBody(response);
      return { ...resultBase, status: 'failed', code: statusCode };
    }
    if (response.status !== 200) {
      await cancelResponseBody(response);
      return { ...resultBase, status: 'failed', code: 'unexpected_status' };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ...resultBase, status: 'failed', code: 'malformed_response' };
    }
    if (!validateBody(body)) {
      return { ...resultBase, status: 'failed', code: 'malformed_response' };
    }
    return { ...resultBase, status: 'passed' };
  } catch (error) {
    return {
      name,
      status: 'failed',
      required: true,
      elapsedMs: elapsedMilliseconds(startedAt),
      code: error instanceof ReadOnlySmokeError ? error.code : 'network_error',
    };
  }
}

async function runAuthenticatedCheck(
  name: string,
  request: () => Promise<Response>,
  expected: 'access' | 'denial',
): Promise<SafeCheckResult> {
  const startedAt = performance.now();
  try {
    const response = await request();
    const resultBase = {
      name,
      required: true,
      httpStatus: response.status,
      requestId: safeRequestId(response.headers.get('x-request-id')),
      elapsedMs: elapsedMilliseconds(startedAt),
    };
    const statusCode = responseCode(response, false);
    await cancelResponseBody(response);
    if (expected === 'access' && response.status === 200) {
      return { ...resultBase, status: 'passed' };
    }
    if (expected === 'denial' && (response.status === 403 || response.status === 404)) {
      return { ...resultBase, status: 'passed' };
    }
    if (expected === 'denial' && response.status === 200) {
      return { ...resultBase, status: 'failed', code: 'cross_tenant_denial_mismatch' };
    }
    return {
      ...resultBase,
      status: 'failed',
      code: statusCode ?? 'unexpected_status',
    };
  } catch (error) {
    return {
      name,
      status: 'failed',
      required: true,
      elapsedMs: elapsedMilliseconds(startedAt),
      code: error instanceof ReadOnlySmokeError ? error.code : 'network_error',
    };
  }
}

function isHealthBody(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const record = body as { status?: unknown; checks?: { application?: unknown } };
  return record.status === 'ok' && record.checks?.application === 'ok';
}

function isReadinessBody(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const record = body as { status?: unknown; checks?: { database?: { status?: unknown } } };
  return record.status === 'ok' && record.checks?.database?.status === 'ok';
}

export async function runReadOnlyVerification(
  input: ReadOnlySmokeTarget,
  dependencies: { fetcher?: FetchLike } = {},
): Promise<ReadOnlySmokeEvidence> {
  const target = validateReadOnlySmokeTarget(input);
  const client = createReadOnlyHttpClient({
    fetcher: dependencies.fetcher,
    timeoutMs: target.timeoutMs!,
    sessionCookie: target.sessionCookie,
  });
  const checks: SafeCheckResult[] = [];

  checks.push(
    await runPublicCheck(
      'health',
      () => client.get(endpointUrl(target.baseUrl, '/api/health', {})),
      isHealthBody,
      false,
    ),
  );
  checks.push(
    await runPublicCheck(
      'readiness',
      () => client.get(endpointUrl(target.baseUrl, '/api/readiness', {})),
      isReadinessBody,
      true,
    ),
  );

  if (!target.sessionCookie) {
    checks.push({
      name: 'tenant-a-access',
      status: 'failed',
      required: true,
      elapsedMs: 0,
      code: 'authentication_not_configured',
    });
  } else {
    checks.push(
      await runAuthenticatedCheck(
        'tenant-a-access',
        () =>
          client.get(
            endpointUrl(target.baseUrl, APPROVED_OPERATIONS_OVERVIEW_PATH, {
              tenantId: target.tenantA.tenantId,
              stationId: target.tenantA.stationId,
            }),
            { authenticated: true },
          ),
        'access',
      ),
    );

    if (target.tenantB) {
      checks.push(
        await runAuthenticatedCheck(
          'tenant-b-denial',
          () =>
            client.get(
              endpointUrl(target.baseUrl, APPROVED_OPERATIONS_OVERVIEW_PATH, {
                tenantId: target.tenantB!.tenantId,
                stationId: target.tenantB!.stationId,
              }),
              { authenticated: true },
            ),
          'denial',
        ),
      );
    } else {
      checks.push({
        name: 'tenant-b-denial',
        status: 'skipped',
        required: false,
        elapsedMs: 0,
        code: 'tenant_context_not_configured',
      });
    }
  }

  return {
    schemaVersion: 'shanda-fuel.read-only-smoke.v1',
    targetEnvironment: target.environment,
    ...(target.deploymentId ? { deploymentId: target.deploymentId } : {}),
    ...(target.commit ? { commit: target.commit } : {}),
    timestamp: new Date().toISOString(),
    pass: checks.every((check) => check.status === 'passed' || !check.required),
    checks,
  };
}

function takeValue(args: string[], index: number, flag: string): [string, number] {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new ReadOnlySmokeError('invalid_configuration', `${flag} requires a value.`);
  }
  return [value, index + 1];
}

export function parseReadOnlySmokeCli(
  args: string[],
  environment: Record<string, string | undefined> = process.env,
): ReadOnlySmokeCliOptions {
  let targetEnvironment: SmokeEnvironment | undefined;
  let baseUrl: string | undefined;
  let tenantAId: string | undefined;
  let stationAId: string | undefined;
  let tenantBId: string | undefined;
  let stationBId: string | undefined;
  let deploymentId: string | undefined;
  let commit: string | undefined;
  let timeoutMs: number | undefined;
  let confirmProduction = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--environment') {
      const [value, nextIndex] = takeValue(args, index, arg);
      index = nextIndex;
      if (value !== 'staging' && value !== 'production') {
        throw new ReadOnlySmokeError(
          'invalid_configuration',
          '--environment must be staging or production.',
        );
      }
      targetEnvironment = value;
    } else if (arg === '--base-url') {
      [baseUrl, index] = takeValue(args, index, arg);
    } else if (arg === '--tenant-a-id') {
      [tenantAId, index] = takeValue(args, index, arg);
    } else if (arg === '--station-a-id') {
      [stationAId, index] = takeValue(args, index, arg);
    } else if (arg === '--tenant-b-id') {
      [tenantBId, index] = takeValue(args, index, arg);
    } else if (arg === '--station-b-id') {
      [stationBId, index] = takeValue(args, index, arg);
    } else if (arg === '--deployment-id') {
      [deploymentId, index] = takeValue(args, index, arg);
    } else if (arg === '--commit') {
      [commit, index] = takeValue(args, index, arg);
    } else if (arg === '--timeout-ms') {
      const [value, nextIndex] = takeValue(args, index, arg);
      index = nextIndex;
      timeoutMs = Number(value);
    } else if (arg === '--confirm-readonly-production') {
      confirmProduction = true;
    } else if (arg === '--help') {
      throw new ReadOnlySmokeError('invalid_configuration', readOnlySmokeUsage());
    } else {
      throw new ReadOnlySmokeError('invalid_configuration', 'Unknown command-line option.');
    }
  }

  if (!targetEnvironment || !baseUrl || !tenantAId || !stationAId) {
    throw new ReadOnlySmokeError('invalid_configuration', readOnlySmokeUsage());
  }
  if (environment.APP_ENV && environment.APP_ENV !== targetEnvironment) {
    throw new ReadOnlySmokeError(
      'invalid_configuration',
      'APP_ENV does not match the explicitly selected target environment.',
    );
  }
  if (Boolean(tenantBId) !== Boolean(stationBId)) {
    throw new ReadOnlySmokeError(
      'invalid_configuration',
      'Tenant B and Station B must be supplied together.',
    );
  }

  return {
    environment: targetEnvironment,
    baseUrl,
    confirmProduction,
    timeoutMs,
    sessionCookie: environment.READONLY_SMOKE_SESSION_COOKIE,
    deploymentId,
    commit,
    tenantA: { tenantId: tenantAId, stationId: stationAId },
    ...(tenantBId && stationBId ? { tenantB: { tenantId: tenantBId, stationId: stationBId } } : {}),
  };
}

export function readOnlySmokeUsage(): string {
  return [
    'Usage: APP_ENV=<staging|production> pnpm smoke:production-readonly --',
    '  --environment <staging|production>',
    '  --base-url <https-origin>',
    '  --tenant-a-id <uuid> --station-a-id <uuid>',
    '  [--tenant-b-id <uuid> --station-b-id <uuid>]',
    '  [--deployment-id <safe-id>] [--commit <safe-id>] [--timeout-ms <ms>]',
    '  [--confirm-readonly-production]',
    '',
    'Authenticated checks read READONLY_SMOKE_SESSION_COOKIE from the secure process environment.',
  ].join('\n');
}

export function safeCliError(error: unknown): string {
  if (error instanceof ReadOnlySmokeError) return error.message;
  return 'Read-only verification failed.';
}

export function createFailureEvidence(
  environment: SmokeEnvironment | undefined,
  deploymentId?: string,
  commit?: string,
): ReadOnlySmokeEvidence {
  return {
    schemaVersion: 'shanda-fuel.read-only-smoke.v1',
    targetEnvironment: environment ?? 'unknown',
    ...(safeIdentifier(deploymentId) ? { deploymentId: safeIdentifier(deploymentId) } : {}),
    ...(safeIdentifier(commit) ? { commit: safeIdentifier(commit) } : {}),
    timestamp: new Date().toISOString(),
    pass: false,
    checks: [],
  };
}
