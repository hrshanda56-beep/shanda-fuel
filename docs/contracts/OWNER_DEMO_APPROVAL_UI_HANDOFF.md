# Owner demo approval UI handoff — Claude

Base: `99bbe34cd9e978288f4ffb55fcad9f144e127922`.
Backend candidate: `codex/owner-demo-backend`. Synthetic local environments only.
No production or staging operation is authorized. Preserve all unrelated worktrees.

## Approval contract

The production reconciliation review surface is
`/stations/{stationId}/reconciliations/{reconciliationId}/review?tenantId={tenantId}&businessDayId={businessDayId}&shiftId={shiftId}`.
Keep the existing management review and server-derived authorization. Only a
SUBMITTED reconciliation can be approved. Keep the current explicit confirmation;
authorization, expected version, idempotency, canonical sale/cost/revenue posting,
and audit remain server-owned.

1. Establish assurance using `POST /api/auth/step-up`, same-origin cookies,
   `Content-Type: application/json`, `Cache-Control: no-store` behavior.
2. Better Auth body: `{ tenantId, password, totpCode }`. Both real factors are
   required and MFA must already be enrolled. Existing setup endpoints are
   `/api/auth/mfa/setup` (password) and `/api/auth/mfa/setup/verify` (six-digit code).
   Never manufacture step-up fields or store credentials in browser persistence.
3. Clerk body: `{ tenantId, action: "APPROVE_RECONCILIATION" }`. Use the existing
   `useReverification` pattern: pass Clerk's `clerk_error` challenge response back
   to Clerk, complete reverification, and retry the same step-up request with the
   challenge cookie. This dedicated action requires `strict_mfa`, including for
   tenant Owners. Lock/deactivation tokens cannot authorize reconciliation approval.
   MFA enrollment must be completed through Clerk's supported account interface;
   do not offer the existing no-MFA Owner lock exception for approval.
4. Success: HTTP 200 `{ status: "active", stepUpLevel: 1, expiresAt }`; Clerk also
   receives an HttpOnly signed assertion cookie. Assurance is session-, tenant-,
   action-bound and expires after at most ten minutes/session expiry. Password/code
   should be cleared immediately. Cancellation or errors must leave approval unposted.
5. Then POST `/api/forecourt/commands` with an `Idempotency-Key` and JSON:
   `{ commandType: "ApproveProductionReconciliation", tenantId, stationId,
   reconciliationId, expectedVersion }`. Use the currently loaded record version.
   Success returns state/version; reload persisted detail and show APPROVED only
   after successful server response. A 403 must offer re-verification; do not infer
   that every 403 is MFA (permission errors remain errors). A stale 409 requires
   refresh/review, not automatic approval of changed evidence.

## UI acceptance

- Reachable verify-identity action before approval; usable password + authenticator
  inputs for Better Auth and Clerk reverification for Clerk.
- Permission/state-aware controls; keyboard-accessible dialog/errors and mobile fit.
- No approval POST on cancelled/failed verification; no optimistic APPROVED display.
- No synthetic assurance, MFA bypass, relaxed assertions, or altered accounting.
- Keep existing return-for-correction behavior and reason requirement.
- Existing `src/modules/setup/ui/step-up-dialog.tsx` demonstrates the provider
  patterns but is payment-specific and hard-codes LOCK_BUSINESS_DAY for Clerk.
  Do not reuse that lock action for approval. Generalize presentation/action props
  or implement an approval-specific component.

## Integration delivery

Deliver a validated UI commit based on the above base, with exact SHA and focused
browser/type/lint evidence. Backend integration will cherry-pick the commit into
its isolated candidate and rerun the combined real-runtime PostgreSQL/browser
workflow. Do not edit the backend worktree. Local Better Auth E2E can verify real
password/TOTP enrollment and step-up; Clerk hosted-provider UI verification requires
an authorized disposable Clerk test environment and is reported separately.
