# Shanda Fuel temporary rate-limit launch exception packet

Prepared: 2026-10-04T02:53:18Z (UTC)

This packet records the explicit operator approval below. It does not
authorize a new staging test or provider configuration change.

## 1. Technical status

**RATE LIMIT IMPLEMENTATION:** PASS

**LOCAL TESTS:** PASS

**STAGING E2E TECHNICAL STATUS:** BLOCKED — PROVIDER

The application contract is 20 requests per 60 seconds. Requests 1–20 are
expected to return HTTP 204. Request 21 is expected to return an
application-generated HTTP 429 with body `{"error":"RATE_LIMITED"}`, a
positive `retry-after`, `x-ratelimit-limit: 20`, and
`x-ratelimit-remaining: 0`.

The implementation and focused local tests pass. The final staging E2E proof
is not PASS.

## 2. Exact gap

The existing staging attempt observed requests 1–20 reaching the application
and returning HTTP 204. Request 21 was intercepted upstream before the
Next.js runtime. Therefore the expected application-generated HTTP 429 and
its rate-limit headers were not directly proven in final staging. The
observed upstream response cannot establish that the PostgreSQL-backed
application limiter executed or returned the required contract.

No new 21-request burst was executed for this packet.

## 3. Supporting evidence

### Application and local evidence

- Route: `GET /api/security/rate-limit-proof`.
- Policy: 20 requests per 60 seconds using the durable PostgreSQL-backed
  limiter.
- Local focused tests: PASS — 3 files, 23 tests.
- Relevant implementation/test evidence:
  - `src/app/api/security/rate-limit-proof/route.ts`
  - `src/platform/security/rate-limit.ts`
  - `src/platform/staging/rate-limit-proof.ts`
  - `src/app/api/security/rate-limit-proof/route.test.ts`
  - `src/platform/staging/rate-limit-proof.test.ts`
  - `docs/runbooks/staging-rate-limit-proof.md`
  - `docs/decisions/ADR-016-security-production-gates.md`

### Existing provider-support evidence

- Provider-support packet: `launch-closeout-prep-20261003T124542Z.md`
  - SHA256: `93f1ff7d39fdb2b8099e374cdb065098e0c54a0a19a1d0b1d3cdb3ee775df738`
- Rate-limit closeout: `rate-limit-closeout-20261003T132355Z.md`
  - SHA256: `8caa952009b55cee31590806a85ed4258f684ee81b9815d534ab583f0e1c2d33`
- Existing observation: requests 1–20 reached the application and returned
  204; request 21 was intercepted upstream.
- Existing provider-support request asks for correlation of the already
  recorded attempt, including timestamps, deployment/region, request IDs,
  exact protection layer/rule, runtime reachability, and a safe diagnostic
  mechanism. It does not request a new burst or provider mutation.

### Read-only provider inspection

The read-only Vercel inspection found no custom WAF rules, IP blocks, or
bypass rules; Bot Protection and Attack Mode were OFF; built-in/system
protections were active; and firewall history showed no custom
denied/challenged requests. The exact upstream protection layer remains
unidentified.

### Final staging state

- Main SHA: `19735bc3f6eb6aee504c992479c45aacd8c0d476`
- Final staging deployment: `dpl_QwV8ceoTEcrMoxtuk3e9fX4ewdMs`
- Canonical staging: `https://shanda-fuel-staging.vercel.app`
- Staging cleanup evidence:
  `staging-cleanup-final-20261004T025016Z.md`
- Staging cleanup evidence SHA256:
  `08f2c9560cc9f57f995884fb326055b2970f4f5d5e5134681cc9279884a4d699`
- Final staging health/readiness: PASS.

## 4. Residual risk

- The application limiter has not been directly proven at threshold in final
  staging.
- Provider/system behavior may interfere with the exact client-visible
  response and headers.
- A limiter regression at threshold could remain undetected until provider
  correlation or an approved staging E2E proof is obtained.

This packet does not claim zero risk and does not call staging E2E PASS.

## 5. Mitigations

- The durable application rate-limit implementation exists.
- Focused local tests pass.
- The first 20 staging requests reached the application correctly.
- Vercel provides upstream system protections.
- Final staging health and readiness checks passed.
- Read-only inspection found no custom firewall rules interfering with the
  route.
- Rollback/redeploy procedures are available through the staging deployment
  history and clean-main deployment process.

## 6. Temporary operating conditions

If a human explicitly approves this temporary evidence exception:

- Do not weaken or remove the application limiter.
- Do not disable Vercel system protections.
- Continue the provider support/correlation request for the existing attempt.
- Perform one approved E2E proof when Vercel supplies a safe mechanism.
- Immediately remove any temporary bypass after that proof.
- Update the launch ledger with the final result.

## 7. Expiry and review

**EXCEPTION REVIEW:** 7 days after approval OR immediately upon Vercel
response, whichever comes first.

The approval timestamp and named approver must be recorded in the launch
ledger. This packet does not supply either approval.

## 8. Decision

[x] APPROVE TEMPORARY RATE-LIMIT EVIDENCE EXCEPTION
[ ] KEEP LAUNCH BLOCKED PENDING STAGING E2E PROOF

### Recorded approval

- Approval UTC timestamp: 2026-10-04T02:57:17Z
- Decision source: explicit operator approval in the launch-ledger request.
- Technical status remains: **BLOCKED — PROVIDER**.
- Implementation/local tests remain: **PASS**.
- Residual risk: accepted temporarily for launch decision-making; the
  application-level staging E2E 429 remains unproven.
- Review trigger: Vercel response or exception expiry, whichever comes first.
- No firewall/provider mutation was performed.
- No additional rate-limit burst was performed.

## 9. Safety confirmation

- Staging unchanged by this packet: confirmed.
- Production untouched: confirmed.
- Recovery untouched: confirmed.
- No rate-limit burst executed: confirmed.
- No firewall mutation: confirmed.
