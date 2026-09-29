import type { Metadata, Viewport } from 'next';

// Design-system foundation first, then app-level styles. Order matters.
import '@/design-system/styles/tokens.css';
import '@/design-system/styles/base.css';
import '@/design-system/styles/components.css';
import './globals.css';

import { themeInitScript } from '@/design-system/theme';

export const metadata: Metadata = {
  title: 'Shanda Fuel',
  description: 'Shanda Fuel engineering foundation',
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f6f5' },
    { media: '(prefers-color-scheme: dark)', color: '#131312' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The theme init script may set data-theme before hydration.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
