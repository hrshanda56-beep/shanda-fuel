# Branch and worktree review — 2026-10-22

Read-only review of local branches against the integration branch
`codex/clerk-only-auth-20261017`. Nothing was deleted, moved or reset.

## Summary

| Group | Count | Meaning | Suggested action |
|---|---|---|---|
| Reachable from the integration branch | 129 | Every commit is already in the integration branch | Safe to delete after approval |
| Same changes, different commits | 18 | Each commit has an equivalent already in the integration branch | Safe to delete after approval |
| Content already identical | 65 | Different commit history, but every file the branch changed is byte-identical on the integration branch | Safe to archive or delete after approval |
| Content not in the integration branch | 3 | See the next section | Keep until reviewed |
| Worktrees with uncommitted changes | 12 | See the last section | Do not delete; owner review |

Worktrees: 119. Remote branches: 119 (78 are already merged into the integration branch).

## Branches with content not in the integration branch

| Branch | What it holds | Verdict |
|---|---|---|
| codex/phase2-completion | One extra test for meter-exception command dispatch (13 lines) | Cherry-pick if wanted; low value |
| codex/reconciliation-shift-fixture | One end-to-end test fixture reset (11 lines) | Needs a browser-test environment to judge; keep |
| codex/staging-latency-canary-fra1 | 4 lines in vercel.json to pin a staging region | Staging-only experiment; not for the integration branch |

## Worktrees with uncommitted changes (left untouched)

| Worktree branch | Changed files | Notes |
|---|---|---|
| codex/finance-reporting-export-20261019 | 14 | Profitability and reporting changes; 6 of the 14 files are already identical on the integration branch. Overlaps files this branch has since changed. Review before discarding |
| codex/expenses-domain-rules | 9 | New expense domain, commands, queries, API route. The integration branch has its own expense modules (unified expense evidence and corrections); check for overlap |
| agent/release-hardening | 8 | Step-up identity module, security route, golden financial scenarios test; also edits two locked UI files |
| codex/inventory-calibration | 3 | Calibration domain edits; the integration branch already has tank calibration (migration 0044) |
| codex/cash-handover-rules | 2 | The integration branch already has cash handover (migration 0043) |
| agent/a6-cash-banking | 2 | Old Phase A branch |
| feat/supplier-workflows, feat/settlement-workflows, feat/inventory-workflows, feat/cash-workflows, codex/phase1-integration, agent/staging-auth-smoke-bootstrap | 1 each | Small leftovers |

## Open pull requests

| PR | Branch | Content state | Suggestion |
|---|---|---|---|
| 144 | ui/ux | Every changed file is identical on the integration branch | Close once the integration branch merges to main |
| 125 | codex/station-navigation-hotfix-current-main | Identical on the integration branch | Close once the integration branch merges to main |
| 146 | codex/clerk-only-auth-20261017 | The integration branch itself (draft) | Keep |
| 129, 132, 147, 148 (GitHub Actions: upload-artifact, setup-node, codeql init and analyze) | dependabot | Minor bumps | Apply on a sub-branch of the integration branch |
| 131, 137, 138, 139, 142, 143 (s3-request-presigner, zod, client-s3, @clerk/backend, resend, @clerk/nextjs) | dependabot | Patch bumps | Apply together on one sub-branch, then run the full checks |
| 135 and 141 (next 16.3.8 → 16.4.0 and eslint-config-next) | dependabot | Framework minor; this repo documents breaking changes in Next | Apply as a pair on their own sub-branch with a full build and browser run |
| 136 (@types/node 24 → 26) | dependabot | Major; the app runs on Node 24 | Hold |
| 134 (dotenv 17 → 18) | dependabot | Major | Hold until needed |
| 130 (actions/setup-python 6 → 7) | dependabot | Major | Hold; check the workflows that use it |

The dependency pull requests target `main`, which is behind the integration branch. Merging them
into `main` first would cause lockfile conflicts, so apply them on the integration branch instead.

## Branches safe to delete after approval

### Reachable from the integration branch (129)
- agent/a1-platform-security
- agent/a10-1-restated-cogs
- agent/a10-2-revenue-margin
- agent/a12-2-costing-schema-wac
- agent/a12-3-opening-receipt-sale-cogs
- agent/a12-4-late-cost-revaluation
- agent/a12-5-restatement-analysis
- agent/a12-inventory-costing-cogs
- agent/a2-ui-foundation
- agent/a3-core-forecourt
- agent/a9
- agent/a9-provider-reversal-fix
- agent/qa1-golden-scenarios
- agent/rc-audit
- agent/rc-auth-staging
- agent/rc-performance
- agent/rc-platform-smoke
- agent/rc-resilience
- agent/release-hardening
- agent/release-ops-docs
- agent/rev1-canonical-revenue
- agent/sec1-security-audit
- agent/security-step-up
- agent/staging-forecourt-auth-hardening
- agent/staging-platform-adapters
- agent/ux-a12-valuation
- agent/ux-ops-workflows
- agent/ux1-operator-audit
- audit/backend-gap-roadmap
- audit/ci-security
- audit/cross-module-journeys
- audit/cutover
- audit/final-release-gate
- audit/incident-readiness
- audit/load-capacity
- audit/observability
- audit/prod-readiness
- audit/security-ops
- codex/cash-handover-rules
- codex/ci-security-hardening-20260929
- codex/clerk-db-staff-20261017
- codex/clerk-test-migration
- codex/delivery-workflow
- codex/expenses-domain-rules
- codex/finance-reporting-export-20261019
- codex/first-owner-bootstrap
- codex/lane4-r2-recovery
- codex/login-cookie-hotfix
- codex/observability-launch-hardening-20260930
- codex/observability-p0-20260929
- codex/observability-provider-preflight-20260930
- codex/operations-overview-perf
- codex/operations-performance-pr
- codex/owner-demo-clerk-port
- codex/performance-investigation
- codex/phase0-overnight-integration
- codex/phase0-review-final
- codex/phase1-backend-fixes
- codex/phase1-integration
- codex/phase1-stabilization
- codex/phase1-ui-test-readiness
- codex/pr144-merge-candidate-20261015
- codex/pr144-phase1-integration-review
- codex/production-readonly-smoke-20260929
- codex/rate-limit-staging-proof-20260930
- codex/recovery-execution-preflight-20260930
- codex/recovery-rehearsal-hardening-20260930
- codex/security-production-gates-20260930
- codex/source-of-truth
- codex/source-of-truth-final
- codex/station-activation-phase0
- codex/station-selection-login-hotfix
- codex/truth-sha-fix
- codex/truth-sync
- codex/v1-fix-a10-fixture
- codex/v1-merge-delivery-workflow
- codex/v1-merge-owner-demo
- codex/v1-ui-lock
- docs/ci-security-hardening-verified
- docs/design-system-verified
- docs/lane4-app-recovery-verified
- docs/lane4-r2-recovery-verified
- docs/lane4-recovery-evidence
- docs/lock-execution-ownership
- docs/observability-p0-verified
- docs/product-shell-verified-20260930
- docs/production-readonly-smoke-verified-20260930
- docs/release-handover
- docs/security-p0-verified
- feat/cash-workflows
- feat/clerk-staff-number-auth-0027
- feat/context-selector-foundation
- feat/dashboard-real-data
- feat/inventory-workflows
- feat/settings-foundation
- feat/settlement-workflows
- feat/shell-consistency
- feat/supplier-workflows
- feature/receipt-document-ocr-20261001
- fix/ci-enforce-csp-config-test
- fix/provider-membership-preflight
- fix/security-p0-dev-csp
- hardening/ci-security
- hardening/observability-p0
- hardening/security-p0
- hardening/security-p0-v2
- integration/baseline-codex-e00763f
- integration/baseline-pr120-4ef3c72
- integration/baseline-pr120-9669c46
- integration/cand-fe9012567-pr120-4ef3c72
- integration/prep-fe9012567-pr120-4ef3c72
- integration/prep-fe9012567-pr120-9669c46
- ops/milestone-a-release-prep-20261012
- perf/instant-loading-20261009
- plan/approval-infrastructure
- plan/first-production-user
- prep/agent-readiness
- reports/redesign-multi-station
- security/next-critical-audit-fix-20260930
- ui/auth-entry-onboarding
- ui/dashboard-mobile-polish
- ui/design-system-foundation
- ui/phase-0-5-premium-ux-20261008
- ui/polish-20260930
- ui/polish-release-20261001
- ui/pr144-final-corrections-20261015
- ui/product-shell-20260929
- ui/settings-profile-layout-clean-20261008
- ui/visual-polish-20261010

### Same changes, different commits (18)
- chore/next-env-generated
- codex/adr015-reconciliation-20261009
- codex/aws-sdk-coordinated-repair-20261009
- codex/clerk-server-only-20261017
- codex/job-runtime-quarantine-docs
- codex/phase0-customers
- codex/phase0-integration-candidate
- codex/phase0-mobile-shell
- codex/pr-consolidation-after-phase0
- codex/pr144-final-gates-20261015
- codex/ui-ux-polish
- docs/adr-015-ui-redesign
- fix/restore-approved-ui-20261009
- hotfix/dependency-audit-exception-20261004
- hotfix/remove-staging-auth-bootstrap-20261003
- integration/agent3-fe9012567-pr120-4ef3c72
- ui/phase1-customer-operations
- ui/recovery-polish-20261001

### Content already identical (65)
- agent/a0-integration-foundation
- agent/a10-management-reporting
- agent/a4-inventory
- agent/a6-cash-banking
- agent/a7-supplier-creditors
- agent/a8-customer-accounts
- agent/a9-provider-settlements
- agent/staging-auth-smoke-bootstrap
- backup/attendant-my-shift-pre-rebase-787b656
- codex/application-performance
- codex/backend-performance
- codex/clerk-only-ui-20261017
- codex/clerk-runtime-blocker-120
- codex/customer-credit-0025-blocker-fix
- codex/customer-credit-0025-ci-fix
- codex/final-integration-rehearsal
- codex/inventory-calibration
- codex/m4-dashboard-slice
- codex/m5-customer-lifecycle
- codex/m5-review-final
- codex/onboarding-minimal-integration
- codex/operational-e2e-remediation
- codex/operational-workflow-fixes
- codex/owner-demo-preparation
- codex/owner-workflow-integration
- codex/phase0-integration-clean
- codex/phase0-m1-rehearsal
- codex/phase0-owner-demo
- codex/phase1-backend-gap-audit
- codex/phase1-contract-decomposition
- codex/phase1-dashboard-candidate
- codex/phase1-engineering-lead-20261012
- codex/phase1-independent-quality-20261015
- codex/phase1-integration-candidate
- codex/phase1b-onboarding
- codex/phase2-integration-candidate
- codex/phase2-isolated-development
- codex/pr144-clean-review
- codex/production-support-readiness
- codex/release-gate-reconciliation
- codex/role-workspaces-20261009
- codex/staff-e2e-flake-fix
- codex/staff-training
- codex/stage1-closeout
- codex/stage1-preflight-calibration
- codex/station-navigation-hotfix-current-main
- codex/station-onboarding
- codex/station-onboarding-completion
- codex/tz-review
- codex/workflow-integrated-verification-20261015
- feat/attendant-my-shift-20261009
- feat/customer-credit-station-scope
- feat/milestone-a-setup-backend-20261012
- feat/milestone-a-setup-frontend-20261012
- fix/launch-ci-and-overflow-20261012
- fix/staff-invite-release-blocker-20261009
- ops/staging-auth-bootstrap-one-shot-20260930
- pr/113
- tmp/ui92-integration-sim
- ui/audit-pages-to-dashboard-20261008
- ui/pages-match-dashboard
- ui/redesign-shell-overview
- ui/reports-redesign
- ui/settings-profile-layout-20261008
- ui/ux
