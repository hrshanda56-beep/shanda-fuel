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
| [`key-rotation.md`](key-rotation.md) | Missing provider-specific procedure | Define secret-manager, overlap, verification, and retirement steps. |
| [`tenant-recovery.md`](tenant-recovery.md) | Missing tested procedure | Define isolated extract tooling, repair ownership, and execute a drill. |

There is no separate job/outbox operations runbook yet. It should be added if
background jobs are enabled for production scope, with lease/retry,
tenant-context, terminal-failure, and replay procedures. Report/export and
object-storage lifecycle runbooks are also needed before those capabilities are
enabled in a pilot scope.
