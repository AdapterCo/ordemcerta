import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, asTenant, makeTenant, system, type Fixture } from './helpers';

/**
 * Isolamento no nível do banco: RLS deny-by-default, FKs compostas com
 * tenant_id, triggers de referência entre empresas e imutabilidade.
 */
describe('RLS e integridade multi-tenant', () => {
  let A: Fixture;
  let B: Fixture;
  let customerA: string;
  let customerB: string;

  beforeAll(async () => {
    A = await makeTenant('Teste A');
    B = await makeTenant('Teste B');
    // mesmo telefone em empresas diferentes
    customerA = (await system.customer.create({ data: { tenantId: A.tenantId, name: 'Cliente A', phoneE164: '+5511999990000' } })).id;
    customerB = (await system.customer.create({ data: { tenantId: B.tenantId, name: 'Cliente B', phoneE164: '+5511999990000' } })).id;
  });

  afterAll(async () => {
    await app.$disconnect();
    await system.$disconnect();
  });

  it('sem contexto de tenant, nenhuma linha é visível (deny-by-default)', async () => {
    const rows = await asTenant(null, (tx) => tx.customer.findMany());
    expect(rows).toHaveLength(0);
  });

  it('tenant A não enxerga cliente de B, mesmo com o mesmo telefone', async () => {
    const rows = await asTenant(A.tenantId, (tx) => tx.customer.findMany({ where: { phoneE164: '+5511999990000' } }));
    expect(rows.map((r) => r.id)).toEqual([customerA]);
    const b = await asTenant(A.tenantId, (tx) => tx.customer.findUnique({ where: { id: customerB } }));
    expect(b).toBeNull();
  });

  it('tenant A não consegue gravar linha com tenant_id de B (WITH CHECK)', async () => {
    await expect(asTenant(A.tenantId, (tx) => tx.customer.create({ data: { tenantId: B.tenantId, name: 'Invasor' } }))).rejects.toThrow();
  });

  it('FK composta impede OS de A apontando para cliente de B', async () => {
    const device = await system.device.create({ data: { tenantId: A.tenantId, customerId: customerA, brand: 'X', model: 'Y' } });
    await expect(
      system.serviceOrder.create({
        data: { tenantId: A.tenantId, branchId: A.branchId, number: 999001, customerId: customerB, deviceId: device.id, createdBy: A.ownerUserId, reportedIssue: 'teste' },
      }),
    ).rejects.toThrow();
  });

  it('trigger impede referência opcional entre empresas (venda com cliente de outra empresa)', async () => {
    await expect(
      system.sale.create({ data: { tenantId: A.tenantId, branchId: A.branchId, number: 999001, customerId: customerB, createdBy: A.ownerUserId } }),
    ).rejects.toThrow(/outra|empresas|23503/i);
  });

  it('movimentações de estoque e ledger são imutáveis', async () => {
    const p = await system.product.create({ data: { tenantId: A.tenantId, sku: `SKU-${randomUUID().slice(0, 6)}`, name: 'Peça', priceCents: 1000 } });
    const m = await system.stockMovement.create({
      data: { tenantId: A.tenantId, branchId: A.branchId, locationId: A.locationId, productId: p.id, type: 'RECEIPT', quantity: 1, actorId: A.ownerUserId },
    });
    await expect(system.stockMovement.update({ where: { id: m.id }, data: { quantity: 5 } })).rejects.toThrow();
    await expect(system.stockMovement.delete({ where: { id: m.id } })).rejects.toThrow();
  });

  it('papel da aplicação não lê hash de senha', async () => {
    await expect(app.$queryRaw`SELECT password_hash FROM users LIMIT 1`).rejects.toThrow();
  });

  it('planos do seed existem uma única vez com preços exatos', async () => {
    const plans = await system.plan.findMany({ where: { code: { in: ['ESSENCIAL', 'PROFISSIONAL', 'AVANCADO', 'REDE'] } }, orderBy: { sortOrder: 'asc' } });
    expect(plans.map((p) => [p.code, p.priceCents, p.maxBranches])).toEqual([
      ['ESSENCIAL', 2999, 1],
      ['PROFISSIONAL', 5999, 3],
      ['AVANCADO', 8999, 5],
      ['REDE', 12999, 10],
    ]);
  });
});
