# Administrator responsibilities

Read [release rules](README.md) and [source/permission map](verification.md).

The ADMINISTRATOR template has setup, membership, role and operational capabilities, but every command still checks scope and permission. Owner is also a scoped template, not an access bypass. Initial bootstrap access may be read-only and must not be mistaken for the full Owner template.

Before training, confirm real staff membership, station/legal-entity scope, employment status, shift templates, pump/nozzle/meter setup, active prices, station timezone and approved opening evidence. Use Settings (`/settings`) and the supported staff/setup controls where authorized. Staff invitation must use the application's reviewed invitation flow; do not create accounts during this documentation exercise or share invitation tokens in training notes.

Confirm who records/submits and who independently approves. The fixed product meaning of Supervisor is the accountable close reviewer, while the current SUPERVISOR role template does not include reconciliation approval. Have the integration/access owner confirm the actual approved grant arrangement. Do not grant broad Owner/Admin rights merely to make a lesson work.

Help users follow the configured provider's supported MFA enrollment/recovery interface. On C, Better Auth approval can offer **Set up authenticator**; Clerk uses **Manage account MFA** and reverification. Never collect staff passwords, MFA seeds or recovery codes. Account recovery and permission changes require the approved access process.

Manage operational exceptions only through available named authorized commands. Missing correction UI is an escalation requirement, not permission to run SQL or send ad-hoc API requests. Production deployment, migrations and first-user provisioning belong to separate reviewed operator runbooks and are outside staff training.
