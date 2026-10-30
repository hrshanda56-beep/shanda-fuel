import 'server-only';

import { DEV_BYPASS_COOKIE, isLocalDevBypassEnabled } from '@/platform/auth/dev-bypass';

export function hasProviderSessionCookie(requestHeaders: Headers): boolean {
  const cookieNames = isLocalDevBypassEnabled() ? ['__session', DEV_BYPASS_COOKIE] : ['__session'];
  return (requestHeaders.get('cookie') ?? '').split(';').some((part) => {
    const cookieName = part.trim().split('=', 1)[0];
    return cookieName !== undefined && cookieNames.includes(cookieName);
  });
}
