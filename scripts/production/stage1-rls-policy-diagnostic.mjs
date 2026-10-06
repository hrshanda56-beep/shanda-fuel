import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const APPROVED_PRODUCTION_HOST = 'ep-polished-haze-b29kd207.c-6.eu-central-1.aws.neon.tech';

export const DIAGNOSTIC_SQL = String.raw`BEGIN TRANSACTION READ ONLY;

DO $$
BEGIN
  IF current_user <> 'migration_owner' OR session_user <> 'migration_owner' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Intentional diagnostic refusal: current_user and session_user must both be migration_owner',
      HINT = 'This is not the original Stage 1 division-by-zero failure.';
  END IF;

  IF current_setting('server_version_num') <> '180006' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Intentional diagnostic refusal: server_version_num is not the approved PostgreSQL 18.6 value',
      HINT = 'This is not the original Stage 1 division-by-zero failure.';
  END IF;
END
$$;

SELECT current_user, session_user, current_database(), current_setting('server_version_num') AS server_version_num,
       current_setting('server_version') AS server_version,
       current_setting('transaction_read_only') AS transaction_read_only;

SELECT count(*) = 1 AS migration_fingerprint_present
  FROM drizzle.__drizzle_migrations
 WHERE hash = 'a51bee68bbfec23cfeabaa7a54039aca3672b7e8b4e386a5d2c36b01bd5d7caa';

SELECT EXISTS (
  SELECT 1
    FROM pg_auth_members membership
    JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
    JOIN pg_roles member_role ON member_role.oid = membership.member
    JOIN pg_roles grantor_role ON grantor_role.oid = membership.grantor
   WHERE granted_role.rolname = 'first_user_provisioner'
     AND member_role.rolname = 'migration_owner'
     AND grantor_role.rolname = 'cloud_admin'
     AND membership.admin_option
     AND NOT membership.inherit_option
     AND NOT membership.set_option
) AS approved_provider_membership;

WITH expected(schema_name, table_name) AS (
  VALUES
    ('app', 'tenants'),
    ('app', 'legal_entities'),
    ('app', 'stations'),
    ('app', 'memberships'),
    ('app', 'membership_role_assignments'),
    ('app', 'temporary_permission_grants'),
    ('platform', 'security_events'),
    ('platform', 'first_user_provisioning_operations'),
    ('platform', 'first_user_provisioning_operation_grants')
)
SELECT e.schema_name,
       e.table_name,
       c.relrowsecurity,
       c.relforcerowsecurity
  FROM expected e
  LEFT JOIN pg_namespace n ON n.nspname = e.schema_name
  LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = e.table_name
 ORDER BY e.schema_name, e.table_name;

WITH expected(schema_name, table_name) AS (
  VALUES
    ('app', 'tenants'),
    ('app', 'legal_entities'),
    ('app', 'stations'),
    ('app', 'memberships'),
    ('app', 'membership_role_assignments'),
    ('app', 'temporary_permission_grants'),
    ('platform', 'security_events'),
    ('platform', 'first_user_provisioning_operations'),
    ('platform', 'first_user_provisioning_operation_grants')
)
SELECT p.schemaname,
       p.tablename,
       p.policyname,
       p.permissive,
       p.roles,
       p.cmd,
       p.qual,
       p.with_check
  FROM pg_policies p
  JOIN expected e ON e.schema_name = p.schemaname AND e.table_name = p.tablename
 ORDER BY p.schemaname, p.tablename, p.policyname;

SELECT p.schemaname,
       p.tablename,
       p.policyname,
       p.permissive,
       p.roles,
       p.cmd,
       p.qual,
       p.with_check
  FROM pg_policies p
 WHERE p.policyname LIKE 'first_user_provisioning_%'
 ORDER BY p.schemaname, p.tablename, p.policyname;

SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       policy.polname AS policy_name,
       policy.polpermissive AS raw_permissive,
       policy.polroles::text AS raw_role_oids,
       policy.polcmd AS raw_command,
       policy.polqual::text AS raw_qual,
       policy.polwithcheck::text AS raw_with_check,
       view_policy.permissive,
       view_policy.roles,
       view_policy.cmd,
       view_policy.qual,
       view_policy.with_check
  FROM pg_catalog.pg_policy policy
  JOIN pg_catalog.pg_class c ON c.oid = policy.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_policies view_policy
    ON view_policy.schemaname = n.nspname
   AND view_policy.tablename = c.relname
   AND view_policy.policyname = policy.polname
 WHERE (n.nspname, c.relname) IN (
    ('app', 'tenants'),
    ('app', 'legal_entities'),
    ('app', 'stations'),
    ('app', 'memberships'),
    ('app', 'membership_role_assignments'),
    ('app', 'temporary_permission_grants'),
    ('platform', 'security_events'),
    ('platform', 'first_user_provisioning_operations'),
    ('platform', 'first_user_provisioning_operation_grants')
  )
    OR policy.polname LIKE 'first_user_provisioning_%'
 ORDER BY n.nspname, c.relname, policy.polname;

WITH expected(schema_name, table_name) AS (
  VALUES
    ('app', 'tenants'),
    ('app', 'legal_entities'),
    ('app', 'stations'),
    ('app', 'memberships'),
    ('app', 'membership_role_assignments'),
    ('app', 'temporary_permission_grants'),
    ('platform', 'security_events'),
    ('platform', 'first_user_provisioning_operations'),
    ('platform', 'first_user_provisioning_operation_grants')
), exact_definer AS (
  SELECT p.schemaname, p.tablename
    FROM pg_policies p
    JOIN expected e ON e.schema_name = p.schemaname AND e.table_name = p.tablename
   WHERE p.policyname = 'first_user_provisioning_definer'
     -- pg_policies.cmd is normalized text; raw pg_policy.polcmd '*' is exposed as 'ALL'.
     AND p.cmd = 'ALL'
     AND p.qual = '(CURRENT_USER = ''migration_owner''::name)'
     AND p.with_check = '(CURRENT_USER = ''migration_owner''::name)'
), unexpected_prefixed AS (
  SELECT p.schemaname, p.tablename, p.policyname
    FROM pg_policies p
   WHERE p.policyname LIKE 'first_user_provisioning_%'
     AND p.policyname <> 'first_user_provisioning_definer'
)
SELECT
  (SELECT count(*) FROM exact_definer) AS exact_definer_policy_count,
  9 AS expected_definer_policy_count,
  (SELECT count(*) FROM exact_definer) = 9 AS exact_definer_policy_count_ok,
  (SELECT count(*) FROM unexpected_prefixed) AS unexpected_prefixed_policy_count,
  NOT EXISTS (SELECT 1 FROM unexpected_prefixed) AS no_unexpected_prefixed_policy_ok,
  (
    (SELECT count(*) FROM exact_definer) = 9
    AND NOT EXISTS (SELECT 1 FROM unexpected_prefixed)
  ) AS policy_checks_ok;

ROLLBACK;`;

const LIBPQ_ENV_KEYS = [
  'PGHOST',
  'PGHOSTADDR',
  'PGPORT',
  'PGDATABASE',
  'PGUSER',
  'PGPASSWORD',
  'PGPASSFILE',
  'PGREQUIREAUTH',
  'PGCHANNELBINDING',
  'PGSERVICE',
  'PGSERVICEFILE',
  'PGOPTIONS',
  'PGAPPNAME',
  'PGSSLMODE',
  'PGREQUIRESSL',
  'PGSSLCOMPRESSION',
  'PGSSLCERT',
  'PGSSLKEY',
  'PGSSLCERTMODE',
  'PGSSLROOTCERT',
  'PGSSLCRL',
  'PGSSLCRLDIR',
  'PGSSLSNI',
  'PGREQUIREPEER',
  'PGSSLMINPROTOCOLVERSION',
  'PGSSLMAXPROTOCOLVERSION',
  'PGGSSENCMODE',
  'PGKRBSRVNAME',
  'PGGSSLIB',
  'PGGSSDELEGATION',
  'PGCONNECT_TIMEOUT',
  'PGCLIENTENCODING',
  'PGTARGETSESSIONATTRS',
  'PGLOADBALANCEHOSTS',
  'DATABASE_URL',
  'DATABASE_DIRECT_URL',
  'SF_PSQL_URI_ENV_NAME',
  'SF_MIGRATION_OWNER_DB_URL',
  'SF_PROVISIONER_DB_URL',
  'SF_EPHEMERAL_PASSWORD',
];

// This parser intentionally mirrors the reviewed sf_psql_from_uri() semantics
// in /Users/wolftech/.codex/phase0/production-dry-run-stage1.sh. It is scoped
// only to this fixed, read-only migration-owner diagnostic; it is not a second
// application connection path. The approved-host, hostaddr, and forced
// read-only checks below are diagnostic-specific hardening.
const SUPPORTED_QUERY_NAMES = new Set([
  'host',
  'port',
  'dbname',
  'user',
  'password',
  'ssl',
  'hostaddr',
  'require_auth',
  'channel_binding',
  'options',
  'application_name',
  'sslmode',
  'requiressl',
  'sslcompression',
  'sslcert',
  'sslkey',
  'sslcertmode',
  'sslrootcert',
  'sslcrl',
  'sslcrldir',
  'sslsni',
  'requirepeer',
  'ssl_min_protocol_version',
  'ssl_max_protocol_version',
  'gssencmode',
  'krbsrvname',
  'gsslib',
  'gssdelegation',
  'connect_timeout',
  'client_encoding',
  'target_session_attrs',
  'load_balance_hosts',
]);

const VALID_BOOLEAN_VALUES = new Set(['0', '1', 'false', 'true', 'no', 'yes', 'off', 'on']);
const VALID_SSL_MODES = new Set([
  'disable',
  'allow',
  'prefer',
  'require',
  'verify-ca',
  'verify-full',
]);
const VALID_TLS_PROTOCOL_VERSIONS = new Set(['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3']);

export class DiagnosticInputError extends Error {}

const reject = (message) => {
  throw new DiagnosticInputError(message);
};

const decodePart = (value) => {
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.includes('\u0000')) reject('connection URI contains a NUL character');
    return decoded;
  } catch {
    reject('connection URI percent-encoding is invalid');
  }
};

const validateQueryValue = (name, value) => {
  if (value === '') reject('connection URI has an empty query parameter');
  if (name === 'sslmode' && !VALID_SSL_MODES.has(value)) {
    reject('connection URI has an invalid sslmode');
  }
  if (
    ['requiressl', 'sslcompression', 'sslsni'].includes(name) &&
    !VALID_BOOLEAN_VALUES.has(value.toLowerCase())
  ) {
    reject(`connection URI has an invalid ${name}`);
  }
  if (name === 'sslcertmode' && !['allow', 'disable', 'require'].includes(value)) {
    reject('connection URI has an invalid sslcertmode');
  }
  if (
    ['ssl_min_protocol_version', 'ssl_max_protocol_version'].includes(name) &&
    !VALID_TLS_PROTOCOL_VERSIONS.has(value)
  ) {
    reject(`connection URI has an invalid ${name}`);
  }
  if (
    ['channel_binding', 'gssencmode'].includes(name) &&
    !['disable', 'prefer', 'require'].includes(value)
  ) {
    reject(`connection URI has an invalid ${name}`);
  }
};

export function parseDiagnosticConnectionUri(source) {
  if (!source) reject('connection URI is missing');

  let url;
  try {
    url = new URL(source);
  } catch {
    reject('connection URI is invalid');
  }

  if ((url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') || url.hash) {
    reject('connection URI scheme or fragment is invalid');
  }

  const queryEntries = [...url.searchParams];
  const queryOccurrences = new Map();
  for (const [rawName] of queryEntries) {
    const name = rawName.toLowerCase();
    if (!name) reject('connection URI has an empty query parameter name');
    if (!SUPPORTED_QUERY_NAMES.has(name))
      reject('connection URI has an unsupported query parameter');
    queryOccurrences.set(name, (queryOccurrences.get(name) ?? 0) + 1);
  }
  for (const [name, count] of queryOccurrences) {
    if (count > 1) reject('connection URI has a duplicate query parameter');
  }
  if (queryOccurrences.has('ssl') && queryOccurrences.has('sslmode')) {
    reject('connection URI cannot combine ssl and sslmode');
  }

  const queryParams = new Map();
  for (const [rawName, value] of queryEntries) {
    const name = rawName.toLowerCase();
    if (name === 'ssl') {
      if (value !== 'true') reject('connection URI has an invalid ssl parameter');
      queryParams.set('sslmode', 'require');
      continue;
    }
    validateQueryValue(name, value);
    if (
      name === 'port' &&
      (!/^[0-9]+$/.test(value) || Number(value) < 1 || Number(value) > 65535)
    ) {
      reject('connection URI port is invalid');
    }
    queryParams.set(name, value);
  }

  const queryValue = (name) => queryParams.get(name);
  const authorityHost = url.hostname.replace(/^\[|\]$/g, '');
  const queryHost = queryValue('host');
  if (queryHost !== undefined && authorityHost && queryHost !== authorityHost) {
    reject('connection URI has conflicting host values');
  }
  const host = queryHost ?? authorityHost;
  if (!host || host.startsWith('/') || host.includes(','))
    reject('connection URI requires one TCP host');
  if (host !== APPROVED_PRODUCTION_HOST)
    reject('connection URI target is not the approved production endpoint');
  if (queryValue('hostaddr') !== undefined)
    reject('connection URI target override is not permitted for this diagnostic');

  const authorityPort = url.port;
  const queryPort = queryValue('port');
  if (queryPort !== undefined && authorityPort && queryPort !== authorityPort) {
    reject('connection URI has conflicting port values');
  }
  const port = queryPort ?? authorityPort;
  if (
    port !== undefined &&
    port !== '' &&
    (!/^[0-9]+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
  ) {
    reject('connection URI port is invalid');
  }

  const authorityDatabase = url.pathname.length > 1 ? decodePart(url.pathname.slice(1)) : '';
  const queryDatabase = queryValue('dbname');
  if (queryDatabase !== undefined && authorityDatabase && queryDatabase !== authorityDatabase) {
    reject('connection URI has conflicting database values');
  }
  const database = queryDatabase ?? authorityDatabase;

  const authorityUser = url.username ? decodePart(url.username) : '';
  const queryUser = queryValue('user');
  if (queryUser !== undefined && authorityUser && queryUser !== authorityUser) {
    reject('connection URI has conflicting user values');
  }
  const user = queryUser ?? authorityUser;

  const authorityPassword = url.password ? decodePart(url.password) : '';
  const queryPassword = queryValue('password');
  if (queryPassword !== undefined && authorityPassword && queryPassword !== authorityPassword) {
    reject('connection URI has conflicting password values');
  }
  const password = queryPassword ?? authorityPassword;
  if (!database || !user || !password) reject('connection URI is missing a required field');

  return { database, host, password, port, queryParams, user };
}

export function buildDiagnosticChildEnvironment(source, parentEnvironment = process.env) {
  if (parentEnvironment.PGHOSTADDR !== undefined) {
    reject('inherited PGHOSTADDR is not permitted for this diagnostic');
  }
  const parsed = parseDiagnosticConnectionUri(source);
  const env = { ...parentEnvironment };
  for (const key of LIBPQ_ENV_KEYS) delete env[key];

  env.PGHOST = parsed.host;
  if (parsed.port) env.PGPORT = parsed.port;
  env.PGDATABASE = parsed.database;
  env.PGUSER = parsed.user;
  env.PGPASSWORD = parsed.password;

  const queryEnv = new Map([
    ['require_auth', 'PGREQUIREAUTH'],
    ['channel_binding', 'PGCHANNELBINDING'],
    ['options', 'PGOPTIONS'],
    ['application_name', 'PGAPPNAME'],
    ['sslmode', 'PGSSLMODE'],
    ['requiressl', 'PGREQUIRESSL'],
    ['sslcompression', 'PGSSLCOMPRESSION'],
    ['sslcert', 'PGSSLCERT'],
    ['sslkey', 'PGSSLKEY'],
    ['sslcertmode', 'PGSSLCERTMODE'],
    ['sslrootcert', 'PGSSLROOTCERT'],
    ['sslcrl', 'PGSSLCRL'],
    ['sslcrldir', 'PGSSLCRLDIR'],
    ['sslsni', 'PGSSLSNI'],
    ['requirepeer', 'PGREQUIREPEER'],
    ['ssl_min_protocol_version', 'PGSSLMINPROTOCOLVERSION'],
    ['ssl_max_protocol_version', 'PGSSLMAXPROTOCOLVERSION'],
    ['gssencmode', 'PGGSSENCMODE'],
    ['krbsrvname', 'PGKRBSRVNAME'],
    ['gsslib', 'PGGSSLIB'],
    ['gssdelegation', 'PGGSSDELEGATION'],
    ['connect_timeout', 'PGCONNECT_TIMEOUT'],
    ['client_encoding', 'PGCLIENTENCODING'],
    ['target_session_attrs', 'PGTARGETSESSIONATTRS'],
    ['load_balance_hosts', 'PGLOADBALANCEHOSTS'],
  ]);

  for (const [name, value] of parsed.queryParams) {
    if (['host', 'port', 'dbname', 'user', 'password', 'hostaddr', 'ssl'].includes(name)) {
      continue;
    }
    const envName = queryEnv.get(name);
    if (!envName || value === '') reject('connection URI has an unsupported or empty parameter');
    env[envName] = value;
  }

  env.PGAPPNAME = 'shanda-fuel-stage1-rls-policy-diagnostic';
  env.PGOPTIONS = '-c default_transaction_read_only=on -c statement_timeout=30000';
  return env;
}

export function runDiagnostic({
  source = process.env.SF_MIGRATION_OWNER_DB_URL,
  parentEnvironment = process.env,
  spawnSyncImpl = spawnSync,
} = {}) {
  const env = buildDiagnosticChildEnvironment(source, parentEnvironment);
  const result = spawnSyncImpl(
    'psql',
    [
      '-X',
      '-w',
      '-v',
      'ON_ERROR_STOP=1',
      '--set=VERBOSITY=verbose',
      '--set=SHOW_CONTEXT=always',
      '--pset=pager=off',
    ],
    { env, input: DIAGNOSTIC_SQL, stdio: ['pipe', 'inherit', 'inherit'] },
  );
  if (result.error) reject('could not start psql');
  return result.status === null ? 1 : result.status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2)
      reject('diagnostic runner does not accept command-line arguments');
    process.exitCode = runDiagnostic();
  } catch (error) {
    if (error instanceof DiagnosticInputError) {
      console.error(`FAIL: ${error.message}.`);
      process.exitCode = 2;
    } else {
      throw error;
    }
  }
}
