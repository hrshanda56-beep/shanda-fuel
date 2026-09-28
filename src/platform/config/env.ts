import 'server-only';
import { z } from 'zod';

const r2AccountIdPattern = /^[a-f0-9]{32}$/i;
const r2BucketNamePattern = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;

export function isValidR2AccountId(value: string): boolean {
  return r2AccountIdPattern.test(value);
}

export function isValidR2BucketName(value: string): boolean {
  return r2BucketNamePattern.test(value);
}

const envSchema = z
  .object({
    APP_ENV: z.enum(['local', 'test', 'staging', 'production']).default('local'),
    APP_URL: z.string().url().default('http://localhost:3000'),
    DATABASE_URL: z.string().min(1).optional(),
    DATABASE_DIRECT_URL: z.string().min(1).optional(),
    BETTER_AUTH_SECRET: z.string().min(32).optional(),
    R2_ACCOUNT_ID: z
      .string()
      .regex(r2AccountIdPattern, { error: 'R2 account ID must be 32 hexadecimal characters' })
      .optional(),
    R2_BUCKET: z
      .string()
      .regex(r2BucketNamePattern, { error: 'R2 bucket name is invalid' })
      .optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    R2_RECOVERY_BUCKET: z
      .string()
      .regex(r2BucketNamePattern, { error: 'R2 recovery bucket name is invalid' })
      .optional(),
    R2_RECOVERY_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_RECOVERY_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
    RESEND_FROM_EMAIL: z.string().email().optional(),
    CRON_SECRET: z.string().min(32).optional(),
    AUDIT_SIGNING_KEY_ID: z.string().min(1).optional(),
    AUDIT_SIGNING_KEY: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    const r2Values = [
      value.R2_ACCOUNT_ID,
      value.R2_BUCKET,
      value.R2_ACCESS_KEY_ID,
      value.R2_SECRET_ACCESS_KEY,
    ];
    if (r2Values.some(Boolean) && r2Values.some((item) => !item)) {
      context.addIssue({
        code: 'custom',
        path: ['R2_BUCKET'],
        message: 'R2 storage configuration must be complete',
      });
    }
    const recoveryValues = [
      value.R2_RECOVERY_BUCKET,
      value.R2_RECOVERY_ACCESS_KEY_ID,
      value.R2_RECOVERY_SECRET_ACCESS_KEY,
    ];
    if (recoveryValues.some(Boolean) && recoveryValues.some((item) => !item)) {
      context.addIssue({
        code: 'custom',
        path: ['R2_RECOVERY_BUCKET'],
        message: 'R2 recovery storage configuration must be complete',
      });
    }
    if (
      value.R2_BUCKET &&
      value.R2_RECOVERY_BUCKET &&
      value.R2_BUCKET === value.R2_RECOVERY_BUCKET
    ) {
      context.addIssue({
        code: 'custom',
        path: ['R2_RECOVERY_BUCKET'],
        message: 'R2 recovery bucket must differ from the private storage bucket',
      });
    }
    if (
      value.APP_ENV === 'production' &&
      r2Values.every(Boolean) &&
      !recoveryValues.every(Boolean)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['R2_RECOVERY_BUCKET'],
        message: 'R2 recovery storage is required when private storage is configured in production',
      });
    }
    if (value.RESEND_API_KEY && !value.RESEND_FROM_EMAIL) {
      context.addIssue({
        code: 'custom',
        path: ['RESEND_FROM_EMAIL'],
        message: 'Required when Resend is configured',
      });
    }
    if (value.APP_ENV === 'production' && !value.DATABASE_URL) {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'Required in production',
      });
    }
    if (value.APP_ENV === 'production' && new URL(value.APP_URL).protocol !== 'https:') {
      context.addIssue({
        code: 'custom',
        path: ['APP_URL'],
        message: 'HTTPS is required in production',
      });
    }
    if (value.APP_ENV === 'production' && !value.BETTER_AUTH_SECRET) {
      context.addIssue({
        code: 'custom',
        path: ['BETTER_AUTH_SECRET'],
        message: 'Required in production',
      });
    }
  });

export type ServerEnv = z.infer<typeof envSchema>;

export function getServerEnv(input: Record<string, string | undefined> = process.env): ServerEnv {
  return envSchema.parse(input);
}

export function assertDatabaseConfigured(
  input: Record<string, string | undefined> = process.env,
): string {
  const env = getServerEnv(input);
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for database access');
  }
  return env.DATABASE_URL;
}
