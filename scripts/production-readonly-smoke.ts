import 'dotenv/config';

import {
  createFailureEvidence,
  parseReadOnlySmokeCli,
  runReadOnlyVerification,
  safeCliError,
} from '../src/platform/smoke/read-only';

async function main(): Promise<void> {
  let environment: 'staging' | 'production' | undefined;
  let deploymentId: string | undefined;
  let commit: string | undefined;

  try {
    const options = parseReadOnlySmokeCli(process.argv.slice(2));
    environment = options.environment;
    deploymentId = options.deploymentId;
    commit = options.commit;
    const evidence = await runReadOnlyVerification(options, {
      vercelAutomationBypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
    });
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
    process.exitCode = evidence.pass ? 0 : 1;
  } catch (error) {
    const message = safeCliError(error);
    process.stderr.write(`${message}\n`);
    process.stdout.write(
      `${JSON.stringify(createFailureEvidence(environment, deploymentId, commit))}\n`,
    );
    process.exitCode = 1;
  }
}

void main();
