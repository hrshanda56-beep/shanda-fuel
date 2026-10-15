#!/usr/bin/env node
/** DEMO ONLY — private disposable PostgreSQL 18; ignores all supplied database URLs. */
import { spawnSync, spawn } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  lstatSync,
  realpathSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { seed, manifest } from './seed.mjs';
import { check } from './check.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const root = `/private/tmp/shanda-owner-demo-${process.getuid()}`;
const data = path.join(root, 'data');
const socket = path.join(root, 'socket');
const marker = path.join(root, 'DEMO_ONLY');
const db = 'shanda_owner_demo';
const port = 55479;
const pgBin = process.env.DEMO_PG_BIN || '/opt/homebrew/opt/postgresql@18/bin';
const mode = process.argv[2];
// Do not inherit PG*, production credentials, NODE_OPTIONS, or service configuration.
const cleanEnv = Object.fromEntries(
  ['PATH', 'HOME', 'USER', 'TMPDIR', 'LANG', 'LC_ALL', 'PNPM_HOME']
    .filter((k) => process.env[k])
    .map((k) => [k, process.env[k]]),
);
function run(exe, args, extra = {}) {
  const result = spawnSync(exe, args, { cwd: repo, env: cleanEnv, stdio: 'inherit', ...extra });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(exe)} failed (${result.status})`);
}
function guard() {
  if (!existsSync(marker) || readFileSync(marker, 'utf8') !== 'SHANDA DEMO ONLY PG18 v1\n')
    throw new Error('Missing demo ownership marker');
  for (const dir of [root, data, socket]) {
    const stat = lstatSync(dir);
    if (
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      stat.uid !== process.getuid() ||
      (stat.mode & 0o077) !== 0 ||
      realpathSync(dir) !== dir
    )
      throw new Error('Unsafe demo directory');
  }
  if (readFileSync(path.join(data, 'PG_VERSION'), 'utf8').trim() !== '18')
    throw new Error('PostgreSQL 18 required');
}
function pg(exe, args) {
  run(path.join(pgBin, exe), args);
}
function connection(user = 'postgres', database = db) {
  return postgres({
    host: socket,
    port,
    username: user,
    database,
    max: 1,
    prepare: false,
    onnotice: () => {},
  });
}
async function verify(client) {
  const [row] =
    await client`select current_setting('data_directory') as directory,current_setting('server_version_num')::int as version,current_database() as db`;
  if (
    row.directory !== data ||
    row.version < 180000 ||
    row.version >= 190000 ||
    ![db, 'postgres'].includes(row.db)
  )
    throw new Error('Wrong demo server');
}
function startCluster() {
  guard();
  const status = spawnSync(path.join(pgBin, 'pg_ctl'), ['-D', data, 'status'], {
    env: cleanEnv,
    stdio: 'ignore',
  });
  if (status.status !== 0)
    pg('pg_ctl', ['-D', data, '-l', path.join(root, 'postgres.log'), '-w', 'start']);
}
async function setup(reset = false) {
  if (!existsSync(root)) {
    mkdirSync(root, { mode: 0o700 });
    mkdirSync(socket, { mode: 0o700 });
    pg('initdb', [
      '-D',
      data,
      '-U',
      'postgres',
      '--auth-local=trust',
      '--auth-host=reject',
      '--encoding=UTF8',
      '--locale=C',
    ]);
    writeFileSync(
      path.join(data, 'postgresql.auto.conf'),
      `listen_addresses = ''\nport = ${port}\nunix_socket_directories = '${socket}'\nunix_socket_permissions = 0700\ntimezone = 'UTC'\n`,
    );
    writeFileSync(marker, 'SHANDA DEMO ONLY PG18 v1\n', { mode: 0o600 });
  }
  startCluster();
  const admin = connection('postgres', 'postgres');
  try {
    await verify(admin);
    if (reset) {
      const [comment] =
        await admin`select shobj_description(oid,'pg_database') as marker from pg_database where datname=${db}`;
      if (comment && comment.marker !== 'SHANDA DEMO ONLY v1')
        throw new Error('Refusing reset of unmarked database');
      // No FORCE: active application sessions must be stopped explicitly first.
      await admin.unsafe(`drop database if exists ${db}`);
    }
    if (!(await admin`select 1 from pg_database where datname=${db}`).length) {
      await admin.unsafe(`create database ${db}`);
      await admin.unsafe(`comment on database ${db} is 'SHANDA DEMO ONLY v1'`);
    }
  } finally {
    await admin.end();
  }
  const sql = connection();
  try {
    await verify(sql);
    await sql.unsafe(readFileSync(path.join(repo, 'ops/db/bootstrap.sql'), 'utf8'));
    await sql.unsafe(
      readFileSync(path.join(repo, 'scripts/db/bootstrap-first-user-provisioner.sql'), 'utf8'),
    );
    await sql.unsafe(
      `grant create, connect on database ${db} to migration_owner with grant option`,
    );
    await sql.unsafe('set role migration_owner');
    await migrate(drizzle(sql), {
      migrationsFolder: path.join(repo, 'src/platform/db/migrations'),
    });
    await sql.unsafe('reset role');
    await sql.unsafe('alter role app_runtime login');
    await seed(sql);
    console.log(JSON.stringify(await manifest(sql), null, 2));
  } finally {
    await sql.end();
  }
}
async function app() {
  startCluster();
  const sql = connection();
  try {
    await verify(sql);
    if (!(await sql`select id from app.stations where code='DEMO-01'`).length)
      throw new Error('Run setup first');
  } finally {
    await sql.end();
  }
  for (const file of ['.env', '.env.local', '.env.development', '.env.development.local']) {
    if (existsSync(path.join(repo, file)))
      throw new Error(`Remove external env file before demo launch: ${file}`);
  }
  const env = {
    ...cleanEnv,
    APP_ENV: 'local',
    APP_URL: 'http://127.0.0.1:3215',
    AUTH_PROVIDER: 'BETTER_AUTH',
    REQUIRE_LOGIN_MFA: 'true',
    REQUIRE_PRIVILEGED_STEP_UP: 'true',
    BETTER_AUTH_SECRET: 'DEMO-ONLY-public-local-signing-key-2026',
    AUDIT_SIGNING_KEY_ID: 'DEMO-ONLY',
    AUDIT_SIGNING_KEY: 'DEMO-ONLY-public-local-audit-key-2026',
    DATABASE_URL: `postgresql:///${db}`,
    PGHOST: socket,
    PGPORT: String(port),
    PGUSER: 'app_runtime',
  };
  const child = spawn('pnpm', ['dev', '--hostname', '127.0.0.1', '--port', '3215'], {
    cwd: repo,
    env,
    stdio: 'inherit',
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Demo app exited (${code})`)),
    );
  });
}
try {
  if (!['setup', 'reset', 'dev', 'stop', 'status', 'check'].includes(mode))
    throw new Error('Usage: node scripts/demo/owner-demo.mjs setup|reset|dev|stop|status|check');
  const version = spawnSync(path.join(pgBin, 'postgres'), ['--version'], {
    env: cleanEnv,
    encoding: 'utf8',
  });
  if (!/PostgreSQL\) 18\./.test(version.stdout || ''))
    throw new Error('Set DEMO_PG_BIN to the PostgreSQL 18 bin directory');
  if (mode === 'setup' || mode === 'reset') await setup(mode === 'reset');
  if (mode === 'dev') await app();
  if (mode === 'stop') {
    guard();
    pg('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
  }
  if (mode === 'status' || mode === 'check') {
    guard();
    const sql = connection();
    try {
      await verify(sql);
      if (mode === 'check') await check(sql);
      else console.log(JSON.stringify(await manifest(sql), null, 2));
    } finally {
      await sql.end();
    }
  }
} catch (error) {
  // SQL/driver errors can contain credential-bearing queries: print only safe categories.
  console.error(
    `DEMO ONLY operation failed: ${error.code || (error instanceof Error && !('query' in error) ? error.message : 'database error')}`,
  );
  process.exitCode = 1;
}
