# Shanda Fuel production Vercel environment evidence

- Status: BLOCKED
- Vercel project: `shanda-fuel`
- Vercel project ID: `prj_XnPOpr7OP4fEne29nQqyENRCQkvf`
- Release SHA: `19735bc3f6eb6aee504c992479c45aacd8c0d476`
- Scope inspected: `production`
- Timestamp (UTC): `2026-10-04T08:17:53Z`

## Production environment contract

| Variable | Required by release contract | Production status | Notes |
| --- | --- | --- | --- |
| `APP_ENV` | yes | absent | Production Vercel environment contained no variables. |
| `APP_URL` | yes | absent | Required value is `https://fuel.shandahr.com`. |
| `DATABASE_URL` | yes | unavailable | Approved production pooled `app_runtime` value unavailable; configuration stopped. |
| `DATABASE_DIRECT_URL` | must be absent | absent | Not configured. |
| `BETTER_AUTH_SECRET` | yes | not configured | Internal production secret generation was not started after the stop condition. |
| `R2_ACCOUNT_ID` | yes with R2 | absent | Required account is `d64179499a237d4a0b1838cf2b991911`. |
| `R2_BUCKET` | yes with R2 | absent | Required bucket is `shanda-fuel-production-private`. |
| `R2_ACCESS_KEY_ID` | yes with R2 | unavailable | Approved production credential unavailable; configuration stopped. |
| `R2_SECRET_ACCESS_KEY` | yes with R2 | unavailable | Approved production credential unavailable; configuration stopped. |
| `R2_RECOVERY_BUCKET` | yes with production R2 | absent | Required bucket is `shanda-fuel-production-recovery`. |
| `R2_RECOVERY_ACCESS_KEY_ID` | yes with production R2 | unavailable | Approved production credential unavailable; configuration stopped. |
| `R2_RECOVERY_SECRET_ACCESS_KEY` | yes with production R2 | unavailable | Approved production credential unavailable; configuration stopped. |
| `AUDIT_SIGNING_KEY_ID` | yes | not configured | Internal production secret generation was not started after the stop condition. |
| `AUDIT_SIGNING_KEY` | yes | not configured | Internal production secret generation was not started after the stop condition. |
| `RESEND_API_KEY` | optional | not configured | Not required by startup validation. |
| `RESEND_FROM_EMAIL` | optional with Resend | not configured | Not required because Resend is not configured. |
| `CRON_SECRET` | optional | not configured | Not required by startup validation. |
| `STAGING_AUTH_BOOTSTRAP_TOKEN` | prohibited | absent | Not part of the release contract and not configured. |
| `STAGING_AUTH_BOOTSTRAP_DATABASE_URL` | prohibited | absent | Not part of the release contract and not configured. |

## Validation

- Required environment names complete: no.
- Production scope correct: yes for the inspected empty production scope; no variables were written.
- `APP_ENV=production`: no; absent.
- `APP_URL` correct: no; absent.
- `DATABASE_URL` pooled `app_runtime`: no; unavailable and not configured.
- `DATABASE_DIRECT_URL` absent: yes.
- Primary R2 configured: no.
- Recovery R2 configured: no.
- Required internal production secrets configured: no.
- Bootstrap variables absent: yes.
- R2 proof references: existing repository recovery evidence under `recovery-evidence/r2-validation-20261002*/evidence.json`; not re-run because production configuration was blocked.
- Canonical application config validation: FAIL because the actual secure process environment lacks the required production values; validation was not weakened with placeholders. The release environment unit suite passed: 30 tests.
- Application deployed: no.
- `fuel.shandahr.com` changed: no.

## Stop condition

The following exact required names were unavailable through an approved secure local source:

- `DATABASE_URL`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_RECOVERY_ACCESS_KEY_ID`
- `R2_RECOVERY_SECRET_ACCESS_KEY`

No Vercel environment mutation, secret generation, deployment, domain change, staging change, recovery-resource change, or credential rotation was performed.

Exact next action: provide or restore access to the approved secure local production source for the five names above, then rerun this operator procedure against the same project and release SHA.
