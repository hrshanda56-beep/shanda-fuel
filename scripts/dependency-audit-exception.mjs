import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const exceptionFile = resolve(process.cwd(), '.github/dependency-audit-exceptions.json');
const configuration = JSON.parse(readFileSync(exceptionFile, 'utf8'));
const exceptions = configuration.exceptions;
const expected = {
  npmAdvisoryId: 1240992,
  githubAdvisoryId: 'GHSA-vfj7-8cjw-p6xm',
  package: 'braces',
  affectedVersion: '3.0.3',
  severity: 'high',
  dependencyPath: '.>eslint-config-next>@next/eslint-plugin-next>fast-glob>micromatch>braces',
};

function fail(message) {
  console.error(`Dependency audit exception configuration error: ${message}`);
  process.exit(1);
}

if (!Array.isArray(exceptions) || exceptions.length !== 1) {
  fail('exactly one advisory exception is permitted');
}

const exception = exceptions[0];
for (const [key, value] of Object.entries(expected)) {
  if (exception[key] !== value) {
    fail(`the only permitted exception must match ${key}=${value}`);
  }
}

const today = new Date().toISOString().slice(0, 10);
if (!exception.reviewDate || exception.reviewDate < today) {
  fail(`exception review date ${exception.reviewDate ?? 'missing'} has expired`);
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
const blocking = advisories.filter((advisory) => {
  if (!['high', 'critical'].includes(advisory.severity)) return false;
  if (advisory.id !== exception.npmAdvisoryId) return true;
  if (advisory.github_advisory_id !== exception.githubAdvisoryId) return true;
  if (advisory.module_name !== exception.package) return true;
  if (advisory.severity !== exception.severity) return true;
  return !advisory.findings?.some(
    (finding) =>
      finding.version === exception.affectedVersion &&
      finding.paths?.includes(exception.dependencyPath),
  );
});

const excepted = advisories.find(
  (advisory) =>
    advisory.id === exception.npmAdvisoryId &&
    advisory.github_advisory_id === exception.githubAdvisoryId &&
    advisory.module_name === exception.package &&
    advisory.severity === exception.severity &&
    advisory.findings?.some(
      (finding) =>
        finding.version === exception.affectedVersion &&
        finding.paths?.includes(exception.dependencyPath),
    ),
);

if (excepted) {
  console.log(
    `TEMPORARY SECURITY EXCEPTION: ${exception.githubAdvisoryId} / npm ${exception.npmAdvisoryId}`,
  );
  console.log(`Package: ${exception.package}@${exception.affectedVersion}`);
  console.log(`Scope: pre-production only; review by ${exception.reviewDate}`);
  console.log(`Owner: ${exception.owner}`);
}

if (blocking.length > 0) {
  console.error('Unexcepted high/critical dependency advisories remain:');
  for (const advisory of blocking) {
    console.error(`${advisory.github_advisory_id ?? advisory.id}: ${advisory.module_name}`);
  }
  process.exit(1);
}

const counts = report.metadata?.vulnerabilities ?? {};
console.log(
  `Dependency audit passed with scoped exception; high=${counts.high ?? 0}, critical=${counts.critical ?? 0}, moderate=${counts.moderate ?? 0}`,
);
