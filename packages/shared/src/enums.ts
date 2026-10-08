/**
 * Enumerações de domínio compartilhadas entre API, worker e web.
 * Devem permanecer sincronizadas com os enums do schema Prisma.
 */

const values = <T extends Record<string, string>>(o: T) => Object.values(o) as [T[keyof T], ...T[keyof T][]];

export const TenantRole = {
  TENANT_OWNER: 'TENANT_OWNER',
  TENANT_ADMIN: 'TENANT_ADMIN',
  MANAGER: 'MANAGER',
  RECEPTIONIST: 'RECEPTIONIST',
  TECHNICIAN: 'TECHNICIAN',
  CASHIER: 'CASHIER',
  INVENTORY: 'INVENTORY',
} as const;
export type TenantRole = (typeof TenantRole)[keyof typeof TenantRole];
export const TENANT_ROLES = values(TenantRole);

export const ROLE_LABELS: Record<TenantRole, string> = {
  TENANT_OWNER: 'Proprietário',
  TENANT_ADMIN: 'Administrador',
  MANAGER: 'Gerente',
  RECEPTIONIST: 'Atendente',
  TECHNICIAN: 'Técnico',
  CASHIER: 'Caixa',
  INVENTORY: 'Estoquista',
};

export const PlatformRole = { PLATFORM_SUPERADMIN: 'PLATFORM_SUPERADMIN' } as const;
export type PlatformRole = (typeof PlatformRole)[keyof typeof PlatformRole];

export const TechnicalStatus = {
  RECEIVED: 'RECEIVED',
  WAITING_DIAGNOSIS: 'WAITING_DIAGNOSIS',
  DIAGNOSING: 'DIAGNOSING',
  WAITING_QUOTE_APPROVAL: 'WAITING_QUOTE_APPROVAL',
  APPROVED: 'APPROVED',
  WAITING_PARTS: 'WAITING_PARTS',
  IN_REPAIR: 'IN_REPAIR',
  TESTING: 'TESTING',
  READY: 'READY',
  REJECTED: 'REJECTED',
  CANCELED: 'CANCELED',
  RETURNED_UNREPAIRED: 'RETURNED_UNREPAIRED',
  REOPENED: 'REOPENED',
} as const;
export type TechnicalStatus = (typeof TechnicalStatus)[keyof typeof TechnicalStatus];
export const TECHNICAL_STATUSES = values(TechnicalStatus);

export const TECHNICAL_STATUS_LABELS: Record<TechnicalStatus, string> = {
  RECEIVED: 'Recebida',
  WAITING_DIAGNOSIS: 'Aguardando diagnóstico',
  DIAGNOSING: 'Em diagnóstico',
  WAITING_QUOTE_APPROVAL: 'Aguardando aprovação',
  APPROVED: 'Aprovada',
  WAITING_PARTS: 'Aguardando peças',
  IN_REPAIR: 'Em reparo',
  TESTING: 'Em testes',
  READY: 'Pronta',
  REJECTED: 'Orçamento recusado',
  CANCELED: 'Cancelada',
  RETURNED_UNREPAIRED: 'Devolvida sem reparo',
  REOPENED: 'Reaberta',
};

/** Status exibido no portal público — nunca expõe detalhes internos. */
export const PUBLIC_STATUS_LABELS: Record<TechnicalStatus, string> = {
  RECEIVED: 'Aparelho recebido',
  WAITING_DIAGNOSIS: 'Aguardando avaliação técnica',
  DIAGNOSING: 'Em avaliação técnica',
  WAITING_QUOTE_APPROVAL: 'Orçamento aguardando sua aprovação',
  APPROVED: 'Orçamento aprovado',
  WAITING_PARTS: 'Aguardando peças',
  IN_REPAIR: 'Em reparo',
  TESTING: 'Em testes finais',
  READY: 'Pronto para retirada',
  REJECTED: 'Orçamento recusado',
  CANCELED: 'Serviço cancelado',
  RETURNED_UNREPAIRED: 'Devolução sem reparo',
  REOPENED: 'Em reanálise',
};

export const DeliveryStatus = {
  IN_CUSTODY: 'IN_CUSTODY',
  READY_FOR_PICKUP: 'READY_FOR_PICKUP',
  DELIVERED: 'DELIVERED',
  RETURNED_UNREPAIRED: 'RETURNED_UNREPAIRED',
} as const;
export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];
export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  IN_CUSTODY: 'Em custódia',
  READY_FOR_PICKUP: 'Disponível para retirada',
  DELIVERED: 'Entregue',
  RETURNED_UNREPAIRED: 'Devolvido sem reparo',
};

export const OrderPaymentStatus = {
  UNBILLED: 'UNBILLED',
  UNPAID: 'UNPAID',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PAID: 'PAID',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
} as const;
export type OrderPaymentStatus = (typeof OrderPaymentStatus)[keyof typeof OrderPaymentStatus];
export const ORDER_PAYMENT_STATUS_LABELS: Record<OrderPaymentStatus, string> = {
  UNBILLED: 'Não faturada',
  UNPAID: 'Em aberto',
  PARTIALLY_PAID: 'Parcialmente paga',
  PAID: 'Paga',
  REFUNDED: 'Estornada',
  PARTIALLY_REFUNDED: 'Parcialmente estornada',
};

export const QuoteStatus = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  SUPERSEDED: 'SUPERSEDED',
} as const;
export type QuoteStatus = (typeof QuoteStatus)[keyof typeof QuoteStatus];
export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  DRAFT: 'Rascunho',
  SENT: 'Enviado',
  APPROVED: 'Aprovado',
  REJECTED: 'Recusado',
  EXPIRED: 'Expirado',
  SUPERSEDED: 'Substituído',
};

export const Priority = { LOW: 'LOW', NORMAL: 'NORMAL', HIGH: 'HIGH', URGENT: 'URGENT' } as const;
export type Priority = (typeof Priority)[keyof typeof Priority];
export const PRIORITIES = values(Priority);
export const PRIORITY_LABELS: Record<Priority, string> = { LOW: 'Baixa', NORMAL: 'Normal', HIGH: 'Alta', URGENT: 'Urgente' };

export const OrderCategory = { DIAGNOSIS: 'DIAGNOSIS', REPAIR: 'REPAIR' } as const;
export type OrderCategory = (typeof OrderCategory)[keyof typeof OrderCategory];

export const AccessoryType = {
  CHIP: 'CHIP',
  SD_CARD: 'SD_CARD',
  CASE: 'CASE',
  CHARGER: 'CHARGER',
  CABLE: 'CABLE',
  OTHER: 'OTHER',
} as const;
export type AccessoryType = (typeof AccessoryType)[keyof typeof AccessoryType];
export const ACCESSORY_TYPES = values(AccessoryType);
export const ACCESSORY_LABELS: Record<AccessoryType, string> = {
  CHIP: 'Chip',
  SD_CARD: 'Cartão SD',
  CASE: 'Capa',
  CHARGER: 'Carregador',
  CABLE: 'Cabo',
  OTHER: 'Outros',
};

export const QuoteLineKind = { PART: 'PART', LABOR: 'LABOR', SERVICE: 'SERVICE', FEE: 'FEE' } as const;
export type QuoteLineKind = (typeof QuoteLineKind)[keyof typeof QuoteLineKind];
export const QUOTE_LINE_KINDS = values(QuoteLineKind);

export const ProductKind = { PRODUCT: 'PRODUCT', PART: 'PART', SERVICE: 'SERVICE' } as const;
export type ProductKind = (typeof ProductKind)[keyof typeof ProductKind];
export const PRODUCT_KINDS = values(ProductKind);

export const PaymentMethod = {
  CASH: 'CASH',
  PIX: 'PIX',
  CREDIT_CARD: 'CREDIT_CARD',
  DEBIT_CARD: 'DEBIT_CARD',
  BANK_TRANSFER: 'BANK_TRANSFER',
  OTHER: 'OTHER',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];
export const PAYMENT_METHODS = values(PaymentMethod);
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Dinheiro',
  PIX: 'Pix',
  CREDIT_CARD: 'Cartão de crédito',
  DEBIT_CARD: 'Cartão de débito',
  BANK_TRANSFER: 'Transferência',
  OTHER: 'Outro',
};

export const StockMovementType = {
  RECEIPT: 'RECEIPT',
  SALE: 'SALE',
  SALE_CANCEL: 'SALE_CANCEL',
  OS_CONSUMPTION: 'OS_CONSUMPTION',
  OS_CONSUMPTION_REVERSAL: 'OS_CONSUMPTION_REVERSAL',
  RETURN: 'RETURN',
  TRANSFER_OUT: 'TRANSFER_OUT',
  TRANSFER_IN: 'TRANSFER_IN',
  ADJUSTMENT: 'ADJUSTMENT',
  LOSS: 'LOSS',
  RESERVE: 'RESERVE',
  RELEASE: 'RELEASE',
} as const;
export type StockMovementType = (typeof StockMovementType)[keyof typeof StockMovementType];

export const CashMovementType = {
  OPENING: 'OPENING',
  PAYMENT_IN: 'PAYMENT_IN',
  SUPPLY: 'SUPPLY',
  WITHDRAWAL: 'WITHDRAWAL',
  REFUND_OUT: 'REFUND_OUT',
  CHANGE_OUT: 'CHANGE_OUT',
} as const;
export type CashMovementType = (typeof CashMovementType)[keyof typeof CashMovementType];

export const SubscriptionStatus = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  SUSPENDED: 'SUSPENDED',
  CANCEL_AT_PERIOD_END: 'CANCEL_AT_PERIOD_END',
  CANCELED: 'CANCELED',
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];
export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  PENDING_PAYMENT: 'Aguardando pagamento',
  ACTIVE: 'Ativa',
  PAST_DUE: 'Em atraso (tolerância)',
  SUSPENDED: 'Suspensa',
  CANCEL_AT_PERIOD_END: 'Cancelamento agendado',
  CANCELED: 'Cancelada',
};

export const InvoiceStatus = {
  DRAFT: 'DRAFT',
  OPEN: 'OPEN',
  PENDING: 'PENDING',
  PAID: 'PAID',
  EXPIRED: 'EXPIRED',
  VOID: 'VOID',
  REFUNDED: 'REFUNDED',
  CHARGEBACK: 'CHARGEBACK',
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: 'Rascunho',
  OPEN: 'Em aberto',
  PENDING: 'Pagamento em processamento',
  PAID: 'Paga',
  EXPIRED: 'Expirada',
  VOID: 'Anulada',
  REFUNDED: 'Estornada',
  CHARGEBACK: 'Contestação (chargeback)',
};

export const BillingPaymentStatus = {
  CREATED: 'CREATED',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELED: 'CANCELED',
  REFUNDED: 'REFUNDED',
  CHARGEBACK: 'CHARGEBACK',
} as const;
export type BillingPaymentStatus = (typeof BillingPaymentStatus)[keyof typeof BillingPaymentStatus];

export const PaymentMode = { CARD_RECURRING: 'CARD_RECURRING', PIX_MANUAL: 'PIX_MANUAL' } as const;
export type PaymentMode = (typeof PaymentMode)[keyof typeof PaymentMode];

export const MessagingChannelStatus = {
  NOT_CONNECTED: 'NOT_CONNECTED',
  ONBOARDING: 'ONBOARDING',
  CONNECTED_BILLING_PENDING: 'CONNECTED_BILLING_PENDING',
  BILLING_REVIEW_REQUIRED: 'BILLING_REVIEW_REQUIRED',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  ERROR: 'ERROR',
  DISCONNECTED: 'DISCONNECTED',
} as const;
export type MessagingChannelStatus = (typeof MessagingChannelStatus)[keyof typeof MessagingChannelStatus];
export const MESSAGING_STATUS_LABELS: Record<MessagingChannelStatus, string> = {
  NOT_CONNECTED: 'Não conectado',
  ONBOARDING: 'Em conexão',
  CONNECTED_BILLING_PENDING: 'Conectado — faturamento pendente',
  BILLING_REVIEW_REQUIRED: 'Revisão de faturamento necessária',
  ACTIVE: 'Ativo',
  SUSPENDED: 'Suspenso',
  ERROR: 'Erro',
  DISCONNECTED: 'Desconectado',
};

export const MessagingEventType = {
  OS_RECEIVED: 'OS_RECEIVED',
  OS_DIAGNOSIS_STARTED: 'OS_DIAGNOSIS_STARTED',
  QUOTE_AVAILABLE: 'QUOTE_AVAILABLE',
  QUOTE_APPROVED: 'QUOTE_APPROVED',
  OS_WAITING_PARTS: 'OS_WAITING_PARTS',
  OS_REPAIR_STARTED: 'OS_REPAIR_STARTED',
  OS_READY: 'OS_READY',
  OS_DELIVERED: 'OS_DELIVERED',
  WARRANTY_UPDATE: 'WARRANTY_UPDATE',
} as const;
export type MessagingEventType = (typeof MessagingEventType)[keyof typeof MessagingEventType];
export const MESSAGING_EVENT_TYPES = values(MessagingEventType);
export const MESSAGING_EVENT_LABELS: Record<MessagingEventType, string> = {
  OS_RECEIVED: 'OS recebida',
  OS_DIAGNOSIS_STARTED: 'Diagnóstico iniciado',
  QUOTE_AVAILABLE: 'Orçamento disponível',
  QUOTE_APPROVED: 'Orçamento aprovado',
  OS_WAITING_PARTS: 'Aguardando peça',
  OS_REPAIR_STARTED: 'Reparo iniciado',
  OS_READY: 'Pronto para retirada',
  OS_DELIVERED: 'Entregue',
  WARRANTY_UPDATE: 'Atualização de garantia',
};

/** Variáveis permitidas nos templates de mensagem — nunca IMEI, senha ou laudo interno. */
export const MESSAGE_TEMPLATE_VARIABLES = [
  'cliente_nome',
  'os_numero',
  'aparelho',
  'empresa_nome',
  'filial_nome',
  'status_publico',
  'link_acompanhamento',
  'valor_orcamento',
  'previsao_entrega',
] as const;
export type MessageTemplateVariable = (typeof MESSAGE_TEMPLATE_VARIABLES)[number];

export const WarrantyClaimStatus = {
  OPEN: 'OPEN',
  IN_ANALYSIS: 'IN_ANALYSIS',
  APPROVED: 'APPROVED',
  DENIED: 'DENIED',
  RESOLVED: 'RESOLVED',
} as const;
export type WarrantyClaimStatus = (typeof WarrantyClaimStatus)[keyof typeof WarrantyClaimStatus];
export const WARRANTY_STATUS_LABELS: Record<WarrantyClaimStatus, string> = {
  OPEN: 'Aberta',
  IN_ANALYSIS: 'Em análise',
  APPROVED: 'Procedente',
  DENIED: 'Negada',
  RESOLVED: 'Resolvida',
};

export const DocumentTemplateType = {
  INTAKE: 'INTAKE',
  RESPONSIBILITY_TERM: 'RESPONSIBILITY_TERM',
  QUOTE: 'QUOTE',
  APPROVAL: 'APPROVAL',
  SALE_RECEIPT: 'SALE_RECEIPT',
  WARRANTY_TERM: 'WARRANTY_TERM',
  PICKUP_RECEIPT: 'PICKUP_RECEIPT',
} as const;
export type DocumentTemplateType = (typeof DocumentTemplateType)[keyof typeof DocumentTemplateType];
export const DOCUMENT_TEMPLATE_TYPES = values(DocumentTemplateType);
export const DOCUMENT_TEMPLATE_LABELS: Record<DocumentTemplateType, string> = {
  INTAKE: 'Ficha de entrada',
  RESPONSIBILITY_TERM: 'Termo de responsabilidade',
  QUOTE: 'Orçamento',
  APPROVAL: 'Aprovação de orçamento',
  SALE_RECEIPT: 'Comprovante de venda (não fiscal)',
  WARRANTY_TERM: 'Termo de garantia',
  PICKUP_RECEIPT: 'Recibo de retirada',
};

export const FileType = {
  PHOTO_INTAKE: 'PHOTO_INTAKE',
  PHOTO_DIAGNOSIS: 'PHOTO_DIAGNOSIS',
  PHOTO_REPAIR: 'PHOTO_REPAIR',
  PHOTO_WARRANTY: 'PHOTO_WARRANTY',
  DOCUMENT: 'DOCUMENT',
  SIGNATURE: 'SIGNATURE',
} as const;
export type FileType = (typeof FileType)[keyof typeof FileType];
export const FILE_TYPES = values(FileType);

export const ConsentChannel = { WHATSAPP: 'WHATSAPP', EMAIL: 'EMAIL', SMS: 'SMS' } as const;
export type ConsentChannel = (typeof ConsentChannel)[keyof typeof ConsentChannel];
export const ConsentPurpose = { SERVICE_NOTIFICATIONS: 'SERVICE_NOTIFICATIONS', MARKETING: 'MARKETING' } as const;
export type ConsentPurpose = (typeof ConsentPurpose)[keyof typeof ConsentPurpose];

export const ChecklistPhase = { INTAKE: 'INTAKE', POST_REPAIR: 'POST_REPAIR' } as const;
export type ChecklistPhase = (typeof ChecklistPhase)[keyof typeof ChecklistPhase];

export const ReportType = {
  OVERVIEW: 'overview',
  SERVICE_ORDERS: 'service-orders',
  TECHNICIANS: 'technicians',
  SALES: 'sales',
  STOCK: 'stock',
  CASH: 'cash',
  WARRANTIES: 'warranties',
} as const;
export type ReportType = (typeof ReportType)[keyof typeof ReportType];
export const REPORT_TYPES = values(ReportType);
