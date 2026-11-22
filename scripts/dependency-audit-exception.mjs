import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const exceptionFile = resolve(process.cwd(), '.github/dependency-audit-exceptions.json');
const configuration = JSON.parse(readFileSync(exceptionFile, 'utf8'));
const exceptions = configuration.exceptions;

function fail(message) {
  console.error(`Dependency audit exception configuration error: ${message}`);
  process.exit(1);
}

// Exactly one exception is permitted: picomatch, GHSA-fc5q-39xc-vjpf (no patched release exists).
// Record: docs/security/exceptions/GHSA-fc5q-39xc-vjpf.md. It lapses on its expiry date, after which
// the audit fails again. Adding or widening an exception is a reviewed change to this script.
const ALLOWED = {
  advisoryId: 'GHSA-fc5q-39xc-vjpf',
  packageName: 'picomatch',
  severity: 'high',
  expires: '2026-12-17',
};

if (!Array.isArray(exceptions) || exceptions.length > 1) {
  fail('at most one advisory exception is permitted');
}
for (const entry of exceptions) {
  for (const key of ['advisoryId', 'packageName', 'severity', 'expires']) {
    if (entry[key] !== ALLOWED[key]) {
      fail(`exception ${key} must be ${ALLOWED[key]}`);
    }
  }
}
const today = new Date().toISOString().slice(0, 10);
const activeException = exceptions.length === 1 && today <= ALLOWED.expires;
if (exceptions.length === 1 && !activeException) {
  console.error(
    `The ${ALLOWED.advisoryId} exception expired on ${ALLOWED.expires}; remove it or review it again.`,
  );
}

const audit = spawnSync('pnpm', ['audit', '--audit-level=high', '--json'], {
  encoding: 'utf8',
  env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
});

if (audit.error) {
  console.error(audit.error);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(audit.stdout.trim());
} catch {
  console.error(audit.stdout);
  console.error(audit.stderr);
  console.error('Dependency audit did not return parseable JSON.');
  process.exit(1);
}

const advisories = Object.values(report.advisories ?? {});
const isExcepted = (advisory) =>
  activeException &&
  (advisory.github_advisory_id ?? advisory.id) === ALLOWED.advisoryId &&
  advisory.module_name === ALLOWED.packageName &&
  advisory.severity === ALLOWED.severity;
const blocking = advisories.filter(
  (advisory) => ['high', 'critical'].includes(advisory.severity) && !isExcepted(advisory),
);

if (blocking.length > 0) {
  console.error('High/critical dependency advisories remain:');
  for (const advisory of blocking) {
    console.error(`${advisory.github_advisory_id ?? advisory.id}: ${advisory.module_name}`);
  }
  process.exit(1);
}

console.log(
  activeException
    ? `Dependency audit: no high or critical advisories other than the excepted ${ALLOWED.advisoryId} (expires ${ALLOWED.expires}).`
    : 'Dependency audit: no high or critical advisories.',
);
