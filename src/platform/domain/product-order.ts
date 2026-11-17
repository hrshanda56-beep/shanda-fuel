import { z } from 'zod';

/**
 * Fuel types a station can sell, and the one ordering rule every screen, report and dropdown uses
 * (client request: Diesel first, Petrol/Blend second, Gas third).
 *
 * Rule: explicit `display_order` first (nulls last), then the default rank of the kind, then name.
 * Rows created before kinds existed have a null kind and sort by name after the known kinds; the
 * migration deliberately does not guess a kind from a name.
 */
export const PRODUCT_KINDS = ['DIESEL', 'D50', 'PETROL', 'BLEND', 'GAS', 'OTHER'] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];
export const BLEND_PERCENTS = [5, 10, 15, 20] as const;
export type BlendPercent = (typeof BLEND_PERCENTS)[number];

export const PRODUCT_KIND_LABELS: Readonly<Record<ProductKind, string>> = {
  DIESEL: 'Diesel',
  D50: 'D50',
  PETROL: 'Petrol',
  BLEND: 'Blend',
  GAS: 'Gas',
  OTHER: 'Others',
};

/** Default rank when no explicit display order is set. Unknown or missing kinds rank last. */
const KIND_RANK: Readonly<Record<ProductKind, number>> = {
  DIESEL: 1,
  D50: 1,
  PETROL: 2,
  BLEND: 2,
  GAS: 3,
  OTHER: 4,
};
const UNKNOWN_RANK = 4;

export function defaultKindRank(kind: string | null | undefined): number {
  return kind && Object.hasOwn(KIND_RANK, kind) ? KIND_RANK[kind as ProductKind] : UNKNOWN_RANK;
}

export type ProductOrderable = Readonly<{
  name: string;
  kind?: string | null;
  displayOrder?: number | null;
}>;

/** Pure comparator for client-side lists; mirrors `productOrderSql` exactly. */
export function compareProducts(a: ProductOrderable, b: ProductOrderable): number {
  const aOrder = a.displayOrder ?? Number.POSITIVE_INFINITY;
  const bOrder = b.displayOrder ?? Number.POSITIVE_INFINITY;
  if (aOrder !== bOrder) return aOrder < bOrder ? -1 : 1;
  const rank = defaultKindRank(a.kind) - defaultKindRank(b.kind);
  if (rank !== 0) return rank;
  return a.name.localeCompare(b.name);
}

/** A name to pre-fill when the person picks a kind; Others has none because they must type it. */
export function suggestedFuelName(kind: ProductKind, blendPercent?: number | null): string {
  if (kind === 'OTHER') return '';
  if (kind === 'BLEND') return blendPercent ? `Blend E${blendPercent}` : 'Blend';
  return PRODUCT_KIND_LABELS[kind];
}

export const productKindInputSchema = z
  .object({
    kind: z.enum(PRODUCT_KINDS),
    blendPercent: z.number().int().nullish(),
    name: z.string().trim().min(1, 'Enter the name of the fuel').max(120),
  })
  .superRefine((value, ctx) => {
    const isBlend = value.kind === 'BLEND';
    const percent = value.blendPercent ?? null;
    if (isBlend && (percent === null || !(BLEND_PERCENTS as readonly number[]).includes(percent))) {
      ctx.addIssue({
        code: 'custom',
        path: ['blendPercent'],
        message: 'Choose a blend of 5%, 10%, 15% or 20%',
      });
    }
    if (!isBlend && percent !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['blendPercent'],
        message: 'Only a blend has a percentage',
      });
    }
  });

export type ProductKindInput = Readonly<{
  kind: ProductKind;
  blendPercent: BlendPercent | null;
  name: string;
}>;

/** The shared server/UI validation of the "Add a fuel type" choice. Throws a ZodError. */
export function parseProductKindInput(input: unknown): ProductKindInput {
  const parsed = productKindInputSchema.parse(input);
  return {
    kind: parsed.kind,
    blendPercent: (parsed.blendPercent ?? null) as BlendPercent | null,
    name: parsed.name,
  };
}
