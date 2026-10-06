import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const helperPath = '/Users/wolftech/.codex/phase0/production-dry-run-stage1.sh';
const helper = readFileSync(helperPath, 'utf8');

test('control-plane reset/self-cleanup helper remains shell-valid', () => {
  const result = spawnSync('bash', ['-n', helperPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('control-plane workflow is human-only and fail-closed', () => {
  assert.match(helper, /sf_verify_ephemeral_password\(\)/);
  assert.match(helper, /ALTER ROLE first_user_provisioner PASSWORD NULL/);
  assert.match(helper, /rolpassword IS NOT NULL/);
  assert.match(helper, /password must be non-NULL after the approved control-plane reset/);
  assert.doesNotMatch(helper, /password must be NULL before assignment/);
  assert.match(helper, /ep-polished-haze-b29kd207\.c-6\.eu-central-1\.aws\.neon\.tech/);
  assert.match(helper, /database !== "shanda_fuel"/);
  assert.match(helper, /trap sf_phase_exit EXIT/);
  assert.match(helper, /trap sf_phase_signal INT TERM HUP/);
  assert.match(helper, /trap - EXIT INT TERM HUP/);
  assert.match(helper, /unset SF_EPHEMERAL_PASSWORD SF_PROVISIONER_DB_URL/);
  assert.doesNotMatch(helper, /SF_DEPLOYMENT_ADMIN_/);
});

test('cleanup is fixed and cannot use a caller-supplied password command', () => {
  const cleanupStart = helper.indexOf('sf_cleanup_temp_password() {');
  const phaseExitStart = helper.indexOf('sf_phase_exit() {');
  assert.notEqual(cleanupStart, -1);
  assert.notEqual(phaseExitStart, -1);
  const cleanup = helper.slice(cleanupStart, phaseExitStart);
  assert.match(cleanup, /sf_psql_from_uri SF_PROVISIONER_DB_URL/);
  assert.match(cleanup, /-c 'ALTER ROLE first_user_provisioner PASSWORD NULL;'/);
  assert.doesNotMatch(cleanup, /SF_MIGRATION_OWNER_DB_URL.*ALTER ROLE/s);
  assert.match(cleanup, /password authentication failed/);
  assert.match(cleanup, /safe first_user_provisioner role attributes changed/);
  assert.match(cleanup, /provider membership topology changed/);
  assert.match(cleanup, /ownership changed/);
});

test('interrupt and cleanup traps remain armed', () => {
  assert.match(helper, /SF_CLEANUP_ARMED=1/);
  assert.match(helper, /trap sf_phase_exit EXIT/);
  assert.match(helper, /trap sf_phase_signal INT TERM HUP/);
  assert.match(helper, /if ! sf_cleanup_temp_password; then/);
  assert.match(helper, /status=1/);
  const scopeStart = helper.indexOf('sf_scope_discovery_phase() (');
  const prepareStart = helper.indexOf('sf_prepare_ephemeral_session', scopeStart);
  const armStart = helper.indexOf('SF_CLEANUP_ARMED=1', scopeStart);
  assert.ok(scopeStart >= 0 && armStart >= 0 && prepareStart > armStart);
});

test('SIGTERM enters the cleanup trap and returns nonzero', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'sf-stage1-interrupt-test-'));
  const marker = join(tempRoot, 'cleanup-called');
  const phaseStart = helper.indexOf('sf_phase_exit() {');
  const phaseEnd = helper.indexOf('sf_prepare_ephemeral_session() {', phaseStart);
  assert.ok(phaseStart >= 0 && phaseEnd > phaseStart);
  const script = `#!/usr/bin/env bash
set -Eeuo pipefail
${helper.slice(phaseStart, phaseEnd)}
sf_cleanup_temp_password() { printf x > '${marker}'; return 0; }
SF_CLEANUP_ARMED=1
trap sf_phase_exit EXIT
trap sf_phase_signal INT TERM HUP
kill -TERM $$
`;
  const scriptPath = join(tempRoot, 'interrupt.sh');
  writeFileSync(scriptPath, script, { mode: 0o700 });
  const result = spawnSync('bash', [scriptPath], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(marker), true);
});

test('input and scope failure paths remain fail-closed before cleanup', () => {
  const prepareStart = helper.indexOf('sf_prepare_ephemeral_session() {');
  const prepareEnd = helper.indexOf('\nsf_assert_direct_session() {', prepareStart);
  assert.ok(prepareStart >= 0 && prepareEnd > prepareStart);
  const prepare = helper.slice(prepareStart, prepareEnd);
  assert.match(prepare, /read -r -s SF_EPHEMERAL_PASSWORD < \/dev\/tty/);
  assert.match(prepare, /test "\$\{#SF_EPHEMERAL_PASSWORD\}" -ge 12/);

  const phaseStart = helper.indexOf('sf_phase_exit() {');
  const scopeStart = helper.indexOf('sf_scope_discovery_phase() (');
  const scopeEnd = helper.indexOf('\nsf_scope_discovery_phase\n', scopeStart);
  assert.ok(phaseStart >= 0 && scopeStart > phaseStart && scopeEnd > scopeStart);
  const phase = helper.slice(phaseStart, prepareStart);
  const scope = helper.slice(scopeStart, scopeEnd);

  const runScenario = (name, prepareBody, directBody) => {
    const tempRoot = mkdtempSync(join(tmpdir(), `sf-stage1-${name}-`));
    const marker = join(tempRoot, 'cleanup-called');
    const script = `#!/usr/bin/env bash
set -Eeuo pipefail
${phase}
${scope}
sf_cleanup_temp_password() { printf x > '${marker}'; return 0; }
sf_prepare_ephemeral_session() { ${prepareBody}; }
sf_assert_direct_session() { ${directBody}; }
sf_assert_set_role_denied() { return 0; }
SF_PROVISIONER_DB_URL=dummy
sf_scope_discovery_phase
`;
    const scriptPath = join(tempRoot, 'scenario.sh');
    writeFileSync(scriptPath, script, { mode: 0o700 });
    const result = spawnSync('bash', [scriptPath], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, `${name} unexpectedly succeeded`);
    assert.equal(existsSync(marker), true, `${name} did not clean up`);
  };

  runScenario('interrupt-before-scope', 'kill -TERM $$', 'return 0');
  runScenario('interrupt-after-auth', 'return 0', 'kill -TERM $$');
  runScenario('scope-failure', 'return 0', 'return 1');
});

test(
  'PG18.6 control-plane-reset equivalent supports auth, self-cleanup, and failure paths',
  { skip: !process.env.SF_RUN_LOCAL_PG18 },
  () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'sf-stage1-self-cleanup-test-'));
    const wrapperDir = join(tempRoot, 'bin');
    const wrapperPath = join(wrapperDir, 'psql');
    const nodeStart = helper.indexOf('import { spawnSync } from "node:child_process";');
    const nodeEnd = helper.indexOf('\n\' -- "$@"', nodeStart);
    assert.ok(nodeStart >= 0 && nodeEnd > nodeStart);
    const parserProgram = helper.slice(nodeStart, nodeEnd);
    mkdirSync(wrapperDir, { mode: 0o700 });
    chmodSync(wrapperDir, 0o700);
    writeFileSync(
      wrapperPath,
      '#!/bin/sh\nexec env PGHOST=127.0.0.1 PGPORT=55434 /opt/homebrew/opt/postgresql@18/bin/psql "$@"\n',
      { mode: 0o700 },
    );

    const baseUrl = (user, password) =>
      `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@ep-polished-haze-b29kd207.c-6.eu-central-1.aws.neon.tech:55434/shanda_fuel?sslmode=disable`;
    const runProvisioner = (password, ...args) =>
      spawnSync(process.execPath, ['--input-type=module', '-e', parserProgram, '--', ...args], {
        env: {
          ...process.env,
          PATH: `${wrapperDir}:${process.env.PATH}`,
          SF_PSQL_URI_ENV_NAME: 'SF_PROVISIONER_DB_URL',
          SF_PROVISIONER_DB_URL: baseUrl('first_user_provisioner', password),
        },
        encoding: 'utf8',
      });
    const runResetEquivalent = (password, adminPassword = 'postgrespass') =>
      spawnSync(
        '/opt/homebrew/opt/postgresql@18/bin/psql',
        [
          '-h',
          '127.0.0.1',
          '-p',
          '55434',
          '-U',
          'postgres',
          '-d',
          'shanda_fuel',
          '-X',
          '-w',
          '-v',
          'ON_ERROR_STOP=1',
          '-c',
          `ALTER ROLE first_user_provisioner PASSWORD '${password.replaceAll("'", "''")}'`,
        ],
        {
          env: { ...process.env, PGPASSWORD: adminPassword },
          encoding: 'utf8',
        },
      );

    const runAdminSql = (sqlText) =>
      spawnSync(
        '/opt/homebrew/opt/postgresql@18/bin/psql',
        [
          '-h',
          '127.0.0.1',
          '-p',
          '55434',
          '-U',
          'postgres',
          '-d',
          'shanda_fuel',
          '-X',
          '-w',
          '-At',
          '-v',
          'ON_ERROR_STOP=1',
          '-c',
          sqlText,
        ],
        { env: { ...process.env, PGPASSWORD: 'postgrespass' }, encoding: 'utf8' },
      );

    const membershipSnapshot = () =>
      runAdminSql(`
        SELECT member.rolname, parent.rolname, grantor.rolname,
               m.admin_option, m.inherit_option, m.set_option
          FROM pg_auth_members AS m
          JOIN pg_roles AS member ON member.oid = m.member
          JOIN pg_roles AS parent ON parent.oid = m.roleid
          JOIN pg_roles AS grantor ON grantor.oid = m.grantor
         WHERE member.rolname = 'first_user_provisioner'
            OR parent.rolname = 'first_user_provisioner'
         ORDER BY member.rolname, parent.rolname, grantor.rolname;
      `).stdout.trim();

    const invariantsHold = () =>
      runAdminSql(`
        SELECT (
          (SELECT rolpassword IS NULL FROM pg_authid WHERE rolname = 'first_user_provisioner')
          AND (SELECT rolcanlogin AND NOT rolsuper AND NOT rolinherit
                      AND NOT rolcreaterole AND NOT rolcreatedb
                      AND NOT rolreplication AND NOT rolbypassrls
                      AND rolconfig IS NULL
                 FROM pg_roles WHERE rolname = 'first_user_provisioner')
          AND NOT EXISTS (
                SELECT 1 FROM pg_database
                 WHERE datname = current_database()
                   AND datdba = 'first_user_provisioner'::regrole)
          AND NOT EXISTS (
                SELECT 1 FROM pg_namespace
                 WHERE nspowner = 'first_user_provisioner'::regrole)
          AND NOT EXISTS (
                SELECT 1 FROM pg_class
                 WHERE relowner = 'first_user_provisioner'::regrole)
          AND NOT EXISTS (
                SELECT 1
                  FROM pg_class AS c
                  JOIN pg_namespace AS n ON n.oid = c.relnamespace
                  CROSS JOIN LATERAL aclexplode(
                    coalesce(c.relacl, acldefault('r', c.relowner))
                  ) AS acl
                 WHERE n.nspname IN ('app', 'auth', 'platform')
                   AND acl.grantee = 'first_user_provisioner'::regrole)
        );
      `).stdout.trim();

    assert.equal(runAdminSql('REVOKE first_user_provisioner FROM deployment_admin;').status, 0);
    assert.equal(runAdminSql('ALTER ROLE first_user_provisioner PASSWORD NULL;').status, 0);
    const baselineMembership = membershipSnapshot();
    assert.notEqual(baselineMembership, '');
    assert.notEqual(runProvisioner('InitialProbe12', '-c', 'select 1').status, 0);

    const reservedPassword = "Res'erved:%/+12";
    assert.notEqual(runResetEquivalent(reservedPassword, 'wrong-admin-password').status, 0);
    assert.equal(runResetEquivalent(reservedPassword).status, 0);
    assert.equal(runProvisioner(reservedPassword, '-c', 'select 1').status, 0);
    assert.equal(
      runProvisioner(reservedPassword, '-c', 'ALTER ROLE first_user_provisioner PASSWORD NULL;')
        .status,
      0,
    );
    assert.notEqual(runProvisioner(reservedPassword, '-c', 'select 1').status, 0);

    const ordinaryPassword = 'OrdinaryPass12';
    assert.equal(runResetEquivalent(ordinaryPassword).status, 0);
    assert.equal(runProvisioner(ordinaryPassword, '-c', 'select 1').status, 0);
    assert.notEqual(runProvisioner('WrongPass12', '-c', 'select 1').status, 0);
    assert.equal(
      runProvisioner(
        ordinaryPassword,
        '-c',
        'BEGIN TRANSACTION READ ONLY; SELECT platform.first_user_provisioning_scope_options(); ROLLBACK;',
      ).status,
      0,
    );
    assert.notEqual(
      runProvisioner('WrongPass12', '-c', 'ALTER ROLE first_user_provisioner PASSWORD NULL;')
        .status,
      0,
    );
    assert.equal(runProvisioner(ordinaryPassword, '-c', 'select 1').status, 0);
    assert.equal(
      runProvisioner(ordinaryPassword, '-c', 'ALTER ROLE first_user_provisioner PASSWORD NULL;')
        .status,
      0,
    );
    assert.notEqual(runProvisioner(ordinaryPassword, '-c', 'select 1').status, 0);
    assert.equal(invariantsHold(), 't');
    assert.equal(membershipSnapshot(), baselineMembership);

    assert.equal(runAdminSql('GRANT first_user_provisioner TO deployment_admin;').status, 0);
    assert.equal(
      runAdminSql(
        "SELECT count(*) FROM pg_auth_members WHERE roleid = 'first_user_provisioner'::regrole OR member = 'first_user_provisioner'::regrole;",
      ).stdout.trim(),
      '2',
    );
    assert.notEqual(membershipSnapshot(), baselineMembership);
    assert.equal(runAdminSql('REVOKE first_user_provisioner FROM deployment_admin;').status, 0);
    assert.equal(
      runAdminSql(
        "SELECT count(*) FROM pg_auth_members WHERE roleid = 'first_user_provisioner'::regrole OR member = 'first_user_provisioner'::regrole;",
      ).stdout.trim(),
      '1',
    );
    assert.equal(invariantsHold(), 't');
    assert.equal(membershipSnapshot(), baselineMembership);

    const wrongTargetMarker = join(tempRoot, 'wrong-target-spawned');
    const mockDir = join(tempRoot, 'mock-bin');
    mkdirSync(mockDir, { mode: 0o700 });
    writeFileSync(join(mockDir, 'psql'), `#!/bin/sh\nprintf x > ${wrongTargetMarker}\nexit 0\n`, {
      mode: 0o700,
    });
    const wrongTarget = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', parserProgram, '--', '-c', 'select 1'],
      {
        env: {
          ...process.env,
          PATH: `${mockDir}:${process.env.PATH}`,
          SF_PSQL_URI_ENV_NAME: 'SF_PROVISIONER_DB_URL',
          SF_PROVISIONER_DB_URL: baseUrl('first_user_provisioner', ordinaryPassword).replace(
            'ep-polished-haze-b29kd207.c-6.eu-central-1.aws.neon.tech',
            'wrong.example.invalid',
          ),
        },
        encoding: 'utf8',
      },
    );
    assert.notEqual(wrongTarget.status, 0);
    assert.equal(existsSync(wrongTargetMarker), false);
  },
);
