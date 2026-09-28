# Staging platform smoke checks

The smoke command is an operator-run Node script. It is not an HTTP endpoint and
must only be run with staging credentials. It refuses every `APP_ENV` except
`staging`, including production.

Load the staging environment securely (do not commit a `.env` file), then run:

```sh
APP_ENV=staging pnpm smoke:staging-platform -- --r2
```

This writes a random synthetic object under `private/staging/smoke/`, reads and
verifies its contents, deletes it, and verifies that it is no longer available.

To additionally send one controlled email, explicitly provide the recipient:

```sh
APP_ENV=staging pnpm smoke:staging-platform -- --send-email --recipient "$STAGING_SMOKE_RECIPIENT"
```

To run both checks together:

```sh
APP_ENV=staging pnpm smoke:staging-platform -- --r2 --send-email --recipient "$STAGING_SMOKE_RECIPIENT"
```

Resend requires `RESEND_API_KEY` and `RESEND_FROM_EMAIL`; this ordinary R2
smoke requires only the four primary `R2_*` settings. Output contains only
check status and the Resend message ID. The recipient and email content are
never printed.

This smoke is not deleted-object recovery evidence. Use the separate
[`r2-object-recovery.md`](../runbooks/r2-object-recovery.md) procedure after
the recovery bucket, Bucket Lock, retention policy, and separate credentials
have been configured.
