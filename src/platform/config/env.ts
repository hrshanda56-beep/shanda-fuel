import 'server-only';
import { z } from 'zod';

const envSchema = z
  .object({
    APP_ENV: z.enum(['local', 'test', 'staging', 'production']).default('local'),
    APP_URL: z.string().url().default('http://localhost:3000'),
    DATABASE_URL: z.string().min(1).optional(),
    DATABASE_DIRECT_URL: z.string().min(1).optional(),
    BETTER_AUTH_SECRET: z.string().min(32).optional(),
    R2_ACCOUNT_ID: z.string().min(1).optional(),
    R2_BUCKET: z.string().min(1).optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
    CRON_SECRET: z.string().min(32).optional(),
    AUDIT_SIGNING_KEY_ID: z.string().min(1).optional(),
    AUDIT_SIGNING_KEY: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    if (value.APP_ENV === 'production' && !value.DATABASE_URL) {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
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
