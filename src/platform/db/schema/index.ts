/**
 * Canonical Drizzle schema entry point.
 *
 * A0 intentionally defines no business tables. A1 and later module owners may
 * add schema files under their owned module/platform boundaries; A0 integrates
 * their reviewed migration sequence into this directory.
 */
export * from './auth';
export * from './a1';
export * from './a3';
