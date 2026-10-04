# Temporary exception: GHSA-vfj7-8cjw-p6xm

## Status

Active for pre-production CI and staging-cleanup work only. This is an
exception, not remediation. It must not be used to authorize a production
deployment.

## Advisory

- Advisory: `GHSA-vfj7-8cjw-p6xm` / npm advisory `1240992`
- Package: `braces@3.0.3`
- Severity: High; CWE-674 stack exhaustion through deeply nested patterns
- Vulnerable range: `<=3.0.3`
- Published patched version: none (`first_patched_version` is null)
- Status on main: pre-existing and identical on PR #82
- Runtime scope: dev-only tooling

Dependency path:

`eslint-config-next@16.3.6 → @next/eslint-plugin-next@16.3.6 → fast-glob@3.3.1 → micromatch@4.0.8 → braces@3.0.3`

## Applicability and exposure evidence

Clean `origin/main` and PR #82 both resolve `braces@3.0.3` only through the
`eslint-config-next` development dependency. `pnpm install --prod
--frozen-lockfile --ignore-scripts` removes `eslint-config-next`, and
`pnpm why braces --prod` returns no dependency path. The production build's
`.next/server` and `.next/static` outputs contain no `braces`, `micromatch`,
or `fast-glob` references. The application does not import or invoke the
library at runtime, and no untrusted request input reaches it.

The vulnerable functionality is brace-pattern parsing. Residual risk is
limited to development and CI tooling if attacker-controlled patterns or a
compromised dependency/tooling environment are introduced there in the
future; this exception does not claim the package is safe or patched.

## Compensating controls

- The CI audit threshold remains `high`; all other high and critical
  advisories fail the job.
- The machine-readable exception allowlist permits exactly this advisory,
  package, version, severity, and dependency path.
- The exception expires for review on `2026-11-03`.
- Production dependency installation excludes the affected development
  dependency, and production bundle inspection is part of the evidence.
- The exception must be removed when a patched `braces` release or upstream
  dependency remediation is available.

## Approval and ownership

- Exception approval requirement: explicit operator/launch-owner approval is
  required before any production release; this record is scoped to the
  pre-production merge and staging-cleanup gate only.
- Owner: `OPERATOR INPUT REQUIRED`
- Review trigger: a patched `braces` release or upstream dependency
  remediation, whichever occurs first.
