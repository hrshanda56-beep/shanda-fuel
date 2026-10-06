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

test('deployment-admin helper remains shell-valid', () => {
  const result = spawnSync('bash', ['-n', helperPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('deployment-admin transport is fixed, target-bound, and process-local', () => {
  assert.match(helper, /SF_DEPLOYMENT_ADMIN_DB_URL/);
  assert.match(helper, /SF_DEPLOYMENT_ADMIN_ROLE/);
  assert.match(helper, /SF_DEPLOYMENT_ADMIN_OPERATION/);
  assert.match(helper, /ep-polished-haze-b29kd207\.c-6\.eu-central-1\.aws\.neon\.tech/);
  assert.match(helper, /database !== "shanda_fuel"/);
  assert.match(helper, /deployment-admin connection does not accept SQL or psql arguments/);
  assert.match(helper, /\A.*\bassign\b.*\bcleanup\b/s);
  assert.match(helper, /PASSWORD NULL/);
  assert.match(helper, /\\bind \$\{temporaryPasswordArgument\}/);
  assert.match(helper, /trap sf_phase_exit EXIT INT TERM HUP/);
  assert.match(helper, /trap - EXIT INT TERM HUP/);
  assert.match(
    helper,
    /unset SF_EPHEMERAL_PASSWORD SF_PROVISIONER_DB_URL SF_DEPLOYMENT_ADMIN_DB_URL SF_DEPLOYMENT_ADMIN_ROLE/,
  );
  assert.doesNotMatch(helper, /SF_DEPLOYMENT_ADMIN_DB_URL.*-c| -c.*SF_DEPLOYMENT_ADMIN_DB_URL/);
});

test('assignment uses the deployment-admin path and preserves migration-owner authority', () => {
  const assignmentStart = helper.indexOf('sf_assign_ephemeral_password() {');
  const cleanupStart = helper.indexOf('sf_build_provisioner_url() {');
  assert.notEqual(assignmentStart, -1);
  assert.notEqual(cleanupStart, -1);
  const assignment = helper.slice(assignmentStart, cleanupStart);
  assert.match(assignment, /SF_DEPLOYMENT_ADMIN_OPERATION=assign/);
  assert.match(assignment, /sf_psql_from_uri SF_DEPLOYMENT_ADMIN_DB_URL/);
  assert.doesNotMatch(assignment, /SF_MIGRATION_OWNER_DB_URL/);
  assert.match(helper, /NOT r\.rolcreaterole AS nocreaterole/);
  assert.match(helper, /PASSWORD NULL/);
});

test('admin SQL is not a caller-controlled execution surface', () => {
  const adminInvocation = helper.slice(
    helper.indexOf('const result = spawnSync('),
    helper.indexOf('if (result.error)', helper.indexOf('const result = spawnSync(')),
  );
  assert.match(
    adminInvocation,
    /sourceName === "SF_DEPLOYMENT_ADMIN_DB_URL" \? \[\] : process\.argv\.slice\(1\)/,
  );
  assert.match(helper, /fixedAdminSql = adminOperation === "assign"/);
  assert.match(helper, /adminOperation === "cleanup"/);
  assert.match(helper, /fixed admin parameter contains an invalid control character/);
});

test(
  'PG18.6 fixed admin path handles assignment, auth, cleanup, and failures',
  { skip: !process.env.SF_RUN_LOCAL_PG18 },
  () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'sf-stage1-admin-test-'));
    const wrapperDir = join(tempRoot, 'bin');
    const wrapperPath = join(wrapperDir, 'psql');
    const nodeStart = helper.indexOf('import { spawnSync } from "node:child_process";');
    const nodeEnd = helper.indexOf('\n\' -- "$@"', nodeStart);
    assert.ok(nodeStart >= 0 && nodeEnd > nodeStart);
    const parserProgram = helper.slice(nodeStart, nodeEnd);
    // The directory is created by the test process so the wrapper's path is never a repository file.
    mkdirSync(wrapperDir, { mode: 0o700 });
    chmodSync(wrapperDir, 0o700);
    writeFileSync(
      wrapperPath,
      '#!/bin/sh\nexec env PGHOST=127.0.0.1 PGPORT=55435 /opt/homebrew/opt/postgresql@18/bin/psql "$@"\n',
      { mode: 0o700 },
    );

    const baseUrl = (user, password) =>
      `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@ep-polished-haze-b29kd207.c-6.eu-central-1.aws.neon.tech:55435/shanda_fuel?sslmode=disable`;
    const run = (operation, url, role, temporaryPassword = '') =>
      spawnSync(process.execPath, ['--input-type=module', '-e', parserProgram], {
        env: {
          ...process.env,
          PATH: `${wrapperDir}:${process.env.PATH}`,
          SF_PSQL_URI_ENV_NAME: 'SF_DEPLOYMENT_ADMIN_DB_URL',
          SF_DEPLOYMENT_ADMIN_DB_URL: url,
          SF_DEPLOYMENT_ADMIN_ROLE: role,
          SF_DEPLOYMENT_ADMIN_OPERATION: operation,
          SF_EPHEMERAL_PASSWORD: temporaryPassword,
        },
        encoding: 'utf8',
      });

    const reservedPassword = "Res'erved:%/+12";
    const assigned = run(
      'assign',
      baseUrl('deployment_admin', 'adminpass'),
      'deployment_admin',
      reservedPassword,
    );
    assert.equal(assigned.status, 0, assigned.stderr);
    const auth = spawnSync(
      'env',
      [
        'PGPASSWORD=' + reservedPassword,
        '/opt/homebrew/opt/postgresql@18/bin/psql',
        '-h',
        '127.0.0.1',
        '-p',
        '55435',
        '-U',
        'first_user_provisioner',
        '-d',
        'shanda_fuel',
        '-X',
        '-w',
        '-Atqc',
        'select 1',
      ],
      { encoding: 'utf8' },
    );
    assert.equal(auth.status, 0, auth.stderr);

    const cleaned = run('cleanup', baseUrl('deployment_admin', 'adminpass'), 'deployment_admin');
    assert.equal(cleaned.status, 0, cleaned.stderr);
    const authAfterCleanup = spawnSync(
      'env',
      [
        'PGPASSWORD=' + reservedPassword,
        '/opt/homebrew/opt/postgresql@18/bin/psql',
        '-h',
        '127.0.0.1',
        '-p',
        '55435',
        '-U',
        'first_user_provisioner',
        '-d',
        'shanda_fuel',
        '-X',
        '-w',
        '-Atqc',
        'select 1',
      ],
      { encoding: 'utf8' },
    );
    assert.notEqual(authAfterCleanup.status, 0);

    const ordinaryPassword = 'OrdinaryPass12';
    const ordinaryAssignment = run(
      'assign',
      baseUrl('deployment_admin', 'adminpass'),
      'deployment_admin',
      ordinaryPassword,
    );
    assert.equal(ordinaryAssignment.status, 0, ordinaryAssignment.stderr);
    const ordinaryAuth = spawnSync(
      'env',
      [
        'PGPASSWORD=' + ordinaryPassword,
        '/opt/homebrew/opt/postgresql@18/bin/psql',
        '-h',
        '127.0.0.1',
        '-p',
        '55435',
        '-U',
        'first_user_provisioner',
        '-d',
        'shanda_fuel',
        '-X',
        '-w',
        '-Atqc',
        'select 1',
      ],
      { encoding: 'utf8' },
    );
    assert.equal(ordinaryAuth.status, 0, ordinaryAuth.stderr);

    const failedCleanup = run(
      'cleanup',
      baseUrl('deployment_admin', 'wrong-admin-password'),
      'deployment_admin',
    );
    assert.notEqual(failedCleanup.status, 0);
    const authAfterFailedCleanup = spawnSync(
      'env',
      [
        'PGPASSWORD=' + ordinaryPassword,
        '/opt/homebrew/opt/postgresql@18/bin/psql',
        '-h',
        '127.0.0.1',
        '-p',
        '55435',
        '-U',
        'first_user_provisioner',
        '-d',
        'shanda_fuel',
        '-X',
        '-w',
        '-Atqc',
        'select 1',
      ],
      { encoding: 'utf8' },
    );
    assert.equal(authAfterFailedCleanup.status, 0);
    const finalCleanup = run(
      'cleanup',
      baseUrl('deployment_admin', 'adminpass'),
      'deployment_admin',
    );
    assert.equal(finalCleanup.status, 0, finalCleanup.stderr);

    const failedAssignment = run(
      'assign',
      baseUrl('limited_admin', 'limitedpass'),
      'limited_admin',
      'OrdinaryPass12',
    );
    assert.notEqual(failedAssignment.status, 0);
    assert.match(
      `${failedAssignment.stdout}${failedAssignment.stderr}`,
      /temporary password assignment failed|permission denied/,
    );

    const wrongRole = run('cleanup', baseUrl('limited_admin', 'limitedpass'), 'deployment_admin');
    assert.notEqual(wrongRole.status, 0);
    assert.doesNotMatch(`${wrongRole.stdout}${wrongRole.stderr}`, /limited_admin|limitedpass/);

    const spawnMarker = join(tempRoot, 'wrong-target-spawned');
    const mockDir = join(tempRoot, 'mock-bin');
    mkdirSync(mockDir, { mode: 0o700 });
    writeFileSync(join(mockDir, 'psql'), `#!/bin/sh\nprintf x > ${spawnMarker}\nexit 0\n`, {
      mode: 0o700,
    });
    const wrongTarget = spawnSync(process.execPath, ['--input-type=module', '-e', parserProgram], {
      env: {
        ...process.env,
        PATH: `${mockDir}:${process.env.PATH}`,
        SF_PSQL_URI_ENV_NAME: 'SF_DEPLOYMENT_ADMIN_DB_URL',
        SF_DEPLOYMENT_ADMIN_DB_URL: baseUrl('deployment_admin', 'adminpass').replace(
          'ep-polished-haze-b29kd207.c-6.eu-central-1.aws.neon.tech',
          'wrong.example.invalid',
        ),
        SF_DEPLOYMENT_ADMIN_ROLE: 'deployment_admin',
        SF_DEPLOYMENT_ADMIN_OPERATION: 'cleanup',
      },
      encoding: 'utf8',
    });
    assert.notEqual(wrongTarget.status, 0);
    assert.equal(existsSync(spawnMarker), false);
  },
);
