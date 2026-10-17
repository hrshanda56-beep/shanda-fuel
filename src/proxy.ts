import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
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
