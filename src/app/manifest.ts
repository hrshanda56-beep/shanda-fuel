import type { MetadataRoute } from 'next';

// Lets the app be installed on a phone's home screen so a supervisor opens it like any other app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Shanda Fuel',
    short_name: 'Shanda Fuel',
    description: 'Fuel-station operations and financial control',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f6f6f5',
    theme_color: '#0a5a4a',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
