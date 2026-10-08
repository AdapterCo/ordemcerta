import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from './env';

export class MailNotConfiguredError extends Error {
  constructor() {
    super('E-mail: integração não configurada');
  }
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  readonly configured: boolean;
  send(msg: MailMessage): Promise<void>;
}

export function createMailer(env: Env, log: (msg: string) => void = console.log): Mailer {
  if (env.MAIL_TRANSPORT === 'smtp') {
    const transport: Transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
    return {
      configured: true,
      async send(msg) {
        await transport.sendMail({ from: env.SMTP_FROM, ...msg });
      },
    };
  }
  if (env.MAIL_TRANSPORT === 'console') {
    // Somente desenvolvimento (bloqueado em produção pela validação de env).
    return {
      configured: true,
      async send(msg) {
        log(`[mail:console] para=${msg.to} assunto="${msg.subject}"\n${msg.text}`);
      },
    };
  }
  return {
    configured: false,
    async send() {
      throw new MailNotConfiguredError();
    },
  };
}
