// Vitest runs in Node rather than through Next's client/server bundler. The
// production server-only package remains active in application builds; this
// empty test-only module lets server modules be unit-tested in Node.
export {};
