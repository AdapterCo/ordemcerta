import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { categorySchema, productQuerySchema, productSchema, supplierSchema, updateProductSchema } from '@ordemcerta/shared';
import type { z } from 'zod';
import { currentTenantId } from '../../core/context';
import { TenantDb } from '../../core/database';
import { Errors } from '../../core/errors';
import { AuditService } from '../../core/services';

@Injectable()
export class CatalogService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  listProducts(q: z.infer<typeof productQuerySchema>) {
    return this.db.run(async (tx) => {
      const where: Prisma.ProductWhereInput = { tenantId: currentTenantId(), categoryId: q.categoryId, kind: q.kind, active: q.active };
      if (q.barcode) where.barcode = q.barcode;
      if (q.q) {
        where.OR = [
          { name: { contains: q.q, mode: 'insensitive' } },
          { sku: { contains: q.q, mode: 'insensitive' } },
          { barcode: q.q },
          { compatibility: { some: { model: { contains: q.q, mode: 'insensitive' } } } },
        ];
      }
      const [items, total] = await Promise.all([
        tx.product.findMany({
          where,
          include: { compatibility: true, balances: { select: { locationId: true, onHand: true, reserved: true, location: { select: { branchId: true } } } } },
          orderBy: { name: 'asc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        tx.product.count({ where }),
      ]);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  getProduct(id: string) {
    return this.db.run(async (tx) => {
      const p = await tx.product.findFirst({ where: { id, tenantId: currentTenantId() }, include: { compatibility: true, balances: { include: { location: true } } } });
      if (!p) throw Errors.notFound('Produto');
      return p;
    });
  }

  createProduct(input: z.infer<typeof productSchema>) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const p = await tx.product.create({
        data: {
          tenantId,
          sku: input.sku,
          barcode: input.barcode,
          name: input.name,
          description: input.description,
          categoryId: input.categoryId ?? null,
          supplierId: input.supplierId ?? null,
          kind: input.kind,
          unit: input.unit,
          costCents: input.costCents,
          priceCents: input.priceCents,
          promoPriceCents: input.promoPriceCents ?? null,
          minStock: input.minStock,
          active: input.active,
          location: input.location,
          compatibility: { create: input.compatibility.map((c) => ({ tenantId, brand: c.brand, model: c.model })) },
        },
      });
      await this.audit.log(tx, { action: 'product_created', entity: 'product', entityId: p.id });
      return p;
    });
  }

  updateProduct(id: string, input: z.infer<typeof updateProductSchema>) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const p = await tx.product.findFirst({ where: { id, tenantId } });
      if (!p) throw Errors.notFound('Produto');
      const { compatibility, ...rest } = input;
      const data: Prisma.ProductUncheckedUpdateInput = {};
      for (const [k, v] of Object.entries(rest)) if (v !== undefined) (data as Record<string, unknown>)[k] = v;
      const updated = await tx.product.update({ where: { id }, data });
      if (compatibility) {
        await tx.productCompatibility.deleteMany({ where: { tenantId, productId: id } });
        await tx.productCompatibility.createMany({ data: compatibility.map((c) => ({ tenantId, productId: id, brand: c.brand, model: c.model })) });
      }
      await this.audit.log(tx, {
        action: 'product_updated',
        entity: 'product',
        entityId: id,
        metadata: { fields: Object.keys(data), ...(input.priceCents !== undefined ? { priceFrom: p.priceCents, priceTo: input.priceCents } : {}) },
      });
      return updated;
    });
  }

  listCategories() {
    return this.db.run((tx) => tx.category.findMany({ where: { tenantId: currentTenantId() }, orderBy: { name: 'asc' } }));
  }

  createCategory(input: z.infer<typeof categorySchema>) {
    return this.db.run((tx) => tx.category.create({ data: { tenantId: currentTenantId(), name: input.name } }));
  }

  listSuppliers() {
    return this.db.run((tx) => tx.supplier.findMany({ where: { tenantId: currentTenantId() }, orderBy: { name: 'asc' } }));
  }

  createSupplier(input: z.infer<typeof supplierSchema>) {
    return this.db.run(async (tx) => {
      const s = await tx.supplier.create({ data: { tenantId: currentTenantId(), ...input } });
      await this.audit.log(tx, { action: 'supplier_created', entity: 'supplier', entityId: s.id });
      return s;
    });
  }
}
