import { Injectable, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { loggerOptions } from '@ordemcerta/server';
import { LoggerModule } from 'nestjs-pino';
import { maybeCtx } from './core/context';
import { CoreModule } from './core/core.module';
import { getEnv } from './core/env.provider';
import { AccessGuard, AuthGuard } from './core/guards';
import { IdempotencyInterceptor } from './core/idempotency.interceptor';
import { RedisThrottlerStorage } from './core/throttler-redis.storage';
import { AuthModule } from './modules/auth/auth.module';
import { CustomersModule } from './modules/customers/customers.module';
import { FinanceModule } from './modules/finance/finance.module';
import { OperationsModule } from './modules/operations.module';
import { ServiceOrdersModule } from './modules/service-orders/service-orders.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { PublicModule } from './modules/public/public.module';
import { WarrantiesModule } from './modules/warranties/warranties.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { ReportsModule } from './modules/reports/reports.module';
import { BillingModule } from './modules/billing/billing.module';
import { PlatformModule } from './modules/platform/platform.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';

/** Rate limit por usuário autenticado (ou IP), executado após a autenticação. */
@Injectable()
class OcThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const a = maybeCtx()?.auth;
    if (a) return `u:${a.userId}`;
    return `ip:${String(req.ip ?? 'unknown')}`;
  }
}

const env = getEnv();

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        ...loggerOptions(env.LOG_LEVEL, 'api'),
        genReqId: (req) => String(req.headers['x-request-id'] ?? ''),
        autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/health') },
        customProps: () => {
          const c = maybeCtx();
          return { tenantId: c?.auth?.tenantId ?? undefined, userId: c?.auth?.userId ?? undefined };
        },
        serializers: {
          req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url.split('?')[0] }),
        },
      },
    }),
    CoreModule,
    ThrottlerModule.forRootAsync({
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({ throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }], storage }),
    }),
    AuthModule,
    TenantsModule,
    CustomersModule,
    FinanceModule,
    OperationsModule,
    ServiceOrdersModule,
    PublicModule,
    WarrantiesModule,
    MessagingModule,
    ReportsModule,
    BillingModule,
    PlatformModule,
    DashboardModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: OcThrottlerGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule {}
