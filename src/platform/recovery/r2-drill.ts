import { randomUUID } from 'node:crypto';
import type { ServerEnv } from '../config/env';
import {
  createR2Storage,
  createUniquePrivateObjectKey,
  StorageError,
  type RecoverablePrivateStorage,
} from '../storage';

export type R2RecoveryDrillEvidence = {
  status: 'passed';
  backupId: string;
  sha256: string;
  byteLength: number;
  createdAt: string;
  primaryCleanup: 'passed';
};

export async function runStagingR2RecoveryDrill(input: {
  env: ServerEnv;
  storage?: RecoverablePrivateStorage;
  createKey?: () => ReturnType<typeof createUniquePrivateObjectKey>;
  createBody?: () => Uint8Array;
}): Promise<R2RecoveryDrillEvidence> {
  const storage = input.storage ?? createR2Storage(input.env);
  const key = (input.createKey ?? (() => createUniquePrivateObjectKey('staging/recovery-drill')))();
  const body = (
    input.createBody ?? (() => new TextEncoder().encode(`staging recovery drill ${randomUUID()}`))
  )();
  const contentType = 'text/plain; charset=utf-8';
  const artifact = await storage.put({ key, body, contentType });
  const written = await storage.get(key);
  if (written.body.byteLength !== body.byteLength || !bytesEqual(written.body, body)) {
    throw new StorageError('checksum_mismatch', 'Primary object write verification failed');
  }

  await storage.delete(key);
  try {
    await storage.get(key);
    throw new Error('Primary delete verification failed');
  } catch (error) {
    if (!(error instanceof StorageError) || error.code !== 'not_found') throw error;
  }

  await storage.restore({ key, backupId: artifact.backupId });
  const restored = await storage.get(key);
  if (restored.body.byteLength !== body.byteLength || !bytesEqual(restored.body, body)) {
    throw new StorageError('checksum_mismatch', 'Primary object restore verification failed');
  }

  await storage.delete(key);
  return {
    status: 'passed',
    backupId: artifact.backupId,
    sha256: artifact.sha256,
    byteLength: body.byteLength,
    createdAt: artifact.createdAt,
    primaryCleanup: 'passed',
  };
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}
