# First production user: runbook (DRAFT, not executed)

**Written for:** the operator who will create the first sign-in on production.
**Status:** draft. Nothing here has been run. No production system was contacted.
**Who:** the first customer on the platform is Triumph Energy, trading as T.E.I Oils. It is a customer
of the platform, not its owner. The first account belongs to a named person at that company.

This file only organises the steps. The rules are in `AGENTS.md` section 7.3 and the credential
handling is in [`deployment.md`](deployment.md) ("Temporary first-user credential authority") and
DEC-040. The tool is `scripts/first-user-provisioning.ts`. If this file disagrees with those, they win.

## Rules that do not bend

- The operator owns every credential and types it at a hidden prompt. It never goes in chat, a file,
  a log or a command line. An assistant never sees it and does not run these steps.
- A dry run cannot be turned into a real run. The real run is a separate step with its own approval.
- Approval from an earlier step or an earlier day does not carry over. Ask again each time.
- Stop at the first unexpected result. Do not carry on to see what happens.

## Before starting

1. [ ] The release in [`v1-migration-and-release.md`](v1-migration-and-release.md) is finished through
   the database check (step 7) and the app is deployed at the recorded commit.
2. [ ] `REQUIRE_LOGIN_MFA` has been set as decided (section 3a of the release runbook).
3. [ ] The person's work email, display name and role are agreed in writing by T.E.I Oils.
4. [ ] The production Clerk instance is the live one and allows `https://fuel.shandahr.com`.
5. [ ] The operator has the provider/deployment-admin connection and can run the reviewed helper
   `scripts/production/first-user-provisioner-credential.ts` (see `deployment.md`). The helper has
   been run once against a disposable PostgreSQL 18 before use, and is not run by an assistant.

## Sequence

1. **Preflight (read only).** Run the reviewed Stage 1 migration-owner preflight (operator tooling kept outside this repo; see
   [`stage1-rls-policy-diagnostic.md`](stage1-rls-policy-diagnostic.md) for the read-only check that backs it). Expected: the
   `first_user_provisioner` role has no password and every security check passes. Record the result.
   Then run the helper with `assign` to set the temporary password (hidden prompts only).
2. **Find the scope ids.** Using the read-only inspect mode, find the tenant, legal entity and station
   that should be granted. Check them against what T.E.I Oils expects. Record the ids (ids are not secrets).
3. **Dry run.**
   `node --conditions=react-server --import tsx scripts/first-user-provisioning.ts --dry-run --environment production --confirm-production-provisioning --email <email> --display-name <name> --tenant-id <id> --legal-entity-id <id> --station-id <id> --expires-at <iso>`
   with the database URL supplied through the hidden prompt, not as an argument.
4. **Check the proof.** The dry run must show exactly 12 read-only permissions, zero rows written and
   unchanged sentinel values. Any other number, or any write, means stop.
5. **Clean up the temporary credential.** Run the helper with `clear`
   (`ALTER ROLE first_user_provisioner PASSWORD NULL;` at the same admin boundary), then confirm a
   login with the old password is refused and the role attributes, membership, ownership and ACLs
   are unchanged.
6. **Approval.** Show the dry-run output and cleanup result to the project lead. The project lead says
   in plain words "go ahead with the real provision for <email>". Record who, when, and the exact
   commit.
7. **Real provision.** A separately reviewed operation, with the same hidden-prompt handling and a
   fresh temporary credential and cleanup afterwards. This step is not part of the dry run.
8. **Widen access properly.** The first account is read-only by design. The owner role is given
   through the normal in-app staff screens by an authorised person, with the audit trail.
9. **Authenticated smoke** on `https://fuel.shandahr.com` as that person: sign in, open the dashboard,
   open Daily Operations, open one report. With MFA off there is no second code. Record the result.
10. **Final cleanup check.** Confirm no temporary credential, file or shell history entry remains.

## Record

```
Operator:                       Approver:
Release commit (full SHA):
Dry run time / result (12 permissions, 0 writes?):
Credential cleanup time / result:
Approval time and wording:
Real provision time:
Smoke test result:
Problems found:
```
