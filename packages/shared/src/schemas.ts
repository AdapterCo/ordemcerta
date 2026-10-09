import { z } from 'zod';
import {
  ACCESSORY_TYPES,
  DOCUMENT_TEMPLATE_TYPES,
  MESSAGING_EVENT_TYPES,
  PAYMENT_METHODS,
  PRIORITIES,
  PRODUCT_KINDS,
  QUOTE_LINE_KINDS,
  REPORT_TYPES,
  TECHNICAL_STATUSES,
  TENANT_ROLES,
} from './enums';
import { isValidIMEI, normalizeDocument, normalizePhoneE164 } from './br';
import { PLAN_CODES } from './plans';

/* ------------------------------------------------------------------ comuns */

export const uuid = z.string().uuid();
export const cents = z.number().int().min(0).max(1_000_000_000);
export const positiveCents = z.number().int().positive().max(1_000_000_000);
const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const phoneSchema = z
  .string()
  .trim()
  .min(8)
  .max(30)
  .transform((v, ctx) => {
    const n = normalizePhoneE164(v);
    if (!n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Telefone inválido' });
      return z.NEVER;
    }
    return n;
  });

export const optionalPhoneSchema = z
  .string()
  .trim()
  .max(30)
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (!v) return null;
    const n = normalizePhoneE164(v);
    if (!n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Telefone inválido' });
      return z.NEVER;
    }
    return n;
  });

export const documentSchema = z
  .string()
  .trim()
  .max(20)
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (!v) return null;
    const n = normalizeDocument(v);
    if (!n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'CPF/CNPJ inválido' });
      return z.NEVER;
    }
    return n.value;
  });

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const optionalEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.string().email().safeParse(v).success, 'E-mail inválido');

export const passwordSchema = z
  .string()
  .min(10, 'A senha deve ter ao menos 10 caracteres')
  .max(128)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Use letras e números');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const versionSchema = z.object({ version: z.number().int().min(0) });

export const addressSchema = z
  .object({
    street: z.string().trim().max(200).optional(),
    number: z.string().trim().max(20).optional(),
    complement: z.string().trim().max(100).optional(),
    district: z.string().trim().max(100).optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(2).optional(),
    zip: z.string().trim().max(10).optional(),
  })
  .partial();

export const timezoneSchema = z
  .string()
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('pt-BR', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Fuso horário inválido');

/* -------------------------------------------------------------------- auth */

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const mfaVerifySchema = z.object({
  mfaToken: z.string().min(10).max(2000),
  code: z.string().regex(/^\d{6}$/, 'Código de 6 dígitos'),
});

export const mfaEnableSchema = z.object({ code: z.string().regex(/^\d{6}$/) });

export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });
export const switchTenantSchema = z.object({ tenantId: uuid });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema });

/** Troca obrigatória da senha provisória no primeiro login (token da etapa de login). */
export const firstPasswordSchema = z.object({ mfaToken: z.string().min(10).max(2000), newPassword: passwordSchema });

/* ------------------------------------------------------------ signup/billing */

export const signupSchema = z.object({
  planCode: z.enum(PLAN_CODES),
  companyName: trimmed(160),
  companyDocument: documentSchema,
  ownerName: trimmed(120),
  email: emailSchema,
  password: passwordSchema,
  phone: phoneSchema,
  paymentMode: z.enum(['CARD_RECURRING', 'PIX_MANUAL']),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'É necessário aceitar os termos de uso' }) }),
  acceptPrivacy: z.literal(true, { errorMap: () => ({ message: 'É necessário aceitar a política de privacidade' }) }),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const changePlanSchema = z.object({ planCode: z.enum(PLAN_CODES) });
export const checkoutPixSchema = z.object({ invoiceId: uuid.optional() });
export const checkoutCardSchema = z.object({ invoiceId: uuid.optional() });

/* ------------------------------------------------------------------ tenant */

export const updateTenantSchema = z.object({
  name: trimmed(160).optional(),
  legalName: optionalText(200),
  document: documentSchema,
  timezone: timezoneSchema.optional(),
  phone: optionalPhoneSchema,
  email: optionalEmailSchema,
  address: addressSchema.optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .nullable(),
});

export const branchSchema = z.object({
  name: trimmed(120),
  phone: optionalPhoneSchema,
  timezone: timezoneSchema.default('America/Sao_Paulo'),
  address: addressSchema.optional(),
  businessHours: z.record(z.string(), z.string().max(40)).optional(),
});
export const updateBranchSchema = branchSchema.partial().extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() });

/** Cadastro direto de funcionário. Sem senha = o sistema gera uma provisória (exibida uma única vez). */
export const createMemberSchema = z.object({
  name: trimmed(120),
  email: emailSchema,
  password: passwordSchema.optional(),
  role: z.enum(TENANT_ROLES).refine((r) => r !== 'TENANT_OWNER', 'Use transferência de propriedade'),
  branchIds: z.array(uuid).max(50).default([]),
  technicianBranchIds: z.array(uuid).max(50).default([]),
});
export const resetMemberPasswordSchema = z.object({ password: passwordSchema.optional() });
export const updateMemberSchema = z.object({
  role: z.enum(TENANT_ROLES).optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  branchIds: z.array(uuid).max(50).optional(),
  technicianBranchIds: z.array(uuid).max(50).optional(),
});
export const transferOwnershipSchema = z.object({ membershipId: uuid, password: z.string().min(1).max(128) });

export const settingSchema = z.object({
  key: z.string().regex(/^[a-z0-9_.]{2,80}$/),
  value: z.unknown(),
  branchId: uuid.optional().nullable(),
});

export const documentTemplateSchema = z.object({
  type: z.enum(DOCUMENT_TEMPLATE_TYPES),
  content: z.string().min(1).max(20000),
});

/* ---------------------------------------------------------------- clientes */

export const customerSchema = z.object({
  name: trimmed(160),
  phone: phoneSchema,
  whatsapp: optionalPhoneSchema,
  email: optionalEmailSchema,
  document: documentSchema,
  address: addressSchema.optional(),
  notes: optionalText(2000),
  consentWhatsapp: z.boolean().optional(),
});
export type CustomerInput = z.infer<typeof customerSchema>;
export const updateCustomerSchema = customerSchema.partial();

export const customerQuerySchema = paginationSchema.extend({ q: z.string().trim().max(100).optional() });

export const imeiSchema = z
  .string()
  .trim()
  .max(20)
  .optional()
  .nullable()
  .transform((v) => (v ? v.replace(/\s/g, '') : null))
  .refine((v) => v === null || isValidIMEI(v), 'IMEI inválido (15 dígitos)');

export const deviceSchema = z.object({
  brand: trimmed(60),
  model: trimmed(80),
  color: optionalText(40),
  imei: imeiSchema,
  serial: optionalText(60),
  notes: optionalText(1000),
});
export type DeviceInput = z.infer<typeof deviceSchema>;

export const consentSchema = z.object({
  channel: z.enum(['WHATSAPP', 'EMAIL', 'SMS']),
  purpose: z.enum(['SERVICE_NOTIFICATIONS', 'MARKETING']),
  granted: z.boolean(),
  source: z.string().trim().max(60).default('balcao'),
});

/* ------------------------------------------------------- ordens de serviço */

export const checklistItemSchema = z.object({
  key: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(120),
  ok: z.boolean().nullable(),
  notes: z.string().trim().max(300).optional(),
});

export const accessorySchema = z.object({
  type: z.enum(ACCESSORY_TYPES),
  description: z.string().trim().max(200).optional(),
  received: z.boolean().default(true),
});

export const createServiceOrderSchema = z.object({
  branchId: uuid,
  customerId: uuid,
  deviceId: uuid.optional(),
  device: deviceSchema.optional(),
  category: z.enum(['DIAGNOSIS', 'REPAIR']).default('REPAIR'),
  reportedIssue: trimmed(2000),
  priority: z.enum(PRIORITIES).default('NORMAL'),
  estimatedDeliveryAt: z.coerce.date().optional().nullable(),
  accessories: z.array(accessorySchema).max(20).default([]),
  intakeChecklist: z.array(checklistItemSchema).max(60).default([]),
  notes: optionalText(2000),
  requiresApproval: z.boolean().default(true),
  diagnosisFeeCents: cents.default(0),
  technicianUserId: uuid.optional().nullable(),
  /** Senha/padrão de desbloqueio: opcional, criptografado, com expiração; nunca vai a PDF/WhatsApp/logs. */
  unlockSecret: z.string().max(100).optional().nullable(),
}).refine((v) => v.deviceId || v.device, { message: 'Informe o aparelho', path: ['deviceId'] });
export type CreateServiceOrderInput = z.infer<typeof createServiceOrderSchema>;

export const updateServiceOrderSchema = versionSchema.extend({
  priority: z.enum(PRIORITIES).optional(),
  estimatedDeliveryAt: z.coerce.date().optional().nullable(),
  reportedIssue: trimmed(2000).optional(),
});

export const serviceOrderQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  status: z.union([z.enum(TECHNICAL_STATUSES), z.array(z.enum(TECHNICAL_STATUSES))]).optional(),
  branchId: uuid.optional(),
  technicianId: uuid.optional(),
  customerId: uuid.optional(),
  deliveryStatus: z.enum(['IN_CUSTODY', 'READY_FOR_PICKUP', 'DELIVERED', 'RETURNED_UNREPAIRED']).optional(),
  paymentStatus: z.enum(['UNBILLED', 'UNPAID', 'PARTIALLY_PAID', 'PAID', 'REFUNDED', 'PARTIALLY_REFUNDED']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  overdue: z.coerce.boolean().optional(),
  sort: z.enum(['createdAt', '-createdAt', 'priority', 'estimatedDeliveryAt', 'number', '-number']).default('-createdAt'),
});

export const assignSchema = versionSchema.extend({ technicianUserId: uuid });
export const transitionSchema = versionSchema.extend({ notes: z.string().trim().max(2000).optional() });
export const submitDiagnosisSchema = versionSchema.extend({
  diagnosis: trimmed(4000),
  technicalReport: optionalText(8000),
  /** Orçamento previamente aprovado pela política: DIAGNOSING -> APPROVED. */
  preApproved: z.boolean().default(false),
});
export const completeRepairSchema = versionSchema.extend({
  checklist: z.array(checklistItemSchema).min(1).max(60),
  technicalReport: optionalText(8000),
  warrantyDays: z.number().int().min(0).max(3650).optional(),
});
export const deliverSchema = versionSchema.extend({
  receivedByName: trimmed(120),
  receivedByDocument: optionalText(20),
  signaturePng: z
    .string()
    .max(500_000)
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/)
    .optional(),
  overrideUnpaid: z.boolean().default(false),
  overrideReason: z.string().trim().max(500).optional(),
});
export const cancelSchema = versionSchema.extend({ reason: trimmed(500) });
export const reopenSchema = versionSchema.extend({ reason: trimmed(500) });
export const checklistSchema = z.object({ phase: z.enum(['INTAKE', 'POST_REPAIR']), items: z.array(checklistItemSchema).min(1).max(60) });
export const noteSchema = z.object({ text: trimmed(4000), visibility: z.enum(['INTERNAL', 'CUSTOMER']).default('INTERNAL') });
export const intakeSignatureSchema = z.object({
  signerName: trimmed(120),
  signerDocument: optionalText(20),
  signaturePng: z.string().max(500_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/),
  accepted: z.literal(true),
});

/* --------------------------------------------------------------- orçamentos */

export const quoteLineSchema = z.object({
  kind: z.enum(QUOTE_LINE_KINDS),
  productId: uuid.optional().nullable(),
  description: trimmed(300),
  qty: z.number().int().positive().max(10_000),
  unitPriceCents: cents,
  unitCostCents: cents.default(0),
  discountCents: cents.default(0),
  warrantyDays: z.number().int().min(0).max(3650).default(90),
});
export const createQuoteSchema = z.object({
  lines: z.array(quoteLineSchema).min(1).max(100),
  discountCents: cents.default(0),
  validDays: z.number().int().min(1).max(60).default(7),
  estimatedDays: z.number().int().min(0).max(365).optional(),
  notes: optionalText(2000),
});
export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;
export const manualApproveQuoteSchema = z.object({
  customerName: trimmed(120),
  method: z.enum(['IN_PERSON', 'PHONE']),
  notes: optionalText(1000),
});
export const rejectQuoteSchema = z.object({ reason: trimmed(500) });

/* ------------------------------------------------------------ portal público */

export const publicLookupSchema = z.object({ orderNumber: z.coerce.number().int().positive(), token: z.string().min(16).max(128) });
export const publicTokenSchema = z.object({ token: z.string().min(16).max(128) });
export const publicOtpRequestSchema = z.object({ token: z.string().min(16).max(128), quoteId: uuid });
export const publicQuoteDecisionSchema = z.object({
  token: z.string().min(16).max(128),
  otpCode: z.string().regex(/^\d{6}$/).optional(),
  signerName: trimmed(120),
  acceptText: z.string().max(2000),
  reason: z.string().trim().max(500).optional(),
});

/* ------------------------------------------------------- catálogo e estoque */

export const categorySchema = z.object({ name: trimmed(80) });
export const supplierSchema = z.object({
  name: trimmed(160),
  document: documentSchema,
  phone: optionalPhoneSchema,
  email: optionalEmailSchema,
  contactName: optionalText(120),
  notes: optionalText(1000),
});

export const productSchema = z.object({
  sku: z.string().trim().min(1).max(60),
  barcode: optionalText(60),
  name: trimmed(160),
  description: optionalText(2000),
  categoryId: uuid.optional().nullable(),
  supplierId: uuid.optional().nullable(),
  kind: z.enum(PRODUCT_KINDS).default('PRODUCT'),
  unit: z.string().trim().max(10).default('UN'),
  costCents: cents.default(0),
  priceCents: cents,
  promoPriceCents: cents.optional().nullable(),
  minStock: z.number().int().min(0).max(1_000_000).default(0),
  active: z.boolean().default(true),
  location: optionalText(60),
  compatibility: z.array(z.object({ brand: trimmed(60), model: trimmed(80) })).max(200).default([]),
});
export type ProductInput = z.infer<typeof productSchema>;
export const updateProductSchema = productSchema.partial();
export const productQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  categoryId: uuid.optional(),
  kind: z.enum(PRODUCT_KINDS).optional(),
  active: z.coerce.boolean().optional(),
  barcode: z.string().trim().max(60).optional(),
});

export const stockReceiveSchema = z.object({
  branchId: uuid,
  locationId: uuid.optional(),
  supplierId: uuid.optional().nullable(),
  reference: optionalText(120),
  items: z.array(z.object({ productId: uuid, quantity: z.number().int().positive().max(1_000_000), unitCostCents: cents })).min(1).max(200),
});
export const stockAdjustSchema = z.object({
  branchId: uuid,
  locationId: uuid.optional(),
  productId: uuid,
  quantityDelta: z.number().int().refine((n) => n !== 0, 'Quantidade não pode ser zero'),
  type: z.enum(['ADJUSTMENT', 'LOSS', 'RETURN']).default('ADJUSTMENT'),
  reason: trimmed(300),
  overrideNegative: z.boolean().default(false),
});
export const stockReserveSchema = z.object({ orderId: uuid, productId: uuid, quantity: z.number().int().positive().max(10_000), locationId: uuid.optional() });
export const stockConsumeSchema = z.object({ reservationId: uuid, quantity: z.number().int().positive().max(10_000).optional() });
export const stockReleaseSchema = z.object({ reservationId: uuid, reason: z.string().trim().max(300).optional() });
export const stockTransferSchema = z.object({
  sourceBranchId: uuid,
  destBranchId: uuid,
  notes: optionalText(500),
  lines: z.array(z.object({ productId: uuid, quantity: z.number().int().positive().max(1_000_000) })).min(1).max(200),
}).refine((v) => v.sourceBranchId !== v.destBranchId, { message: 'Origem e destino devem ser diferentes', path: ['destBranchId'] });
export const stockTransferReceiveSchema = z.object({
  notes: optionalText(500),
  lines: z.array(z.object({ lineId: uuid, quantityReceived: z.number().int().min(0).max(1_000_000) })).min(1).max(200),
});
export const stockQuerySchema = paginationSchema.extend({
  branchId: uuid.optional(),
  productId: uuid.optional(),
  belowMin: z.coerce.boolean().optional(),
  q: z.string().trim().max(100).optional(),
});

/* ---------------------------------------------------------- PDV/financeiro */

export const saleItemSchema = z.object({
  productId: uuid,
  qty: z.number().int().positive().max(10_000),
  unitPriceCents: cents.optional(),
  discountCents: cents.default(0),
});
export const createSaleSchema = z.object({
  branchId: uuid,
  customerId: uuid.optional().nullable(),
  orderId: uuid.optional().nullable(),
  items: z.array(saleItemSchema).min(1).max(200),
  discountCents: cents.default(0),
});
export const paymentPartSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amountCents: positiveCents,
  /** Somente dinheiro: valor entregue pelo cliente, para cálculo de troco. */
  tenderedCents: positiveCents.optional(),
  externalReference: z.string().trim().max(120).optional(),
});
export const confirmSaleSchema = z.object({
  cashSessionId: uuid,
  payments: z.array(paymentPartSchema).min(1).max(10),
});
export const cancelSaleSchema = z.object({ reason: trimmed(500) });
export const refundSaleSchema = z.object({
  reason: trimmed(500),
  cashSessionId: uuid,
  method: z.enum(PAYMENT_METHODS),
  items: z.array(z.object({ saleItemId: uuid, qty: z.number().int().positive() })).min(1).max(200),
  returnToStock: z.boolean().default(true),
});

export const createReceivableSchema = z.object({ sourceType: z.literal('SERVICE_ORDER'), sourceId: uuid });
export const createPaymentSchema = z.object({
  branchId: uuid,
  cashSessionId: uuid,
  receivableId: uuid,
  parts: z.array(paymentPartSchema).min(1).max(10),
  notes: optionalText(500),
});
export const refundPaymentSchema = z.object({ amountCents: positiveCents, reason: trimmed(500), cashSessionId: uuid });

export const cashRegisterSchema = z.object({ branchId: uuid, name: trimmed(60) });
export const openCashSchema = z.object({ registerId: uuid, openingFloatCents: cents });
export const cashMovementSchema = z.object({ amountCents: positiveCents, reason: trimmed(300) });
export const closeCashSchema = z.object({
  declared: z.record(z.enum(PAYMENT_METHODS), cents),
  notes: optionalText(1000),
});

/* ---------------------------------------------------------------- mensagens */

export const createChannelSchema = z.object({
  branchId: uuid.optional().nullable(),
  provider: z.enum(['WHATSAPP_CLOUD', 'WHATSAPP_UNOFFICIAL_QR']).default('WHATSAPP_CLOUD'),
  name: trimmed(80),
});
export const completeOnboardingSchema = z.object({
  /** Código retornado pelo Embedded Signup (quando habilitado). */
  code: z.string().max(2000).optional(),
  wabaId: z.string().regex(/^\d{5,30}$/),
  phoneNumberId: z.string().regex(/^\d{5,30}$/),
  /** Conexão assistida: token do sistema do cliente (nunca exibido de volta). */
  accessToken: z.string().min(20).max(1000).optional(),
});
export const billingVerificationSchema = z.object({
  method: z.enum(['API', 'ASSISTED']),
  evidenceNote: trimmed(2000),
  evidenceFileId: uuid.optional(),
  confirmOwnBilling: z.literal(true),
  confirmNoCreditLineSharing: z.literal(true),
  approve: z.boolean().default(false),
});
export const messageTemplateSchema = z.object({
  eventType: z.enum(MESSAGING_EVENT_TYPES),
  name: z.string().regex(/^[a-z0-9_]{1,512}$/, 'Nome do template Meta: minúsculas, números e _'),
  language: z.string().regex(/^[a-z]{2}(_[A-Z]{2})?$/).default('pt_BR'),
  body: z.string().min(1).max(1024),
  variables: z.array(z.string()).max(10).default([]),
  enabled: z.boolean().default(true),
  approvalStatus: z.enum(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED']).default('DRAFT'),
});
export const upsertTemplatesSchema = z.object({ templates: z.array(messageTemplateSchema).max(50) });
export const testMessageSchema = z.object({ channelId: uuid, to: phoneSchema, eventType: z.enum(MESSAGING_EVENT_TYPES) });

/* ---------------------------------------------------------------- garantias */

export const createWarrantyClaimSchema = z.object({
  orderId: uuid,
  originalLineId: uuid.optional().nullable(),
  reason: trimmed(2000),
});
export const updateWarrantyClaimSchema = z.object({
  status: z.enum(['OPEN', 'IN_ANALYSIS', 'APPROVED', 'DENIED', 'RESOLVED']).optional(),
  triageNotes: optionalText(4000),
  resolution: optionalText(4000),
  denialReason: optionalText(2000),
  createReturnOrder: z.boolean().default(false),
});

/* --------------------------------------------------------------- relatórios */

export const reportQuerySchema = z.object({
  branchId: uuid.optional(),
  technicianId: uuid.optional(),
  attendantId: uuid.optional(),
  from: z.coerce.date(),
  to: z.coerce.date(),
});
export const reportExportSchema = z.object({
  reportType: z.enum(REPORT_TYPES),
  format: z.enum(['CSV', 'PDF']),
  params: reportQuerySchema,
});

/* --------------------------------------------------------------- plataforma */

export const platformPlanSchema = z.object({
  code: z.string().regex(/^[A-Z0-9_]{2,40}$/),
  name: trimmed(80),
  priceCents: positiveCents,
  maxBranches: z.number().int().positive().max(1000),
  maxTechniciansPerBranch: z.number().int().positive().max(1000),
  maxCashRegistersPerBranch: z.number().int().positive().max(1000),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
});
export const platformTenantStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  reason: trimmed(500),
});
export const platformSettingSchema = z.object({
  graceDays: z.number().int().min(0).max(30).optional(),
});
export const supportAccessGrantSchema = z.object({
  platformUserEmail: emailSchema,
  reason: trimmed(500),
  hours: z.number().int().min(1).max(72),
});
