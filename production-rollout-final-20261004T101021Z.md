# Shanda Fuel production rollout final evidence

- Production rollout disposition: **COMPLETE**
- Prepared: `2026-10-04T10:10:21Z` (UTC)
- Release SHA: `19735bc3f6eb6aee504c992479c45aacd8c0d476`
- Vercel project: `shanda-fuel`
- Vercel project ID: `prj_XnPOpr7OP4fEne29nQqyENRCQkvf`
- Production deployment ID: `dpl_G9C8i3soqzSa8ncu2yrZbP6K4QxV`
- Deployment URL: `https://shanda-fuel-5vsrcgj4h-shanda-hr-s-projects.vercel.app`
- Production domain: `https://fuel.shandahr.com`
- Production rollout human approval: already granted

## Verified production gates

| Gate | Status |
| --- | --- |
| Exact release SHA deployed | PASS |
| Deployment status Ready | PASS |
| Production environment configured | PASS |
| `DATABASE_URL` pooled `app_runtime` | PASS |
| `DATABASE_DIRECT_URL` absent | PASS |
| Primary R2 configured | PASS |
| Recovery R2 configured | PASS |
| `BETTER_AUTH_SECRET` configured | PASS |
| Audit signing configuration configured | PASS |
| Staging bootstrap variables absent | PASS |
| `.neon` untracked/uncommitted | PASS |
| `/api/health` HTTP status | 200 PASS |
| Health identifies service `shanda-fuel` | PASS |
| `/api/readiness` HTTP status | 200 PASS |
| Readiness database status | `ok` PASS |
| `/login` HTTP status | 200 PASS |
| `/api/internal/staging-auth-smoke-bootstrap` HTTP status | 404 PASS |
| Root `/` HTTP status | 200 PASS |
| Exact production domain assigned to `shanda-fuel` | PASS |
| Cloudflare DNS changed during cutover | NO |
| Unrelated `shanda-hr` wildcard changed | NO |

## Preserved exception statuses

### Observability

- Technical status: **BLOCKED**.
- Temporary launch exception: **APPROVED**.
- Technical status is not relabeled PASS.

### Rate limit

- Implementation: **PASS**.
- Local tests: **PASS**.
- Staging E2E technical status: **BLOCKED — PROVIDER**.
- Temporary evidence exception: **APPROVED**.
- Staging E2E technical status is not relabeled PASS.

### Dependency security

- `GHSA-vfj7-8cjw-p6xm` remains technically open/unremediated.
- Scoped temporary CI/security exception is active.
- The vulnerable path is dev-only and transitive.
- Production runtime exposure is absent.
- Review date: `2026-11-03`.
- The advisory is not relabeled remediated.

### Recovery

- Final recovery rehearsal: **PASS**.
- RTO: 105 seconds.
- RPO: 0 seconds.
- Recovery is not rerun by this evidence task.

### Staging

- Stable and verified.
- Staging cleanup is not modified or rerun.

## Evidence and safety

- This file contains no secrets, credentials, connection strings, cookies, or key material.
- Historical failed and superseded evidence is preserved and was not overwritten.
- No application code, infrastructure, domains, DNS, Vercel settings, Neon,
  Cloudflare, staging, recovery, or production configuration was modified by
  this evidence task.
