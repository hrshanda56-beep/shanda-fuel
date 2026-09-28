import { describe, expect, it, vi } from 'vitest';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getServerEnv } from '../config/env';
import {
  createPrivateObjectKey,
  createR2Storage,
  createR2SmokeStorage,
  StorageError,
  type PrivateObjectKey,
} from './index';

function testEnv() {
  return getServerEnv({
    APP_ENV: 'test',
    R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
    R2_BUCKET: 'private-test-bucket',
    R2_ACCESS_KEY_ID: 'access-secret-test',
    R2_SECRET_ACCESS_KEY: 'secret-secret-test',
    R2_RECOVERY_BUCKET: 'recovery-test-bucket',
    R2_RECOVERY_ACCESS_KEY_ID: 'recovery-access-secret-test',
    R2_RECOVERY_SECRET_ACCESS_KEY: 'recovery-secret-secret-test',
  });
}

describe('private R2 storage adapter', () => {
  it('fails safely when storage configuration is missing', () => {
    const env = getServerEnv({ APP_ENV: 'test' });
    expect(() => createR2Storage(env)).toThrowError(StorageError);
    expect(() => createR2Storage(env)).toThrow('Private storage is not configured');
  });

  it('accepts a valid staging account and forms only the documented R2 endpoint', async () => {
    const signUrl = vi.fn(async (client) => {
      const endpoint = await client.config.endpoint();
      expect(endpoint.hostname).toBe('0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com');
      return 'https://signed.example.invalid';
    });
    const storage = createR2SmokeStorage(testEnv(), { client: { send: vi.fn() }, signUrl });
    await expect(
      storage.createReadUrl(createPrivateObjectKey('evidence', 'record-123')),
    ).resolves.toBe('https://signed.example.invalid');
  });

  it('rejects unvalidated endpoint and bucket values even if environment typing is bypassed', () => {
    const env = testEnv();
    for (const accountId of [
      'attacker.example#',
      'attacker.example/path',
      'attacker.example?query',
      'attacker@example',
      'attacker:443',
      'short',
      '',
    ]) {
      expect(() =>
        createR2SmokeStorage({ ...env, R2_ACCOUNT_ID: accountId } as typeof env),
      ).toThrow('Private storage is not configured');
    }
    for (const bucket of ['bad_bucket', 'BadBucket', '-bad-bucket', 'bad-bucket-', 'ab']) {
      expect(() => createR2SmokeStorage({ ...env, R2_BUCKET: bucket } as typeof env)).toThrow(
        'Private storage is not configured',
      );
    }
  });

  it('constructs deterministic safe keys and rejects traversal', () => {
    expect(createPrivateObjectKey('evidence', 'record_123')).toBe('private/evidence/record_123');
    expect(() => createPrivateObjectKey('../private', 'secret')).toThrowError(StorageError);
    expect(() => createPrivateObjectKey('evidence/../private', 'secret')).toThrowError(
      StorageError,
    );
    expect(() => createPrivateObjectKey('evidence', '../secret')).toThrowError(StorageError);
  });

  it('preserves invalid_key errors for put, signed reads, and delete without SDK calls', async () => {
    const send = vi.fn();
    const signUrl = vi.fn();
    const storage = createR2SmokeStorage(testEnv(), { client: { send }, signUrl });
    const invalidKey = 'private/../evidence/record-123' as PrivateObjectKey;

    await expect(
      storage.put({ key: invalidKey, body: new Uint8Array([1]), contentType: 'application/pdf' }),
    ).rejects.toMatchObject({ code: 'invalid_key' });
    await expect(storage.createReadUrl(invalidKey)).rejects.toMatchObject({ code: 'invalid_key' });
    await expect(storage.delete(invalidKey)).rejects.toMatchObject({ code: 'invalid_key' });

    expect(send).not.toHaveBeenCalled();
    expect(signUrl).not.toHaveBeenCalled();
  });

  it('uses only the configured private bucket for put, get, and delete', async () => {
    const content = new Uint8Array([1, 2, 3]);
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof PutObjectCommand) return {};
      if (command instanceof GetObjectCommand) {
        return {
          Body: { transformToByteArray: async () => content },
          ContentType: 'application/pdf',
          ContentLength: 3,
        };
      }
      if (command instanceof DeleteObjectCommand) return {};
      throw new Error('Unexpected S3 command');
    });
    const storage = createR2SmokeStorage(testEnv(), { client: { send } });
    const key = createPrivateObjectKey('evidence', 'record-123');
    await storage.put({ key, body: content, contentType: 'application/pdf' });
    expect(await storage.get(key)).toEqual({
      body: content,
      contentType: 'application/pdf',
      contentLength: 3,
    });
    await storage.delete(key);
    expect(send).toHaveBeenCalledTimes(3);
    const [putCommand, getCommand, deleteCommand] = send.mock.calls.map(
      ([command]) => command as PutObjectCommand | GetObjectCommand | DeleteObjectCommand,
    );
    if (!putCommand || !getCommand || !deleteCommand)
      throw new Error('Expected all three S3 calls');
    expect(putCommand).toBeInstanceOf(PutObjectCommand);
    expect(getCommand).toBeInstanceOf(GetObjectCommand);
    expect(deleteCommand).toBeInstanceOf(DeleteObjectCommand);
    expect(putCommand).not.toBeInstanceOf(DeleteObjectCommand);
    expect(getCommand).not.toBeInstanceOf(DeleteObjectCommand);
    expect(deleteCommand).not.toBeInstanceOf(GetObjectCommand);
    for (const command of [putCommand, getCommand, deleteCommand]) {
      expect(command.input).toMatchObject({
        Bucket: 'private-test-bucket',
        Key: 'private/evidence/record-123',
      });
    }
  });

  it.each([
    'text/plain\r\nX-Injected: yes',
    'text/plain\u0000',
    '',
    'not-a-mime-type',
    'text/plain; charset=',
    `text/${'a'.repeat(260)}`,
  ])('rejects unsafe content type %j before calling R2', async (contentType) => {
    const send = vi.fn();
    const storage = createR2SmokeStorage(testEnv(), { client: { send } });
    await expect(
      storage.put({
        key: createPrivateObjectKey('evidence', 'record-123'),
        body: new Uint8Array([1]),
        contentType,
      }),
    ).rejects.toMatchObject({ code: 'invalid_content_type' });
    expect(send).not.toHaveBeenCalled();
  });

  it.each(['application/pdf', 'text/plain; charset=utf-8'])(
    'returns validated provider content type %s',
    async (contentType) => {
      const body = new Uint8Array([1, 2]);
      const send = vi.fn().mockResolvedValue({
        Body: { transformToByteArray: async () => body },
        ContentType: contentType,
        ContentLength: body.length,
      });
      const storage = createR2SmokeStorage(testEnv(), { client: { send } });

      await expect(storage.get(createPrivateObjectKey('evidence', 'record-123'))).resolves.toEqual({
        body,
        contentType,
        contentLength: 2,
      });
    },
  );

  it.each([
    'text/plain\r\nX-Injected: yes',
    'text/plain\u0000',
    'not-a-mime-type',
    `text/${'a'.repeat(260)}`,
  ])('rejects unsafe provider content type without exposing it: %j', async (contentType) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const send = vi.fn().mockResolvedValue({
      Body: { transformToByteArray: async () => new Uint8Array([1]) },
      ContentType: contentType,
    });
    const storage = createR2SmokeStorage(testEnv(), { client: { send } });

    let caught: unknown;
    try {
      await storage.get(createPrivateObjectKey('evidence', 'record-123'));
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      name: 'StorageError',
      code: 'invalid_content_type',
      message: 'The object content type is invalid',
    });
    expect(JSON.stringify(caught)).not.toContain(contentType);
    expect(JSON.stringify(log.mock.calls)).not.toContain(contentType);
    expect(log).not.toHaveBeenCalled();
  });

  it('keeps missing provider content type behavior sanitized', async () => {
    const send = vi.fn().mockResolvedValue({
      Body: { transformToByteArray: async () => new Uint8Array([1]) },
    });
    const storage = createR2SmokeStorage(testEnv(), { client: { send } });

    await expect(
      storage.get(createPrivateObjectKey('evidence', 'record-123')),
    ).rejects.toMatchObject({
      code: 'provider',
      message: 'Private storage returned an invalid object',
    });
  });

  it('bounds signed URL expiry and uses the configured bucket', async () => {
    const signUrl = vi.fn(async (_client, command, options) => {
      expect(command.input).toEqual({
        Bucket: 'private-test-bucket',
        Key: 'private/evidence/record-123',
      });
      return `https://private.invalid/?expires=${options.expiresIn}`;
    });
    const storage = createR2SmokeStorage(testEnv(), { client: { send: vi.fn() }, signUrl });
    const key = createPrivateObjectKey('evidence', 'record-123');
    expect(await storage.createReadUrl(key)).toContain('expires=300');
    expect(signUrl.mock.calls[0]?.[2].expiresIn).toBe(300);
    await expect(storage.createReadUrl(key, 901)).rejects.toThrow('between 1 and 900');
    await expect(storage.createReadUrl(key, 0)).rejects.toThrow(StorageError);
  });

  it('maps provider errors to sanitized typed errors', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const send = vi
      .fn()
      .mockRejectedValue(new Error('secret-secret-test https://signed-secret.invalid'));
    const storage = createR2SmokeStorage(testEnv(), { client: { send } });
    await expect(
      storage.delete(createPrivateObjectKey('evidence', 'record-123')),
    ).rejects.toMatchObject({
      name: 'StorageError',
      code: 'provider',
      message: 'Private storage operation failed',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-secret-test');
    expect(JSON.stringify(log.mock.calls)).not.toContain('signed-secret.invalid');
  });
});

type MemoryObject = { body: Uint8Array; contentType: string };

class MemoryR2Client {
  readonly objects = new Map<string, MemoryObject>();
  readonly commands: unknown[] = [];
  failPut: ((command: PutObjectCommand) => Error | undefined) | undefined;
  corruptConditionalPrimaryPut = false;

  async send(command: unknown): Promise<unknown> {
    this.commands.push(command);
    if (command instanceof PutObjectCommand) {
      const failure = this.failPut?.(command);
      if (failure) throw failure;
      const key = command.input.Key!;
      if (command.input.IfNoneMatch === '*' && this.objects.has(key)) {
        throw Object.assign(new Error('already exists'), { name: 'PreconditionFailed' });
      }
      const body = new Uint8Array(command.input.Body as Uint8Array);
      this.objects.set(key, {
        body:
          command.input.IfNoneMatch === '*' && this.corruptConditionalPrimaryPut
            ? new Uint8Array([0])
            : body,
        contentType: command.input.ContentType!,
      });
      return {};
    }
    if (command instanceof GetObjectCommand) {
      const object = this.objects.get(command.input.Key!);
      if (!object) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
      return {
        Body: { transformToByteArray: async () => new Uint8Array(object.body) },
        ContentType: object.contentType,
        ContentLength: object.body.byteLength,
      };
    }
    if (command instanceof ListObjectsV2Command) {
      const prefix = command.input.Prefix ?? '';
      return {
        Contents: [...this.objects.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((Key) => ({ Key })),
      };
    }
    if (command instanceof DeleteObjectCommand) {
      this.objects.delete(command.input.Key!);
      return {};
    }
    throw new Error('Unexpected S3 command');
  }
}

function recoveryStorage(primary = new MemoryR2Client(), recovery = new MemoryR2Client()) {
  const storage = createR2Storage(testEnv(), {
    primaryClient: primary,
    recoveryClient: recovery,
    backupId: () => 'backup-001',
    now: () => new Date('2026-09-28T10:00:00.000Z'),
  });
  return { storage, primary, recovery };
}

describe('recoverable private R2 storage', () => {
  it('requires a separate complete recovery configuration', () => {
    const env = testEnv();
    expect(() => createR2Storage({ ...env, R2_RECOVERY_BUCKET: undefined } as typeof env)).toThrow(
      'Private recovery storage is not configured',
    );
    expect(() =>
      getServerEnv({
        ...env,
        R2_RECOVERY_BUCKET: env.R2_BUCKET,
      }),
    ).toThrow('R2 recovery bucket must differ');
  });

  it('retains immutable bytes and manifest before writing the primary object, then restores with read-back verification', async () => {
    const { storage, primary, recovery } = recoveryStorage();
    const key = createPrivateObjectKey('evidence', 'recovery-001');
    const body = new TextEncoder().encode('recover this exact object');

    const artifact = await storage.put({ key, body, contentType: 'text/plain; charset=utf-8' });
    expect(artifact).toEqual({
      backupId: 'backup-001',
      createdAt: '2026-09-28T10:00:00.000Z',
      sha256: '5394c25a427255dd72b2b7c30a830743a089a1b17a69eae272f0c89fb315e495',
      byteLength: body.byteLength,
      contentType: 'text/plain; charset=utf-8',
    });
    expect(recovery.commands.slice(0, 2)).toEqual(
      expect.arrayContaining([expect.any(PutObjectCommand), expect.any(PutObjectCommand)]),
    );
    expect(primary.commands[0]).toBeInstanceOf(PutObjectCommand);
    const manifestCommand = recovery.commands[1] as PutObjectCommand;
    expect(
      JSON.parse(new TextDecoder().decode(manifestCommand.input.Body as Uint8Array)),
    ).toMatchObject({
      sourceBucket: 'private-test-bucket',
      sourceKey: key,
      contentType: 'text/plain; charset=utf-8',
      byteLength: body.byteLength,
      backupId: 'backup-001',
      createdAt: '2026-09-28T10:00:00.000Z',
      formatVersion: 'shanda-fuel.r2-recovery.v1',
      sha256: artifact.sha256,
    });

    await storage.delete(key);
    await expect(storage.get(key)).rejects.toMatchObject({ code: 'not_found' });
    await expect(storage.restore({ key, backupId: artifact.backupId })).resolves.toEqual(artifact);
    await expect(storage.get(key)).resolves.toMatchObject({
      body,
      contentType: 'text/plain; charset=utf-8',
    });
    const restorePut = primary.commands.find(
      (command) => command instanceof PutObjectCommand && command.input.IfNoneMatch === '*',
    ) as PutObjectCommand;
    expect(restorePut.input).toMatchObject({ Bucket: 'private-test-bucket', Key: key });
    expect(recovery.objects.size).toBe(2);
  });

  it('does not write the primary object when a retained recovery write fails', async () => {
    const primary = new MemoryR2Client();
    const recovery = new MemoryR2Client();
    recovery.failPut = () => new Error('recovery unavailable');
    const { storage } = recoveryStorage(primary, recovery);

    await expect(
      storage.put({
        key: createPrivateObjectKey('evidence', 'recovery-002'),
        body: new Uint8Array([1]),
        contentType: 'application/pdf',
      }),
    ).rejects.toMatchObject({ code: 'backup_unavailable' });
    expect(primary.commands).toHaveLength(0);
  });

  it('refuses deletion when no verified retained recovery artifact exists', async () => {
    const { storage, primary } = recoveryStorage();
    const key = createPrivateObjectKey('evidence', 'recovery-003');
    primary.objects.set(key, { body: new Uint8Array([1, 2]), contentType: 'application/pdf' });

    await expect(storage.delete(key)).rejects.toMatchObject({ code: 'missing_recovery_copy' });
    expect(primary.objects.has(key)).toBe(true);
    expect(primary.commands.some((command) => command instanceof DeleteObjectCommand)).toBe(false);
  });

  it('refuses deletion when retained bytes fail their manifest checksum', async () => {
    const { storage, recovery, primary } = recoveryStorage();
    const key = createPrivateObjectKey('evidence', 'recovery-004');
    await storage.put({ key, body: new Uint8Array([1, 2, 3]), contentType: 'application/pdf' });
    const recoveryObjectKey = [...recovery.objects.keys()].find((item) =>
      item.includes('/objects/'),
    )!;
    recovery.objects.set(recoveryObjectKey, {
      body: new Uint8Array([9]),
      contentType: 'application/pdf',
    });

    await expect(storage.delete(key)).rejects.toMatchObject({ code: 'checksum_mismatch' });
    expect(primary.objects.has(key)).toBe(true);
  });

  it('refuses restore when the primary destination already contains an object', async () => {
    const { storage } = recoveryStorage();
    const key = createPrivateObjectKey('evidence', 'recovery-005');
    const artifact = await storage.put({
      key,
      body: new Uint8Array([1, 2, 3]),
      contentType: 'application/pdf',
    });

    await expect(storage.restore({ key, backupId: artifact.backupId })).rejects.toMatchObject({
      code: 'destination_already_present',
    });
  });

  it('reports checksum mismatch when read-back after restore differs from the retained bytes', async () => {
    const primary = new MemoryR2Client();
    const { storage } = recoveryStorage(primary);
    const key = createPrivateObjectKey('evidence', 'recovery-006');
    const artifact = await storage.put({
      key,
      body: new Uint8Array([1, 2, 3]),
      contentType: 'application/pdf',
    });
    await storage.delete(key);
    primary.corruptConditionalPrimaryPut = true;

    await expect(storage.restore({ key, backupId: artifact.backupId })).rejects.toMatchObject({
      code: 'checksum_mismatch',
    });
  });
});
