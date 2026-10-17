# Shanda Fuel production infrastructure reconciliation

- Evidence timestamp (UTC): 2026-10-04T04:28:32Z
- Approved release SHA: `19735bc3f6eb6aee504c992479c45aacd8c0d476`
- Scope: production infrastructure reconciliation only; no application deployment or domain cutover.

## Neon

- Organization: `Shanda-Fuel` (`org-morning-art-28987930`)
- Project: `shanda-fuel-production` (`plain-paper-48449309`)
- Region: `aws-eu-central-1`
- Branch: `main` (`br-morning-dust-b270y3ry`)
- Database: `shanda_fuel`
- Endpoint: `ep-polished-haze-b29kd207`
- Canonical migrations applied: 21/21.
- `app` tables with RLS: 67/67.
- `app` tables with forced RLS: 67/67.

### app_runtime reconciliation

The previous production role defect was provider-default privilege state: `CREATEDB`, `CREATEROLE`, `INHERIT`, `REPLICATION`, and `BYPASSRLS` were enabled, and the role had an unintended `neon_superuser` membership. The role owned no database, schema, relation, function, or default-privilege objects.

The defective role was removed through the Neon role control plane only after the ownership audit. A replacement was created through SQL with `LOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOINHERIT`, `NOREPLICATION`, and `NOBYPASSRLS`. Direct ACLs were restored from read-only comparison with the known-good staging role: 3 schema ACL entries, 205 relation ACL entries, 11 function ACL entries, and 14 column-level ACL objects. No staging membership was copied.

Final validation: no role memberships; no owned schemas, relations, functions, or default ACLs; pooled connection identifies as `app_runtime`; runtime read succeeds; missing tenant/actor/membership context is fail-closed; `CREATE` in `app` and `SET ROLE migration_owner` are denied; `BYPASSRLS` is false.

## Cloudflare R2

- OAuth account: `d64179499a237d4a0b1838cf2b991911`
- Existing staging buckets were read-only inventory only and were not modified.
- Created production bucket: `shanda-fuel-production-private`.
- Created production recovery bucket: `shanda-fuel-production-recovery`.
- Bucket-scoped runtime credentials: not yet created.
- Object upload/download/hash/delete/absence probes: not yet run because credentials are not yet available.

## Vercel

- Team: `shanda-hr-s-projects` (`team_VMthg2WoTS6eeOP5BjRh3i8b`)
- Project: `shanda-fuel` (`prj_XnPOpr7OP4fEne29nQqyENRCQkvf`)
- Production environment variables: none configured.
- No `DATABASE_DIRECT_URL` exists in the production project.
- No deployment was performed.

## Domain and DNS

- `fuel.shandahr.com` remains served by the existing ShandaHR wildcard path; no Vercel domain assignment or DNS change was made.
- CNAME: `cname.vercel-dns-0.com.`
- A: `76.76.21.21`, `76.223.126.88` (with the CNAME also shown by `dig` during resolution).
- AAAA: no IPv6 address returned beyond the CNAME line.

## Status

BLOCKED pending creation of two persistent, bucket-scoped Cloudflare R2 Object Read & Write credentials through the authenticated Cloudflare dashboard. No secret values are recorded here.

No application deployment, domain attachment/move, DNS modification, Vercel environment mutation, staging mutation, recovery-environment mutation, database migration beyond the 21 canonical migrations, or triumph-energy change was performed in this reconciliation step.
