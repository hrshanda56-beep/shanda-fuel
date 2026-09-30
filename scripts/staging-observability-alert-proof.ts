import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const SAFE_ROUTE = '/api/forecourt/operations/overview';
export const REQUEST_TIMEOUT_MS = 10_000;

type FetchImplementation = typeof fetch;
type Log = (message: string) => void;

export type StagingAlertProofArguments = {
  baseUrl: string;
  count: number;
};

export type StagingAlertProofResult = {
  route: typeof SAFE_ROUTE;
  count: number;
  requestIds: string[];
  responseStatuses: number[];
};

function usage(): string {
  return [
    'Usage: APP_ENV=staging pnpm exec tsx scripts/staging-observability-alert-proof.ts --confirm-staging-alert-proof --base-url https://staging.example.test [--count 1]',
    '',
    'Sends unauthenticated GET requests to an existing protected read-only route.',
    'The base URL must be an HTTPS origin with no credentials, path, query, or fragment.',
    'It never supplies a cookie, token, request body, or business write command.',
  ].join('\n');
}

function argumentValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

export function validateStagingOrigin(value: string): URL {
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new Error('The staging --base-url must be a valid HTTPS origin.');
  }
  if (origin.protocol !== 'https:') {
    throw new Error('The staging --base-url must use HTTPS.');
  }
  if (origin.username || origin.password) {
    throw new Error('The staging --base-url must not contain username or password credentials.');
  }
  if (origin.pathname !== '/') {
    throw new Error('The staging --base-url must not include a path.');
  }
  if (origin.search || origin.hash) {
    throw new Error('The staging --base-url must not include a query or fragment.');
  }
  return origin;
}

export function parseArguments(argv: string[]): StagingAlertProofArguments {
  const args = argv.slice(2);
  if (!args.includes('--confirm-staging-alert-proof')) {
    throw new Error('Pass --confirm-staging-alert-proof to confirm a staging-only alert proof.');
  }
  if (
    args.includes('--bypass-secret') ||
    args.includes('--vercel-protection-bypass-secret') ||
    args.includes('--vercel-automation-bypass-secret')
  ) {
    throw new Error(
      'The Vercel bypass secret must only be supplied through VERCEL_AUTOMATION_BYPASS_SECRET in the process environment.',
    );
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--confirm-staging-alert-proof') continue;
    if (arg === '--base-url' || arg === '--count') {
      index += 1;
      continue;
    }
    throw new Error('Unsupported command-line argument.');
  }

  const baseUrl = argumentValue(args, '--base-url');
  if (!baseUrl) throw new Error('A staging --base-url is required.');
  validateStagingOrigin(baseUrl);

  const rawCount = argumentValue(args, '--count') ?? '1';
  const count = Number(rawCount);
  if (!Number.isInteger(count) || count < 1 || count > 3) {
    throw new Error('--count must be an integer from 1 through 3.');
  }

  return { baseUrl, count };
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  fetchImplementation: FetchImplementation = fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetchImplementation(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new Error(`Staging alert proof request timed out after ${timeoutMs}ms.`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function discardResponseBody(response: Response | undefined): Promise<void> {
  try {
    await response?.body?.cancel();
  } catch {
    // The proof result does not depend on consuming a response body.
  }
}

export async function runStagingAlertProof(input: {
  baseUrl: string;
  count: number;
  environment?: Record<string, string | undefined>;
  fetchImplementation?: FetchImplementation;
  timeoutMs?: number;
  log?: Log;
}): Promise<StagingAlertProofResult> {
  const origin = validateStagingOrigin(input.baseUrl);
  const endpoint = new URL(SAFE_ROUTE, origin);
  endpoint.searchParams.set('tenantId', randomUUID());
  endpoint.searchParams.set('stationId', randomUUID());
  const bypassSecret = input.environment?.VERCEL_AUTOMATION_BYPASS_SECRET;
  const fetchImplementation = input.fetchImplementation ?? fetch;
  const log = input.log ?? console.log;
  const requestIds: string[] = [];
  const responseStatuses: number[] = [];

  for (let index = 0; index < input.count; index += 1) {
    const requestId = randomUUID();
    requestIds.push(requestId);
    let response: Response | undefined;
    try {
      const headers = new Headers({ 'x-request-id': requestId });
      if (bypassSecret) headers.set('x-vercel-protection-bypass', bypassSecret);
      response = await fetchWithTimeout(
        endpoint,
        { method: 'GET', headers, redirect: 'manual' },
        fetchImplementation,
        input.timeoutMs,
      );
      if (response.redirected || (response.status >= 300 && response.status <= 399)) {
        throw new Error('The staging alert proof refused an HTTP redirect.');
      }
      if (response.status !== 401 && response.status !== 403) {
        throw new Error(
          `Expected an unauthenticated response from ${SAFE_ROUTE}; received HTTP ${response.status}.`,
        );
      }
      responseStatuses.push(response.status);
      log(
        `safe auth-failure request ${index + 1}/${input.count}: ${requestId} HTTP ${response.status}`,
      );
    } finally {
      await discardResponseBody(response);
    }
  }

  log(
    `Staging alert proof stimulus complete: ${input.count} read-only request(s) sent to ${SAFE_ROUTE}.`,
  );
  return { route: SAFE_ROUTE, count: input.count, requestIds, responseStatuses };
}

export async function main(
  argv = process.argv,
  environment: Record<string, string | undefined> = process.env,
  fetchImplementation: FetchImplementation = fetch,
  log: Log = console.log,
  errorLog: Log = console.error,
): Promise<number> {
  try {
    if (environment.APP_ENV !== 'staging') {
      throw new Error('Staging observability proof requires APP_ENV=staging.');
    }
    const args = parseArguments(argv);
    await runStagingAlertProof({
      ...args,
      environment,
      fetchImplementation,
      log,
    });
    return 0;
  } catch (error) {
    errorLog(error instanceof Error ? error.message : 'Staging observability proof failed.');
    errorLog(usage());
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
