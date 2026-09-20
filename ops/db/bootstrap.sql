-- Environment bootstrap, not an application migration.
-- Run this as the managed PostgreSQL owner/admin before applying canonical
-- migrations. Runtime credentials are injected by the deployment platform and
-- never stored in this repository.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'migration_owner') then
    create role migration_owner
      nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_runtime') then
    create role app_runtime
      nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'job_runtime') then
    create role job_runtime
      nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'diagnostics_readonly') then
    create role diagnostics_readonly
      nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls nologin;
  end if;
end
$$;

alter role migration_owner nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role app_runtime nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role job_runtime nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role diagnostics_readonly nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;

revoke create on schema public from public;

-- The provider/admin connection may grant LOGIN and a secret-backed password
-- to each role after this script completes. CI uses SET ROLE from its isolated
-- postgres owner connection and therefore needs no committed credential.
