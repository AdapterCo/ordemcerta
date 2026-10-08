import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { BillingError, MessagingError, StorageNotConfiguredError, MercadoPagoNotConfiguredError } from '@ordemcerta/server';
import { ErrorCode, type ApiErrorBody } from '@ordemcerta/shared';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { DomainError } from './errors';
import { maybeCtx } from './context';

const BILLING_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  CONFLICT: 409,
  PRECONDITION_FAILED: 422,
  PLAN_DOWNGRADE_BLOCKED: 422,
  INTEGRATION_NOT_CONFIGURED: 503,
  PROVIDER_ERROR: 502,
};

/** Formato uniforme de erro: {code,message,details,requestId}. Nunca vaza stack ou SQL. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') return;
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    const requestId = maybeCtx()?.requestId ?? (req.headers['x-request-id'] as string | undefined);
    const { status, body } = this.map(exception);
    body.requestId = requestId;
    if (status >= 500) {
      this.logger.error({ err: exception instanceof Error ? { message: exception.message, stack: exception.stack } : exception, requestId, path: req.path }, 'erro interno');
    }
    if (!res.headersSent) res.status(status).json(body);
  }

  private map(e: unknown): { status: number; body: ApiErrorBody } {
    if (e instanceof DomainError) return { status: e.status, body: { code: e.code, message: e.message, details: e.details } };
    if (e instanceof BillingError) {
      return { status: BILLING_STATUS[e.code] ?? 400, body: { code: e.code, message: e.message, details: e.details } };
    }
    if (e instanceof StorageNotConfiguredError) {
      return { status: 503, body: { code: ErrorCode.INTEGRATION_NOT_CONFIGURED, message: e.message } };
    }
    if (e instanceof MercadoPagoNotConfiguredError) {
      return { status: 503, body: { code: ErrorCode.INTEGRATION_NOT_CONFIGURED, message: e.message } };
    }
    if (e instanceof MessagingError) {
      const status = e.code === 'NOT_CONFIGURED' || e.code === 'NOT_IMPLEMENTED' ? 503 : 502;
      return { status, body: { code: e.code === 'NOT_CONFIGURED' ? ErrorCode.INTEGRATION_NOT_CONFIGURED : ErrorCode.PROVIDER_ERROR, message: e.message } };
    }
    if (e instanceof ZodError) {
      return { status: 422, body: { code: ErrorCode.VALIDATION_ERROR, message: 'Dados inválidos', details: e.flatten() } };
    }
    if (e instanceof ThrottlerException) {
      return { status: 429, body: { code: ErrorCode.RATE_LIMITED, message: 'Muitas requisições. Aguarde e tente novamente.' } };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      switch (e.code) {
        case 'P2002':
          return { status: 409, body: { code: ErrorCode.CONFLICT, message: 'Registro duplicado', details: { fields: e.meta?.target } } };
        case 'P2025':
          return { status: 404, body: { code: ErrorCode.NOT_FOUND, message: 'Registro não encontrado' } };
        case 'P2034':
          return { status: 409, body: { code: ErrorCode.CONFLICT, message: 'Conflito de concorrência; tente novamente' } };
        case 'P2003':
          return { status: 422, body: { code: ErrorCode.VALIDATION_ERROR, message: 'Referência inválida' } };
        case 'P2004':
        case 'P2010': {
          const msg = String(e.message);
          if (msg.includes('23503') || msg.includes('Referência entre empresas') || msg.includes('não pertence à empresa')) {
            return { status: 403, body: { code: ErrorCode.FORBIDDEN, message: 'Referência a registro de outra empresa' } };
          }
          if (msg.includes('42501')) return { status: 403, body: { code: ErrorCode.FORBIDDEN, message: 'Operação não permitida sobre registro imutável' } };
          if (msg.includes('23514')) return { status: 422, body: { code: ErrorCode.VALIDATION_ERROR, message: 'Valores violam regras de consistência' } };
          break;
        }
      }
    }
    if (e instanceof Prisma.PrismaClientUnknownRequestError) {
      const msg = String(e.message);
      if (msg.includes('Referência entre empresas') || msg.includes('não pertence à empresa')) {
        return { status: 403, body: { code: ErrorCode.FORBIDDEN, message: 'Referência a registro de outra empresa' } };
      }
      if (msg.includes('somente inserção') || msg.includes('não podem ser excluídos') || msg.includes('finalizado não pode')) {
        return { status: 403, body: { code: ErrorCode.FORBIDDEN, message: 'Operação não permitida sobre registro imutável' } };
      }
      if (msg.includes('check constraint')) return { status: 422, body: { code: ErrorCode.VALIDATION_ERROR, message: 'Valores violam regras de consistência' } };
    }
    if (e instanceof HttpException) {
      const status = e.getStatus();
      const code =
        status === 404 ? ErrorCode.NOT_FOUND : status === 401 ? ErrorCode.UNAUTHENTICATED : status === 403 ? ErrorCode.FORBIDDEN : status === 413 ? ErrorCode.FILE_REJECTED : ErrorCode.VALIDATION_ERROR;
      const r = e.getResponse();
      const message = typeof r === 'string' ? r : ((r as { message?: string | string[] }).message?.toString() ?? e.message);
      return { status, body: { code, message } };
    }
    return { status: HttpStatus.INTERNAL_SERVER_ERROR, body: { code: ErrorCode.INTERNAL_ERROR, message: 'Erro interno. Tente novamente.' } };
  }
}
