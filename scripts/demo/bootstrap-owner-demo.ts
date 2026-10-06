import postgres from 'postgres';

const APPROVED_APP_ENV = 'demo';
const APPROVED_DATABASE_NAME = 'shanda_fuel_demo';

const ROLE_REQUIREMENTS = {
  migration_owner: { login: false },
  app_runtime: { login: false },
  job_runtime: { login: false },
  diagnostics_readonly: { login: false },
  first_user_provisioner: { login: true },
} as const;

type RequiredRole = keyof typeof ROLE_REQUIREMENTS;

type RoleState = {
  rolname: RequiredRole;
  rolcanlogin: boolean;
  rolsuper: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolinherit: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
  hasConfig: boolean;
  hasMembership: boolean;
};

const requiredRoleNames = Object.keys(ROLE_REQUIREMENTS) as RequiredRole[];

const databaseUrl = process.env.DATABASE_URL;
const appEnv = process.env.APP_ENV;

if (appEnv !== APPROVED_APP_ENV) {
  throw new Error('Refusing owner-demo role bootstrap unless APP_ENV=demo.');
}
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required.');
}

const database = new URL(databaseUrl);
const databaseName = decodeURIComponent(database.pathname.replace(/^\//, ''));
if (databaseName !== APPROVED_DATABASE_NAME) {
  throw new Error('Refusing owner-demo role bootstrap for an unexpected database name.');
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function createRoleSql(roleName: RequiredRole, currentUser: string): string {
  const login = ROLE_REQUIREMENTS[roleName].login ? 'LOGIN' : 'NOLOGIN';
  const migrationMembership =
    roleName === 'migration_owner' ? ` role ${quoteIdentifier(currentUser)}` : '';
  return `create role ${roleName} ${login} nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls${migrationMembership}`;
}

async function readRoleStates(sql: ReturnType<typeof postgres>): Promise<RoleState[]> {
  return sql<RoleState[]>`
    select
      r.rolname,
      r.rolcanlogin,
      r.rolsuper,
      r.rolcreatedb,
      r.rolcreaterole,
      r.rolinherit,
      r.rolreplication,
      r.rolbypassrls,
      r.rolconfig is not null as "hasConfig",
      exists (
        select 1
        from pg_auth_members membership
        where membership.member = r.oid
      ) as "hasMembership"
    from pg_roles r
    where r.rolname in ${sql(requiredRoleNames)}
    order by r.rolname
  `;
}

function unsafeFlags(role: RoleState): string[] {
  const flags: string[] = [];
  if (role.rolsuper) flags.push('SUPERUSER');
  if (role.rolcreatedb) flags.push('CREATEDB');
  if (role.rolcreaterole) flags.push('CREATEROLE');
  if (role.rolreplication) flags.push('REPLICATION');
  if (role.rolbypassrls) flags.push('BYPASSRLS');
  if (role.hasConfig) flags.push('ROLE_CONFIG');
  if (role.hasMembership) flags.push('ROLE_MEMBERSHIP');
  return flags;
}

async function reconcileRoles(sql: ReturnType<typeof postgres>): Promise<void> {
  const currentUserResult = await sql<{ currentUser: string }[]>`
    select current_user as "currentUser"
  `;
  const currentUser = currentUserResult[0]?.currentUser;
  if (!currentUser)
    throw new Error('Owner-demo bootstrap could not identify the current database role.');

  let roles = await readRoleStates(sql);
  const present = new Set(roles.map((role) => role.rolname));

  for (const roleName of requiredRoleNames) {
    if (!present.has(roleName)) {
      await sql.unsafe(createRoleSql(roleName, currentUser));
    }
  }

  roles = await readRoleStates(sql);
  if (roles.length !== requiredRoleNames.length) {
    throw new Error('Owner-demo role bootstrap did not create the complete required role set.');
  }

  for (const role of roles) {
    const flags = unsafeFlags(role);
    if (flags.length > 0) {
      throw new Error(
        `Refusing owner-demo bootstrap: ${role.rolname} has unsafe pre-existing role state (${flags.join(', ')}).`,
      );
    }

    const requiredLogin = ROLE_REQUIREMENTS[role.rolname].login;
    const alterParts: string[] = [];
    if (role.rolcanlogin !== requiredLogin) alterParts.push(requiredLogin ? 'LOGIN' : 'NOLOGIN');
    if (role.rolinherit) alterParts.push('NOINHERIT');

    if (alterParts.length > 0) {
      try {
        await sql.unsafe(`alter role ${role.rolname} ${alterParts.join(' ')}`);
      } catch {
        throw new Error(
          `Refusing owner-demo bootstrap: could not establish the required ${role.rolname} LOGIN/INHERIT posture.`,
        );
      }
    }
  }

  const finalRoles = await readRoleStates(sql);
  const finalStateIsSafe =
    finalRoles.length === requiredRoleNames.length &&
    finalRoles.every((role) => {
      const requiredLogin = ROLE_REQUIREMENTS[role.rolname].login;
      return (
        role.rolcanlogin === requiredLogin &&
        !role.rolsuper &&
        !role.rolcreatedb &&
        !role.rolcreaterole &&
        !role.rolinherit &&
        !role.rolreplication &&
        !role.rolbypassrls &&
        !role.hasConfig &&
        !role.hasMembership
      );
    });
  if (!finalStateIsSafe) {
    throw new Error(
      'Owner-demo role bootstrap did not establish the required least-privilege role state.',
    );
  }
}

async function ensureMigrationAuthority(sql: ReturnType<typeof postgres>): Promise<void> {
  const capability = await sql<{ canSet: boolean }[]>`
    select pg_has_role(current_user, 'migration_owner', 'SET') as "canSet"
  `;
  if (!capability[0]?.canSet) {
    try {
      await sql.unsafe(`
        do $$
        begin
          execute format('grant migration_owner to %I with admin option', current_user);
        end
        $$;
      `);
    } catch {
      throw new Error(
        'Refusing owner-demo bootstrap: the current connection cannot obtain SET capability for migration_owner.',
      );
    }
  }

  const finalCapability = await sql<{ canSet: boolean }[]>`
    select pg_has_role(current_user, 'migration_owner', 'SET') as "canSet"
  `;
  if (!finalCapability[0]?.canSet) {
    throw new Error(
      'Refusing owner-demo bootstrap: migration_owner SET capability is not available to the current connection.',
    );
  }
}

async function main() {
  const sql = postgres(databaseUrl, { max: 1 });

  try {
    await reconcileRoles(sql);
    await ensureMigrationAuthority(sql);
    console.log('Owner-demo prerequisite roles ready.');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Owner-demo role bootstrap failed.');
  process.exitCode = 1;
});
