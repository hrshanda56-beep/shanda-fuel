# Key rotation runbook

## Status

**Repository procedure ready; provider-specific execution remains open.**

The repository has separate configuration values for the Better Auth secret,
audit signing key, R2 credentials, Resend credentials, and cron secret, but it
does not contain the provider's secret-manager or deployment-control details.
Do not rotate any key from this placeholder or by editing repository files.

## Repository-side contract

Rotate values in the provider secret manager, never in repository files. The
following identities are separate rotation units: `BETTER_AUTH_SECRET`,
`AUDIT_SIGNING_KEY_ID` + `AUDIT_SIGNING_KEY`, primary R2 credentials, recovery
R2 credentials, `RESEND_API_KEY`, and `CRON_SECRET`. Staging and production must
use different secret-manager entries and values.

The audit key ID is recorded with security events, so a rotation record must
include the new key ID without including key material. The current repository
does not implement dual-key verification; overlap is therefore provider- and
operator-controlled, and the old value must remain only as long as the
approved compatibility window requires.

## Required provider/operator procedure

1. Name the deployment/provider owner and secret-manager location; record the
   staging and production entries separately.
2. Define overlap/dual-key behavior, if supported, for each key class and the
   expected session, audit, storage, email, and job impact.
3. Rotate in staging, run authenticated smoke, audit-signing, storage/email,
   and job checks, then record old-key retirement timing.
4. Rotate production during an approved window, verify health/readiness,
   runtime-role/rate-limit checks, and
   security events, and confirm the old secret is revoked or expired.
5. Record key ID, start/end time, environment, approver, evidence, old-key
   retirement confirmation, and rollback/recovery action without recording
   secret material.

Required evidence is metadata only: provider/deployment identifier, environment,
key ID where applicable, check names and pass/fail, timestamps, approver, and
retirement result. Never record the value, connection string, cookie, backup
code, or raw provider export.

This is a known operational follow-up, not a reason to alter authentication or
MFA behavior in the RC.
