import type { DeliveryStatus, QuoteStatus, TechnicalStatus } from './enums';
import type { Permission } from './permissions';

/**
 * Máquina de estados técnica da OS (seção 4). Cada transição declara a
 * permissão exigida. Pré-condições adicionais (checklist, aprovação,
 * versão do orçamento) são verificadas no service.
 */
export interface TransitionRule {
  to: TechnicalStatus;
  permission: Permission;
  /** Nome da ação/endpoint que realiza a transição. */
  action: string;
}

export const TECHNICAL_TRANSITIONS: Record<TechnicalStatus, readonly TransitionRule[]> = {
  RECEIVED: [
    { to: 'WAITING_DIAGNOSIS', permission: 'os:assign', action: 'assign' },
    { to: 'WAITING_DIAGNOSIS', permission: 'os:accept', action: 'accept' },
    { to: 'CANCELED', permission: 'os:cancel', action: 'cancel' },
  ],
  WAITING_DIAGNOSIS: [
    { to: 'DIAGNOSING', permission: 'os:diagnose', action: 'start-diagnosis' },
    { to: 'CANCELED', permission: 'os:cancel', action: 'cancel' },
  ],
  DIAGNOSING: [
    { to: 'WAITING_QUOTE_APPROVAL', permission: 'os:diagnose', action: 'submit-diagnosis' },
    { to: 'APPROVED', permission: 'os:diagnose', action: 'submit-diagnosis' },
    { to: 'RETURNED_UNREPAIRED', permission: 'os:diagnose', action: 'return-unrepaired' },
    { to: 'CANCELED', permission: 'os:cancel', action: 'cancel' },
  ],
  WAITING_QUOTE_APPROVAL: [
    { to: 'APPROVED', permission: 'quote:approve_manual', action: 'approve' },
    { to: 'REJECTED', permission: 'quote:approve_manual', action: 'reject' },
    { to: 'DIAGNOSING', permission: 'os:diagnose', action: 'start-diagnosis' },
    { to: 'CANCELED', permission: 'os:cancel', action: 'cancel' },
  ],
  APPROVED: [
    { to: 'WAITING_PARTS', permission: 'os:repair', action: 'request-parts' },
    { to: 'IN_REPAIR', permission: 'os:repair', action: 'start-repair' },
    { to: 'CANCELED', permission: 'os:cancel', action: 'cancel' },
  ],
  WAITING_PARTS: [
    { to: 'IN_REPAIR', permission: 'os:repair', action: 'start-repair' },
    { to: 'APPROVED', permission: 'os:repair', action: 'parts-arrived' },
    { to: 'CANCELED', permission: 'os:cancel', action: 'cancel' },
  ],
  IN_REPAIR: [
    { to: 'TESTING', permission: 'os:repair', action: 'start-testing' },
    { to: 'WAITING_PARTS', permission: 'os:repair', action: 'request-parts' },
  ],
  TESTING: [
    { to: 'READY', permission: 'os:repair', action: 'complete-repair' },
    { to: 'IN_REPAIR', permission: 'os:repair', action: 'start-repair' },
  ],
  READY: [{ to: 'REOPENED', permission: 'os:reopen', action: 'reopen' }],
  REJECTED: [
    { to: 'RETURNED_UNREPAIRED', permission: 'os:update', action: 'return-unrepaired' },
    { to: 'DIAGNOSING', permission: 'os:diagnose', action: 'start-diagnosis' },
    { to: 'CANCELED', permission: 'os:cancel', action: 'cancel' },
  ],
  RETURNED_UNREPAIRED: [{ to: 'REOPENED', permission: 'os:reopen', action: 'reopen' }],
  CANCELED: [{ to: 'REOPENED', permission: 'os:reopen', action: 'reopen' }],
  REOPENED: [
    { to: 'DIAGNOSING', permission: 'os:diagnose', action: 'start-diagnosis' },
    { to: 'IN_REPAIR', permission: 'os:repair', action: 'start-repair' },
    { to: 'CANCELED', permission: 'os:cancel', action: 'cancel' },
  ],
};

export function findTransition(from: TechnicalStatus, to: TechnicalStatus, action?: string): TransitionRule | undefined {
  return TECHNICAL_TRANSITIONS[from]?.find((t) => t.to === to && (action === undefined || t.action === action));
}

export function canTransition(from: TechnicalStatus, to: TechnicalStatus): boolean {
  return Boolean(findTransition(from, to));
}

/** Status a partir dos quais um reparo cobrável já pode ter começado. */
export const REPAIR_STARTED_STATUSES: readonly TechnicalStatus[] = ['IN_REPAIR', 'TESTING', 'READY'];

/** Status técnicos terminais em que o aparelho pode ser entregue ao cliente. */
export const DELIVERABLE_TECHNICAL_STATUSES: readonly TechnicalStatus[] = ['READY', 'RETURNED_UNREPAIRED', 'CANCELED'];

/** OS "abertas" para KPIs. */
export const OPEN_TECHNICAL_STATUSES: readonly TechnicalStatus[] = [
  'RECEIVED', 'WAITING_DIAGNOSIS', 'DIAGNOSING', 'WAITING_QUOTE_APPROVAL', 'APPROVED',
  'WAITING_PARTS', 'IN_REPAIR', 'TESTING', 'REOPENED', 'REJECTED',
];

export const DELIVERY_TRANSITIONS: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  IN_CUSTODY: ['READY_FOR_PICKUP'],
  READY_FOR_PICKUP: ['DELIVERED', 'RETURNED_UNREPAIRED', 'IN_CUSTODY'],
  DELIVERED: [],
  RETURNED_UNREPAIRED: [],
};

export const QUOTE_TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
  DRAFT: ['SENT', 'SUPERSEDED'],
  SENT: ['APPROVED', 'REJECTED', 'EXPIRED', 'SUPERSEDED'],
  APPROVED: ['SUPERSEDED'],
  REJECTED: ['SUPERSEDED'],
  EXPIRED: ['SUPERSEDED'],
  SUPERSEDED: [],
};

export function canTransitionQuote(from: QuoteStatus, to: QuoteStatus): boolean {
  return QUOTE_TRANSITIONS[from].includes(to);
}
