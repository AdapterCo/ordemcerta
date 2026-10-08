import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import IORedis from 'ioredis';
import { createServer } from 'node:http';
import { Deps } from './deps';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error', 'warn'] });
  app.enableShutdownHooks();
  const deps = app.get(Deps);
  const redis = new IORedis(deps.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  redis.on('error', () => undefined);

  // Health do worker (usado pelo healthcheck do container).
  const port = Number(process.env.WORKER_HEALTH_PORT ?? 3002);
  createServer(async (req, res) => {
    if (req.url === '/health/live') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"ok"}');
      return;
    }
    if (req.url === '/health/ready') {
      const db = await deps.db.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
      const r = await redis.ping().then(() => true).catch(() => false);
      res.writeHead(db && r ? 200 : 503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: db && r ? 'ok' : 'degraded', checks: { database: db, redis: r } }));
      return;
    }
    res.writeHead(404).end();
  }).listen(port, '0.0.0.0');

  deps.log.info({ port }, 'worker iniciado');
}

void bootstrap();
