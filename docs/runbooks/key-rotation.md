# Key rotation runbook

## Status

**OPEN — owner-specific procedure required before pilot/production sign-off.**

The repository has separate configuration values for the Better Auth secret,
audit signing key, R2 credentials, Resend credentials, and cron secret, but it
does not contain the provider's secret-manager or deployment-control details.
Do not rotate any key from this placeholder or by editing repository files.

## Required procedure to complete

1. Name the deployment/provider owner and secret-manager location.
2. Define overlap/dual-key behavior, if supported, for each key class and the
   expected session, audit, storage, email, and job impact.
3. Rotate in staging, run authenticated smoke, audit-signing, storage/email,
   and job checks, then record old-key retirement timing.
4. Rotate production during an approved window, verify health/readiness and
   security events, and confirm the old secret is revoked or expired.
5. Record key ID, start/end time, approver, evidence, and rollback/recovery
   action without recording secret material.

This is a known operational follow-up, not a reason to alter authentication or
MFA behavior in the RC.
