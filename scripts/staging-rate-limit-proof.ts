import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  parseArguments,
  proofUsage,
  runStagingRateLimitProof,
} from '../src/platform/staging/rate-limit-proof';

export async function main(
  argv = process.argv,
  environment: Record<string, string | undefined> = process.env,
  fetchImplementation: typeof fetch = fetch,
  log: (message: string) => void = console.log,
  errorLog: (message: string) => void = console.error,
): Promise<number> {
  try {
    if (environment.APP_ENV !== 'staging') {
      throw new Error('Staging rate-limit proof requires APP_ENV=staging.');
    }
    const options = parseArguments(argv);
    const sessionCookie = environment.STAGING_RATE_LIMIT_PROOF_SESSION_COOKIE;
    if (!sessionCookie) {
      throw new Error('STAGING_RATE_LIMIT_PROOF_SESSION_COOKIE must already be set.');
    }
    const evidence = await runStagingRateLimitProof({
      ...options,
      sessionCookie,
      vercelAutomationBypassSecret: environment.VERCEL_AUTOMATION_BYPASS_SECRET,
      fetchImplementation,
      log,
    });
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
    return evidence.pass ? 0 : 1;
  } catch (error) {
    errorLog(error instanceof Error ? error.message : 'Staging rate-limit proof failed.');
    errorLog(proofUsage());
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
