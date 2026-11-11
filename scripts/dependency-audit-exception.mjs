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

// No exception is currently active. The only one ever recorded (braces, GHSA-vfj7-8cjw-p6xm) expired
// on 2026-11-03 and the advisory is no longer reported. Adding an exception again is a reviewed
// change to this script, not just to the JSON file.
if (!Array.isArray(exceptions) || exceptions.length !== 0) {
  fail('no advisory exception is permitted');
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
const blocking = advisories.filter((advisory) => ['high', 'critical'].includes(advisory.severity));

if (blocking.length > 0) {
  console.error('High/critical dependency advisories remain:');
  for (const advisory of blocking) {
    console.error(`${advisory.github_advisory_id ?? advisory.id}: ${advisory.module_name}`);
  }
  process.exit(1);
}

console.log('Dependency audit: no high or critical advisories.');
