-- A1 migration proposal; A0 must review and fold this into the canonical
-- src/platform/db/migrations history before any environment applies it.
-- This file is intentionally not a canonical migration.

-- Better Auth core tables. The application config uses the auth schema
-- namespace and UUID identifiers; A0 should integrate the generated Drizzle
-- shape into canonical migration history before deployment.
create table if not exists auth."user" (
  id uuid primary key,
  name text not null,
  email text not null unique,
  email_verified boolean not null default false,
  image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists auth.session (
  id uuid primary key,
  user_id uuid not null references auth."user"(id),
  token text not null unique,
  expires_at timestamptz not null,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  strong_authenticated_at timestamptz,
  strong_authentication_expires_at timestamptz,
  step_up_level smallint not null default 0 check (step_up_level between 0 and 2),
  step_up_expires_at timestamptz
);

create table if not exists auth.account (
  id uuid primary key,
  user_id uuid not null references auth."user"(id),
  account_id text not null,
  provider_id text not null,
  access_token text,
  refresh_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  id_token text,
  password text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, account_id)
);

create table if not exists auth.verification (
  id uuid primary key,
  identifier text not null,
  value text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app.tenants (
  id uuid primary key,
  name text not null,
  slug text not null unique,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED', 'ARCHIVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id)
);

create table if not exists app.legal_entities (
  id uuid primary key,
  tenant_id uuid not null references app.tenants(id),
  legal_name text not null,
  registration_reference text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table if not exists app.stations (
  id uuid primary key,
  tenant_id uuid not null references app.tenants(id),
  legal_entity_id uuid not null,
  code text not null,
  name text not null,
  timezone text not null default 'Africa/Harare',
  status text not null default 'ONBOARDING' check (status in ('ONBOARDING', 'ACTIVE', 'INACTIVE', 'ARCHIVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code),
  unique (tenant_id, legal_entity_id, id),
  foreign key (tenant_id, legal_entity_id)
    references app.legal_entities (tenant_id, id)
);

create table if not exists app.memberships (
  id uuid primary key,
  tenant_id uuid not null references app.tenants(id),
  identity_id uuid not null references auth."user"(id),
  status text not null default 'ACTIVE' check (status in ('INVITED', 'ACTIVE', 'SUSPENDED', 'LOCKED', 'DISABLED')),
  disabled_at timestamptz,
  suspended_at timestamptz,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, identity_id)
);

create table if not exists platform.permission_definitions (
  code text primary key,
  description text not null,
  created_at timestamptz not null default now()
);

create table if not exists platform.role_definitions (
  code text primary key,
  description text not null,
  created_at timestamptz not null default now()
);

create table if not exists platform.role_permissions (
  role_code text not null references platform.role_definitions(code),
  permission_code text not null references platform.permission_definitions(code),
  primary key (role_code, permission_code)
);

-- A1 seeds only platform/basic permissions. Business-domain workstreams add
-- their own reviewed permission codes when those domains are implemented.
insert into platform.permission_definitions (code, description) values
  ('tenant.context.select', 'Select the active tenant context'),
  ('tenant.view', 'View tenant metadata'),
  ('tenant.manage', 'Manage tenant metadata'),
  ('legal_entity.view', 'View legal-entity metadata'),
  ('legal_entity.manage', 'Manage legal-entity metadata'),
  ('station.view', 'View station metadata'),
  ('station.manage', 'Manage station metadata'),
  ('membership.view', 'View tenant memberships'),
  ('membership.invite', 'Invite an identity to a tenant'),
  ('membership.manage', 'Manage membership and role assignments'),
  ('membership.disable', 'Disable a tenant membership'),
  ('role.view', 'View role definitions and assignments'),
  ('role.manage', 'Manage role assignments'),
  ('document.view', 'View tenant documents'),
  ('document.upload', 'Upload tenant documents'),
  ('report.view', 'View available reports'),
  ('report.export', 'Export a report'),
  ('audit.view', 'View tenant audit events')
on conflict (code) do nothing;

insert into platform.role_definitions (code, description) values
  ('OWNER', 'Tenant owner'),
  ('ADMINISTRATOR', 'Tenant administrator'),
  ('FINANCE', 'Finance operator'),
  ('SUPERVISOR', 'Station supervisor'),
  ('ATTENDANT', 'Station attendant')
on conflict (code) do nothing;

insert into platform.role_permissions (role_code, permission_code)
select 'OWNER', code from platform.permission_definitions
on conflict do nothing;

insert into platform.role_permissions (role_code, permission_code) values
  ('ADMINISTRATOR', 'tenant.context.select'),
  ('ADMINISTRATOR', 'tenant.view'),
  ('ADMINISTRATOR', 'tenant.manage'),
  ('ADMINISTRATOR', 'legal_entity.view'),
  ('ADMINISTRATOR', 'legal_entity.manage'),
  ('ADMINISTRATOR', 'station.view'),
  ('ADMINISTRATOR', 'station.manage'),
  ('ADMINISTRATOR', 'membership.view'),
  ('ADMINISTRATOR', 'membership.invite'),
  ('ADMINISTRATOR', 'membership.manage'),
  ('ADMINISTRATOR', 'membership.disable'),
  ('ADMINISTRATOR', 'role.view'),
  ('ADMINISTRATOR', 'role.manage'),
  ('ADMINISTRATOR', 'document.view'),
  ('ADMINISTRATOR', 'document.upload'),
  ('ADMINISTRATOR', 'report.view'),
  ('ADMINISTRATOR', 'report.export'),
  ('ADMINISTRATOR', 'audit.view'),
  ('FINANCE', 'tenant.context.select'),
  ('FINANCE', 'tenant.view'),
  ('FINANCE', 'legal_entity.view'),
  ('FINANCE', 'station.view'),
  ('FINANCE', 'document.view'),
  ('FINANCE', 'document.upload'),
  ('FINANCE', 'report.view'),
  ('FINANCE', 'report.export'),
  ('FINANCE', 'audit.view'),
  ('SUPERVISOR', 'tenant.context.select'),
  ('SUPERVISOR', 'tenant.view'),
  ('SUPERVISOR', 'station.view'),
  ('SUPERVISOR', 'document.view'),
  ('SUPERVISOR', 'document.upload'),
  ('SUPERVISOR', 'report.view'),
  ('ATTENDANT', 'tenant.context.select'),
  ('ATTENDANT', 'station.view')
on conflict do nothing;

create table if not exists app.membership_role_assignments (
  id uuid primary key,
  tenant_id uuid not null references app.tenants(id),
  membership_id uuid not null,
  role_code text not null references platform.role_definitions(code),
  scope_type text not null check (scope_type in ('TENANT', 'LEGAL_ENTITY', 'STATION')),
  legal_entity_id uuid,
  station_id uuid,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, membership_id)
    references app.memberships (tenant_id, id),
  foreign key (tenant_id, legal_entity_id)
    references app.legal_entities (tenant_id, id),
  foreign key (tenant_id, legal_entity_id, station_id)
    references app.stations (tenant_id, legal_entity_id, id),
  check (
    (scope_type = 'TENANT' and legal_entity_id is null and station_id is null)
    or (scope_type = 'LEGAL_ENTITY' and legal_entity_id is not null and station_id is null)
    or (scope_type = 'STATION' and legal_entity_id is not null and station_id is not null)
  )
);

create table if not exists app.temporary_permission_grants (
  id uuid primary key,
  tenant_id uuid not null references app.tenants(id),
  membership_id uuid not null,
  permission_code text not null references platform.permission_definitions(code),
  scope_type text not null check (scope_type in ('TENANT', 'LEGAL_ENTITY', 'STATION')),
  legal_entity_id uuid,
  station_id uuid,
  expires_at timestamptz not null,
  reason text not null,
  revoked_at timestamptz,
  revoked_by_membership_id uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, membership_id)
    references app.memberships (tenant_id, id),
  foreign key (tenant_id, legal_entity_id)
    references app.legal_entities (tenant_id, id),
  foreign key (tenant_id, legal_entity_id, station_id)
    references app.stations (tenant_id, legal_entity_id, id),
  check (
    (scope_type = 'TENANT' and legal_entity_id is null and station_id is null)
    or (scope_type = 'LEGAL_ENTITY' and legal_entity_id is not null and station_id is null)
    or (scope_type = 'STATION' and legal_entity_id is not null and station_id is not null)
  )
);

create or replace function app.revoke_membership_grants_on_status_change()
returns trigger
language plpgsql
as $$
begin
  if new.status <> 'ACTIVE' and old.status = 'ACTIVE' then
    update app.temporary_permission_grants
    set revoked_at = coalesce(revoked_at, now())
    where tenant_id = new.tenant_id
      and membership_id = new.id
      and revoked_at is null;
  end if;
  return new;
end
$$;

drop trigger if exists revoke_membership_grants on app.memberships;
create trigger revoke_membership_grants
after update of status on app.memberships
for each row execute function app.revoke_membership_grants_on_status_change();

create table if not exists platform.security_events (
  id uuid primary key,
  tenant_id uuid not null references app.tenants(id),
  membership_id uuid,
  actor_id uuid,
  event_code text not null,
  request_id uuid not null,
  occurred_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb,
  key_id text not null,
  algorithm text not null check (algorithm = 'hmac-sha256'),
  signature text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, membership_id)
    references app.memberships (tenant_id, id)
);

create or replace function app.current_tenant_id() returns uuid
language sql stable as $$
  select case
    when current_setting('app.tenant_id', true) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then current_setting('app.tenant_id', true)::uuid
    else null
  end
$$;

create or replace function app.current_actor_id() returns uuid
language sql stable as $$
  select case
    when current_setting('app.actor_id', true) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then current_setting('app.actor_id', true)::uuid
    else null
  end
$$;

create or replace function app.current_membership_id() returns uuid
language sql stable as $$
  select case
    when current_setting('app.membership_id', true) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then current_setting('app.membership_id', true)::uuid
    else null
  end
$$;

create or replace function app.has_active_membership() returns boolean
language sql stable
as $$
  select exists (
    select 1
    from app.memberships m
    where m.tenant_id = app.current_tenant_id()
      and m.id = app.current_membership_id()
      and m.identity_id = app.current_actor_id()
      and m.status = 'ACTIVE'
  )
$$;

alter table app.tenants enable row level security;
alter table app.tenants force row level security;
drop policy if exists tenants_context on app.tenants;
create policy tenants_context on app.tenants
  using (id = app.current_tenant_id() and app.has_active_membership())
  with check (id = app.current_tenant_id() and app.has_active_membership());

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'legal_entities',
    'stations',
    'membership_role_assignments',
    'temporary_permission_grants'
  ] loop
    execute format('alter table app.%I enable row level security', table_name);
    execute format('alter table app.%I force row level security', table_name);
    execute format('drop policy if exists tenant_context on app.%I', table_name);
    execute format(
      'create policy tenant_context on app.%I using (tenant_id = app.current_tenant_id() and app.has_active_membership()) with check (tenant_id = app.current_tenant_id() and app.has_active_membership())',
      table_name
    );
  end loop;
end $$;

drop policy if exists temporary_grant_revocation on app.temporary_permission_grants;
create policy temporary_grant_revocation on app.temporary_permission_grants
  for update
  using (
    tenant_id = app.current_tenant_id()
    and (
      app.has_active_membership()
      or membership_id = app.current_membership_id()
    )
  )
  with check (
    tenant_id = app.current_tenant_id()
    and revoked_at is not null
  );

alter table app.memberships enable row level security;
alter table app.memberships force row level security;
drop policy if exists tenant_context on app.memberships;
create policy tenant_context on app.memberships
  using (
    tenant_id = app.current_tenant_id()
    and id = app.current_membership_id()
    and identity_id = app.current_actor_id()
  )
  with check (
    tenant_id = app.current_tenant_id()
    and id = app.current_membership_id()
    and identity_id = app.current_actor_id()
  );

drop policy if exists memberships_identity_lookup on app.memberships;
create policy memberships_identity_lookup on app.memberships
  for select using (identity_id = app.current_actor_id());

alter table platform.security_events enable row level security;
alter table platform.security_events force row level security;
drop policy if exists security_events_context on platform.security_events;
create policy security_events_context on platform.security_events
  using (
    tenant_id = app.current_tenant_id() and app.has_active_membership()
  )
  with check (
    tenant_id = app.current_tenant_id() and app.has_active_membership()
  );

-- This stream is intentionally tenant-scoped. Login, MFA, recovery, and other
-- pre-tenant identity events require a separately designed global stream; they
-- must not bypass this table's tenant RLS through a nullable tenant_id.

-- The migration owner creates app_runtime, job_runtime and diagnostics_readonly
-- in each environment. They are not schema owners and must not receive
-- BYPASSRLS. Grant INSERT (and narrowly scoped tenant SELECT where needed) on
-- security_events to the intended writer role only. Do not grant UPDATE or
-- DELETE to app_runtime or job_runtime; role setup is environment-specific
-- and is not embedded in an application migration.
