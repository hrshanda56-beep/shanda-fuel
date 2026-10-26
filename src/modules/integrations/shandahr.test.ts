import { AppError } from '../../platform/errors';
import { describe, expect, it } from 'vitest';
import { createShandaHrAdapter, isShandaHrEnabled, SHANDAHR_FEATURE_FLAG } from './shandahr';

describe('ShandaHR integration boundary', () => {
  it('is disabled unless the explicit opt-in flag is set', () => {
    expect(isShandaHrEnabled({})).toBe(false);
    expect(isShandaHrEnabled({ [SHANDAHR_FEATURE_FLAG]: '0' })).toBe(false);
    expect(createShandaHrAdapter({ environment: {} }).status).toBe('DISABLED');
  });

  it('does not make a network call while disabled', async () => {
    let calls = 0;
    const adapter = createShandaHrAdapter({
      environment: {},
      transport: { listEmployees: async () => ((calls += 1), []) },
    });

    await expect(adapter.listEmployees()).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
    });
    expect(calls).toBe(0);
  });

  it('keeps an explicit opt-in unconfigured until a transport is injected', async () => {
    const adapter = createShandaHrAdapter({
      environment: { [SHANDAHR_FEATURE_FLAG]: '1' },
    });
    expect(adapter.status).toBe('ENABLED_WITHOUT_TRANSPORT');
    await expect(adapter.listEmployees()).rejects.toBeInstanceOf(AppError);
  });

  it('passes the future transport through without adding external credentials', async () => {
    const employees = [{ externalId: 'hr-1', displayName: 'Tendai', active: true }];
    const adapter = createShandaHrAdapter({
      environment: { [SHANDAHR_FEATURE_FLAG]: '1' },
      transport: { listEmployees: async () => employees },
    });
    expect(adapter.status).toBe('READY');
    await expect(adapter.listEmployees()).resolves.toEqual(employees);
  });
});
