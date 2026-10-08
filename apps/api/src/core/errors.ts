import { ErrorCode, type PlanLimitDetails } from '@ordemcerta/shared';

export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode | string,
    message: string,
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const Errors = {
  unauthenticated: (msg = 'Autenticação necessária') => new DomainError(ErrorCode.UNAUTHENTICATED, msg, 401),
  invalidCredentials: () => new DomainError(ErrorCode.INVALID_CREDENTIALS, 'E-mail ou senha inválidos', 401),
  forbidden: (msg = 'Acesso negado') => new DomainError(ErrorCode.FORBIDDEN, msg, 403),
  notFound: (what = 'Registro') => new DomainError(ErrorCode.NOT_FOUND, `${what} não encontrado(a)`, 404),
  conflict: (msg: string, details?: unknown) => new DomainError(ErrorCode.CONFLICT, msg, 409, details),
  versionConflict: () =>
    new DomainError(ErrorCode.VERSION_CONFLICT, 'Este registro foi alterado por outra pessoa. Atualize a tela e tente novamente.', 409),
  invalidTransition: (from: string, to: string) =>
    new DomainError(ErrorCode.INVALID_TRANSITION, `Transição não permitida: ${from} → ${to}`, 409, { from, to }),
  precondition: (msg: string, details?: unknown) => new DomainError(ErrorCode.PRECONDITION_FAILED, msg, 422, details),
  validation: (msg: string, details?: unknown) => new DomainError(ErrorCode.VALIDATION_ERROR, msg, 422, details),
  planLimit: (d: PlanLimitDetails) =>
    new DomainError(ErrorCode.PLAN_LIMIT_REACHED, `Limite do plano ${d.plan} atingido (${d.current}/${d.limit})`, 409, d),
  subscriptionInactive: (status: string) =>
    new DomainError(
      ErrorCode.SUBSCRIPTION_INACTIVE,
      'Operação bloqueada: a assinatura não está ativa. Regularize em Assinatura para liberar.',
      402,
      { status },
    ),
  insufficientStock: (details: unknown) => new DomainError(ErrorCode.INSUFFICIENT_STOCK, 'Estoque insuficiente', 409, details),
  integrationNotConfigured: (name: string) =>
    new DomainError(ErrorCode.INTEGRATION_NOT_CONFIGURED, `${name}: integração não configurada`, 503),
  provider: (msg: string) => new DomainError(ErrorCode.PROVIDER_ERROR, msg, 502),
  tokenInvalid: () => new DomainError(ErrorCode.TOKEN_INVALID, 'Link inválido ou expirado', 404),
};
