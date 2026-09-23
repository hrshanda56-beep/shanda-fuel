import { describe, expect, it, vi } from 'vitest';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getServerEnv } from '../config/env';
import { createPrivateObjectKey, createR2Storage, StorageError } from './index';

function testEnv() {
  return getServerEnv({
    APP_ENV: 'test',
    R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
    R2_BUCKET: 'private-test-bucket',
    R2_ACCESS_KEY_ID: 'access-secret-test',
    R2_SECRET_ACCESS_KEY: 'secret-secret-test',
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
    const storage = createR2Storage(testEnv(), { client: { send: vi.fn() }, signUrl });
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
      expect(() => createR2Storage({ ...env, R2_ACCOUNT_ID: accountId } as typeof env)).toThrow(
        'Private storage is not configured',
      );
    }
    for (const bucket of ['bad_bucket', 'BadBucket', '-bad-bucket', 'bad-bucket-', 'ab']) {
      expect(() => createR2Storage({ ...env, R2_BUCKET: bucket } as typeof env)).toThrow(
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
    const storage = createR2Storage(testEnv(), { client: { send } });
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
    const storage = createR2Storage(testEnv(), { client: { send } });
    await expect(
      storage.put({
        key: createPrivateObjectKey('evidence', 'record-123'),
        body: new Uint8Array([1]),
        contentType,
      }),
    ).rejects.toMatchObject({ code: 'invalid_content_type' });
    expect(send).not.toHaveBeenCalled();
  });

  it('bounds signed URL expiry and uses the configured bucket', async () => {
    const signUrl = vi.fn(async (_client, command, options) => {
      expect(command.input).toEqual({
        Bucket: 'private-test-bucket',
        Key: 'private/evidence/record-123',
      });
      return `https://private.invalid/?expires=${options.expiresIn}`;
    });
    const storage = createR2Storage(testEnv(), { client: { send: vi.fn() }, signUrl });
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
    const storage = createR2Storage(testEnv(), { client: { send } });
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
