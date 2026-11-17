import { z } from 'zod';
import type { SetupProduct } from './contracts';
import { BLEND_PERCENTS, PRODUCT_KINDS } from '../../platform/domain/product-order';

/**
 * The "Add a fuel type" command payload. `kind` is optional only so older clients that send just a
 * code and name keep working (they create a row with no kind, which sorts by name). When a kind is
 * sent it is validated exactly like the screen does: a Blend needs 5, 10, 15 or 20 percent, nothing
 * else carries a percentage, and the name is always required (so Others needs a typed name).
 */
const blendPercentField = z
  .number()
  .int()
  .refine((value) => (BLEND_PERCENTS as readonly number[]).includes(value), {
    message: 'A blend is 5%, 10%, 15% or 20%',
  })
  .nullish();

/** A blend needs 5, 10, 15 or 20 percent; every other kind has none. */
function checkBlend(
  value: { kind?: string | null; blendPercent?: number | null },
  ctx: z.RefinementCtx,
) {
  const isBlend = value.kind === 'BLEND';
  const hasPercent = value.blendPercent !== null && value.blendPercent !== undefined;
  if (isBlend && !hasPercent) {
    ctx.addIssue({
      code: 'custom',
      path: ['blendPercent'],
      message: 'Choose a blend of 5%, 10%, 15% or 20%',
    });
  }
  if (!isBlend && hasPercent) {
    ctx.addIssue({
      code: 'custom',
      path: ['blendPercent'],
      message: 'Only a blend has a percentage',
    });
  }
}

export const createProductPayload = z
  .object({
    tenantId: z.string().uuid(),
    stationId: z.string().uuid(),
    code: z.string().trim().min(1).max(32),
    name: z.string().trim().min(1).max(120),
    unit: z.enum(['LITRES', 'KILOGRAMS']).default('LITRES'),
    kind: z.enum(PRODUCT_KINDS).nullish(),
    blendPercent: blendPercentField,
  })
  .superRefine(checkBlend);
export type CreateProductPayload = z.infer<typeof createProductPayload>;

/** Sets the kind of an existing fuel. Never renames it and never changes its code. */
export const setProductKindPayload = z
  .object({
    tenantId: z.string().uuid(),
    stationId: z.string().uuid(),
    productId: z.string().uuid(),
    kind: z.enum(PRODUCT_KINDS),
    blendPercent: blendPercentField,
  })
  .superRefine(checkBlend);
export type SetProductKindPayload = z.infer<typeof setProductKindPayload>;

/** A products row as the setup overview returns it, with the fuel type and blend percentage. */
export function toSetupProduct(row: {
  id: string;
  code: string;
  name: string;
  status: string;
  kind: string | null;
  blend_percent: number | null;
  display_order: number | null;
  unit: string;
}): SetupProduct {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    unit: row.unit === 'KILOGRAMS' ? 'KILOGRAMS' : 'LITRES',
    kind: row.kind,
    blendPercent: row.blend_percent,
    displayOrder: row.display_order,
  };
}
