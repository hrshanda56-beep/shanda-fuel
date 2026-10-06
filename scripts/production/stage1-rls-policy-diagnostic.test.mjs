import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APPROVED_PRODUCTION_HOST,
  DIAGNOSTIC_SQL,
  DiagnosticInputError,
  buildDiagnosticChildEnvironment,
  runDiagnostic,
} from './stage1-rls-policy-diagnostic.mjs';

const validUri =
  'postgresql://migration_owner:p%40ss@' +
  APPROVED_PRODUCTION_HOST +
  '/shanda_fuel?sslmode=require';

test('approved target reaches a mocked psql spawn with child-only decoded credentials', () => {
  let invocation;
  const status = runDiagnostic({
    source: validUri,
    parentEnvironment: {
      SF_MIGRATION_OWNER_DB_URL: validUri,
      PGHOST: 'wrong-parent-host',
      PGPASSWORD: 'wrong-parent-password',
    },
    spawnSyncImpl: (file, args, options) => {
      invocation = { file, args, options };
      return { error: undefined, status: 0 };
    },
  });

  assert.equal(status, 0);
  assert.equal(invocation.file, 'psql');
  assert.deepEqual(invocation.args.slice(0, 4), ['-X', '-w', '-v', 'ON_ERROR_STOP=1']);
  assert.equal(invocation.options.env.PGHOST, APPROVED_PRODUCTION_HOST);
  assert.equal(invocation.options.env.PGPASSWORD, 'p@ss');
  assert.equal(invocation.options.env.PGSSLMODE, 'require');
  assert.equal(
    invocation.options.env.PGOPTIONS,
    '-c default_transaction_read_only=on -c statement_timeout=30000',
  );
  assert.equal(invocation.options.input, DIAGNOSTIC_SQL);
  assert.equal('SF_MIGRATION_OWNER_DB_URL' in invocation.options.env, false);
  assert.equal(invocation.options.env.PGHOST, APPROVED_PRODUCTION_HOST);
  assert.equal(invocation.options.env.PGAPPNAME, 'shanda-fuel-stage1-rls-policy-diagnostic');
});

test('wrong host fails before psql and does not print the supplied host', () => {
  let spawned = false;
  assert.throws(
    () =>
      runDiagnostic({
        source: 'postgresql://migration_owner:p%40ss@wrong.example/shanda_fuel',
        spawnSyncImpl: () => {
          spawned = true;
          return { error: undefined, status: 0 };
        },
      }),
    (error) =>
      error instanceof DiagnosticInputError &&
      error.message === 'connection URI target is not the approved production endpoint',
  );
  assert.equal(spawned, false);
});

for (const [name, uri] of [
  ['malformed URI', 'not-a-postgres-uri'],
  ['unsupported parameter', `${validUri}&not_allowed=true`],
  ['duplicate parameter', `${validUri}&sslmode=require`],
  ['ssl conflict', validUri.replace('sslmode=require', 'ssl=true&sslmode=require')],
  ['invalid port', `${validUri}&port=0`],
  ['target override', `${validUri}&hostaddr=127.0.0.1`],
  [
    'missing required password',
    `postgresql://migration_owner@${APPROVED_PRODUCTION_HOST}/shanda_fuel`,
  ],
]) {
  test(`${name} fails before psql`, () => {
    let spawned = false;
    assert.throws(
      () =>
        runDiagnostic({
          source: uri,
          spawnSyncImpl: () => {
            spawned = true;
            return { error: undefined, status: 0 };
          },
        }),
      DiagnosticInputError,
    );
    assert.equal(spawned, false);
  });
}

test('parent libpq and URI variables are removed from the child except decoded PGPASSWORD', () => {
  const env = buildDiagnosticChildEnvironment(validUri, {
    SF_MIGRATION_OWNER_DB_URL: validUri,
    DATABASE_URL: 'postgresql://secret.example/hidden',
    PGHOST: 'wrong-parent-host',
    PGOPTIONS: '-c default_transaction_read_only=off',
    PGPASSWORD: 'wrong-parent-password',
    SAFE_OPERATOR_VALUE: 'retained',
  });
  assert.equal(env.SAFE_OPERATOR_VALUE, 'retained');
  assert.equal('SF_MIGRATION_OWNER_DB_URL' in env, false);
  assert.equal('DATABASE_URL' in env, false);
  assert.equal('PGHOSTADDR' in env, false);
  assert.equal(env.PGPASSWORD, 'p@ss');
});

test('inherited PGHOSTADDR is rejected before psql', () => {
  assert.throws(
    () =>
      runDiagnostic({
        source: validUri,
        parentEnvironment: { PGHOSTADDR: '127.0.0.1' },
        spawnSyncImpl: () => {
          throw new Error('psql must not spawn');
        },
      }),
    (error) =>
      error instanceof DiagnosticInputError &&
      error.message === 'inherited PGHOSTADDR is not permitted for this diagnostic',
  );
});

test('diagnostic reproduces both historical policy subconditions and their conjunction', () => {
  assert.match(DIAGNOSTIC_SQL, /exact_definer_policy_count_ok/);
  assert.match(DIAGNOSTIC_SQL, /no_unexpected_prefixed_policy_ok/);
  assert.match(DIAGNOSTIC_SQL, /AS policy_checks_ok/);
  assert.match(
    DIAGNOSTIC_SQL,
    /p\.policyname LIKE 'first_user_provisioning_%'[\s\S]+p\.policyname <> 'first_user_provisioning_definer'/,
  );
  assert.match(DIAGNOSTIC_SQL, /p\.qual = '\(CURRENT_USER = ''migration_owner''::name\)'/);
  assert.match(DIAGNOSTIC_SQL, /p\.with_check = '\(CURRENT_USER = ''migration_owner''::name\)'/);
  assert.match(DIAGNOSTIC_SQL, /p\.cmd = 'ALL'/);
  assert.doesNotMatch(DIAGNOSTIC_SQL, /p\.cmd = '\*'/);
  assert.match(DIAGNOSTIC_SQL, /policy\.polqual::text AS raw_qual/);
  assert.match(DIAGNOSTIC_SQL, /policy\.polwithcheck::text AS raw_with_check/);
});
