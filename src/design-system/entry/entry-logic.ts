/**
 * Pure presentation logic for the signed-out entry surfaces (sign-in, invitation,
 * workplace choice). Nothing here grants access: authorisation stays in the
 * server auth, membership and context layers.
 */

export const ENTRY_MESSAGES = {
  invalidCredentials: "That email or password isn't right.",
  rateLimited: 'Too many attempts. Try again shortly.',
  unavailable: "We couldn't sign you in. Please try again.",
  unsupportedSecondFactor: 'This account needs a sign-in method this page does not support.',
  invalidCode: 'That authenticator code is invalid or expired. Try the current code.',
  codeFormat: 'Enter the six-digit code from your authenticator.',
} as const;

/**
 * Password reset has no backing workflow yet (no reset route, no reset email
 * sender), so the "Forgot password?" action must not render. Flip this only in
 * the change that ships a real reset flow.
 */
export const PASSWORD_RESET_AVAILABLE = false;

export type LoginFailure = 'invalid-credentials' | 'rate-limited' | 'unavailable';

type AuthClientError = { status?: number; code?: string } | null | undefined;

/** Map a raw auth-client error to a safe category. Raw provider text is never shown. */
export function classifyLoginFailure(error: AuthClientError): LoginFailure {
  const status = error?.status;
  if (status === 429 || error?.code === 'TOO_MANY_REQUESTS') return 'rate-limited';
  if (typeof status === 'number' && status >= 500) return 'unavailable';
  return 'invalid-credentials';
}

export function loginFailureMessage(failure: LoginFailure): string {
  if (failure === 'rate-limited') return ENTRY_MESSAGES.rateLimited;
  if (failure === 'unavailable') return ENTRY_MESSAGES.unavailable;
  return ENTRY_MESSAGES.invalidCredentials;
}

const POST_SIGN_IN_DEFAULT = '/workplace';
const INVITE_PATH = /^\/invite\/[A-Za-z0-9_-]{1,512}$/;

function safeStationPath(next: string): string | undefined {
  try {
    const target = new URL(next, 'https://fuel.shandahr.com');
    if (target.origin !== 'https://fuel.shandahr.com') return undefined;
    if (decodeURIComponent(target.pathname).includes('\\')) return undefined;
    if (!target.pathname.startsWith('/stations/')) return undefined;
    if (!target.searchParams.get('tenantId') || !target.searchParams.get('stationId')) {
      return undefined;
    }
    return `${target.pathname}${target.search}`;
  } catch {
    return undefined;
  }
}

/**
 * Where to go after sign-in. Only the default route or an invitation path is
 * honoured, so a crafted `next` value cannot redirect off-site or into an
 * arbitrary route.
 */
export function safePostSignInPath(next: string | null | undefined): string {
  if (typeof next === 'string' && INVITE_PATH.test(next)) return next;
  if (typeof next === 'string') return safeStationPath(next) ?? POST_SIGN_IN_DEFAULT;
  return POST_SIGN_IN_DEFAULT;
}

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_REQUIREMENTS = [`At least ${PASSWORD_MIN_LENGTH} characters`] as const;

export type NewPasswordIssues = { password?: string; confirm?: string };

export function validateNewPassword(password: string, confirm: string): NewPasswordIssues {
  const issues: NewPasswordIssues = {};
  if (password.length < PASSWORD_MIN_LENGTH) {
    issues.password = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  } else if (password.length > PASSWORD_MAX_LENGTH) {
    issues.password = `Use no more than ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (confirm !== password) issues.confirm = "Those passwords don't match.";
  return issues;
}

export type WorkplaceOption = Readonly<{
  organisationId: string;
  legalEntityId: string;
  stationId: string;
  stationName: string;
  /** Organisation / legal entity, present only when needed to tell options apart. */
  detail?: string;
}>;

export type AllStationsOption = Readonly<{
  organisationId: string;
  organisationName: string;
}>;

type AvailableTree = Readonly<{
  organisations: readonly Readonly<{
    id: string;
    name: string;
    legalEntities: readonly Readonly<{
      id: string;
      name: string;
      stations: readonly Readonly<{ id: string; name: string }>[];
    }>[];
  }>[];
}>;

export type WorkplacePlan =
  | { kind: 'none' }
  | { kind: 'continue' }
  | {
      kind: 'choose';
      options: readonly WorkplaceOption[];
      allStationsOptions: readonly AllStationsOption[];
      defaultAllStationsOrganisationId: string;
    };

/**
 * Decide the post-sign-in step from the already-authorised context tree.
 * - no organisation at all: a human access state, never an empty dashboard
 * - at most one station: continue
 * - several stations: ask where they are working
 */
export function planWorkplaceEntry(
  available: AvailableTree,
  rememberedOrganisationId?: string,
): WorkplacePlan {
  if (available.organisations.length === 0) return { kind: 'none' };

  const flat = available.organisations.flatMap((organisation) =>
    organisation.legalEntities.flatMap((legalEntity) =>
      legalEntity.stations.map((station) => ({ organisation, legalEntity, station })),
    ),
  );
  if (flat.length <= 1) return { kind: 'continue' };

  const nameCounts = new Map<string, number>();
  for (const { station } of flat) {
    nameCounts.set(station.name, (nameCounts.get(station.name) ?? 0) + 1);
  }
  const multipleOrganisations = available.organisations.length > 1;

  const options = flat.map(({ organisation, legalEntity, station }): WorkplaceOption => {
    const ambiguous = (nameCounts.get(station.name) ?? 0) > 1;
    const detail = multipleOrganisations
      ? organisation.name
      : ambiguous
        ? legalEntity.name
        : undefined;
    return {
      organisationId: organisation.id,
      legalEntityId: legalEntity.id,
      stationId: station.id,
      stationName: station.name,
      ...(detail ? { detail } : {}),
    };
  });
  const allStationsOptions = available.organisations.map((organisation) => ({
    organisationId: organisation.id,
    organisationName: organisation.name,
  }));
  const defaultAllStationsOrganisationId = allStationsOptions.some(
    (option) => option.organisationId === rememberedOrganisationId,
  )
    ? rememberedOrganisationId!
    : allStationsOptions[0]!.organisationId;

  return {
    kind: 'choose',
    options,
    allStationsOptions,
    defaultAllStationsOrganisationId,
  };
}
