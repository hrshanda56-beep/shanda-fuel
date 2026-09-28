import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { getServerEnv } from '../src/platform/config/env';
import { assertStagingSmokeAllowed } from '../src/platform/config/staging-smoke';
import {
  createR2Storage,
  createUniquePrivateObjectKey,
  StorageError,
} from '../src/platform/storage';

const confirmationFlag = '--confirm-recovery-drill';

async function main() {
  try {
    assertStagingSmokeAllowed(process.env.APP_ENV);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Staging recovery drill is not allowed.',
    );
    process.exitCode = 1;
    return;
  }

  if (process.argv.slice(2).length !== 1 || process.argv[2] !== confirmationFlag) {
    console.error(`Specify ${confirmationFlag} to run the staging R2 recovery drill.`);
    process.exitCode = 1;
    return;
  }

  const key = createUniquePrivateObjectKey('staging/recovery-drill');
  const body = new TextEncoder().encode(`staging recovery drill ${randomUUID()}`);
  const contentType = 'text/plain; charset=utf-8';
  try {
    const storage = createR2Storage(getServerEnv());
    const artifact = await storage.put({ key, body, contentType });
    const written = await storage.get(key);
    if (new TextDecoder().decode(written.body) !== new TextDecoder().decode(body)) {
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
    if (
      restored.body.byteLength !== body.byteLength ||
      new TextDecoder().decode(restored.body) !== new TextDecoder().decode(body)
    ) {
      throw new StorageError('checksum_mismatch', 'Primary object restore verification failed');
    }

    await storage.delete(key);
    console.log(
      `R2 staging recovery drill: retained copy, delete, restore, and checksum verification passed (backup ${artifact.backupId}; sha256 ${artifact.sha256}).`,
    );
    console.log(
      'Primary synthetic object deleted. Retained recovery objects remain until approved retention expires.',
    );
  } catch (error) {
    const code = error instanceof StorageError ? error.code : 'provider';
    console.error(`R2 staging recovery drill failed (${code}).`);
    process.exitCode = 1;
  }
}

void main();
