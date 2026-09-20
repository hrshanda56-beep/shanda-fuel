import { AppError } from '../errors';
import { z } from 'zod';

const tenantTransactionContextSchema = z
  .object({
    tenantId: z.string().uuid(),
    actorId: z.string().uuid(),
    membershipId: z.string().uuid().optional(),
    legalEntityId: z.string().uuid().optional(),
    stationId: z.string().uuid().optional(),
    requestId: z.string().uuid().optional(),
  })
  .superRefine((context, refinement) => {
    if (context.stationId && !context.legalEntityId) {
      refinement.addIssue({
        code: 'custom',
        path: ['legalEntityId'],
        message: 'Station context requires a legal-entity context',
      });
    }
  });

export type TenantTransactionContext = z.infer<typeof tenantTransactionContextSchema>;

/**
 * Parse a context at the application boundary. Database context is security
 * sensitive: malformed identifiers are forbidden rather than coerced.
 */
export function parseTenantTransactionContext(input: unknown): TenantTransactionContext {
  const result = tenantTransactionContextSchema.safeParse(input);
  if (!result.success) {
    throw new AppError(
      'FORBIDDEN',
      'A valid tenant and actor context are required for database work',
    );
  }
  return result.data;
}

export function assertTenantTransactionContext(
  input: unknown,
): asserts input is TenantTransactionContext {
  parseTenantTransactionContext(input);
}
