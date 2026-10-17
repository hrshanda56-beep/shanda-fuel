# Shanda Fuel rate-limit closeout

**Decision:** `RATE LIMIT: BLOCKED — PROVIDER`

**Prepared:** 2026-10-03T13:23:55Z  
**Repository:** `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel`  
**Observed checkout:** `ops/staging-auth-bootstrap-one-shot-20260930` at `05f3b355e2440a3d83977f844709a99d0ad8c625`  
**Requested main:** `0db85f6192f7c96fd92282389cc970b35bae2e33`  
**Canonical staging:** `https://shanda-fuel-staging.vercel.app`  
**Vercel project:** `shanda-fuel-staging` / `prj_Bg5vKaqhyVQipr4o7PI7LdeSrNX4`  
**Vercel team:** `shanda-hr-s-projects` / `team_VMthg2WoTS6eeOP5BjRh3i8b`

## 1. Exact application contract

- Route: `GET /api/security/rate-limit-proof`.
- Availability: staging only, and only when `VERCEL_PROJECT_ID` is unset or is
  `prj_Bg5vKaqhyVQipr4o7PI7LdeSrNX4`; production, local, and other projects
  return an empty `404`.
- Authentication: the route is authenticated after the limiter; it accepts no
  tenant, business, financial, or command input and performs no business write.
- Policy: dedicated `proof` bucket, **20 requests per 60 seconds**, keyed by a
  SHA-256 hash of the trusted client-address bucket and policy scope.
- Expected sequence: requests 1–20 return HTTP `204` with an empty body and
  `cache-control: no-store`; request 21 returns the application HTTP `429`.
- Application `429` response: JSON body `{"error":"RATE_LIMITED"}` with
  `cache-control: no-store`, `content-type: application/json`, a positive
  integer `retry-after` no greater than 60, `x-ratelimit-limit: 20`, and
  `x-ratelimit-remaining: 0`.
- Generation point: `platform.consume_rate_limit(text,text,integer,integer)`
  atomically denies the exhausted bucket; `withPersistentRateLimit` then calls
  `rateLimitResponse`. The denied request is returned before authentication.
- Request path: the repository has no `src/middleware.ts`; the Next.js route is
  wrapped by application request observability, then the persistent limiter,
  then authentication. Vercel edge/deployment protection is outside the app
  and precedes the function/runtime.
- No staging-only semantic exception changes the limiter. The staging-only
  behavior is route exposure/404 guarding, not a weaker limiter.

## 2. Exact observed provider behavior

The existing closeout evidence records:

- Requests 1–20 returned HTTP `204` and reached the application.
- Request 21 was intercepted upstream before the application, so it did not
  establish the PostgreSQL-backed application limiter's `429`.
- The automation/protection-bypass attempt did not produce application-level
  `429` proof.
- No raw successful evidence record from that run is present locally. The exact
  request-window timestamp, deployment ID, request IDs, edge rule ID, exact
  upstream status, and upstream headers/body are therefore **unavailable**, not
  inferred.

This separates the evidence as follows:

| Question | Application limiter | Vercel/edge/provider |
| --- | --- | --- |
| Requests 1–20 | Existing closeout record says HTTP 204 reached the app | Not independently correlated here |
| Request 21 | No app invocation/429 proof | Existing closeout record says upstream interception |
| `429` headers/body | Defined and unit-tested locally, not observed on staging request 21 | Exact upstream response not retained locally |
| Rule/layer identity | Not applicable | Unknown pending Vercel correlation |

## 3. Read-only provider inspection

Read-only inspection was attempted against the stated project/team using the
connected Vercel provider tools and local Vercel CLI.

- Deployment listing returned Vercel `403 Forbidden`: access to scope
  `shanda-hr-s-projects` requires re-authentication or a token authorized for
  `team_VMthg2WoTS6eeOP5BjRh3i8b`.
- Runtime-log query returned `403 Forbidden` (“You don't have permission to
  access this resource”).
- Runtime-error query returned `403 Forbidden`.
- Project-details inspection through the connector could not be completed
  because its project argument mapping rejected the supplied project ID before
  the provider request (`idOrName` was required).
- Local `vercel whoami --scope shanda-hr-s-projects` failed with a fetch error;
  no authenticated identity was exposed. No provider mutation was attempted.

Consequently, this task cannot name or prove the exact Vercel layer that
handled request 21. The provider findings are an access limitation, not proof
that a particular firewall, bot, attack-mitigation, or deployment-protection
rule was responsible.

## 4. Root reason the request-21 result does not prove app `429`

The edge/provider handled request 21 before the Next.js function/runtime. A
provider-generated response can have status `429` (or another protection
response) without carrying the application's `x-ratelimit-*` and `retry-after`
contract, without executing `platform.consume_rate_limit`, and without
proving the app returned `{"error":"RATE_LIMITED"}`. The bypass attempt did
not remove that ambiguity. Therefore this gate cannot be called `PASS`.

## 5. Provider-ready support packet

Please correlate the **already-recorded** attempt; do not start another
21-request burst.

**Project and route**

- Project: `shanda-fuel-staging`
- Project ID: `prj_Bg5vKaqhyVQipr4o7PI7LdeSrNX4`
- Team: `shanda-hr-s-projects` / `team_VMthg2WoTS6eeOP5BjRh3i8b`
- Origin: `https://shanda-fuel-staging.vercel.app`
- Route: `GET /api/security/rate-limit-proof`
- Relevant repository commit containing the route/harness: `05f3b355e2440a3d83977f844709a99d0ad8c625`
- Deployment identifier: unavailable in local evidence

**Expected versus actual**

- Expected: 20 authenticated `204` responses, then an application-generated
  `429` with the documented headers/body.
- Actual: requests 1–20 were recorded as `204` and reaching the app; request
  21 was recorded as intercepted upstream; the automation bypass did not
  produce application-level `429` proof.
- Attempt timestamps and request IDs: unavailable in the repository; please
  recover them from provider logs/support correlation if retained.

**Exact technical questions**

1. For the existing request window, what are the UTC timestamps, deployment or
   region, and edge event/request IDs for requests 1–21?
2. Which exact protection layer and rule handled request 21? Provide its action
   and rule ID, if applicable: firewall/WAF, bot management, attack mitigation,
   deployment protection, abuse/rate control, or another edge layer.
3. Did request 21 reach the Next.js function/runtime? If not, classify the
   response status and redacted headers/body family.
4. For requests 1–21, provide the redacted edge decision and response
   classification, including whether application execution occurred.
5. Is there an existing supported, staging-only diagnostic mechanism that
   allows this exact route and one controlled proof window to reach the app
   limiter while preserving normal production and staging protection? If so,
   document the smallest reversible change and its rollback. Do not apply it
   during this task.

**Smallest provider action requested:** read-only correlation/explanation for
the existing attempt. If the provider cannot recover the identifiers or prove
the edge decision, return that limitation explicitly. A provider configuration
mutation is not requested or authorized by this packet.

## 6. Live diagnostic and verification

- Live staging diagnostic: **none**.
- 21-request staging burst: **not run**.
- Production route/smoke/deployment/secrets: **not touched**.
- Recovery scripts/project/branches: **not touched**.
- Staging cleanup/bootstrap removal: **not executed**.
- Canonical staging configuration: **unchanged**; only read-only local metadata
  and provider queries were inspected.
- Local tests: `pnpm exec vitest run
  src/platform/security/rate-limit.test.ts
  src/platform/staging/rate-limit-proof.test.ts
  src/app/api/security/rate-limit-proof/route.test.ts` — **3 files, 23 tests
  passed** at 2026-10-03T13:23:41Z.

## 7. Exact evidence paths and SHA-256

The following are the repository evidence used for this packet:

| Path | SHA-256 |
| --- | --- |
| `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel/launch-closeout-prep-20261003T124542Z.md` | `93f1ff7d39fdb2b8099e374cdb065098e0c54a0a19a1d0b1d3cdb3ee775df738` |
| `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel/src/app/api/security/rate-limit-proof/route.ts` | `fc424e6396c1bdd0d458e000398e14d15448136e71b515d4624133b434e3732c` |
| `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel/src/platform/security/rate-limit.ts` | `f511344cc541d5ff0323801b27f50f6abe5e88242db606efa5386ab1f8429bc7` |
| `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel/src/platform/staging/rate-limit-proof.ts` | `27074bf95e69c49889be42bc8b3e6718ed3950cd9bfb07f9767cdee9a6269e3e` |
| `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel/src/app/api/security/rate-limit-proof/route.test.ts` | `a2c0aeb0d185406c13b25949c9cc19d7969e89a8c7d36ce9ce9d43e72ef1e1cf` |
| `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel/src/platform/staging/rate-limit-proof.test.ts` | `9bd12d5ec55b504d6b0aab26d545f79339738f2a794cef39af69c9bc922a65a4` |
| `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel/docs/runbooks/staging-rate-limit-proof.md` | `517ac78988711a195024bf913f07076ee30cccdbf8a9a683a614f715c25ca0c1` |
| `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel/docs/decisions/ADR-016-security-production-gates.md` | `e963761073c2a2980ab4158cf6edb19bbe30c472437eba1cb833dccb1bad081a` |
| `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel/src/platform/db/migrations/0020_security_runtime_least_privilege_rate_limit.sql` | `a4df0fcbc46bd8c23081122ee5ca63408a64e1086bfecf3a67cb232cd73b549b` |
| `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel/scripts/staging-rate-limit-proof.ts` | `60e630ede9d6e775b7bac0e569a24331b9627b55460f38a56b4e6105d4fd9e4d` |

## 8. Closeout confirmation

- Recovery untouched: **confirmed**.
- Canonical staging configuration unchanged: **confirmed**.
- Staging cleanup not executed: **confirmed**.
- Production untouched: **confirmed**.

**Support packet path:**
`/Users/wolftech/1TheStudio/1The Studio/shanda-fuel/rate-limit-closeout-20261003T132355Z.md`

**Packet SHA-256:** reported by the closeout operator after writing this file;
it is intentionally not embedded in the file itself so the reported digest
remains the digest of this exact immutable content.
