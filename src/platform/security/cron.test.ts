import { describe, expect, it } from 'vitest';
import { authorizeCronRequest } from './cron';

const secret = 'a'.repeat(32);

function request(value?: string): Request {
  return new Request('https://fuel.example/api/cron/recurring-costs', {
    headers: value ? { authorization: value } : undefined,
  });
}

describe('scheduled request authorization', () => {
  it('accepts the configured bearer secret', () => {
    expect(() => authorizeCronRequest(request(`Bearer ${secret}`), secret)).not.toThrow();
  });

  it('rejects missing, malformed, wrong and unconfigured secrets', () => {
    expect(() => authorizeCronRequest(request(), secret)).toThrow(/Authentication is required/);
    expect(() => authorizeCronRequest(request(`Basic ${secret}`), secret)).toThrow(
      /Authentication is required/,
    );
    expect(() => authorizeCronRequest(request(`Bearer ${'b'.repeat(32)}`), secret)).toThrow(
      /Authentication is required/,
    );
    expect(() => authorizeCronRequest(request(`Bearer ${secret}`), undefined)).toThrow(
      /Scheduled jobs are off/,
    );
  });
});
