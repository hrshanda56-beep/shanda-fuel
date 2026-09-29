import type { Metadata, Viewport } from 'next';
import { DM_Sans } from 'next/font/google';

// Design-system foundation first, then app-level styles. Order matters.
import '@/design-system/styles/tokens.css';
import '@/design-system/styles/base.css';
import '@/design-system/styles/components.css';
import '@/design-system/styles/shell.css';
import './globals.css';

import { themeInitScript } from '@/design-system/theme';

// Self-hosted by next/font (no browser request to Google; CSP font-src 'self' holds).
const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Shanda Fuel',
  description: 'Shanda Fuel engineering foundation',
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#e6ecea' },
    { media: '(prefers-color-scheme: dark)', color: '#303938' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The theme init script may set data-theme before hydration.
    <html lang="en" className={dmSans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
