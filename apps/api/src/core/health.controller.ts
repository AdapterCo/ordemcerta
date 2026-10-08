import { Controller, Get, Inject, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { integrationStatus } from '@ordemcerta/server';
import type { Response } from 'express';
import { AppPrisma, SystemPrisma } from './database';
import { Public } from './decorators';
import { ENV, type AppEnv } from './env.provider';
import { RedisService, StorageService } from './services';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly app: AppPrisma,
    private readonly system: SystemPrisma,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
    @Inject(ENV) private readonly env: AppEnv,
  ) {}

  @Public()
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** Prontidão: banco (ambos os papéis), Redis e storage. Integrações listadas sem segredos. */
  @Public()
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const check = async (fn: () => Promise<unknown>) => {
      try {
        await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))]);
        return true;
      } catch {
        return false;
      }
    };
    const database = await check(() => this.app.$queryRaw`SELECT 1`);
    const databaseSystem = await check(() => this.system.$queryRaw`SELECT 1`);
    const redis = await check(() => this.redis.client.ping());
    const storage = this.storage.provider ? await check(async () => {
      if (!(await this.storage.provider!.healthy())) throw new Error();
    }) : null;
    const ok = database && databaseSystem && redis && storage !== false;
    res.status(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'degraded', checks: { database, databaseSystem, redis, storage }, integrations: integrationStatus(this.env) };
  }
}
