# Operator runbook inventory

This inventory distinguishes documented procedures from procedures that still
need provider access or a witnessed execution. A documented procedure is not
evidence that the operational exercise has passed.

| Runbook | Status | Remaining action |
| --- | --- | --- |
| [`deployment.md`](deployment.md) | Procedure ready | Fill provider control-plane owner and attach deployment evidence. |
| [`backup-restore.md`](backup-restore.md) | Database and app verification complete; R2 recovery open | Retain the Lane 4 evidence and close the R2 deleted-object recovery gap. |
| [`r2-object-recovery.md`](r2-object-recovery.md) | Implementation ready; provider configuration and witnessed drill open | Configure the separate locked recovery bucket and run the dedicated staging drill. |
| [`incident-response.md`](incident-response.md) | Procedure ready | Connect paging, traffic controls, and on-call ownership. |
| [`observability.md`](observability.md) | In-repo contract and validation ready; provider integration open | Follow [`observability-provider-setup.md`](observability-provider-setup.md), then execute [`observability-staging-alert-proof.md`](observability-staging-alert-proof.md). |
| [`observability-provider-setup.md`](observability-provider-setup.md) | Procedure ready; provider execution open | Select the approved sink, configure drain/parser, import alerts/dashboard, set retention and owners, and attach evidence. |
| [`observability-staging-alert-proof.md`](observability-staging-alert-proof.md) | Safe rehearsal ready; execution open | Run only against staging and prove searchability, alert firing, owner delivery, acknowledgement, and cleanup. |
| [`staging-performance-verification.md`](staging-performance-verification.md) | Procedure ready; execution open | Run with the RC against representative synthetic data. |
| [`staging-auth-smoke-bootstrap.md`](staging-auth-smoke-bootstrap.md) | Retired historical record | The temporary bootstrap helper and package command were removed; do not execute this procedure. |
| [`staging-rate-limit-proof.md`](staging-rate-limit-proof.md) | Procedure ready; staging execution open | Run only against the approved staging HTTPS origin with a current authenticated session and migration `0020` deployed. |
| [`key-rotation.md`](key-rotation.md) | Repository procedure ready; provider execution open | Name the secret manager, execute staging/production rotation, verify overlap/retirement, and retain metadata-only evidence. |
| [`production-configuration.md`](production-configuration.md) | Repository checks ready; provider evidence open | Verify DNS, TLS, edge/WAF, environment binding, and runtime smoke with the provider/operator. |
| [`codeql.md`](codeql.md) | Repository workflow prepared; provider availability open | Enable GitHub Code Scanning/GHAS support and record a successful CodeQL matrix run. |
| [`tenant-recovery.md`](tenant-recovery.md) | Missing tested procedure | Define isolated extract tooling, repair ownership, and execute a drill. |
| [`milestone-a-release.md`](milestone-a-release.md) | Prepared; owner execution open | Vercel access/plan decisions, pre-migration Neon branch + dump, rehearsal, then 0027-0029 and smoke. |
| [`staging-recovery-rehearsal.md`](staging-recovery-rehearsal.md) | Repository rehearsal ready; provider execution open | Prepare the isolated Neon target, known-good timestamp, staging read-only session, and R2 controls, then run the two-phase rehearsal. |

There is no separate job/outbox operations runbook yet. It should be added if
background jobs are enabled for production scope, with lease/retry,
tenant-context, terminal-failure, and replay procedures. Report/export and
object-storage lifecycle runbooks are also needed before those capabilities are
enabled in a pilot scope.
