import { timingSafeEqual } from 'node:crypto';
import { AppError } from '../errors';

function sameSecret(leftValue: string, rightValue: string): boolean {
  const left = Buffer.from(leftValue);
  const right = Buffer.from(rightValue);
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/** Authorize a provider-scheduled request without creating an application user/session. */
export function authorizeCronRequest(request: Request, configuredSecret: string | undefined): void {
  if (!configuredSecret) throw new AppError('DEPENDENCY_UNAVAILABLE', 'Scheduled jobs are off');
  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!sameSecret(presented, configuredSecret)) {
    throw new AppError('UNAUTHENTICATED', 'Authentication is required');
  }
}
