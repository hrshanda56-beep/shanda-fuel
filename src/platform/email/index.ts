import 'server-only';
import { Resend, type CreateEmailOptions } from 'resend';
import { getServerEnv, type ServerEnv } from '../config/env';
import { createLogger } from '../logging';

const logger = createLogger({ component: 'platform.email' });

export class EmailError extends Error {
  constructor(readonly code: 'configuration' | 'provider') {
    super(code === 'configuration' ? 'Email delivery is not configured' : 'Email delivery failed');
    this.name = 'EmailError';
  }
}

export type EmailMessage = {
  to: string;
  subject: string;
  text?: string;
  html?: string;
};

export type EmailReceipt = { messageId: string };

export interface EmailSender {
  send(message: EmailMessage): Promise<EmailReceipt>;
}

type Send = (input: {
  from: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
}) => Promise<{ data: { id: string } | null; error: unknown | null }>;

export function createResendEmailSender(env: ServerEnv = getServerEnv(), send?: Send): EmailSender {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) throw new EmailError('configuration');
  const resend = send ? undefined : new Resend(env.RESEND_API_KEY);
  const sendEmail =
    send ?? ((input: Parameters<Send>[0]) => resend!.emails.send(input as CreateEmailOptions));

  return {
    async send(message) {
      if (!message.text && !message.html) throw new EmailError('provider');
      try {
        const result = await sendEmail({ from: env.RESEND_FROM_EMAIL!, ...message });
        if (result.error || !result.data?.id) throw new EmailError('provider');
        return { messageId: result.data.id };
      } catch {
        logger.error('Platform provider operation failed', {
          service: 'resend',
          errorCode: 'provider',
        });
        throw new EmailError('provider');
      }
    },
  };
}
