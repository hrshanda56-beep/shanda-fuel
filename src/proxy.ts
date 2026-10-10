import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextFetchEvent, NextRequest } from 'next/server';

import { getAuthProviderName } from './platform/auth/provider';

// Clerk's Frontend API is accessed directly by the browser in development.
// Keep this proxy limited to session integration; resource authorization belongs
// to the route or service that consumes the authenticated request.
const clerkProxy = clerkMiddleware({ frontendApiProxy: { enabled: false } });

export function proxy(request: NextRequest, event: NextFetchEvent) {
  const provider = getAuthProviderName();
  if (provider === 'BETTER_AUTH') return NextResponse.next();
  return clerkProxy(request, event);
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|png|jpg|jpeg|gif|svg|ico|webp|avif|woff2?|ttf|map|txt|xml|csv|pdf|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
    '/__clerk/:path*',
  ],
};
