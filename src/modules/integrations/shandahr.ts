import { AppError } from '../../platform/errors';

/**
 * ShandaHR remains outside v1 (DEC-044). This boundary is deliberately small:
 * it gives a future adapter a stable seam without making the application
 * depend on an HR URL, token, SDK, or network call today.
 */
export const SHANDAHR_FEATURE_FLAG = 'SHANDAHR_INTEGRATION_ENABLED' as const;

export type ShandaHrEmployee = Readonly<{
  externalId: string;
  displayName: string;
  stationCode?: string;
  active: boolean;
}>;

export type ShandaHrAdapter = Readonly<{
  status: 'DISABLED' | 'ENABLED_WITHOUT_TRANSPORT' | 'READY';
  listEmployees: () => Promise<readonly ShandaHrEmployee[]>;
}>;

export type ShandaHrTransport = Readonly<{
  listEmployees: () => Promise<readonly ShandaHrEmployee[]>;
}>;

type Environment = Readonly<Record<string, string | undefined>>;

export function isShandaHrEnabled(environment: Environment = process.env): boolean {
  return environment[SHANDAHR_FEATURE_FLAG] === '1';
}

function disabledAdapter(): ShandaHrAdapter {
  return {
    status: 'DISABLED',
    listEmployees: async () => {
      throw new AppError('DEPENDENCY_UNAVAILABLE', 'The ShandaHR integration is disabled.');
    },
  };
}

function enabledWithoutTransportAdapter(): ShandaHrAdapter {
  return {
    status: 'ENABLED_WITHOUT_TRANSPORT',
    listEmployees: async () => {
      throw new AppError(
        'DEPENDENCY_UNAVAILABLE',
        'The ShandaHR integration is enabled but has no approved transport configured.',
      );
    },
  };
}

/**
 * Resolve the future integration seam. Production code must inject an
 * approved transport after the ShandaHR contract, authentication, retry and
 * data-ownership decisions are recorded. No transport is created implicitly.
 */
export function createShandaHrAdapter(input?: {
  environment?: Environment;
  transport?: ShandaHrTransport;
}): ShandaHrAdapter {
  if (!isShandaHrEnabled(input?.environment)) return disabledAdapter();
  if (!input?.transport) return enabledWithoutTransportAdapter();
  return { status: 'READY', listEmployees: input.transport.listEmployees };
}
