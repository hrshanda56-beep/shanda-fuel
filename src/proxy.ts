import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { isLocalDevBypassEnabled } from '@/platform/auth/dev-bypass';
import type { NextFetchEvent, NextRequest } from 'next/server';

// Clerk's Frontend API is accessed directly by the browser in development.
// Keep this proxy limited to session integration; resource authorization belongs
// to the route or service that consumes the authenticated request.
const clerkProxy = clerkMiddleware({
  // Server-side auth talks directly to Clerk; the browser still uses the
  // same-origin proxy configured by NEXT_PUBLIC_CLERK_PROXY_URL.
  proxyUrl: '',
  frontendApiProxy: { enabled: true, path: '/api/clerk' },
});

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  // The owner-demo route is a dedicated browser-local artifact with no Clerk
  // session. Keep the bypass limited to that exact route and explicit env;
  // every other request continues through Clerk middleware.
  if (
    process.env.APP_ENV === 'demo' &&
    (request.nextUrl.pathname === '/owner-demo' || request.nextUrl.pathname === '/owner-demo/')
  ) {
    return NextResponse.next();
  }
  // Local development only: guarded by isLocalDevBypassEnabled (never on a
  // deployed build or a non-local database); Clerk is not contacted at all.
  if (isLocalDevBypassEnabled()) return NextResponse.next();
  const response = await clerkProxy(request, event);
  if (!response) return NextResponse.next();

  // Clerk decorates its response with a rewrite to the current URL so the
  // authenticated request headers reach the route. Next 16 treats that
  // no-op rewrite as a fresh proxy invocation, which loops forever. The
  // override headers are sufficient when the rewrite does not change the
  // pathname or query string.
  const rewrite = response.headers.get('x-middleware-rewrite');
  if (rewrite) {
    const rewrittenUrl = new URL(rewrite, request.url);
    if (
      rewrittenUrl.pathname === request.nextUrl.pathname &&
      rewrittenUrl.search === request.nextUrl.search
    ) {
      response.headers.delete('x-middleware-rewrite');
      response.headers.set('x-middleware-next', '1');
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|png|jpg|jpeg|gif|svg|ico|webp|avif|woff2?|ttf|map|txt|xml|csv|pdf|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
    '/__clerk/:path*',
  ],
};
