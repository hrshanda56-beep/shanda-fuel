import { describe, expect, it, vi } from 'vitest';

import {
  APPROVED_PRODUCTION_HOST,
  buildScramVerifier,
  buildSql,
  CredentialInputError,
  parseAdminConnectionUri,
  run,
  validateTemporaryPassword,
  type Prompter,
} from '../../../scripts/production/first-user-provisioner-credential';

const PASSWORD = 'placeholder-temporary-password-0000';
const ADMIN_PASSWORD = 'admin-secret-value';
const uri = (user = 'neondb_owner', query = '?sslmode=require') =>
  `postgresql://${user}:${ADMIN_PASSWORD}@${APPROVED_PRODUCTION_HOST}/neondb${query}`;

function prompter(answers: string[]): Prompter {
  const next = () => answers.shift() ?? '';
  return { hidden: async () => next(), visible: async () => next() };
}

describe('parseAdminConnectionUri', () => {
  it('accepts the approved host with TLS', () => {
    expect(parseAdminConnectionUri(uri())).toMatchObject({
      host: APPROVED_PRODUCTION_HOST,
      user: 'neondb_owner',
      database: 'neondb',
      sslmode: 'require',
    });
  });

  it.each([
    ['another host', uri().replace(APPROVED_PRODUCTION_HOST, 'example.com')],
    ['a forbidden role', uri('migration_owner')],
    ['cloud_admin', uri('cloud_admin')],
    ['the provisioner itself', uri('first_user_provisioner')],
    ['sslmode disable', uri('neondb_owner', '?sslmode=disable')],
    ['hostaddr', uri('neondb_owner', '?sslmode=require&hostaddr=127.0.0.1')],
    ['options', uri('neondb_owner', '?sslmode=require&options=-c%20x%3D1')],
    ['repeated parameters', uri('neondb_owner', '?sslmode=require&sslmode=require')],
    ['no password', `postgresql://neondb_owner@${APPROVED_PRODUCTION_HOST}/neondb`],
    ['whitespace', `${uri()} `],
    ['empty', ''],
  ])('rejects %s', (_name, value) => {
    expect(() => parseAdminConnectionUri(value)).toThrow(CredentialInputError);
  });

  it('never puts the secret in an error message', () => {
    try {
      parseAdminConnectionUri(uri('migration_owner'));
    } catch (error) {
      expect((error as Error).message).not.toContain(ADMIN_PASSWORD);
    }
  });
});

describe('validateTemporaryPassword', () => {
  it('requires length and printable ASCII', () => {
    expect(validateTemporaryPassword(PASSWORD)).toBe(PASSWORD);
    expect(() => validateTemporaryPassword('short')).toThrow(CredentialInputError);
    expect(() => validateTemporaryPassword(`${PASSWORD} with space`)).toThrow(CredentialInputError);
    expect(() => validateTemporaryPassword(`${PASSWORD}é`)).toThrow(CredentialInputError);
  });
});

describe('buildScramVerifier', () => {
  it('is deterministic for a salt, salted otherwise, and hides the plaintext', () => {
    const salt = Buffer.alloc(16, 7);
    const a = buildScramVerifier(PASSWORD, salt);
    expect(a).toBe(buildScramVerifier(PASSWORD, salt));
    expect(a).toMatch(
      /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/,
    );
    expect(buildScramVerifier(PASSWORD)).not.toBe(buildScramVerifier(PASSWORD));
    expect(a).not.toContain(PASSWORD);
  });
});

describe('buildSql', () => {
  const verifier = buildScramVerifier(PASSWORD);

  it('sends exactly one ALTER ROLE, for the provisioner, inside a checked transaction', () => {
    for (const sql of [buildSql('assign', verifier), buildSql('clear')]) {
      expect(sql.match(/ALTER ROLE/g)).toHaveLength(1);
      expect(sql).toContain('ALTER ROLE first_user_provisioner PASSWORD');
      expect(sql).toMatch(/BEGIN;[\s\S]*COMMIT;/);
      expect(sql).toContain('role attributes or memberships changed');
      expect(sql).not.toMatch(
        /CREATE ROLE|\bGRANT\b|\bDROP\b|ALTER ROLE (?!first_user_provisioner)/i,
      );
      expect(sql).not.toContain(PASSWORD);
    }
    expect(buildSql('clear')).toContain('ALTER ROLE first_user_provisioner PASSWORD NULL;');
    expect(buildSql('assign', verifier)).toContain(`PASSWORD '${verifier}';`);
  });

  it('refuses a malformed verifier', () => {
    expect(() => buildSql('assign', "x'; DROP ROLE app_runtime; --")).toThrow(CredentialInputError);
    expect(() => buildSql('assign')).toThrow(CredentialInputError);
  });
});

describe('run', () => {
  const ok = { status: 0, stdout: 'OK: done', stderr: '', error: undefined };

  it('assigns through psql stdin, keeps secrets out of argv and env, and prints no secret', async () => {
    const spawn = vi.fn().mockReturnValue({
      ...ok,
      stderr: `oops ${ADMIN_PASSWORD} ${PASSWORD}`,
    });
    const out: string[] = [];
    const err: string[] = [];
    const status = await run(
      'assign',
      prompter([uri(), PASSWORD, PASSWORD, 'ASSIGN first_user_provisioner']),
      spawn,
      (line) => out.push(line),
      (line) => err.push(line),
    );
    expect(status).toBe(0);
    const [command, args, options] = spawn.mock.calls[0]!;
    expect(command).toBe('psql');
    expect(JSON.stringify(args)).not.toMatch(new RegExp(`${PASSWORD}|${ADMIN_PASSWORD}`));
    expect(options.input).toContain('ALTER ROLE first_user_provisioner PASSWORD');
    expect(options.input).not.toContain(PASSWORD);
    expect(
      Object.keys(options.env)
        .filter((k) => k.startsWith('PG'))
        .sort(),
    ).toEqual([
      'PGAPPNAME',
      'PGDATABASE',
      'PGHOST',
      'PGOPTIONS',
      'PGPASSWORD',
      'PGPORT',
      'PGSSLMODE',
      'PGUSER',
    ]);
    expect(options.env).not.toHaveProperty('DATABASE_URL');
    expect([...out, ...err].join('\n')).not.toMatch(new RegExp(`${PASSWORD}|${ADMIN_PASSWORD}`));
  });

  it('clears without asking for a temporary password', async () => {
    const spawn = vi.fn().mockReturnValue(ok);
    const status = await run(
      'clear',
      prompter([uri(), 'CLEAR first_user_provisioner']),
      spawn,
      () => {},
      () => {},
    );
    expect(status).toBe(0);
    expect(spawn.mock.calls[0]![2].input).toContain('PASSWORD NULL;');
  });

  it.each([
    ['mismatched passwords', [uri(), PASSWORD, `${PASSWORD}x`, 'ASSIGN first_user_provisioner']],
    ['a wrong confirmation', [uri(), PASSWORD, PASSWORD, 'yes']],
  ])('sends nothing on %s', async (_name, answers) => {
    const spawn = vi.fn();
    await expect(
      run(
        'assign',
        prompter(answers),
        spawn,
        () => {},
        () => {},
      ),
    ).rejects.toThrow(CredentialInputError);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('passes a failing psql status through', async () => {
    const spawn = vi.fn().mockReturnValue({ ...ok, status: 3 });
    const status = await run(
      'clear',
      prompter([uri(), 'CLEAR first_user_provisioner']),
      spawn,
      () => {},
      () => {},
    );
    expect(status).toBe(3);
  });
});
