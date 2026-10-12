import type { SetupOverview } from './contracts';

/**
 * Plain-language reasons the station cannot yet run dependent transactions.
 * Pure and derived only from entered data, so it never invents a default.
 * The same facts are enforced server-side by the dependent commands (delivery
 * allocations need a tank; reconciliation readings need an ACTIVE price).
 */
export function computeSetupBlockers(
  data: Omit<SetupOverview, 'blockers'>,
): readonly { code: string; message: string }[] {
  const out: { code: string; message: string }[] = [];
  const productName = (id: string) => data.products?.find((p) => p.id === id)?.name ?? 'a product';
  if (data.products && data.products.length === 0) {
    out.push({ code: 'NO_PRODUCT', message: 'No fuel product is entered. Add one first.' });
  }
  if (data.tanks && data.tanks.filter((t) => t.status === 'ACTIVE').length === 0) {
    out.push({
      code: 'NO_TANK',
      message: 'No tank is entered, so fuel deliveries cannot be received.',
    });
  }
  const activeNozzles = data.nozzles?.filter((n) => n.status === 'ACTIVE') ?? null;
  if (activeNozzles && activeNozzles.length === 0) {
    out.push({
      code: 'NO_NOZZLE',
      message: 'No pump nozzle is entered, so no sales can be recorded.',
    });
  }
  if (data.shiftTemplates && data.shiftTemplates.filter((s) => s.active).length === 0) {
    out.push({
      code: 'NO_SHIFT_TEMPLATE',
      message: 'No shift template is entered, so shifts cannot be planned.',
    });
  }
  if (data.prices && activeNozzles) {
    const priced = new Set(data.prices.filter((p) => p.state === 'ACTIVE').map((p) => p.productId));
    for (const productId of new Set(activeNozzles.map((n) => n.productId))) {
      if (!priced.has(productId)) {
        out.push({
          code: 'NO_PRICE',
          message: `No active selling price for ${productName(productId)}, so it cannot be sold or reconciled.`,
        });
      }
    }
  }
  return out;
}
