import { AppError } from '../errors';
import { z } from 'zod';

declare const tenantTransactionContextBrand: unique symbol;

const tenantTransactionContextSchema = z
  .object({
    tenantId: z.string().uuid(),
    actorId: z.string().uuid(),
    membershipId: z.string().uuid(),
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

export type TenantTransactionInput = z.infer<typeof tenantTransactionContextSchema> & {
  membershipId: string;
};

export type TenantTransactionContext = TenantTransactionInput & {
  readonly [tenantTransactionContextBrand]: 'trusted';
};

const trustedContexts = new WeakSet<object>();

/**
 * Parse a context at the application boundary. Database context is security
 * sensitive: malformed identifiers are forbidden rather than coerced.
 */
export function parseTenantTransactionContext(input: unknown): TenantTransactionInput {
  const result = tenantTransactionContextSchema.safeParse(input);
  if (!result.success || !result.data.membershipId) {
    throw new AppError(
      'FORBIDDEN',
      'A valid tenant, actor, and membership context are required for database work',
    );
  }
  return result.data as TenantTransactionInput;
}

export function createTrustedTenantTransactionContext(input: unknown): TenantTransactionContext {
  const parsed = parseTenantTransactionContext(input);
  const trusted = Object.freeze(parsed) as TenantTransactionContext;
  trustedContexts.add(trusted);
  return trusted;
}

export function assertTrustedTenantTransactionContext(
  input: TenantTransactionContext,
): asserts input is TenantTransactionContext {
  if (!input || typeof input !== 'object' || !trustedContexts.has(input)) {
    throw new AppError('FORBIDDEN', 'A server-resolved tenant authority context is required');
  }
}
