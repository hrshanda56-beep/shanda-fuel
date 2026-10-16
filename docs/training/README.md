# Staff training and operational procedures

Status: **PARTIALLY VERIFIED** · Prepared 16 October 2026 (Africa/Harare).

Use these materials for supervised onboarding. Read the release check below before teaching button sequences. No production or staging was accessed; no real accounts or transactions were created. Screenshots are deliberately omitted because no application build was run for this documentation task.

## Release check before each session

The human-assigned accepted production baseline is `99bbe34cd9e978288f4ffb55fcad9f144e127922` (**B**). A fresh `git fetch origin main` resolved `origin/main` to that exact commit. This verifies repository identity, not the live deployment or database state.

The local operational candidate is `f24548677b7b64d829b03ec9b7ffc2615a0c4530` (**C**). Candidate instructions must be taught only after the integration owner confirms the deployed source SHA, required migrations, authentication provider and final release gates. Never ask station staff to migrate or seed anything.

Some canonical status entries describe older releases. The current human-supplied SHAs govern this training comparison; historical status is not fresh production evidence. Product requirements still govern intended behavior. See [verification and maintenance](verification.md) for evidence, gaps and release checks.

## Training pack

- [Owner guide and one-page quick start](owner.md)
- [Supervisor guide and one-page quick start](supervisor.md)
- [Attendant guide and quick reference](attendant.md)
- [Finance guide and quick reference](finance.md)
- [Administrator responsibilities](administrator.md)
- [Fourteen standard operating procedures](procedures.md)
- [Daily shift and reconciliation checklists](checklists.md)
- [Common errors and troubleshooting](troubleshooting.md)
- [Training agenda and competency record](training-session.md)
- [Source map, permissions and known limitations](verification.md)

The quick-start sections are short print-copy masters intended for a single page each. Print pagination has not been verified; use print preview before distributing. Detailed guides and SOPs remain the reference.

## Shared access rules

Use only [Shanda Fuel](https://fuel.shandahr.com) for owner/staff production access. Use your own assigned account. Never share passwords, MFA codes or recovery codes. Training exercises require a separately authorized training environment with synthetic data; do not practice writes in production.

Sign in at `/login`. Better Auth labels are **Work email**, **Password**, then **Verify your authenticator**, **Authenticator code**, **Verify code** when challenged. Clerk uses **Email or Staff Number** and **Password** and its provider verification flow. Follow the actual provider prompts; do not assume the two flows are interchangeable. Ask the administrator for enrollment/recovery support if required. Never send codes or recovery material to a trainer.

Use **Work context** / **Switch station** to choose an authorized organisation, legal entity and station. One available station may be selected automatically. **All stations** is available only where the page allows it. Recheck station, business date and shift after any switch. Do not construct IDs or edit a URL to obtain access. No authorized work area means stop and contact the administrator.

Sign out through the account controls when finished, especially on a shared device. A missing figure or `—` is unavailable information, not zero. Station time comes from station setup; report a missing or incorrect timezone rather than guessing.
