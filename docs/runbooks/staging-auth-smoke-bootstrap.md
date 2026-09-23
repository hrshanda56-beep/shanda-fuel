# Staging auth smoke bootstrap runbook

This runbook creates one synthetic Better Auth credential identity and two
short-lived Station A permission grants for the deployed A3 authenticated smoke
test. It is an operator-only staging action. It is not an HTTP endpoint, does
not create a session, and refuses every environment other than `staging`.

Load staging secrets through the deployment secret manager. Do not commit a
`.env` file or place the password in a command line.

## 1. Check-only verification

Use the exact synthetic Tenant A and Station A identifiers:

```sh
APP_ENV=staging node --conditions=react-server --import tsx scripts/staging-auth-smoke-bootstrap.ts \
  --check \
  --tenant-id a1000000-0000-4000-8000-000000000001 \
  --station-id a5000000-0000-4000-8000-000000000001
```

The output reports hierarchy and membership validity, whether the synthetic
auth user and credential account exist, and whether each required grant is
present, absent, or expired. It does not print email addresses, passwords,
hashes, or session values.

## 2. Bootstrap

Use a reserved synthetic email and provide the password through a secret
environment variable. The explicit confirmation flag is required.

```sh
export STAGING_AUTH_SMOKE_PASSWORD='operator-supplied-secret'
APP_ENV=staging node --conditions=react-server --import tsx scripts/staging-auth-smoke-bootstrap.ts \
  --confirm-staging-auth-bootstrap \
  --tenant-id a1000000-0000-4000-8000-000000000001 \
  --station-id a5000000-0000-4000-8000-000000000001 \
  --email operator+smoke@staging.shandafuel.invalid
unset STAGING_AUTH_SMOKE_PASSWORD
```

The command is idempotent while the existing grants are active. Grants expire
automatically after two hours. Re-running after expiry creates fresh grants and
does not rewrite the old grant.

## 3. HTTPS sign-in

Open the deployed staging HTTPS URL and sign in with the synthetic email and
the password supplied to the operator. The public signup route remains
disabled.

## 4. Obtain the session cookie normally

Let the deployed Better Auth sign-in flow set its secure session cookie. Do not
copy a session token from the database, construct a cookie manually, or use a
bootstrap script to create a session.

## 5. OpenBusinessDay smoke

With the authenticated browser session and Station A selected, run the A3
`OpenBusinessDay` workflow using the deployed UI/API flow. Confirm the server
reports success and that the business day is open.

## 6. StartShift smoke

Run the A3 `StartShift` workflow for Station A. Confirm the server reports
success and that the shift is started.

## 7. Stop after the shift opens

Do not create financial data or continue into later A3/A4/A5 workflows for this
bootstrap smoke. Capture only the normal smoke-test evidence needed for the
deployment check.

## 8. Temporary grant expiry

The grants are station-scoped to Station A and limited to `business_day.open`
and `shift.start`. They are not an Owner/Admin role, wildcard grant, or
tenant-wide grant. After expiry, the same session must no longer authorize
these commands unless another explicit, approved grant exists. Use the
check-only command to confirm the expiry state.
