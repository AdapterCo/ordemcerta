import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === true || v === 'true' || v === '1'));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

/**
 * Variáveis de ambiente compartilhadas por API e worker. Valores ausentes de
 * integrações externas resultam em "integração não configurada", nunca em
 * comportamento simulado.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    APP_DOMAIN: z.string().default('localhost'),
    APP_URL: z.string().url().default('http://localhost:5173'),
    API_PORT: z.coerce.number().int().default(3001),
    CORS_ORIGINS: z.string().default('http://localhost:5173'),
    TRUST_PROXY: bool(true),

    DATABASE_URL: z.string().min(1),
    DATABASE_SYSTEM_URL: z.string().min(1),
    REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

    JWT_SECRET: z.string().min(32, 'JWT_SECRET deve ter ao menos 32 caracteres'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(30),
    /** Chave AES-256 em base64 (32 bytes). Rotação: ENCRYPTION_KEY_ID + ENCRYPTION_KEYS_PREVIOUS ("id:base64,id:base64"). */
    ENCRYPTION_KEY: z.string().min(40),
    ENCRYPTION_KEY_ID: z.string().regex(/^[a-z0-9]{1,8}$/).default('k1'),
    ENCRYPTION_KEYS_PREVIOUS: optionalString,
    COOKIE_SECURE: bool(true),

    MAIL_TRANSPORT: z.enum(['smtp', 'console', 'none']).default('none'),
    SMTP_HOST: optionalString,
    SMTP_PORT: z.coerce.number().int().default(587),
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    SMTP_FROM: z.string().default('OrdemCerta <nao-responda@ordemcerta.adapterco.com.br>'),

    MP_ACCESS_TOKEN: optionalString,
    MP_WEBHOOK_SECRET: optionalString,
    MP_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().default(300),

    META_APP_ID: optionalString,
    META_APP_SECRET: optionalString,
    META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v23.0'),
    META_WEBHOOK_VERIFY_TOKEN: optionalString,
    META_EMBEDDED_SIGNUP_ENABLED: bool(false),
    META_EMBEDDED_SIGNUP_CONFIG_ID: optionalString,

    API_DOCS_ENABLED: bool(false),
    API_DOCS_USER: optionalString,
    API_DOCS_PASSWORD: optionalString,
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (env.MAIL_TRANSPORT === 'console') {
        ctx.addIssue({ code: 'custom', path: ['MAIL_TRANSPORT'], message: 'Transporte console não é permitido em produção' });
      }
      if (!env.COOKIE_SECURE) {
        ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'Cookies devem ser Secure em produção' });
      }
      if (env.API_DOCS_ENABLED && (!env.API_DOCS_USER || !env.API_DOCS_PASSWORD)) {
        ctx.addIssue({ code: 'custom', path: ['API_DOCS_ENABLED'], message: 'OpenAPI em produção exige API_DOCS_USER/API_DOCS_PASSWORD' });
      }
    }
    if (env.MAIL_TRANSPORT === 'smtp' && !env.SMTP_HOST) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'SMTP_HOST obrigatório com MAIL_TRANSPORT=smtp' });
    }
    try {
      if (Buffer.from(env.ENCRYPTION_KEY, 'base64').length !== 32) throw new Error();
    } catch {
      ctx.addIssue({ code: 'custom', path: ['ENCRYPTION_KEY'], message: 'ENCRYPTION_KEY deve ser base64 de 32 bytes (openssl rand -base64 32)' });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida:\n${issues}`);
  }
  return parsed.data;
}

/** Estado das integrações externas, exibido em /health/ready e no painel da plataforma. */
export function integrationStatus(env: Env) {
  return {
    mail: env.MAIL_TRANSPORT !== 'none',
    mercadoPago: Boolean(env.MP_ACCESS_TOKEN && env.MP_WEBHOOK_SECRET),
    whatsappCloud: Boolean(env.META_APP_ID && env.META_APP_SECRET && env.META_WEBHOOK_VERIFY_TOKEN),
    whatsappEmbeddedSignup: Boolean(env.META_EMBEDDED_SIGNUP_ENABLED && env.META_EMBEDDED_SIGNUP_CONFIG_ID),
  };
}
