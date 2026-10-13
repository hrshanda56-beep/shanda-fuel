import 'server-only';

import { getAuthProviderName } from '../../platform/auth/provider';

export function hasProviderSessionCookie(requestHeaders: Headers): boolean {
  const cookieName = getAuthProviderName() === 'CLERK' ? '__session' : 'session_token';
  return (requestHeaders.get('cookie') ?? '')
    .split(';')
    .some((part) => part.trim().startsWith(`${cookieName}=`));
}
