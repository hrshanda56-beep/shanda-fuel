import { afterEach, describe, expect, it, vi } from 'vitest';
import { getServerEnv } from '../config/env';
import { createResendEmailSender, EmailError } from './index';

const apiKey = 'resend-secret-test';
const message = { to: 'operator@example.invalid', subject: 'Staging test', text: 'synthetic body' };
const env = () =>
  getServerEnv({
    APP_ENV: 'test',
    RESEND_API_KEY: apiKey,
    RESEND_FROM_EMAIL: 'staging@example.invalid',
  });

afterEach(() => vi.restoreAllMocks());

describe('Resend email adapter', () => {
  it('fails safely when configuration is missing', () => {
    expect(() => createResendEmailSender(getServerEnv({ APP_ENV: 'test' }))).toThrowError(
      EmailError,
    );
    expect(() => createResendEmailSender(getServerEnv({ APP_ENV: 'test' }))).toThrow(
      'Email delivery is not configured',
    );
  });

  it('maps success to the application-owned receipt', async () => {
    const send = vi.fn().mockResolvedValue({ data: { id: 'provider-message-id' }, error: null });
    const sender = createResendEmailSender(env(), send);
    await expect(sender.send(message)).resolves.toEqual({ messageId: 'provider-message-id' });
    expect(send).toHaveBeenCalledWith({ from: 'staging@example.invalid', ...message });
  });

  it('maps provider errors without surfacing secrets or sensitive payloads', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const send = vi.fn().mockResolvedValue({
      data: null,
      error: new Error(`${apiKey} ${message.to} ${message.text}`),
    });
    const sender = createResendEmailSender(env(), send);
    let thrown: unknown;
    try {
      await sender.send(message);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      name: 'EmailError',
      code: 'provider',
      message: 'Email delivery failed',
    });
    expect(JSON.stringify(thrown)).not.toContain(apiKey);
    expect(JSON.stringify(thrown)).not.toContain(message.to);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).not.toContain(apiKey);
    expect(log.mock.calls[0]?.[0]).not.toContain(message.to);
    expect(log.mock.calls[0]?.[0]).not.toContain(message.text);
  });

  it('requires a body without attempting a provider call', async () => {
    const send = vi.fn();
    const sender = createResendEmailSender(env(), send);
    await expect(
      sender.send({ to: 'operator@example.invalid', subject: 'empty' }),
    ).rejects.toThrowError(EmailError);
    expect(send).not.toHaveBeenCalled();
  });
});
