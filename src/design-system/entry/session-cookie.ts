import 'server-only';

import { getAuthProviderName } from '../../platform/auth/provider';

export function hasProviderSessionCookie(requestHeaders: Headers): boolean {
  const cookieNames =
    getAuthProviderName() === 'CLERK'
      ? ['__session']
      : ['__Secure-shanda-fuel.session_token', 'shanda-fuel.session_token'];
  return (requestHeaders.get('cookie') ?? '').split(';').some((part) => {
    const cookieName = part.trim().split('=', 1)[0];
    return cookieName !== undefined && cookieNames.includes(cookieName);
  });
}
