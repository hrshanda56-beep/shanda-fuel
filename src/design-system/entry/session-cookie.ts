import 'server-only';

export function hasProviderSessionCookie(requestHeaders: Headers): boolean {
  const cookieNames = ['__session'];
  return (requestHeaders.get('cookie') ?? '').split(';').some((part) => {
    const cookieName = part.trim().split('=', 1)[0];
    return cookieName !== undefined && cookieNames.includes(cookieName);
  });
}
