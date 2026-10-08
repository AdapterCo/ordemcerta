import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Tx } from '@ordemcerta/server';
import {
  consentSchema,
  customerQuerySchema,
  customerSchema,
  deviceSchema,
  maskIdentifier,
  normalizeDocument,
  normalizePhoneE164,
  onlyDigits,
  updateCustomerSchema,
} from '@ordemcerta/shared';
import type { z } from 'zod';
import { auth, currentTenantId } from '../../core/context';
import { TenantDb } from '../../core/database';
import { Errors } from '../../core/errors';
import { AuditService, CryptoService } from '../../core/services';

@Injectable()
export class CustomersService {
  constructor(
    private readonly db: TenantDb,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  /** Visão do aparelho sem dados sensíveis completos. */
  deviceView<T extends { imeiLast4: string | null; serialLast4: string | null; imeiEncrypted?: string | null; serialEncrypted?: string | null; imeiHash?: string | null }>(d: T) {
    const { imeiEncrypted: _i, serialEncrypted: _s, imeiHash: _h, ...rest } = d;
    return { ...rest, imeiMasked: d.imeiLast4 ? maskIdentifier(`00000000000${d.imeiLast4}`) : null, serialMasked: d.serialLast4 ? `••••${d.serialLast4}` : null };
  }

  list(q: z.infer<typeof customerQuerySchema>) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const where: Prisma.CustomerWhereInput = { tenantId, anonymizedAt: null };
      const term = q.q?.trim();
      if (term) {
        const phone = normalizePhoneE164(term);
        const doc = normalizeDocument(term);
        const digits = onlyDigits(term);
        const or: Prisma.CustomerWhereInput[] = [{ name: { contains: term, mode: 'insensitive' } }];
        if (phone) or.push({ phoneE164: phone }, { whatsappE164: phone });
        else if (digits.length >= 4) or.push({ phoneE164: { endsWith: digits } });
        if (doc) or.push({ document: doc.value });
        if (term.includes('@')) or.push({ email: term.toLowerCase() });
        where.OR = or;
      }
      const [items, total] = await Promise.all([
        tx.customer.findMany({
          where,
          orderBy: { name: 'asc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          select: { id: true, name: true, phoneE164: true, whatsappE164: true, email: true, document: true, createdAt: true, _count: { select: { serviceOrders: true } } },
        }),
        tx.customer.count({ where }),
      ]);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  get(id: string) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const c = await tx.customer.findFirst({
        where: { id, tenantId },
        include: {
          devices: { orderBy: { createdAt: 'desc' } },
          consents: { orderBy: { grantedAt: 'desc' } },
          serviceOrders: {
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: { id: true, number: true, technicalStatus: true, deliveryStatus: true, paymentStatus: true, createdAt: true, deviceId: true, totalCents: true },
          },
        },
      });
      if (!c) throw Errors.notFound('Cliente');
      return { ...c, devices: c.devices.map((d) => this.deviceView(d)) };
    });
  }

  create(input: z.infer<typeof customerSchema>, allowDuplicate = false) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      if (!allowDuplicate) {
        const dup = await tx.customer.findFirst({
          where: { tenantId, anonymizedAt: null, OR: [{ phoneE164: input.phone }, ...(input.document ? [{ document: input.document }] : [])] },
          select: { id: true, name: true },
        });
        if (dup) throw Errors.conflict('Já existe cliente com este telefone/documento nesta empresa', { existingId: dup.id, existingName: dup.name });
      }
      const c = await tx.customer.create({
        data: {
          tenantId,
          name: input.name,
          phoneE164: input.phone,
          whatsappE164: input.whatsapp ?? input.phone,
          email: input.email,
          document: input.document,
          notes: input.notes,
          address: (input.address ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      if (input.consentWhatsapp !== undefined) await this.recordConsent(tx, tenantId, c.id, { channel: 'WHATSAPP', purpose: 'SERVICE_NOTIFICATIONS', granted: input.consentWhatsapp, source: 'cadastro' });
      await this.audit.log(tx, { action: 'customer_created', entity: 'customer', entityId: c.id });
      return c;
    });
  }

  update(id: string, input: z.infer<typeof updateCustomerSchema>) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const current = await tx.customer.findFirst({ where: { id, tenantId, anonymizedAt: null } });
      if (!current) throw Errors.notFound('Cliente');
      const data: Prisma.CustomerUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.phone !== undefined) data.phoneE164 = input.phone;
      if (input.whatsapp !== undefined) data.whatsappE164 = input.whatsapp;
      if (input.email !== undefined) data.email = input.email;
      if (input.document !== undefined) data.document = input.document;
      if (input.notes !== undefined) data.notes = input.notes;
      if (input.address !== undefined) data.address = input.address as Prisma.InputJsonValue;
      const c = await tx.customer.update({ where: { id }, data });
      if (input.consentWhatsapp !== undefined) {
        await this.recordConsent(tx, tenantId, id, { channel: 'WHATSAPP', purpose: 'SERVICE_NOTIFICATIONS', granted: input.consentWhatsapp, source: 'cadastro' });
      }
      await this.audit.log(tx, { action: 'customer_updated', entity: 'customer', entityId: id, metadata: { fields: Object.keys(data) } });
      return c;
    });
  }

  /** Registro de consentimento por canal/finalidade (histórico preservado). */
  async recordConsent(tx: Tx, tenantId: string, customerId: string, input: z.infer<typeof consentSchema>) {
    const active = await tx.customerConsent.findFirst({
      where: { tenantId, customerId, channel: input.channel, purpose: input.purpose, revokedAt: null },
      orderBy: { grantedAt: 'desc' },
    });
    if (input.granted && !active) {
      await tx.customerConsent.create({
        data: { tenantId, customerId, channel: input.channel, purpose: input.purpose, grantedAt: new Date(), source: input.source, actorId: auth().userId },
      });
    } else if (!input.granted && active) {
      await tx.customerConsent.update({ where: { id: active.id }, data: { revokedAt: new Date() } });
    }
  }

  setConsent(customerId: string, input: z.infer<typeof consentSchema>) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const exists = await tx.customer.count({ where: { id: customerId, tenantId } });
      if (!exists) throw Errors.notFound('Cliente');
      await this.recordConsent(tx, tenantId, customerId, input);
      await this.audit.log(tx, { action: input.granted ? 'consent_granted' : 'consent_revoked', entity: 'customer', entityId: customerId, metadata: { channel: input.channel, purpose: input.purpose } });
      return tx.customerConsent.findMany({ where: { tenantId, customerId }, orderBy: { grantedAt: 'desc' } });
    });
  }

  listDevices(customerId: string) {
    return this.db.run(async (tx) => {
      const devices = await tx.device.findMany({ where: { tenantId: currentTenantId(), customerId }, orderBy: { createdAt: 'desc' } });
      return devices.map((d) => this.deviceView(d));
    });
  }

  /** Cria aparelho dentro de uma transação existente (usado também pela recepção de OS). */
  async createDeviceTx(tx: Tx, tenantId: string, customerId: string, input: z.infer<typeof deviceSchema>) {
    const customer = await tx.customer.findFirst({ where: { id: customerId, tenantId, anonymizedAt: null }, select: { id: true } });
    if (!customer) throw Errors.notFound('Cliente');
    const imei = input.imei ?? null;
    const serial = input.serial ?? null;
    return tx.device.create({
      data: {
        tenantId,
        customerId,
        brand: input.brand,
        model: input.model,
        color: input.color,
        notes: input.notes,
        imeiEncrypted: this.crypto.encryptNullable(imei),
        imeiHash: imei ? this.crypto.blindIndex(imei) : null,
        imeiLast4: imei ? imei.slice(-4) : null,
        serialEncrypted: this.crypto.encryptNullable(serial),
        serialLast4: serial ? serial.slice(-4) : null,
      },
    });
  }

  createDevice(customerId: string, input: z.infer<typeof deviceSchema>) {
    return this.db.run(async (tx) => {
      const d = await this.createDeviceTx(tx, currentTenantId(), customerId, input);
      await this.audit.log(tx, { action: 'device_created', entity: 'device', entityId: d.id });
      return this.deviceView(d);
    });
  }

  /** Revela IMEI/serial completo (acesso a dado sensível com auditoria). */
  revealDevice(deviceId: string, reason: string) {
    return this.db.run(async (tx) => {
      const d = await tx.device.findFirst({ where: { id: deviceId, tenantId: currentTenantId() } });
      if (!d) throw Errors.notFound('Aparelho');
      await this.audit.log(tx, { action: 'device_identifier_revealed', entity: 'device', entityId: d.id, metadata: { reason } });
      return {
        imei: d.imeiEncrypted ? this.crypto.decrypt(d.imeiEncrypted) : null,
        serial: d.serialEncrypted ? this.crypto.decrypt(d.serialEncrypted) : null,
      };
    });
  }

  /** Exportação de dados do titular (LGPD). */
  exportData(id: string) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const c = await tx.customer.findFirst({
        where: { id, tenantId },
        include: {
          devices: true,
          consents: true,
          serviceOrders: { select: { number: true, createdAt: true, technicalStatus: true, deliveryStatus: true, reportedIssue: true, totalCents: true, deliveredAt: true } },
        },
      });
      if (!c) throw Errors.notFound('Cliente');
      await this.audit.log(tx, { action: 'customer_data_exported', entity: 'customer', entityId: id });
      return {
        exportedAt: new Date().toISOString(),
        customer: { name: c.name, phone: c.phoneE164, whatsapp: c.whatsappE164, email: c.email, document: c.document, address: c.address, createdAt: c.createdAt },
        devices: c.devices.map((d) => ({ brand: d.brand, model: d.model, color: d.color, imeiMasked: this.deviceView(d).imeiMasked })),
        consents: c.consents.map((x) => ({ channel: x.channel, purpose: x.purpose, grantedAt: x.grantedAt, revokedAt: x.revokedAt, source: x.source })),
        serviceOrders: c.serviceOrders,
      };
    });
  }

  /**
   * Anonimização (LGPD): remove identificadores pessoais preservando registros
   * de OS/financeiros exigidos por obrigação legal. Bloqueada com OS em aberto.
   */
  anonymize(id: string) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const c = await tx.customer.findFirst({ where: { id, tenantId, anonymizedAt: null } });
      if (!c) throw Errors.notFound('Cliente');
      const open = await tx.serviceOrder.count({ where: { tenantId, customerId: id, deliveryStatus: { in: ['IN_CUSTODY', 'READY_FOR_PICKUP'] } } });
      if (open) throw Errors.precondition('Cliente possui aparelho em custódia; conclua a entrega antes da anonimização');
      await tx.customer.update({
        where: { id },
        data: { name: 'Cliente anonimizado', phoneE164: null, whatsappE164: null, email: null, document: null, address: Prisma.DbNull, notes: null, active: false, anonymizedAt: new Date() },
      });
      await tx.device.updateMany({ where: { tenantId, customerId: id }, data: { imeiEncrypted: null, imeiHash: null, imeiLast4: null, serialEncrypted: null, serialLast4: null, notes: null } });
      await tx.customerConsent.updateMany({ where: { tenantId, customerId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log(tx, { action: 'customer_anonymized', entity: 'customer', entityId: id });
      return { ok: true };
    });
  }
}
