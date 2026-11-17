/**
 * The dashboard figures and the "needs attention" list read different data and need nothing from
 * each other, so both are started at once. Waiting for one before asking for the other added the
 * whole length of the second read to every dashboard load.
 */
export async function loadDashboardWithWork<D, W>(loaders: {
  dashboard: () => Promise<D>;
  work: () => Promise<W>;
}): Promise<{ data: D; work: W }> {
  const [data, work] = await Promise.all([loaders.dashboard(), loaders.work()]);
  return { data, work };
}
