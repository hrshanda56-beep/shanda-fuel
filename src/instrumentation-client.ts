// Registers the offline/installable shell. Production only: a service worker in development
// would serve stale builds. A failure here must never affect the app, so it is swallowed.
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'production') {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        /* the app works the same without it */
      });
    });
  }
}
