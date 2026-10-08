import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUniqueViolation, sha256Hex } from '@ordemcerta/server';
import { ErrorCode } from '@ordemcerta/shared';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { from, mergeMap, of, throwError, catchError, map, type Observable } from 'rxjs';
import { maybeCtx } from './context';
import { SystemPrisma } from './database';
import { META_IDEMPOTENT } from './decorators';
import { DomainError } from './errors';
import { CryptoService } from './services';

const KEY_RE = /^[A-Za-z0-9_\-:.]{8,120}$/;
const TTL_MS = 24 * 3600 * 1000;

/**
 * Idempotency-Key obrigatório em vendas, pagamentos, caixa e estoque.
 * Repetição com o mesmo corpo devolve a mesma resposta; corpo diferente com a
 * mesma chave é rejeitado; requisição em andamento retorna 409 (clique duplo).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly system: SystemPrisma,
    private readonly crypto: CryptoService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();
    if (!this.reflector.getAllAndOverride<boolean>(META_IDEMPOTENT, [context.getHandler(), context.getClass()])) return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !KEY_RE.test(key)) {
      throw new DomainError(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 'Header Idempotency-Key obrigatório (8–120 caracteres)', 400);
    }
    const c = maybeCtx();
    const tenantId = c?.auth?.tenantId ?? null;
    const actorId = c?.auth?.userId ?? null;
    const scope = c?.auth ? `${tenantId ?? 'none'}:${actorId}` : `public:${this.crypto.ipHash(c?.ip) ?? 'unknown'}`;
    const route = `${req.method} ${(req.route as { path?: string } | undefined)?.path ?? req.path}`;
    const requestHash = sha256Hex(`${req.originalUrl}\n${JSON.stringify(req.body ?? {})}`);

    let recordId: string;
    try {
      const rec = await this.system.idempotencyRecord.create({
        data: { tenantId, actorId, scope, route, key, requestHash, expiresAt: new Date(Date.now() + TTL_MS) },
      });
      recordId = rec.id;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const existing = await this.system.idempotencyRecord.findUnique({ where: { scope_route_key: { scope, route, key } } });
      if (!existing) throw new DomainError(ErrorCode.CONFLICT, 'Requisição em processamento; tente novamente', 409);
      if (existing.expiresAt < new Date()) {
        await this.system.idempotencyRecord.delete({ where: { id: existing.id } }).catch(() => undefined);
        return this.intercept(context, next);
      }
      if (existing.requestHash !== requestHash) {
        throw new DomainError(ErrorCode.IDEMPOTENCY_CONFLICT, 'Idempotency-Key já usada com outro conteúdo', 422);
      }
      if (!existing.completed) throw new DomainError(ErrorCode.CONFLICT, 'Requisição idêntica em processamento', 409);
      res.status(existing.statusCode ?? 200);
      res.setHeader('Idempotent-Replayed', 'true');
      return of(existing.responseJson);
    }

    return next.handle().pipe(
      mergeMap((body) =>
        from(
          this.system.idempotencyRecord.update({
            where: { id: recordId },
            data: {
              completed: true,
              statusCode: res.statusCode,
              responseJson: (body === undefined ? Prisma.JsonNull : JSON.parse(JSON.stringify(body))) as Prisma.InputJsonValue,
            },
          }),
        ).pipe(map(() => body)),
      ),
      catchError((err) =>
        from(this.system.idempotencyRecord.delete({ where: { id: recordId } }).catch(() => undefined)).pipe(mergeMap(() => throwError(() => err))),
      ),
    );
  }
}
