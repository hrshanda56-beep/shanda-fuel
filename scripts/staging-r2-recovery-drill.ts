import 'dotenv/config';
import { getServerEnv } from '../src/platform/config/env';
import { assertStagingSmokeAllowed } from '../src/platform/config/staging-smoke';
import { runStagingR2RecoveryDrill } from '../src/platform/recovery/r2-drill';

const confirmationFlag = '--confirm-recovery-drill';

export async function main() {
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

  try {
    const evidence = await runStagingR2RecoveryDrill({ env: getServerEnv() });
    console.log(
      `R2 staging recovery drill: retained copy, delete, restore, and checksum verification passed (backup ${evidence.backupId}; sha256 ${evidence.sha256}).`,
    );
    console.log(
      'Primary synthetic object deleted. Retained recovery objects remain until approved retention expires.',
    );
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'provider';
    console.error(`R2 staging recovery drill failed (${code}).`);
    process.exitCode = 1;
  }
}

void main();
