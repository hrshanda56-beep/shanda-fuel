# Deployment and rollback checklist

Status: repository process verified; live GitHub/Vercel settings and executable
rollback capability **NOT VERIFIED** on 2026-10-16. Documentation is not approval.

## GitHub to Vercel release path

The repository expects reviewed changes into `main`, CI on the exact release SHA,
then an immutable Vercel production deployment and verification on
<https://fuel.shandahr.com>. `.github/workflows/ci.yml` runs on PRs targeting
main and pushes to main/agent/prep branches. A `codex/` branch gets PR CI when a PR
is opened; this local docs branch is not pushed. No checked-in workflow here
proves automatic Vercel production promotion. Git integration, production branch
setting (expected `main`), branch protection, required reviews/checks, and any
manual promotion policy need project/repository-owner confirmation.

- [ ] Review PR diff and independent review on exact release SHA; preserve security
      and migration ownership gates. No unresolved P0/P1; record exceptions.
- [ ] Inspect quality job (format/lint/typecheck, migrations/provisioner assertions,
      DB metadata, unit/integration, build/browser), dependency audit, secret scan,
      Semgrep and runtime-role proof on that SHA. CodeQL is conditional on
      `CODEQL_ENABLED`; skipped is not PASS. Obtain owner disposition for skips.
- [ ] Note CI PostgreSQL service is 16; separately require relevant PostgreSQL 18.6,
      correct-role/UTC evidence for production compatibility.
- [ ] Owner verifies Vercel project, Git repository, expected production branch,
      environment/provider names and secret bindings without exporting values.
- [ ] DB owner supplies actual migration hash/journal state, backup/rehearsal and
      an explicitly reviewed plan that preserves deferred 0025. Do not run a
      general `pnpm db:migrate` against production to discover what is pending.
- [ ] Release owner explicitly authorizes production operation and exact SHA.

## Deployment identity evidence (authorized read-only operator)

In Vercel's correct production project, select the immutable deployment and
record deployment ID, full source commit SHA, target environment and READY
status. Verify its domain/alias list includes `fuel.shandahr.com`; inspect the
canonical production alias and confirm it points back to that same deployment.
Record time and restricted control-plane evidence reference. A successful build,
a READY preview or a health response alone does not prove production alias/SHA.

Check canonical health/readiness, authenticated sign-in/context/protected
read/logout/re-login and affected read flows under the approved smoke procedure.
Use [production read-only smoke](production-readonly-smoke.md) with its reviewed
credential-handling boundary; never put a session in argv/evidence. Avoid
financial test writes and synthetic production fixtures. Record real unconfigured
states honestly. Execute [the observation watch](post-release-monitoring.md).

## Last known healthy and rollback decision

Select a previous immutable deployment with recorded healthy smoke, actual
production exposure, full SHA, environment/config compatibility and compatible
schema/migration evidence. The accepted code baseline `99bbe34...` is a candidate
reference, not automatic proof of a healthy rollback deployment. A deployment's
READY status alone is insufficient.

Existing [deployment](deployment.md) and [incident](incident-response.md) runbooks
approve the _decision path_ for application-only traffic repointing after owner
approval and compatibility review. **Provider rollback execution is NOT VERIFIED**:
no witnessed rollback, eligible immutable target, operator role/entitlement or
current dashboard control was inspected here. The Vercel owner must establish
those with approved read-only access and attach evidence before relying on the
control. No runnable rollback command is supplied and no rollback was attempted.
If unavailable, escalate to the release owner for a separately approved forward
fix or provider recovery plan; do not improvise.

- [ ] Incident owner records impact, decision, target ID/full SHA and authorization.
- [ ] DB owner compares live journal hashes/order and actual objects/ACLs against
      both target and current application requirements. Check schema, functions,
      RLS/column grants, immutable guards, auth/session tables and in-flight work.
- [ ] Prove target compatibility on a separately approved isolated equivalent
      database/rehearsal; do not infer it from an additive migration description.
- [ ] Drain incompatible in-flight operations only through authorized controls.
      Retain idempotency, pending retry and audit evidence.
- [ ] Authorized provider operator executes only the reviewed recovery operation.
- [ ] Verify target full SHA, READY, canonical alias, health/readiness, auth/MFA,
      tenant/context and affected reads. DB owner confirms journal unchanged by
      app rollback and runtime permissions/objects remain compatible. Review
      partial/duplicate effects before resuming commands.

**Application rollback never automatically reverses migrations.** Migrations are
forward-only history. Incompatible schema/data requires the database incident
path and [backup/restore](backup-restore.md), never invented down-migrations or
restoring over production. Candidate 0030 has a documented compensating-migration
proposal, not an approved production operation; see [risks](reliability-risks.md).
