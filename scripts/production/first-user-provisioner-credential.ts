import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Operator-only helper for the temporary `first_user_provisioner` password (deployment.md,
 * "Temporary first-user credential authority"). It replaces the old Stage 1 helper that tried the
 * assignment through `migration_owner`, which cannot do it.
 *
 *   assign  sets the temporary password, then checks that nothing else about the role changed
 *   clear   runs `ALTER ROLE first_user_provisioner PASSWORD NULL`, with the same checks
 *
 * It does nothing else: no scope discovery, no dry run, no provisioning. The operator owns both
 * secrets (the provider/deployment-admin connection and the temporary password) and types them at
 * hidden prompts. Neither goes in argv, a file, the environment, a log or the output. The password
 * is turned into a SCRAM-SHA-256 verifier here, so the plaintext never reaches the server's
 * statement log. An assistant does not run this.
 */

export const APPROVED_PRODUCTION_HOST = 'ep-polished-haze-b29kd207.c-6.eu-central-1.aws.neon.tech';
export const TARGET_ROLE = 'first_user_provisioner';

/** Roles that must never be used as the admin connection (deployment.md: no shortcuts). */
export const FORBIDDEN_ADMIN_ROLES: readonly string[] = [
  'migration_owner',
  'first_user_provisioner',
  'app_runtime',
  'job_runtime',
  'diagnostics_readonly',
  'cloud_admin',
];

const MINIMUM_PASSWORD_LENGTH = 24;
const SCRAM_ITERATIONS = 4096;
const ALLOWED_SSLMODES = new Set(['require', 'verify-full']);

export class CredentialInputError extends Error {}

function reject(message: string): never {
  throw new CredentialInputError(message);
}

export type Action = 'assign' | 'clear';

export type AdminConnection = Readonly<{
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  sslmode: string;
}>;

/** Parses the operator's admin connection URI. Strict: approved host, TLS, nothing unexpected. */
export function parseAdminConnectionUri(source: string | undefined): AdminConnection {
  if (!source || /[\s]/.test(source)) reject('connection URI is missing or contains whitespace');
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return reject('connection URI is not a valid URI');
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    reject('connection URI must use postgresql://');
  }
  if (url.hostname.toLowerCase() !== APPROVED_PRODUCTION_HOST) {
    reject('connection URI host is not the approved production host');
  }
  if (url.hash) reject('connection URI must not have a fragment');
  const decode = (value: string) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return reject('connection URI has invalid percent-encoding');
    }
  };
  const user = decode(url.username);
  const password = decode(url.password);
  const database = decode(url.pathname.replace(/^\//, ''));
  if (!user || !password || !database) reject('connection URI is missing a required field');
  if (FORBIDDEN_ADMIN_ROLES.includes(user.toLowerCase())) {
    reject('connection URI user is not permitted for this operation');
  }
  let sslmode = 'require';
  const seen = new Set<string>();
  for (const [name, value] of url.searchParams) {
    if (seen.has(name)) reject('connection URI repeats a parameter');
    seen.add(name);
    if (name === 'sslmode') {
      if (!ALLOWED_SSLMODES.has(value))
        reject('connection URI sslmode must be require or verify-full');
      sslmode = value;
    } else if (name === 'channel_binding') {
      if (value !== 'require' && value !== 'prefer')
        reject('connection URI channel_binding is invalid');
    } else {
      reject('connection URI has an unsupported parameter');
    }
  }
  return { host: url.hostname, port: url.port || '5432', database, user, password, sslmode };
}

/** The temporary password the operator chose. Printable ASCII only, so no SASLprep ambiguity. */
export function validateTemporaryPassword(password: string): string {
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    reject(`temporary password must be at least ${MINIMUM_PASSWORD_LENGTH} characters`);
  }
  if (!/^[\x21-\x7e]+$/.test(password)) {
    reject('temporary password must be printable ASCII with no spaces');
  }
  return password;
}

/** PostgreSQL SCRAM-SHA-256 verifier, so the server never receives or logs the plaintext. */
export function buildScramVerifier(password: string, salt: Buffer = randomBytes(16)): string {
  const salted = pbkdf2Sync(password, salt, SCRAM_ITERATIONS, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${SCRAM_ITERATIONS}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

const VERIFIER_SHAPE =
  /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/;

const ROLE_SNAPSHOT_SQL = `(
  select jsonb_build_object(
    'role', to_jsonb(r) - 'oid' - 'rolpassword',
    'member_of', coalesce((select jsonb_agg(jsonb_build_object(
        'role', p.rolname, 'grantor', g.rolname,
        'admin', m.admin_option, 'inherit', m.inherit_option, 'set', m.set_option)
        order by p.rolname, g.rolname)
      from pg_auth_members m
      join pg_roles p on p.oid = m.roleid
      join pg_roles g on g.oid = m.grantor
      where m.member = r.oid), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object(
        'member', c.rolname, 'grantor', g.rolname,
        'admin', m.admin_option, 'inherit', m.inherit_option, 'set', m.set_option)
        order by c.rolname, g.rolname)
      from pg_auth_members m
      join pg_roles c on c.oid = m.member
      join pg_roles g on g.oid = m.grantor
      where m.roleid = r.oid), '[]'::jsonb))
  from pg_roles r where r.rolname = '${TARGET_ROLE}'
)`;

const forbiddenList = FORBIDDEN_ADMIN_ROLES.map((role) => `'${role}'`).join(', ');

/**
 * The only SQL this tool sends. One transaction: guard, snapshot, the single ALTER ROLE, compare.
 * Any difference in the role's attributes, settings or memberships rolls everything back.
 */
export function buildSql(action: Action, verifier?: string): string {
  let statement: string;
  if (action === 'assign') {
    if (!verifier || !VERIFIER_SHAPE.test(verifier)) reject('internal error: malformed verifier');
    statement = `ALTER ROLE ${TARGET_ROLE} PASSWORD '${verifier}';`;
  } else {
    statement = `ALTER ROLE ${TARGET_ROLE} PASSWORD NULL;`;
  }
  return `\\set ON_ERROR_STOP on
\\set VERBOSITY terse
\\set SHOW_CONTEXT never
BEGIN;
DO $guard$
BEGIN
  IF session_user <> current_user OR session_user IN (${forbiddenList}) THEN
    RAISE EXCEPTION 'refused: this connection user is not permitted for this operation';
  END IF;
  IF current_setting('server_version_num') <> '180006' THEN
    RAISE EXCEPTION 'refused: server version is not the approved PostgreSQL 18.6';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolcreaterole AND NOT rolsuper) THEN
    RAISE EXCEPTION 'refused: the connection user must have CREATEROLE and must not be a superuser';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${TARGET_ROLE}') THEN
    RAISE EXCEPTION 'refused: ${TARGET_ROLE} does not exist';
  END IF;
  PERFORM set_config('sf.role_before', ${ROLE_SNAPSHOT_SQL}::text, true);
END
$guard$;
${statement}
DO $verify$
BEGIN
  IF ${ROLE_SNAPSHOT_SQL}::text IS DISTINCT FROM current_setting('sf.role_before') THEN
    RAISE EXCEPTION 'refused: role attributes or memberships changed; rolled back';
  END IF;
END
$verify$;
COMMIT;
\\echo OK: ${action === 'assign' ? 'password assigned' : 'password cleared'} for ${TARGET_ROLE}; no other role attribute changed
`;
}

export type Prompter = Readonly<{
  hidden(question: string): Promise<string>;
  visible(question: string): Promise<string>;
}>;

export type RunResult = Readonly<{ status: number }>;

type SpawnImpl = (
  command: string,
  args: string[],
  options: { env: Record<string, string>; input: string; encoding: 'utf8' },
) => SpawnSyncReturns<string>;

function childEnvironment(connection: AdminConnection): Record<string, string> {
  // A minimal environment on purpose: no inherited PG* variables, service files or .pgpass.
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    PGHOST: connection.host,
    PGPORT: connection.port,
    PGDATABASE: connection.database,
    PGUSER: connection.user,
    PGPASSWORD: connection.password,
    PGSSLMODE: connection.sslmode,
    PGAPPNAME: 'shanda-fuel-first-user-provisioner-credential',
    PGOPTIONS: '-c statement_timeout=30000 -c lock_timeout=10000',
  };
}

function scrub(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) if (secret) out = out.split(secret).join('[redacted]');
  return out;
}

export async function run(
  action: Action,
  prompter: Prompter,
  spawnImpl: SpawnImpl = spawnSync as unknown as SpawnImpl,
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
  writeError: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): Promise<number> {
  const connection = parseAdminConnectionUri(
    await prompter.hidden('Admin connection URI (hidden, not echoed): '),
  );
  let verifier: string | undefined;
  let temporaryPassword = '';
  if (action === 'assign') {
    temporaryPassword = validateTemporaryPassword(
      await prompter.hidden('Temporary password for first_user_provisioner (hidden): '),
    );
    const again = await prompter.hidden('Type the temporary password again (hidden): ');
    if (again !== temporaryPassword) reject('the two passwords did not match');
    verifier = buildScramVerifier(temporaryPassword);
  }
  const phrase = `${action.toUpperCase()} ${TARGET_ROLE}`;
  write(
    `About to ${action} the password of ${TARGET_ROLE} on ${connection.host} as ${connection.user}.`,
  );
  const typed = await prompter.visible(`Type "${phrase}" to continue: `);
  if (typed.trim() !== phrase) reject('confirmation did not match; nothing was sent');

  const result = spawnImpl('psql', ['-X', '-w', '-q', '--pset=pager=off'], {
    env: childEnvironment(connection),
    input: buildSql(action, verifier),
    encoding: 'utf8',
  });
  const secrets = [connection.password, temporaryPassword, verifier ?? ''];
  if (result.error) reject('could not start psql');
  if (result.stdout) write(scrub(result.stdout.trimEnd(), secrets));
  if (result.stderr) writeError(scrub(result.stderr.trimEnd(), secrets));
  return result.status === null ? 1 : result.status;
}

export function createTerminalPrompter(
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
): Prompter {
  if (!input.isTTY || !output.isTTY) {
    reject('this tool needs an interactive terminal for its hidden prompts');
  }
  const read = (question: string, hidden: boolean) =>
    new Promise<string>((resolveRead, rejectRead) => {
      output.write(question);
      let value = '';
      input.setEncoding('utf8');
      if (hidden) input.setRawMode(true);
      input.resume();
      const finish = (error?: Error) => {
        input.removeListener('data', onData);
        if (hidden) input.setRawMode(false);
        input.pause();
        output.write('\n');
        if (error) rejectRead(error);
        else resolveRead(value);
      };
      const onData = (chunk: string) => {
        for (const char of chunk) {
          if (char === '\r' || char === '\n') return finish();
          if (char === '\u0003') return finish(new CredentialInputError('cancelled'));
          if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
          else if (hidden || char >= ' ') value += char;
        }
      };
      input.on('data', onData);
    });
  return {
    hidden: (question) => read(question, true),
    visible: (question) => read(question, false),
  };
}

export async function main(argv: readonly string[]): Promise<number> {
  const action = argv[0];
  if (argv.length !== 1 || (action !== 'assign' && action !== 'clear')) {
    reject('usage: first-user-provisioner-credential.ts assign|clear (no other arguments)');
  }
  return run(action, createTerminalPrompter());
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (status) => {
      process.exitCode = status;
    },
    (error: unknown) => {
      if (error instanceof CredentialInputError) {
        console.error(`FAIL: ${error.message}.`);
        process.exitCode = 2;
      } else {
        console.error('FAIL: unexpected error; nothing was printed to avoid leaking input.');
        process.exitCode = 1;
      }
    },
  );
}
