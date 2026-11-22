# Temporary exception: GHSA-fc5q-39xc-vjpf

## Status

Active until **2026-12-17**, then the CI audit fails again until the exception is removed or
reviewed. This is an exception, not remediation.

## Advisory

- Advisory: `GHSA-fc5q-39xc-vjpf`
- Package: `picomatch` (2.3.2 and 4.0.7 are both in the lockfile)
- Severity: High; regular-expression denial of service from crafted glob patterns
- Vulnerable range: `<=4.0.7`
- Patched version: none. 4.0.7 is the newest release and is affected, so no upgrade or override fixes it.

## Applicability

- Reached only through development tooling: eslint-config-next (fast-glob, micromatch),
  typescript-eslint, vite, vitest (tinyglobby, fdir).
- `pnpm why picomatch --prod` returns no path, so it is not a production dependency and is not
  deployed to Vercel.
- The tools only match patterns written in this repository, never input from a request.
- Residual risk: development and CI machines, if an attacker could control a glob pattern there.

## Compensating controls

- The audit threshold stays `high`; every other high or critical advisory still fails the job.
- The script allows exactly this advisory id, package and severity, and only until the expiry date.
- Dependabot and the audit keep running, so a patched release will show up.

## Removal

Remove the entry from `.github/dependency-audit-exceptions.json` (and set the script back to
permitting none) as soon as a patched picomatch is published and the lockfile uses it, or by the
expiry date, whichever comes first.
