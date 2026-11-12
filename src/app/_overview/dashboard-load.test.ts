import { expect, it } from 'vitest';
import { loadDashboardWithWork } from './dashboard-load';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

it('starts the dashboard figures and the work list together, not one after the other', async () => {
  const started: string[] = [];
  const dashboard = deferred<string>();
  const work = deferred<string>();
  const loading = loadDashboardWithWork({
    dashboard: () => {
      started.push('dashboard');
      return dashboard.promise;
    },
    work: () => {
      started.push('work');
      return work.promise;
    },
  });
  // Neither has finished, yet both have already been asked for.
  expect(started.sort()).toEqual(['dashboard', 'work']);
  dashboard.resolve('figures');
  work.resolve('items');
  await expect(loading).resolves.toEqual({ data: 'figures', work: 'items' });
});

it('does not wait for the slower one to start the faster one', async () => {
  const work = deferred<string>();
  let dashboardStarted = false;
  const loading = loadDashboardWithWork({
    dashboard: async () => {
      dashboardStarted = true;
      return 'figures';
    },
    work: () => work.promise,
  });
  await Promise.resolve();
  expect(dashboardStarted).toBe(true);
  work.resolve('items');
  await loading;
});

it('fails when the dashboard figures fail, as before', async () => {
  await expect(
    loadDashboardWithWork({
      dashboard: async () => {
        throw new Error('dashboard failed');
      },
      work: async () => 'items',
    }),
  ).rejects.toThrow('dashboard failed');
});
