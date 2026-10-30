# Operations: environment and running the app

This page lists the settings the app needs to start and what to check when it does not. Never put a real key in a committed file, a chat message or a log.

## Clerk keys (sign-in)

Clerk is the only sign-in provider. Two keys are needed and **they must come from the same Clerk instance**:

| Variable | Where it is used | Looks like |
| --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | The browser | `pk_test_...` or `pk_live_...` |
| `CLERK_SECRET_KEY` | The server only | `sk_test_...` or `sk_live_...` |

The browser reaches Clerk through the app at `/api/clerk` (set in `src/app/layout.tsx`, route in `src/app/api/clerk/`). That route sends the secret key to Clerk on every request.

### "The secret key given with this proxy request is invalid"

This message on every page means the secret key does not belong to the instance named by the publishable key (or is missing). To fix it:

1. In the Clerk dashboard, open the instance you want, then API keys.
2. Copy **both** keys from that same page into your environment (for local work, your own untracked `.env.local`).
3. Restart the dev server. Environment values are read once at start.

The app checks the two keys before it starts talking to Clerk and logs a `[clerk-config]` line saying which key is missing or which pair does not match (test key with a live key, wrong format, or a different instance host when `CLERK_EXPECTED_FRONTEND_HOST` is set). It never prints a key.

A test instance uses `pk_test_` and `sk_test_`. A live instance uses `pk_live_` and `sk_live_`. Mixing them is the most common cause.

### Local work without Clerk

A local-only sign-in bypass exists for development on a disposable database (`DEV_AUTH_BYPASS=1`). It refuses to run on a deployed build or against a non-local database. It is not part of any release.

## Database

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | The app's runtime connection (restricted role) |
| `DATABASE_DIRECT_URL` | Migrations and tooling |

Migrations are explicit operations and do not run when the app is deployed. Check the production migration state separately from the web release.

## Other required settings

See `.env.example` for the full list, including the audit signing key (`AUDIT_SIGNING_KEY_ID`, `AUDIT_SIGNING_KEY`).

## Throwaway test and demo databases

Use a local database only. Pin `DATABASE_URL` and `DATABASE_DIRECT_URL` to `127.0.0.1` before any database command so nothing can reach production.
