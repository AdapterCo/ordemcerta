import { Global, Module } from '@nestjs/common';
import { AppPrisma, SystemPrisma, TenantDb } from './database';
import { envProvider } from './env.provider';
import { AuthResolver } from './guards';
import { HealthController } from './health.controller';
import { PlanLimitsService } from './plan-limits.service';
import { RealtimeGateway, RealtimeService } from './realtime.gateway';
import {
  AuditService,
  CryptoService,
  OutboxService,
  QueueService,
  RedisService,
  SubscriptionStateService,
} from './services';
import { RedisThrottlerStorage } from './throttler-redis.storage';
import { SettingsService } from './settings.service';
import { TokenService } from './token.service';

const providers = [
  envProvider,
  AppPrisma,
  SystemPrisma,
  TenantDb,
  TokenService,
  AuthResolver,
  CryptoService,
  RedisService,
  QueueService,
  AuditService,
  OutboxService,
  SubscriptionStateService,
  PlanLimitsService,
  RealtimeGateway,
  RealtimeService,
  RedisThrottlerStorage,
  SettingsService,
];

@Global()
@Module({
  controllers: [HealthController],
  providers,
  exports: providers,
})
export class CoreModule {}
