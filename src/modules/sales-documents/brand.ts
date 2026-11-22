import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { resolveTenantReadAuthority } from '../context/read-authority';
import { withTenantTransaction } from '../../platform/db/transaction';
import type { AuthenticatedActorContext } from '../identity';

export const brandQuerySchema = z.object({ tenantId: z.string().uuid() });

/** A company's own look, shown on the loading screen: a transparent logo and a colour. */
export type CompanyBrand = {
  /** A `data:image/png;base64,…` address, or null when the company has no logo. */
  logo: string | null;
  /** `#rrggbb`, or null for the app's colours. */
  colour: string | null;
};

const PNG_BASE64 = /^iVBORw0KGgo[A-Za-z0-9+/]+=*$/;
const HEX_COLOUR = /^#[0-9A-Fa-f]{6}$/;

/** Turns stored values into what the screen may use, dropping anything that is not well formed. */
export function toCompanyBrand(
  row: { app_logo_png_base64: string | null; brand_colour: string | null } | undefined,
): CompanyBrand {
  const png = row?.app_logo_png_base64 ?? null;
  const colour = row?.brand_colour ?? null;
  return {
    logo:
      png && png.length <= 300000 && PNG_BASE64.test(png) ? `data:image/png;base64,${png}` : null,
    colour: colour && HEX_COLOUR.test(colour) ? colour : null,
  };
}

/**
 * The company's logo and colour for the loading screen. Any signed-in member of the company may
 * read it (the company's own look is not secret from its own people), so it needs no document
 * permission; the company is still checked and row-level security still applies.
 */
export async function readCompanyBrandFromRequest(
  request: Request,
  rawInput: unknown,
  actor?: AuthenticatedActorContext,
): Promise<CompanyBrand> {
  const input = brandQuerySchema.parse(rawInput);
  const { authority } = await resolveTenantReadAuthority({
    request,
    tenantId: input.tenantId,
    authenticatedActor: actor,
  });
  return withTenantTransaction(authority.transaction, async (transaction) => {
    const rows = await transaction.execute<{
      app_logo_png_base64: string | null;
      brand_colour: string | null;
    }>(sql`
      select app_logo_png_base64, brand_colour
      from app.sales_doc_profiles
      where tenant_id = ${input.tenantId}
      order by (app_logo_png_base64 is null), updated_at desc
      limit 1
    `);
    return toCompanyBrand(rows[0]);
  });
}
