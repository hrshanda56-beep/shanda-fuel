# Shanda Fuel final launch ledger

Prepared: `2026-10-04T10:10:21Z` (UTC)

## Final disposition

**PRODUCTION ROLLOUT: COMPLETE**

Production rollout human approval was already granted. The final production
deployment and read-only endpoint/domain checks are recorded below. The
technical exception states remain exactly as recorded; an exception does not
change a blocked technical status to PASS.

## Release and deployment identity

- Release SHA: `19735bc3f6eb6aee504c992479c45aacd8c0d476`.
- Vercel project: `shanda-fuel`.
- Vercel project ID: `prj_XnPOpr7OP4fEne29nQqyENRCQkvf`.
- Production deployment ID: `dpl_G9C8i3soqzSa8ncu2yrZbP6K4QxV`.
- Deployment URL: `https://shanda-fuel-5vsrcgj4h-shanda-hr-s-projects.vercel.app`.
- Production domain: `https://fuel.shandahr.com`.

## Production cutover gates

- Exact release SHA deployed: **PASS**.
- Deployment status Ready: **PASS**.
- Production environment configured: **PASS**.
- `DATABASE_URL` pooled `app_runtime`: **PASS**.
- `DATABASE_DIRECT_URL` absent: **PASS**.
- Primary R2 configured: **PASS**.
- Recovery R2 configured: **PASS**.
- `BETTER_AUTH_SECRET` configured: **PASS**.
- Audit signing configuration configured: **PASS**.
- Staging bootstrap variables absent: **PASS**.
- `.neon` untracked/uncommitted: **PASS**.
- `/api/health` HTTP 200: **PASS**.
- Health identifies service `shanda-fuel`: **PASS**.
- `/api/readiness` HTTP 200: **PASS**.
- Readiness database status `ok`: **PASS**.
- `/login` HTTP 200: **PASS**.
- `/api/internal/staging-auth-smoke-bootstrap` HTTP 404: **PASS**.
- Root `/` HTTP 200: **PASS**.
- Exact production domain assigned to `shanda-fuel`: **PASS**.
- Cloudflare DNS changed during cutover: **NO**.
- Unrelated `shanda-hr` wildcard changed: **NO**.

## Exception register

### Observability

- Technical status: **BLOCKED**.
- Temporary launch exception: **APPROVED**.
- Do not relabel technical status PASS.

### Rate limit

- Implementation: **PASS**.
- Local tests: **PASS**.
- Staging E2E technical status: **BLOCKED — PROVIDER**.
- Temporary evidence exception: **APPROVED**.
- Do not relabel staging E2E technical status PASS.

### Dependency security

- `GHSA-vfj7-8cjw-p6xm` remains technically open/unremediated.
- Scoped temporary CI/security exception is active.
- Dev-only transitive path.
- Production runtime exposure absent.
- Review date: `2026-11-03`.
- Do not relabel the advisory remediated.

### Recovery

- Final recovery rehearsal: **PASS**.
- RTO: 105 seconds.
- RPO: 0 seconds.
- Do not rerun recovery.

### Staging

- Stable and verified.
- Do not modify or rerun staging cleanup.

## Evidence preservation and scope

- Final production evidence: `production-rollout-final-20261004T101021Z.md`.
- Historical failed, blocked, superseded, and exception evidence is preserved;
  no historical evidence was overwritten.
- No secrets are included in this ledger or the production evidence file.
- No application code, infrastructure, domains, DNS, Vercel settings, Neon,
  Cloudflare, staging, recovery, or production configuration was modified by
  this evidence task.
- Mutations performed beyond evidence files: **NONE**.
