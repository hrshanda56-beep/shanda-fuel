import { notFound } from 'next/navigation';
import { isDevOnlySurfaceAvailable } from '@/design-system/reference/availability';
import { PanelWizardsPreviewClient } from './panel-wizards-client';

export const metadata = { title: { absolute: 'Step-by-step guides preview · Shanda Fuel' } };

/**
 * The guides that replaced the side panels, one at a time and without the signed-in shell
 * (development only). `?w=` picks the guide; whatever it would save is printed on the page so
 * Playwright can check it.
 */
export default async function PanelWizardsPreview({
  searchParams,
}: {
  searchParams: Promise<{ w?: string }>;
}) {
  if (!isDevOnlySurfaceAvailable()) notFound();
  const { w } = await searchParams;
  return <PanelWizardsPreviewClient which={w ?? ''} />;
}
