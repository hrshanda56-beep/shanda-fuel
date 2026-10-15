import type { Metadata, Viewport } from 'next';
import { ClerkProvider } from '@clerk/nextjs';

// Design-system foundation first, then app-level styles. Order matters.
import '@/design-system/styles/tokens.css';
import '@/design-system/styles/base.css';
import '@/design-system/styles/components.css';
import '@/design-system/styles/shell.css';
import './globals.css';
import '@/design-system/styles/shell-phase1.css';
import '@/design-system/styles/reports.css';
import '@/design-system/styles/entry.css';
import '@/design-system/styles/approved-ui.css';
import '@/design-system/styles/my-shift.css';
import '@/design-system/styles/shell-header.css';

import { ToastProvider } from '@/design-system/toast';
import { shellInitScript } from '@/design-system/shell-preferences';
import { themeInitScript } from '@/design-system/theme';
import { getAuthProviderName } from '@/platform/auth/provider';

export const metadata: Metadata = {
  title: {
    default: 'Shanda Fuel',
    template: '%s · Shanda Fuel',
  },
  description: 'Fuel-station operations and financial control',
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f6f5' },
    { media: '(prefers-color-scheme: dark)', color: '#131312' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const authProvider = getAuthProviderName();
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const content =
    authProvider === 'CLERK' && publishableKey ? (
      <ClerkProvider publishableKey={publishableKey} proxyUrl="/api/clerk">
        {children}
      </ClerkProvider>
    ) : (
      children
    );
  return (
    // The init scripts may set data-theme / data-sidebar before hydration.
    // data-scroll-behavior: in-page anchors scroll smoothly; route changes jump.
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript + shellInitScript }} />
      </head>
      <body>
        <ToastProvider>{content}</ToastProvider>
      </body>
    </html>
  );
}
