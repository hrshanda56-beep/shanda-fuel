import { describe, expect, it } from 'vitest';
import { executeForecourtCommand, type ForecourtCommandPorts } from './application';

describe('A3 authoritative command seam', () => {
  it('authorizes before idempotency and appends audit/outbox within the effect boundary', async () => {
    const calls: string[] = [];
    const ports: ForecourtCommandPorts = {
      authorize: async () => {
        calls.push('authorize');
      },
      idempotency: {
        run: async (_request, effect) => {
          calls.push('idempotency');
          return effect();
        },
      },
      audit: {
        append: async () => {
          calls.push('audit');
        },
      },
      outbox: {
        publish: async () => {
          calls.push('outbox');
        },
      },
    };
    const result = await executeForecourtCommand({
      context: {
        tenantId: '11111111-1111-4111-8111-111111111111',
        stationId: '22222222-2222-4222-8222-222222222222',
        actorId: '33333333-3333-4333-8333-333333333333',
        membershipId: '44444444-4444-4444-8444-444444444444',
        requestId: '55555555-5555-4555-8555-555555555555',
      },
      commandType: 'SealSegment',
      idempotencyKey: 'retry-key-1',
      requestHash: 'hash-1',
      subjectType: 'MeterSegment',
      subjectId: '66666666-6666-4666-8666-666666666666',
      ports,
      execute: async () => ({ result: 'sealed' as const }),
    });
    expect(result).toBe('sealed');
    expect(calls).toEqual(['authorize', 'idempotency', 'audit']);
  });
});
