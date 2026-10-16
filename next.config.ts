import type { NextConfig } from 'next';

const isolatedE2E = process.env.SHANDA_E2E_ISOLATED_CACHE === '1';
if (isolatedE2E && process.env.APP_ENV !== 'test') {
  throw new Error('E2E cache isolation requires a test environment');
}

const scriptSource = `'self' 'unsafe-inline'${
  process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''
}`;

const nextConfig: NextConfig = {
  ...(isolatedE2E
    ? {
        distDir: '.next-e2e-postgres-dev',
        // A serial development matrix revisits many routes after the default
        // two-page buffer would evict them. Keep compiled entries for this run.
        onDemandEntries: { maxInactiveAge: 60 * 60 * 1000, pagesBufferLength: 64 },
      }
    : {}),
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
