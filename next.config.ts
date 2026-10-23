import type { NextConfig } from 'next';

const scriptSource = `'self' 'unsafe-inline'${
  process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''
}`;

const nextConfig: NextConfig = {
  // Keep browser validation separate from an already-running developer server.
  distDir: process.env.PLAYWRIGHT_PORT ? '.next-playwright' : '.next',
  // Keep the development badge clear of the sidebar's bottom-left controls. The browser tests turn
  // it off: at 320px it sits on top of the phone dock's More button and swallows their clicks.
  devIndicators: process.env.APP_ENV === 'test' ? false : { position: 'bottom-right' },
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: `default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; form-action 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src ${scriptSource}; connect-src 'self'; font-src 'self' data:`,
          },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
