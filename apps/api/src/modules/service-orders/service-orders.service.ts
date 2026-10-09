import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type ServiceOrder, type TechnicalStatus } from '@prisma/client';
import { nextCounter, randomToken, sha256Hex, renderPlaceholders, type Tx } from '@ordemcerta/server';
import {
  assignSchema,
  cancelSchema,
  checklistSchema,
  completeRepairSchema,
  createServiceOrderSchema,
  deliverSchema,
  DELIVERABLE_TECHNICAL_STATUSES,
  findTransition,
  formatBRL,
  intakeSignatureSchema,
  noteSchema,
  OPEN_TECHNICAL_STATUSES,
  normalizePhoneE164,
  onlyDigits,
  reopenSchema,
  serviceOrderQuerySchema,
  submitDiagnosisSchema,
  transitionSchema,
  updateServiceOrderSchema,
} from '@ordemcerta/shared';
import type { z } from 'zod';
import { assertBranch, assertCan, auth, branchScope, can, ctx, currentTenantId } from '../../core/context';
import { bumpVersion, TenantDb, type TxHooks } from '../../core/database';
import { ENV, type AppEnv } from '../../core/env.provider';
import { Errors } from '../../core/errors';
import { RealtimeService } from '../../core/realtime.gateway';
import { AuditService, CryptoService, OutboxService } from '../../core/services';
import { SettingsService } from '../../core/settings.service';
import { CustomersService } from '../customers/customers.service';
import { FinanceService } from '../finance/finance.service';
import { StockService } from '../stock/stock.service';
import { documentTemplate, trackingLink } from './order-helpers';
import { OrderSignaturesService } from './order-signatures.service';

type Transition = {
  to: TechnicalStatus;
  action: string;
  eventType: string;
  outbox?: string;
  data?: Prisma.ServiceOrderUncheckedUpdateInput;
  payload?: Record<string, unknown>;
  /** Transições disparadas pelo sistema (ex.: aprovação no portal) não exigem permissão do ator. */
  system?: boolean;
};

const PRIORITY_ORDER: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

@Injectable()
export class ServiceOrdersService {
  constructor(
    private readonly db: TenantDb,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly realtime: RealtimeService,
    private readonly settings: SettingsService,
    private readonly customers: CustomersService,
    private readonly finance: FinanceService,
    private readonly stock: StockService,
    private readonly signatures: OrderSignaturesService,
    @Inject(ENV) private readonly env: AppEnv,
  ) {}

  /* ============================================================ helpers */

  async load(tx: Tx, id: string): Promise<ServiceOrder> {
    const o = await tx.serviceOrder.findFirst({ where: { id, tenantId: currentTenantId() } });
    if (!o) throw Errors.notFound('OS');
    assertBranch(o.branchId);
    return o;
  }

  /** Técnico só atua em OS atribuídas a ele (ou não atribuídas nas filiais em que é técnico). */
  private assertTechnicianScope(o: ServiceOrder) {
    const a = auth();
    if (can('os:assign')) return;
    if (o.assignedTechnicianId === a.userId) return;
    if (!o.assignedTechnicianId && a.technicianBranchIds.includes(o.branchId)) return;
    throw Errors.forbidden('OS atribuída a outro técnico');
  }

  /** Transição com permissão, pré-condição de versão, histórico, auditoria e evento de domínio. */
  async transition(tx: Tx, hooks: TxHooks, o: ServiceOrder, version: number, t: Transition) {
    const rule = findTransition(o.technicalStatus, t.to, t.action);
    if (!rule) throw Errors.invalidTransition(o.technicalStatus, t.to);
    if (!t.system) assertCan(rule.permission);
    await bumpVersion(tx, 'service_orders', o.id, version);
    const updated = await tx.serviceOrder.update({ where: { id: o.id }, data: { technicalStatus: t.to, ...(t.data ?? {}) } });
    const c = ctx();
    await tx.serviceOrderEvent.create({
      data: {
        tenantId: o.tenantId,
        orderId: o.id,
        actorId: c.auth?.userId ?? null,
        actorType: t.system ? 'CUSTOMER' : 'USER',
        eventType: t.eventType,
        fromStatus: o.technicalStatus,
        toStatus: t.to,
        payloadJson: (t.payload ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    await this.audit.log(tx, {
      tenantId: o.tenantId,
      actorType: t.system && !c.auth ? 'CUSTOMER' : undefined,
      action: `os_${t.eventType}`,
      entity: 'service_order',
      entityId: o.id,
      metadata: { from: o.technicalStatus, to: t.to },
    });
    if (t.outbox) {
      await this.outbox.add(tx, hooks, o.tenantId, {
        eventType: t.outbox,
        aggregateType: 'service_order',
        aggregateId: o.id,
        payload: { orderId: o.id, number: o.number, branchId: o.branchId, customerId: o.customerId },
      });
    }
    this.signal(hooks, updated);
    return updated;
  }

  signal(hooks: TxHooks, o: Pick<ServiceOrder, 'id' | 'tenantId' | 'branchId' | 'number' | 'technicalStatus' | 'assignedTechnicianId' | 'priority'>, event = 'os.updated') {
    hooks.afterCommit(() =>
      this.realtime.toBranch(o.tenantId, o.branchId, event, {
        id: o.id,
        number: o.number,
        technicalStatus: o.technicalStatus,
        assignedTechnicianId: o.assignedTechnicianId,
        priority: o.priority,
      }),
    );
  }

  private async assertTechnicianOfBranch(tx: Tx, tenantId: string, branchId: string, userId: string) {
    const ok = await tx.membershipBranch.count({
      where: { tenantId, branchId, isTechnician: true, membership: { userId, status: 'ACTIVE' } },
    });
    if (!ok) throw Errors.validation('Usuário não é técnico ativo desta filial');
  }

  /* ============================================================ consultas */

  list(q: z.infer<typeof serviceOrderQuerySchema>) {
    if (q.branchId) assertBranch(q.branchId);
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const statuses = q.status ? (Array.isArray(q.status) ? q.status : [q.status]) : undefined;
      const where: Prisma.ServiceOrderWhereInput = {
        tenantId,
        branchId: q.branchId ?? branchScope(),
        technicalStatus: statuses ? { in: statuses } : undefined,
        assignedTechnicianId: q.technicianId,
        customerId: q.customerId,
        deliveryStatus: q.deliveryStatus,
        paymentStatus: q.paymentStatus,
        receivedAt: { gte: q.from, lte: q.to },
      };
      if (q.overdue) {
        where.estimatedDeliveryAt = { lt: new Date() };
        where.technicalStatus = { in: [...OPEN_TECHNICAL_STATUSES] };
      }
      const term = q.q?.trim();
      if (term) {
        const or: Prisma.ServiceOrderWhereInput[] = [
          { customer: { name: { contains: term, mode: 'insensitive' } } },
          { device: { model: { contains: term, mode: 'insensitive' } } },
          { device: { brand: { contains: term, mode: 'insensitive' } } },
        ];
        const digits = onlyDigits(term);
        if (/^\d{1,9}$/.test(term)) or.push({ number: Number(term) });
        const phone = normalizePhoneE164(term);
        if (phone) or.push({ customer: { phoneE164: phone } });
        if (digits.length === 15) or.push({ device: { imeiHash: this.crypto.blindIndex(digits) } });
        else if (digits.length === 4) or.push({ device: { imeiLast4: digits } });
        where.OR = or;
      }
      const orderBy: Prisma.ServiceOrderOrderByWithRelationInput[] =
        q.sort === 'priority'
          ? [{ priority: 'desc' }, { receivedAt: 'asc' }]
          : q.sort === 'estimatedDeliveryAt'
            ? [{ estimatedDeliveryAt: 'asc' }]
            : q.sort === 'number'
              ? [{ number: 'asc' }]
              : q.sort === '-number'
                ? [{ number: 'desc' }]
                : q.sort === 'createdAt'
                  ? [{ createdAt: 'asc' }]
                  : [{ createdAt: 'desc' }];
      const [rows, total] = await Promise.all([
        tx.serviceOrder.findMany({
          where,
          orderBy,
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          include: {
            customer: { select: { id: true, name: true, phoneE164: true } },
            device: { select: { id: true, brand: true, model: true, color: true } },
            branch: { select: { id: true, name: true } },
          },
        }),
        tx.serviceOrder.count({ where }),
      ]);
      const techIds = [...new Set(rows.map((r) => r.assignedTechnicianId).filter(Boolean))] as string[];
      const techs = techIds.length
        ? await tx.tenantMembership.findMany({ where: { tenantId, userId: { in: techIds } }, select: { userId: true, user: { select: { name: true } } } })
        : [];
      const names = new Map(techs.map((t) => [t.userId, t.user.name]));
      const items = rows.map((r) => ({ ...r, technicianName: r.assignedTechnicianId ? (names.get(r.assignedTechnicianId) ?? null) : null }));
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  /** Fila técnica: OS abertas da(s) filial(is), ordenadas por prioridade e SLA. */
  queue(branchId?: string, mine = false) {
    if (branchId) assertBranch(branchId);
    return this.db.run(async (tx) => {
      const a = auth();
      const rows = await tx.serviceOrder.findMany({
        where: {
          tenantId: currentTenantId(),
          branchId: branchId ?? branchScope(),
          technicalStatus: { in: ['RECEIVED', 'WAITING_DIAGNOSIS', 'DIAGNOSING', 'WAITING_QUOTE_APPROVAL', 'APPROVED', 'WAITING_PARTS', 'IN_REPAIR', 'TESTING', 'REOPENED'] },
          ...(mine ? { assignedTechnicianId: a.userId } : {}),
        },
        include: { customer: { select: { name: true } }, device: { select: { brand: true, model: true } }, branch: { select: { name: true } } },
        take: 500,
      });
      return rows
        .sort(
          (x, y) =>
            (PRIORITY_ORDER[x.priority] ?? 9) - (PRIORITY_ORDER[y.priority] ?? 9) ||
            (x.slaDueAt?.getTime() ?? Infinity) - (y.slaDueAt?.getTime() ?? Infinity) ||
            x.receivedAt.getTime() - y.receivedAt.getTime(),
        )
        .map((r) => ({ ...r, slaBreached: r.slaDueAt ? r.slaDueAt.getTime() < Date.now() : false }));
    });
  }

  get(id: string) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const o = await tx.serviceOrder.findFirst({
        where: { id, tenantId },
        include: {
          customer: { select: { id: true, name: true, phoneE164: true, whatsappE164: true, email: true, document: true } },
          device: true,
          branch: { select: { id: true, name: true, timezone: true } },
          accessories: true,
          checklists: { orderBy: { completedAt: 'desc' } },
          notes: { orderBy: { createdAt: 'desc' } },
          terms: { orderBy: { acceptedAt: 'desc' } },
          quotes: { include: { lines: { orderBy: { position: 'asc' } } }, orderBy: { version: 'desc' } },
          reservations: { include: { product: { select: { name: true, sku: true } } }, orderBy: { createdAt: 'desc' } },
          pickupReceipt: true,
          warrantyClaims: true,
          unlockSecrets: { where: { purgedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, expiresAt: true } },
        },
      });
      if (!o) throw Errors.notFound('OS');
      assertBranch(o.branchId);
      const userIds = [o.createdBy, o.assignedTechnicianId, ...o.notes.map((n) => n.authorId)].filter(Boolean) as string[];
      const users = await tx.tenantMembership.findMany({ where: { tenantId, userId: { in: [...new Set(userIds)] } }, select: { userId: true, user: { select: { name: true } } } });
      const names = Object.fromEntries(users.map((u) => [u.userId, u.user.name]));
      const receivable = await tx.receivable.findUnique({ where: { tenantId_sourceType_sourceId: { tenantId, sourceType: 'SERVICE_ORDER', sourceId: id } } });
      const { unlockSecrets, notes, ...rest } = o;
      return {
        ...rest,
        device: this.customers.deviceView(o.device),
        notes: can('os:internal_notes') ? notes : notes.filter((n) => n.visibility === 'CUSTOMER'),
        hasUnlockSecret: unlockSecrets.length > 0,
        receivable: receivable ? { ...receivable, outstandingCents: this.finance.outstanding(receivable) } : null,
        userNames: names,
      };
    });
  }

  history(id: string) {
    return this.db.run(async (tx) => {
      const o = await this.load(tx, id);
      const events = await tx.serviceOrderEvent.findMany({ where: { tenantId: o.tenantId, orderId: id }, orderBy: { createdAt: 'asc' } });
      const ids = [...new Set(events.map((e) => e.actorId).filter(Boolean))] as string[];
      const users = await tx.tenantMembership.findMany({ where: { tenantId: o.tenantId, userId: { in: ids } }, select: { userId: true, user: { select: { name: true } } } });
      const names = new Map(users.map((u) => [u.userId, u.user.name]));
      return events.map((e) => ({ ...e, actorName: e.actorId ? (names.get(e.actorId) ?? null) : e.actorType === 'CUSTOMER' ? 'Cliente (portal)' : 'Sistema' }));
    });
  }

  /* ============================================================ recepção */

  create(input: z.infer<typeof createServiceOrderSchema>) {
    assertBranch(input.branchId);
    return this.db.run(async (tx, hooks) => {
      const tenantId = currentTenantId();
      const a = auth();
      const branch = await tx.branch.findFirst({ where: { id: input.branchId, tenantId, status: 'ACTIVE' } });
      if (!branch) throw Errors.validation('Filial inválida ou inativa');
      const customer = await tx.customer.findFirst({ where: { id: input.customerId, tenantId, anonymizedAt: null } });
      if (!customer) throw Errors.notFound('Cliente');

      let deviceId = input.deviceId;
      if (deviceId) {
        const d = await tx.device.findFirst({ where: { id: deviceId, tenantId, customerId: customer.id } });
        if (!d) throw Errors.validation('Aparelho não pertence ao cliente');
      } else {
        deviceId = (await this.customers.createDeviceTx(tx, tenantId, customer.id, input.device!)).id;
      }

      if (input.technicianUserId) {
        assertCan('os:assign');
        await this.assertTechnicianOfBranch(tx, tenantId, input.branchId, input.technicianUserId);
      }
      if (!input.requiresApproval) assertCan('os:approve_override');

      const now = new Date();
      const slaHours = await this.settings.get(tx, tenantId, 'os.sla_hours', input.branchId);
      const number = await nextCounter(tx, tenantId, 'service_order');
      const order = await tx.serviceOrder.create({
        data: {
          tenantId,
          branchId: input.branchId,
          number,
          customerId: customer.id,
          deviceId,
          createdBy: a.userId,
          assignedTechnicianId: input.technicianUserId ?? null,
          category: input.category,
          technicalStatus: input.technicianUserId ? 'WAITING_DIAGNOSIS' : 'RECEIVED',
          priority: input.priority,
          reportedIssue: input.reportedIssue,
          requiresApproval: input.requiresApproval,
          diagnosisFeeCents: input.diagnosisFeeCents,
          estimatedDeliveryAt: input.estimatedDeliveryAt ?? null,
          slaDueAt: new Date(now.getTime() + slaHours * 3600_000),
          receivedAt: now,
        },
      });
      if (input.accessories.length) {
        await tx.serviceOrderAccessory.createMany({
          data: input.accessories.map((x) => ({ tenantId, orderId: order.id, type: x.type, description: x.description ?? null, received: x.received })),
        });
      }
      if (input.intakeChecklist.length) {
        await tx.serviceOrderChecklist.create({
          data: { tenantId, orderId: order.id, phase: 'INTAKE', itemsJson: input.intakeChecklist as Prisma.InputJsonValue, completedBy: a.userId },
        });
      }
      if (input.notes) await tx.serviceOrderNote.create({ data: { tenantId, orderId: order.id, authorId: a.userId, visibility: 'INTERNAL', text: input.notes } });
      if (input.unlockSecret) {
        const ttl = await this.settings.get(tx, tenantId, 'os.unlock_secret_ttl_days', input.branchId);
        await tx.deviceUnlockSecret.create({
          data: { tenantId, orderId: order.id, secretEncrypted: this.crypto.encrypt(input.unlockSecret), expiresAt: new Date(now.getTime() + ttl * 86_400_000), createdBy: a.userId },
        });
      }
      const token = randomToken(24);
      const ttlDays = await this.settings.get(tx, tenantId, 'portal.token_ttl_days');
      await tx.publicTrackingToken.create({
        data: { tenantId, orderId: order.id, tokenHash: sha256Hex(token), expiresAt: new Date(now.getTime() + ttlDays * 86_400_000), createdBy: a.userId },
      });
      await tx.serviceOrderEvent.create({
        data: { tenantId, orderId: order.id, actorId: a.userId, eventType: 'created', toStatus: order.technicalStatus, payloadJson: { priority: order.priority, category: order.category } },
      });
      if (input.diagnosisFeeCents > 0) {
        await tx.serviceOrderEvent.create({ data: { tenantId, orderId: order.id, actorId: a.userId, eventType: 'diagnosis_fee_informed', payloadJson: { feeCents: input.diagnosisFeeCents } } });
      }
      await this.audit.log(tx, { action: 'os_created', entity: 'service_order', entityId: order.id, metadata: { number } });
      await this.outbox.add(tx, hooks, tenantId, {
        eventType: 'os.created',
        aggregateType: 'service_order',
        aggregateId: order.id,
        payload: { orderId: order.id, number, branchId: order.branchId, customerId: customer.id, trackingTokenEnc: this.crypto.encrypt(token) },
      });
      this.signal(hooks, order, 'os.created');
      return { order, trackingToken: token, trackingUrl: trackingLink(this.env.APP_URL, number, token) };
    });
  }

  /** OS de retorno em garantia vinculada à original (que nunca é apagada). */
  async createWarrantyReturn(tx: Tx, hooks: TxHooks, original: ServiceOrder, reason: string) {
    const a = auth();
    const now = new Date();
    const number = await nextCounter(tx, original.tenantId, 'service_order');
    const slaHours = await this.settings.get(tx, original.tenantId, 'os.sla_hours', original.branchId);
    const order = await tx.serviceOrder.create({
      data: {
        tenantId: original.tenantId,
        branchId: original.branchId,
        number,
        customerId: original.customerId,
        deviceId: original.deviceId,
        createdBy: a.userId,
        category: 'REPAIR',
        technicalStatus: 'RECEIVED',
        priority: 'HIGH',
        reportedIssue: `Retorno em garantia da OS ${original.number}: ${reason}`,
        requiresApproval: false,
        diagnosisFeeCents: 0,
        warrantyOfOrderId: original.id,
        slaDueAt: new Date(now.getTime() + slaHours * 3600_000),
        receivedAt: now,
      },
    });
    const token = randomToken(24);
    const ttlDays = await this.settings.get(tx, original.tenantId, 'portal.token_ttl_days');
    await tx.publicTrackingToken.create({
      data: { tenantId: original.tenantId, orderId: order.id, tokenHash: sha256Hex(token), expiresAt: new Date(now.getTime() + ttlDays * 86_400_000), createdBy: a.userId },
    });
    await tx.serviceOrderEvent.create({
      data: { tenantId: original.tenantId, orderId: order.id, actorId: a.userId, eventType: 'created_warranty_return', toStatus: 'RECEIVED', payloadJson: { originalOrderId: original.id } },
    });
    await tx.serviceOrderEvent.create({
      data: { tenantId: original.tenantId, orderId: original.id, actorId: a.userId, eventType: 'warranty_return_opened', payloadJson: { returnOrderId: order.id, number } },
    });
    await this.outbox.add(tx, hooks, original.tenantId, {
      eventType: 'os.created',
      aggregateType: 'service_order',
      aggregateId: order.id,
      payload: { orderId: order.id, number, branchId: order.branchId, customerId: order.customerId, trackingTokenEnc: this.crypto.encrypt(token) },
    });
    this.signal(hooks, order, 'os.created');
    return { order, trackingUrl: trackingLink(this.env.APP_URL, number, token) };
  }

  update(id: string, input: z.infer<typeof updateServiceOrderSchema>) {
    return this.db.run(async (tx, hooks) => {
      const o = await this.load(tx, id);
      if (o.deliveryStatus === 'DELIVERED') throw Errors.precondition('OS entregue não pode ser editada; use reabertura');
      await bumpVersion(tx, 'service_orders', id, input.version);
      const data: Prisma.ServiceOrderUpdateInput = {};
      if (input.priority) data.priority = input.priority;
      if (input.estimatedDeliveryAt !== undefined) data.estimatedDeliveryAt = input.estimatedDeliveryAt;
      if (input.reportedIssue) data.reportedIssue = input.reportedIssue;
      const u = await tx.serviceOrder.update({ where: { id }, data });
      await tx.serviceOrderEvent.create({ data: { tenantId: o.tenantId, orderId: id, actorId: auth().userId, eventType: 'updated', payloadJson: { fields: Object.keys(data) } } });
      await this.audit.log(tx, { action: 'os_updated', entity: 'service_order', entityId: id, metadata: { fields: Object.keys(data) } });
      this.signal(hooks, u);
      return u;
    });
  }

  /** Assinatura de aceite da ficha de entrada com hash do termo e evidências. */
  signIntake(id: string, input: z.infer<typeof intakeSignatureSchema>) {
    return this.db.run(async (tx) => {
      const o = await this.load(tx, id);
      const tenantId = o.tenantId;
      const intake = await documentTemplate(tx, tenantId, 'INTAKE');
      const resp = await documentTemplate(tx, tenantId, 'RESPONSIBILITY_TERM');
      const vars = { taxa_diagnostico: o.diagnosisFeeCents ? formatBRL(o.diagnosisFeeCents) : 'sem taxa', link_consulta: `${this.env.APP_URL}/status` };
      const text = `${renderPlaceholders(intake.content, vars)}\n\n${renderPlaceholders(resp.content, vars)}`;
      const documentHash = sha256Hex(`OS ${o.number}\n${o.reportedIssue}\n${text}`);
      const file = await this.signatures.store(tx, o, input.signaturePng);
      const c = ctx();
      const term = await tx.serviceOrderTerm.create({
        data: {
          tenantId,
          orderId: id,
          termType: 'INTAKE',
          termVersion: Math.max(intake.version, resp.version),
          documentHash,
          acceptedAt: new Date(),
          signerName: input.signerName,
          signerDocument: input.signerDocument,
          signatureFileId: file.id,
          evidenceJson: {
            method: 'assinatura_manuscrita_em_dispositivo',
            collectedBy: auth().userId,
            ipHash: this.crypto.ipHash(c.ip),
            userAgent: c.userAgent?.slice(0, 200) ?? null,
            templateVersions: { INTAKE: intake.version, RESPONSIBILITY_TERM: resp.version },
            note: 'Assinatura eletrônica simples; não equivale automaticamente a assinatura qualificada.',
          },
          createdBy: auth().userId,
        },
      });
      await tx.serviceOrderEvent.create({ data: { tenantId, orderId: id, actorId: auth().userId, eventType: 'intake_signed', payloadJson: { termId: term.id, documentHash } } });
      await this.audit.log(tx, { action: 'os_intake_signed', entity: 'service_order', entityId: id });
      return term;
    });
  }

  reissueTrackingToken(id: string) {
    return this.db.run(async (tx) => {
      const o = await this.load(tx, id);
      await tx.publicTrackingToken.updateMany({ where: { tenantId: o.tenantId, orderId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      const token = randomToken(24);
      const ttlDays = await this.settings.get(tx, o.tenantId, 'portal.token_ttl_days');
      await tx.publicTrackingToken.create({
        data: { tenantId: o.tenantId, orderId: id, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + ttlDays * 86_400_000), createdBy: auth().userId },
      });
      await this.audit.log(tx, { action: 'os_tracking_token_reissued', entity: 'service_order', entityId: id });
      return { trackingToken: token, trackingUrl: trackingLink(this.env.APP_URL, o.number, token) };
    });
  }

  /** Senha de desbloqueio: acesso restrito, auditado, nunca em PDF/WhatsApp/logs. */
  revealUnlockSecret(id: string, reason: string) {
    return this.db.run(async (tx) => {
      const o = await this.load(tx, id);
      this.assertTechnicianScope(o);
      const s = await tx.deviceUnlockSecret.findFirst({ where: { tenantId: o.tenantId, orderId: id, purgedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
      if (!s?.secretEncrypted) throw Errors.notFound('Senha de desbloqueio (inexistente ou expirada)');
      await this.audit.log(tx, { action: 'unlock_secret_accessed', entity: 'service_order', entityId: id, metadata: { reason } });
      return { secret: this.crypto.decrypt(s.secretEncrypted), expiresAt: s.expiresAt };
    });
  }

  addNote(id: string, input: z.infer<typeof noteSchema>) {
    return this.db.run(async (tx) => {
      const o = await this.load(tx, id);
      if (input.visibility === 'INTERNAL') assertCan('os:internal_notes');
      const n = await tx.serviceOrderNote.create({ data: { tenantId: o.tenantId, orderId: id, authorId: auth().userId, visibility: input.visibility, text: input.text } });
      await tx.serviceOrderEvent.create({ data: { tenantId: o.tenantId, orderId: id, actorId: auth().userId, eventType: 'note_added', payloadJson: { visibility: input.visibility } } });
      return n;
    });
  }

  addChecklist(id: string, input: z.infer<typeof checklistSchema>) {
    return this.db.run(async (tx) => {
      const o = await this.load(tx, id);
      this.assertTechnicianScope(o);
      const c = await tx.serviceOrderChecklist.create({
        data: { tenantId: o.tenantId, orderId: id, phase: input.phase, itemsJson: input.items as Prisma.InputJsonValue, completedBy: auth().userId },
      });
      await tx.serviceOrderEvent.create({ data: { tenantId: o.tenantId, orderId: id, actorId: auth().userId, eventType: 'checklist_recorded', payloadJson: { phase: input.phase } } });
      return c;
    });
  }

  /* ========================================================= painel técnico */

  assign(id: string, input: z.infer<typeof assignSchema>) {
    return this.db.run(async (tx, hooks) => {
      const o = await this.load(tx, id);
      await this.assertTechnicianOfBranch(tx, o.tenantId, o.branchId, input.technicianUserId);
      if (o.technicalStatus === 'RECEIVED') {
        return this.transition(tx, hooks, o, input.version, {
          to: 'WAITING_DIAGNOSIS',
          action: 'assign',
          eventType: 'assigned',
          data: { assignedTechnicianId: input.technicianUserId },
          payload: { technicianUserId: input.technicianUserId },
        });
      }
      if (['READY', 'CANCELED', 'RETURNED_UNREPAIRED'].includes(o.technicalStatus)) throw Errors.precondition('OS finalizada');
      assertCan('os:assign');
      await bumpVersion(tx, 'service_orders', id, input.version);
      const u = await tx.serviceOrder.update({ where: { id }, data: { assignedTechnicianId: input.technicianUserId } });
      await tx.serviceOrderEvent.create({ data: { tenantId: o.tenantId, orderId: id, actorId: auth().userId, eventType: 'reassigned', payloadJson: { from: o.assignedTechnicianId, to: input.technicianUserId } } });
      await this.audit.log(tx, { action: 'os_reassigned', entity: 'service_order', entityId: id });
      this.signal(hooks, u);
      return u;
    });
  }

  accept(id: string, version: number) {
    return this.db.run(async (tx, hooks) => {
      const o = await this.load(tx, id);
      const a = auth();
      if (o.assignedTechnicianId && o.assignedTechnicianId !== a.userId) throw Errors.conflict('OS já atribuída a outro técnico');
      await this.assertTechnicianOfBranch(tx, o.tenantId, o.branchId, a.userId);
      return this.transition(tx, hooks, o, version, { to: 'WAITING_DIAGNOSIS', action: 'accept', eventType: 'accepted', data: { assignedTechnicianId: a.userId } });
    });
  }

  startDiagnosis(id: string, input: z.infer<typeof transitionSchema>) {
    return this.db.run(async (tx, hooks) => {
      const o = await this.load(tx, id);
      this.assertTechnicianScope(o);
      const a = auth();
      const data: Prisma.ServiceOrderUncheckedUpdateInput = { diagnosisStartedAt: o.diagnosisStartedAt ?? new Date() };
      if (!o.assignedTechnicianId && a.technicianBranchIds.includes(o.branchId)) data.assignedTechnicianId = a.userId;
      return this.transition(tx, hooks, o, input.version, {
        to: 'DIAGNOSING',
        action: 'start-diagnosis',
        eventType: 'diagnosis_started',
        outbox: o.technicalStatus === 'WAITING_DIAGNOSIS' ? 'os.diagnosis_started' : undefined,
        data,
        payload: input.notes ? { notes: input.notes } : undefined,
      });
    });
  }

  submitDiagnosis(id: string, input: z.infer<typeof submitDiagnosisSchema>) {
    return this.db.run(async (tx, hooks) => {
      const o = await this.load(tx, id);
      this.assertTechnicianScope(o);
      const data = { diagnosis: input.diagnosis, technicalReport: input.technicalReport ?? o.technicalReport };
      if (input.preApproved) {
        if (o.requiresApproval) assertCan('os:approve_override');
        return this.transition(tx, hooks, o, input.version, {
          to: 'APPROVED',
          action: 'submit-diagnosis',
          eventType: 'diagnosis_submitted_preapproved',
          data,
          payload: { override: o.requiresApproval },
        });
      }
      const quote = await tx.quote.findFirst({ where: { tenantId: o.tenantId, orderId: id, status: { in: ['DRAFT', 'SENT'] } } });
      if (!quote) throw Errors.precondition('Crie o orçamento antes de concluir o diagnóstico');
      return this.transition(tx, hooks, o, input.version, { to: 'WAITING_QUOTE_APPROVAL', action: 'submit-diagnosis', eventType: 'diagnosis_submitted', data });
    });
  }

  requestParts(id: string, input: z.infer<typeof transitionSchema>) {
    return this.db.run(async (tx, hooks) => {
      const o = await this.load(tx, id);
      this.assertTechnicianScope(o);
      return this.transition(tx, hooks, o, input.version, {
        to: 'WAITING_PARTS',
        action: 'request-parts',
        eventType: 'parts_requested',
        outbox: 'os.waiting_parts',
        payload: input.notes ? { notes: input.notes } : undefined,
      });
    });
  }

  partsArrived(id: string, input: z.infer<typeof transitionSchema>) {
    return this.db.run(async (tx, hooks) => {
      const o = await this.load(tx, id);
      this.assertTechnicianScope(o);
      return this.transition(tx, hooks, o, input.version, { to: 'APPROVED', action: 'parts-arrived', eventType: 'parts_arrived' });
    });
  }

  /** Reparo cobrável só com orçamento aprovado quando requires_approval=true. */
  startRepair(id: string, input: z.infer<typeof transitionSchema>) {
    return this.db.run(async (tx, hooks) => {
      const o = await this.load(tx, id);
      this.assertTechnicianScope(o);
      if (o.requiresApproval && !o.approvedQuoteId && !o.warrantyOfOrderId && o.technicalStatus !== 'TESTING') {
        const preapproved = await tx.serviceOrderEvent.count({ where: { tenantId: o.tenantId, orderId: id, eventType: 'diagnosis_submitted_preapproved' } });
        if (!preapproved) throw Errors.precondition('Reparo cobrável exige orçamento aprovado');
      }
      return this.transition(tx, hooks, o, input.version, {
        to: 'IN_REPAIR',
        action: 'start-repair',
        eventType: o.technicalStatus === 'TESTING' ? 'back_to_repair' : 'repair_started',
        outbox: ['APPROVED', 'WAITING_PARTS', 'REOPENED'].includes(o.technicalStatus) ? 'os.repair_started' : undefined,
        data: { repairStartedAt: o.repairStartedAt ?? new Date() },
      });
    });
  }

  startTesting(id: string, input: z.infer<typeof transitionSchema>) {
    return this.db.run(async (tx, hooks) => {
      const o = await this.load(tx, id);
      this.assertTechnicianScope(o);
      return this.transition(tx, hooks, o, input.version, { to: 'TESTING', action: 'start-testing', eventType: 'testing_started' });
    });
  }

  /** Conclusão exige checklist final completo (itens configurados) e nenhuma reserva pendente. */
  completeRepair(id: string, input: z.infer<typeof completeRepairSchema>) {
    return this.db.run(async (tx, hooks) => {
      const o = await this.load(tx, id);
      this.assertTechnicianScope(o);
      const required = await this.settings.get(tx, o.tenantId, 'os.post_repair_checklist', o.branchId);
      const answered = new Map(input.checklist.map((i) => [i.key, i]));
      const missing = required.filter((r) => answered.get(r.key)?.ok === null || !answered.has(r.key));
      if (missing.length) throw Errors.precondition('Checklist final incompleto', { missing: missing.map((m) => m.label) });
      const failedWithoutNote = input.checklist.filter((i) => i.ok === false && !i.notes);
      if (failedWithoutNote.length) throw Errors.precondition('Itens reprovados exigem observação', { items: failedWithoutNote.map((i) => i.label) });
      const pending = await tx.stockReservation.count({ where: { tenantId: o.tenantId, orderId: id, status: 'ACTIVE' } });
      if (pending) throw Errors.precondition('Baixe ou libere as peças reservadas antes de concluir');

      const quoteWarranty = o.approvedQuoteId
        ? (await tx.quoteLine.aggregate({ where: { tenantId: o.tenantId, quoteId: o.approvedQuoteId }, _max: { warrantyDays: true } }))._max.warrantyDays
        : null;
      const warrantyDays = input.warrantyDays ?? quoteWarranty ?? (await this.settings.get(tx, o.tenantId, 'os.default_warranty_days', o.branchId));
      await tx.serviceOrderChecklist.create({
        data: { tenantId: o.tenantId, orderId: id, phase: 'POST_REPAIR', itemsJson: input.checklist as Prisma.InputJsonValue, completedBy: auth().userId },
      });
      return this.transition(tx, hooks, o, input.version, {
        to: 'READY',
        action: 'complete-repair',
        eventType: 'repair_completed',
        outbox: 'os.ready',
        data: {
          completedAt: new Date(),
          deliveryStatus: 'READY_FOR_PICKUP',
          warrantyDays,
          technicalReport: input.technicalReport ?? o.technicalReport,
        },
      });
    });
  }

  returnUnrepaired(id: string, input: z.infer<typeof cancelSchema>) {
    return this.db.run(async (tx, hooks) => {
      const o = await this.load(tx, id);
      await this.stock.releaseAllForOrder(tx, o.tenantId, id, 'Devolução sem reparo');
      if (o.diagnosisFeeCents > 0) await this.finance.upsertOrderReceivable(tx, o.tenantId, o, o.diagnosisFeeCents);
      return this.transition(tx, hooks, o, input.version, {
        to: 'RETURNED_UNREPAIRED',
        action: 'return-unrepaired',
        eventType: 'returned_unrepaired',
        outbox: 'os.ready',
        data: { deliveryStatus: 'READY_FOR_PICKUP', completedAt: new Date() },
        payload: { reason: input.reason },
      });
    });
  }

  cancel(id: string, input: z.infer<typeof cancelSchema>) {
    return this.db.run(async (tx, hooks) => {
      const o = await this.load(tx, id);
      const released = await this.stock.releaseAllForOrder(tx, o.tenantId, id, `Cancelamento: ${input.reason}`);
      await tx.quote.updateMany({ where: { tenantId: o.tenantId, orderId: id, status: { in: ['DRAFT', 'SENT'] } }, data: { status: 'SUPERSEDED' } });
      return this.transition(tx, hooks, o, input.version, {
        to: 'CANCELED',
        action: 'cancel',
        eventType: 'canceled',
        data: { canceledAt: new Date(), cancelReason: input.reason, deliveryStatus: o.deliveryStatus === 'IN_CUSTODY' ? 'READY_FOR_PICKUP' : o.deliveryStatus },
        payload: { reason: input.reason, reservationsReleased: released },
      });
    });
  }

  /** Reabertura: ocorrência auditada; histórico preservado. */
  reopen(id: string, input: z.infer<typeof reopenSchema>) {
    return this.db.run(async (tx, hooks) => {
      const o = await this.load(tx, id);
      return this.transition(tx, hooks, o, input.version, {
        to: 'REOPENED',
        action: 'reopen',
        eventType: 'reopened',
        data: {
          deliveryStatus: 'IN_CUSTODY',
          completedAt: null,
          canceledAt: null,
          ...(o.deliveryStatus === 'DELIVERED' ? { deliveredAt: o.deliveredAt } : {}),
        },
        payload: { reason: input.reason, previousDeliveryStatus: o.deliveryStatus },
      });
    });
  }

  /**
   * Entrega: separada da conclusão técnica. Exige quitação conforme política,
   * ou override com permissão e motivo (auditado). Registra recibo de retirada.
   */
  deliver(id: string, input: z.infer<typeof deliverSchema>) {
    return this.db.run(async (tx, hooks) => {
      const o = await this.load(tx, id);
      const a = auth();
      if (!DELIVERABLE_TECHNICAL_STATUSES.includes(o.technicalStatus)) throw Errors.precondition('OS ainda não está pronta para entrega');
      if (o.deliveryStatus !== 'READY_FOR_PICKUP') throw Errors.invalidTransition(o.deliveryStatus, 'DELIVERED');

      const receivable = await tx.receivable.findUnique({ where: { tenantId_sourceType_sourceId: { tenantId: o.tenantId, sourceType: 'SERVICE_ORDER', sourceId: id } } });
      const outstanding = receivable ? this.finance.outstanding(receivable) : 0;
      const requirePayment = await this.settings.get(tx, o.tenantId, 'os.require_payment_for_delivery', o.branchId);
      let override = false;
      if (outstanding > 0 && requirePayment) {
        if (!input.overrideUnpaid) throw Errors.precondition('Há saldo em aberto. Registre o pagamento ou use a liberação autorizada.', { outstandingCents: outstanding });
        assertCan('os:deliver_override');
        if (!input.overrideReason || input.overrideReason.length < 5) throw Errors.validation('Informe o motivo da liberação com saldo em aberto');
        override = true;
      }
      await bumpVersion(tx, 'service_orders', id, input.version);
      const file = input.signaturePng ? await this.signatures.store(tx, o, input.signaturePng) : null;
      const now = new Date();
      const pickupText = (await documentTemplate(tx, o.tenantId, 'PICKUP_RECEIPT')).content;
      await tx.pickupReceipt.create({
        data: {
          tenantId: o.tenantId,
          orderId: id,
          receivedByName: input.receivedByName,
          receivedByDocument: input.receivedByDocument,
          deliveredBy: a.userId,
          signatureFileId: file?.id ?? null,
          balanceOverride: override || outstanding > 0,
          overrideReason: override ? input.overrideReason : outstanding > 0 ? 'Política da empresa permite entrega com saldo' : null,
          outstandingCents: outstanding,
          deliveredAt: now,
        },
      });
      await tx.serviceOrderTerm.create({
        data: {
          tenantId: o.tenantId,
          orderId: id,
          termType: 'PICKUP',
          termVersion: 1,
          documentHash: sha256Hex(`OS ${o.number}\n${pickupText}\n${input.receivedByName}\n${now.toISOString()}`),
          acceptedAt: now,
          signerName: input.receivedByName,
          signerDocument: input.receivedByDocument,
          signatureFileId: file?.id ?? null,
          evidenceJson: { method: file ? 'assinatura_manuscrita_em_dispositivo' : 'conferencia_presencial', deliveredBy: a.userId },
          createdBy: a.userId,
        },
      });
      const delivered = o.technicalStatus === 'READY' ? 'DELIVERED' : 'RETURNED_UNREPAIRED';
      const warrantyUntil = o.technicalStatus === 'READY' && o.warrantyDays ? new Date(now.getTime() + o.warrantyDays * 86_400_000) : null;
      const u = await tx.serviceOrder.update({ where: { id }, data: { deliveryStatus: delivered, deliveredAt: now, warrantyUntil } });
      await tx.deviceUnlockSecret.updateMany({ where: { tenantId: o.tenantId, orderId: id, purgedAt: null }, data: { secretEncrypted: null, purgedAt: now } });

      // Faturamento de serviço por competência (entrega); não confundir com recebimento.
      if (receivable && receivable.amountCents > 0) {
        await this.finance.postLedger(tx, o.tenantId, [
          { branchId: o.branchId, sourceType: 'SERVICE_ORDER', sourceId: id, entryType: 'REVENUE_SERVICE', amountCents: receivable.amountCents, memo: `OS ${o.number}` },
        ]);
      }
      await tx.serviceOrderEvent.create({
        data: { tenantId: o.tenantId, orderId: id, actorId: a.userId, eventType: 'delivered', payloadJson: { override, outstandingCents: outstanding, receivedByName: input.receivedByName } },
      });
      await this.audit.log(tx, { action: override ? 'os_delivered_with_override' : 'os_delivered', entity: 'service_order', entityId: id, metadata: { outstandingCents: outstanding } });
      await this.outbox.add(tx, hooks, o.tenantId, {
        eventType: 'os.delivered',
        aggregateType: 'service_order',
        aggregateId: id,
        payload: { orderId: id, number: o.number, branchId: o.branchId, customerId: o.customerId },
      });
      this.signal(hooks, u);
      return u;
    });
  }
}
