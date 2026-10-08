import pino, { type LoggerOptions } from 'pino';

/**
 * Nunca logar tokens, mensagens completas, senhas, IMEI completo ou dados de
 * pagamento (seção 10). Caminhos redigidos automaticamente.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'req.headers["x-signature"]',
  'req.headers["x-hub-signature-256"]',
  'req.headers["x-tracking-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.mfaToken',
  '*.secret',
  '*.unlockSecret',
  '*.imei',
  '*.serial',
  '*.otpCode',
  '*.code',
  '*.qrCode',
  '*.qr_code',
  '*.card',
  '*.signaturePng',
];

export function loggerOptions(level: string, service: string): LoggerOptions {
  return {
    level,
    base: { service },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
  };
}

export function createLogger(level: string, service: string) {
  return pino(loggerOptions(level, service));
}
