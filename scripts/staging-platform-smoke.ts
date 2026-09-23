import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { getServerEnv } from '../src/platform/config/env';
import { assertStagingSmokeAllowed } from '../src/platform/config/staging-smoke';
import { createResendEmailSender } from '../src/platform/email';
import {
  createR2Storage,
  createUniquePrivateObjectKey,
  StorageError,
} from '../src/platform/storage';

async function main() {
  try {
    assertStagingSmokeAllowed(process.env.APP_ENV);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Staging smoke is not allowed.');
    process.exitCode = 1;
    return;
  }

  const args = process.argv.slice(2);
  const r2Enabled = args.includes('--r2');
  const emailEnabled = args.includes('--send-email');
  const recipientIndex = args.indexOf('--recipient');
  const recipient = recipientIndex >= 0 ? args[recipientIndex + 1] : undefined;
  if (!r2Enabled && !emailEnabled) {
    console.error('Specify --r2 and/or --send-email --recipient <address>.');
    process.exitCode = 1;
    return;
  }
  if (emailEnabled && (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))) {
    console.error('Email smoke requires an explicit valid --recipient <address>.');
    process.exitCode = 1;
    return;
  }
  if (!emailEnabled && recipientIndex >= 0) {
    console.error('--recipient is only valid with --send-email.');
    process.exitCode = 1;
    return;
  }

  try {
    const env = getServerEnv();
    if (r2Enabled) {
      const storage = createR2Storage(env);
      const key = createUniquePrivateObjectKey('staging/smoke');
      const content = new TextEncoder().encode(`staging smoke ${randomUUID()}`);
      await storage.put({ key, body: content, contentType: 'text/plain; charset=utf-8' });
      const read = await storage.get(key);
      if (new TextDecoder().decode(read.body) !== new TextDecoder().decode(content)) {
        throw new Error('R2 verification failed');
      }
      await storage.delete(key);
      try {
        await storage.get(key);
        throw new Error('R2 delete verification failed');
      } catch (error) {
        if (!(error instanceof StorageError) || error.code !== 'not_found') throw error;
      }
      console.log('R2 staging smoke: put/read/delete verified.');
    }
    if (emailEnabled) {
      const email = createResendEmailSender(env);
      const receipt = await email.send({
        to: recipient!,
        subject: 'Shanda Fuel staging email smoke test',
        text: 'This is an operator-triggered staging email smoke test.',
      });
      console.log(`Resend staging smoke: sent (message id ${receipt.messageId}).`);
    }
  } catch (error) {
    const code = error instanceof StorageError ? error.code : 'provider';
    console.error(`Staging platform smoke failed (${code}).`);
    process.exitCode = 1;
  }
}

void main();
