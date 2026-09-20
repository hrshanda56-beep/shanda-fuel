-- A1 migration proposal; A0 must review and fold this into the canonical
-- src/platform/db/migrations history before any environment applies it.
-- This file is intentionally not a canonical migration.

create table if not exists auth.identities (
  id uuid primary key,
  external_subject text not null unique,
  email text,
  display_name text not null,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists auth.sessions (
  id uuid primary key,
  identity_id uuid not null references auth.identities(id),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  strong_authenticated_at timestamptz,
  strong_authentication_expires_at timestamptz,
  step_up_level smallint not null default 0 check (step_up_level between 0 and 2),
  step_up_expires_at timestamptz,
  created_at timestamptz not null default now()
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
  identity_id uuid not null references auth.identities(id),
  status text not null default 'ACTIVE' check (status in ('INVITED', 'ACTIVE', 'DISABLED')),
  disabled_at timestamptz,
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

create table if not exists platform.security_events (
  id uuid primary key,
  tenant_id uuid not null references app.tenants(id),
  actor_id uuid,
  event_code text not null,
  request_id uuid not null,
  occurred_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb,
  key_id text not null,
  algorithm text not null check (algorithm = 'hmac-sha256'),
  signature text not null,
  unique (tenant_id, id)
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

alter table app.tenants enable row level security;
alter table app.tenants force row level security;
drop policy if exists tenants_context on app.tenants;
create policy tenants_context on app.tenants
  using (id = app.current_tenant_id())
  with check (id = app.current_tenant_id());

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'legal_entities',
    'stations',
    'memberships',
    'membership_role_assignments',
    'temporary_permission_grants'
  ] loop
    execute format('alter table app.%I enable row level security', table_name);
    execute format('alter table app.%I force row level security', table_name);
    execute format('drop policy if exists tenant_context on app.%I', table_name);
    execute format(
      'create policy tenant_context on app.%I using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id())',
      table_name
    );
  end loop;
end $$;

alter table platform.security_events enable row level security;
alter table platform.security_events force row level security;
drop policy if exists security_events_context on platform.security_events;
create policy security_events_context on platform.security_events
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

-- The migration owner creates app_runtime, job_runtime and diagnostics_readonly
-- in each environment. They are not schema owners and must not receive
-- BYPASSRLS. After provisioning, revoke UPDATE/DELETE on security_events from
-- app_runtime and job_runtime; role setup is environment-specific and is not
-- embedded in an application migration.
