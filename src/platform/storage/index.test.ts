import { describe, expect, it, vi } from 'vitest';
import { getServerEnv } from '../config/env';
import { createPrivateObjectKey, createR2Storage, StorageError } from './index';

function testEnv() {
  return getServerEnv({
    APP_ENV: 'test',
    R2_ACCOUNT_ID: 'account-safe-test',
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
    const send = vi.fn(async (command: { input: Record<string, unknown> }) => {
      if (
        'Key' in command.input &&
        command.input.Key === 'private/evidence/record-123' &&
        'Bucket' in command.input
      ) {
        if ('ContentType' in command.input) return {};
        if (Object.keys(command.input).length === 2) {
          return {
            Body: { transformToByteArray: async () => content },
            ContentType: 'application/pdf',
            ContentLength: 3,
          };
        }
      }
      return {};
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
    for (const [command] of send.mock.calls) {
      expect(command.input.Bucket).toBe('private-test-bucket');
    }
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
