# Shanda Fuel production infrastructure provisioning — BLOCKED

- Timestamp (UTC): 2026-10-04T03:40:41Z
- Release SHA: `19735bc3f6eb6aee504c992479c45aacd8c0d476`
- Vercel project: `shanda-fuel` / `prj_XnPOpr7OP4fEne29nQqyENRCQkvf`
- Neon project: `shanda-fuel-production` / `plain-paper-48449309`
- Neon region: `aws-eu-central-1`
- PostgreSQL version: 18
- Production branch: `main` / `br-morning-dust-b270y3ry`
- Read-write endpoint: `ep-polished-haze-b29kd207`
- Database: `shanda_fuel`
- Migration owner: `migration_owner`

## Database state

- Canonical migration source count: 21 (`0000` through `0020`)
- Applied migration count: 21
- Migration status: COMPLETE
- App tables with RLS: 67/67
- App tables with forced RLS: 67/67
- Runtime-role least privilege: BLOCKED
- Blocking detail: Neon returned `permission denied to alter role` when the
  available provider-created administrative role attempted the repository-
  required `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT` flags.
  The three runtime/diagnostics roles therefore remain provider-default roles
  and are not approved for production runtime use.
- Temporary provisioning roles: deleted

## Storage and application configuration

- Production R2 primary bucket: NOT PROVISIONED
- Production R2 recovery bucket: NOT PROVISIONED
- R2 blocker: no authenticated production Cloudflare/R2 account, bucket
  creation authority, or provider credential is available; staging and
  recovery resources were not reused.
- Production Vercel environment variables: none configured
- `DATABASE_URL`: absent
- `DATABASE_DIRECT_URL`: absent
- Staging bootstrap variables: absent
- Production auth/signing/storage variables: absent

## Safety outcomes

- Production application deployment: NOT PERFORMED
- `fuel.shandahr.com`: unchanged
- `*.shandahr.com`: unchanged
- `shanda-hr`: unchanged
- `triumph-energy`: unchanged
- Staging/recovery: unchanged
- Recovery baseline: NOT CREATED
- Secrets or connection strings: not recorded in this evidence

## Required next action

Obtain an approved Neon/provider-admin path that can create or alter roles
with the repository-required least-privilege flags, and obtain the
human-owned production Cloudflare/R2 account and scoped credentials. Then
reconcile the existing Neon project before configuring Vercel or deploying.
