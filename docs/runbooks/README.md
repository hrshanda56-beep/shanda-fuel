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
| [`observability.md`](observability.md) | Expectations ready; integration open | Connect structured logs, dashboards, alert routing, retention, and escalation. |
| [`staging-performance-verification.md`](staging-performance-verification.md) | Procedure ready; execution open | Run with the RC against representative synthetic data. |
| [`staging-auth-smoke-bootstrap.md`](staging-auth-smoke-bootstrap.md) | Procedure ready; staging execution open | Use only with the approved staging URL, secrets, and operator. |
| [`key-rotation.md`](key-rotation.md) | Repository procedure ready; provider execution open | Name the secret manager, execute staging/production rotation, verify overlap/retirement, and retain metadata-only evidence. |
| [`production-configuration.md`](production-configuration.md) | Repository checks ready; provider evidence open | Verify DNS, TLS, edge/WAF, environment binding, and runtime smoke with the provider/operator. |
| [`codeql.md`](codeql.md) | Repository workflow prepared; provider availability open | Enable GitHub Code Scanning/GHAS support and record a successful CodeQL matrix run. |
| [`tenant-recovery.md`](tenant-recovery.md) | Missing tested procedure | Define isolated extract tooling, repair ownership, and execute a drill. |
| [`staging-recovery-rehearsal.md`](staging-recovery-rehearsal.md) | Repository rehearsal ready; provider execution open | Prepare the isolated Neon target, known-good timestamp, staging read-only session, and R2 controls, then run the two-phase rehearsal. |

There is no separate job/outbox operations runbook yet. It should be added if
background jobs are enabled for production scope, with lease/retry,
tenant-context, terminal-failure, and replay procedures. Report/export and
object-storage lifecycle runbooks are also needed before those capabilities are
enabled in a pilot scope.
