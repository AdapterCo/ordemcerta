import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createAdapter } from '@socket.io/redis-adapter';
import { safeEqual } from '@ordemcerta/server';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import IORedis from 'ioredis';
import { Logger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { ServerOptions } from 'socket.io';
import { AppModule } from './app.module';
import { als } from './core/context';
import { getEnv } from './core/env.provider';
import { AllExceptionsFilter } from './core/error.filter';

class RedisIoAdapter extends IoAdapter {
  private adapter?: ReturnType<typeof createAdapter>;
  async connect(url: string) {
    const pub = new IORedis(url, { lazyConnect: false, maxRetriesPerRequest: null });
    const sub = pub.duplicate();
    pub.on('error', () => undefined);
    sub.on('error', () => undefined);
    this.adapter = createAdapter(pub, sub);
  }
  override createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    if (this.adapter) server.adapter(this.adapter);
    return server;
  }
}

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Configuração compartilhada entre produção e testes de integração. */
export async function configureApp(app: NestExpressApplication) {
  const env = getEnv();
  app.set('trust proxy', env.TRUST_PROXY ? 1 : false);
  app.disable('x-powered-by');

  // Correlation ID + contexto de requisição (AsyncLocalStorage)
  app.use((req: Request, res: Response, next: NextFunction) => {
    const incoming = req.headers['x-request-id'];
    const requestId = typeof incoming === 'string' && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
    req.headers['x-request-id'] = requestId;
    res.setHeader('X-Request-Id', requestId);
    als.run({ requestId, ip: req.ip ?? null, userAgent: (req.headers['user-agent'] as string | undefined) ?? null }, () => next());
  });

  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: false },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '1mb' });

  const origins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({
    origin: (origin, cb) => cb(null, !origin || origins.includes(origin)),
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-CSRF-Token', 'X-Request-Id', 'X-Tracking-Token'],
    exposedHeaders: ['X-Request-Id', 'Idempotent-Replayed'],
  });

  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });
  app.useGlobalFilters(new AllExceptionsFilter());

  const ws = new RedisIoAdapter(app);
  await ws.connect(env.REDIS_URL);
  app.useWebSocketAdapter(ws);

  // OpenAPI em /api/docs — protegido por basic auth em produção.
  if (env.API_DOCS_ENABLED || env.NODE_ENV !== 'production') {
    if (env.NODE_ENV === 'production') {
      app.use('/api/docs', (req: Request, res: Response, next: NextFunction) => {
        const header = req.headers.authorization ?? '';
        const [user, pass] = Buffer.from(header.replace(/^Basic /, ''), 'base64').toString().split(':');
        if (user && pass && safeEqual(user, env.API_DOCS_USER ?? '') && safeEqual(pass, env.API_DOCS_PASSWORD ?? '')) return next();
        res.setHeader('WWW-Authenticate', 'Basic realm="OrdemCerta API"');
        res.status(401).end();
      });
    }
    const config = new DocumentBuilder()
      .setTitle('OrdemCerta API')
      .setDescription('API REST v1 — gestão de assistências técnicas. Erros: {code,message,details,requestId}.')
      .setVersion('1.0')
      .addBearerAuth()
      .addServer('/')
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config), { jsonDocumentUrl: 'api/docs/openapi.json' });
  }

  app.enableShutdownHooks();
  return app;
}

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));
  return configureApp(app);
}
