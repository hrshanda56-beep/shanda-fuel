import { NextResponse } from 'next/server';

import { DEV_BYPASS_COOKIE, devBypassUsers } from '@/platform/auth/dev-bypass';

export const dynamic = 'force-dynamic';

/** Local-only: choose which seeded identity this browser acts as. 404 anywhere else. */
export async function POST(request: Request) {
  const users = devBypassUsers();
  if (users.length === 0) return new NextResponse(null, { status: 404 });
  const form = await request.formData();
  const choice = String(form.get('user') ?? '');
  const response = NextResponse.redirect(new URL('/workplace', request.url), 303);
  if (choice === '__signout') {
    const signedOut = NextResponse.redirect(new URL('/dev-login', request.url), 303);
    signedOut.cookies.delete(DEV_BYPASS_COOKIE);
    return signedOut;
  }
  if (!users.some((user) => user.providerUserId === choice)) {
    return new NextResponse(null, { status: 400 });
  }
  response.cookies.set(DEV_BYPASS_COOKIE, choice, { httpOnly: true, sameSite: 'lax', path: '/' });
  return response;
}
