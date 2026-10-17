# Shanda Fuel production Vercel environment evidence

- Status: BLOCKED
- Vercel team ID: `team_VMthg2WoTS6eeOP5BjRh3i8b`
- Vercel project: `shanda-fuel`
- Vercel project ID: `prj_XnPOpr7OP4fEne29nQqyENRCQkvf`
- Release SHA: `19735bc3f6eb6aee504c992479c45aacd8c0d476`
- Scope: `production` only
- Timestamp (UTC): `2026-10-04T09:22:31Z`

## Environment contract and final status

The exact release source defines the following variables. Final production
metadata is empty after cleanup of the interrupted write.

| Variable | Contract | Final production status |
| --- | --- | --- |
| `APP_ENV` | required; must be `production` | absent |
| `APP_URL` | required; must be `https://fuel.shandahr.com` | absent |
| `DATABASE_URL` | required; pooled production `app_runtime` / `shanda_fuel` | absent |
| `DATABASE_DIRECT_URL` | must be absent | absent |
| `BETTER_AUTH_SECRET` | required in production; generated locally | absent |
| `R2_ACCOUNT_ID` | required with R2; `d64179499a237d4a0b1838cf2b991911` | absent |
| `R2_BUCKET` | required with R2; `shanda-fuel-production-private` | absent |
| `R2_ACCESS_KEY_ID` | required with R2; secure handoff value | absent |
| `R2_SECRET_ACCESS_KEY` | required with R2; secure handoff value | absent |
| `R2_RECOVERY_BUCKET` | required with production R2; `shanda-fuel-production-recovery` | absent |
| `R2_RECOVERY_ACCESS_KEY_ID` | required with production R2; secure handoff value | absent |
| `R2_RECOVERY_SECRET_ACCESS_KEY` | required with production R2; secure handoff value | absent |
| `AUDIT_SIGNING_KEY_ID` | required in production; generated locally | absent |
| `AUDIT_SIGNING_KEY` | required in production; generated locally | absent |
| `RESEND_API_KEY` | optional | absent |
| `RESEND_FROM_EMAIL` | optional when Resend is configured | absent |
| `CRON_SECRET` | optional | absent |
| `STAGING_AUTH_BOOTSTRAP_TOKEN` | prohibited staging-only variable | absent |
| `STAGING_AUTH_BOOTSTRAP_DATABASE_URL` | prohibited staging-only variable | absent |

## Validation and safety

- Required env names complete: no.
- Production scope correct: no variables remain configured; no other scope was changed.
- `APP_ENV=production`: no.
- `APP_URL` correct: no.
- `DATABASE_URL` pooled `app_runtime`: no; not configured.
- `DATABASE_DIRECT_URL` absent: yes.
- Primary R2 configured: no.
- Recovery R2 configured: no.
- Required internal production secrets configured: no.
- Bootstrap variables absent: yes.
- Production R2 proof status from the secure handoff: primary allowed-bucket PASS; primary cross-bucket isolation PASS; recovery allowed-bucket PASS; recovery upload/download/SHA256/delete PASS; recovery cross-bucket isolation PASS. Proof was not re-run because configuration did not complete.
- Canonical production config validation: FAIL against the empty process environment; validation was not weakened with placeholders.
- Secure handoff file deleted: yes, after all five values were loaded into process memory.
- `.neon` tracked/committed: no; it is untracked (`?? .neon`). It was not modified or committed.
- Application deployed: no.
- `fuel.shandahr.com` changed: no.

## Interruption record

The handoff was validated as owner `wolftech` with mode `600`, loaded in
memory, and deleted as required. An operator execution error occurred after
the first non-secret variable was attempted; that single partial `APP_ENV`
write was removed immediately. Final Vercel production metadata is empty, and
no secret or generated internal secret was written to Vercel.

Exact next action: create a new approved secure handoff containing the five
production values, then rerun the production-only configuration procedure.
Do not provide secret values in chat.
