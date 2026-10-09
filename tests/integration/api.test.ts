import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Http, idem, makeTenant, system, type Fixture } from './helpers';

/**
 * Testes ponta a ponta da API (in-process, PostgreSQL + Redis reais):
 * isolamento por endpoint, concorrência, quotas, suspensão e fluxo completo da OS.
 */
let nest: INestApplication;
let base: string;

beforeAll(async () => {
  process.env.API_PORT = '0';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createApp } = require('../../apps/api/dist/bootstrap');
  nest = await createApp();
  await nest.listen(0, '127.0.0.1');
  const addr = nest.getHttpServer().address();
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await nest?.close();
  await system.$disconnect();
});

async function product(f: Fixture, onHand: number, priceCents = 5000) {
  const p = await system.product.create({ data: { tenantId: f.tenantId, sku: `P-${randomUUID().slice(0, 8)}`, name: 'Película', priceCents, costCents: 1000 } });
  await system.stockBalance.create({ data: { tenantId: f.tenantId, locationId: f.locationId, productId: p.id, onHand } });
  return p;
}

describe('isolamento entre empresas nos endpoints', () => {
  let A: Fixture;
  let B: Fixture;
  let a: Http;
  let b: Http;
  beforeAll(async () => {
    A = await makeTenant('Iso A');
    B = await makeTenant('Iso B');
    a = await new Http(base).login(A.ownerEmail);
    b = await new Http(base).login(B.ownerEmail);
  });

  it('cliente, OS e venda de B são invisíveis para A', async () => {
    const c = await b.req('POST', '/customers', { name: 'Cliente B', phone: '11988887777' });
    expect(c.status).toBe(201);
    expect((await a.req('GET', `/customers/${c.body.id}`)).status).toBe(404);
    const list = await a.req('GET', '/customers', undefined);
    expect(list.body.items.find((x: { id: string }) => x.id === c.body.id)).toBeUndefined();
    const os = await b.req('POST', '/service-orders', { branchId: B.branchId, customerId: c.body.id, device: { brand: 'S', model: 'A' }, reportedIssue: 'Tela' }, { 'Idempotency-Key': idem() });
    expect(os.status).toBe(201);
    expect((await a.req('GET', `/service-orders/${os.body.order.id}`)).status).toBe(404);
    expect((await a.req('GET', `/service-orders/${os.body.order.id}/pdf`)).status).toBe(404);
    // branch_id de outra empresa no corpo é rejeitado
    expect((await a.req('POST', '/service-orders', { branchId: B.branchId, customerId: c.body.id, device: { brand: 'S', model: 'A' }, reportedIssue: 'x' }, { 'Idempotency-Key': idem() })).status).toBe(403);
  });

  it('portal público não aceita número de OS sem o token correto', async () => {
    const r = await new Http(base).req('POST', '/public/status/lookup', { orderNumber: 1, token: 'x'.repeat(32) });
    expect(r.status).toBe(404);
  });
});

describe('concorrência', () => {
  let A: Fixture;
  let a: Http;
  let session: string;
  beforeAll(async () => {
    A = await makeTenant('Conc');
    a = await new Http(base).login(A.ownerEmail);
    session = (await a.req('POST', '/cash-sessions/open', { registerId: A.registerId, openingFloatCents: 10000 }, { 'Idempotency-Key': idem() })).body.id;
  });

  it('duas vendas da última unidade: apenas uma confirma', async () => {
    const p = await product(A, 1);
    const mk = () => a.req('POST', '/sales', { branchId: A.branchId, items: [{ productId: p.id, qty: 1 }] }, { 'Idempotency-Key': idem() });
    const [s1, s2] = await Promise.all([mk(), mk()]);
    const confirm = (id: string) => a.req('POST', `/sales/${id}/confirm`, { cashSessionId: session, payments: [{ method: 'PIX', amountCents: 5000 }] }, { 'Idempotency-Key': idem() });
    const results = await Promise.all([confirm(s1.body.id), confirm(s2.body.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe('INSUFFICIENT_STOCK');
  });

  it('clique duplo / mesma Idempotency-Key não duplica pagamento', async () => {
    const p = await product(A, 5);
    const sale = await a.req('POST', '/sales', { branchId: A.branchId, items: [{ productId: p.id, qty: 1 }] }, { 'Idempotency-Key': idem() });
    const key = idem();
    const body = { cashSessionId: session, payments: [{ method: 'CASH', amountCents: 5000, tenderedCents: 10000 }] };
    const [r1, r2] = await Promise.all([a.req('POST', `/sales/${sale.body.id}/confirm`, body, { 'Idempotency-Key': key }), a.req('POST', `/sales/${sale.body.id}/confirm`, body, { 'Idempotency-Key': key })]);
    expect([r1.status, r2.status]).toContain(200);
    const replay = await a.req('POST', `/sales/${sale.body.id}/confirm`, body, { 'Idempotency-Key': key });
    expect(replay.status).toBe(200);
    expect(replay.body.changeCents).toBe(5000);
    const payments = await system.payment.count({ where: { tenantId: A.tenantId, allocations: { some: { receivable: { sourceId: sale.body.id } } } } });
    expect(payments).toBe(1);
  });

  it('duas sangrias simultâneas não ultrapassam o dinheiro do caixa', async () => {
    const s = await a.req('GET', `/cash-sessions/${session}/summary`);
    const available = s.body.expected.CASH as number;
    const w = () => a.req('POST', `/cash-sessions/${session}/withdraw`, { amountCents: available, reason: 'Sangria teste' }, { 'Idempotency-Key': idem() });
    const res = await Promise.all([w(), w()]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 422]);
  });

  it('OS com versão desatualizada é rejeitada', async () => {
    const c = await a.req('POST', '/customers', { name: 'Versão', phone: '11977776666' });
    const os = await a.req('POST', '/service-orders', { branchId: A.branchId, customerId: c.body.id, device: { brand: 'M', model: 'G' }, reportedIssue: 'Bateria' }, { 'Idempotency-Key': idem() });
    const ok = await a.req('PATCH', `/service-orders/${os.body.order.id}`, { version: 0, priority: 'HIGH' });
    expect(ok.status).toBe(200);
    const stale = await a.req('PATCH', `/service-orders/${os.body.order.id}`, { version: 0, priority: 'LOW' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('VERSION_CONFLICT');
  });
});

describe('quotas do plano e suspensão', () => {
  it('ESSENCIAL não cria segunda filial (PLAN_LIMIT_REACHED)', async () => {
    const E = await makeTenant('Essencial', 'ESSENCIAL');
    const e = await new Http(base).login(E.ownerEmail);
    const r = await e.req('POST', '/branches', { name: 'Segunda' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('PLAN_LIMIT_REACHED');
    expect(r.body.details).toMatchObject({ kind: 'branches', limit: 1, current: 1, plan: 'ESSENCIAL' });
  });

  it('criações concorrentes de filial não ultrapassam o limite', async () => {
    const P = await makeTenant('Prof', 'PROFISSIONAL');
    await system.branch.create({ data: { tenantId: P.tenantId, name: 'Dois' } });
    const p = await new Http(base).login(P.ownerEmail);
    const res = await Promise.all([p.req('POST', '/branches', { name: 'X' }), p.req('POST', '/branches', { name: 'Y' })]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('empresa suspensa consulta dados mas não cria OS nem vendas', async () => {
    const S = await makeTenant('Suspensa', 'PROFISSIONAL', 'SUSPENDED');
    const s = await new Http(base).login(S.ownerEmail);
    expect((await s.req('GET', '/service-orders')).status).toBe(200);
    const c = await s.req('POST', '/customers', { name: 'X', phone: '11966665555' });
    expect(c.status).toBe(402);
    expect(c.body.code).toBe('SUBSCRIPTION_INACTIVE');
  });
});

describe('cadastro direto de funcionário', () => {
  const NEW_PASSWORD = 'MinhaSenha2026x';

  it('dono cria com senha provisória; 1º login exige troca antes de qualquer sessão', async () => {
    const F = await makeTenant('Equipe');
    const owner = await new Http(base).login(F.ownerEmail);
    const email = `tec.${randomUUID().slice(0, 8)}@ordemcerta.test`;
    const c = await owner.req<any>('POST', '/members', { name: 'Técnico Teste', email, role: 'TECHNICIAN', branchIds: [F.branchId] });
    expect(c.status).toBe(201);
    expect(c.body.existingAccount).toBe(false);
    const provisional = c.body.temporaryPassword as string;
    expect(provisional).toMatch(/^[A-Za-z]{4}-\d{4}-[A-Za-z]{2}$/);

    const anon = new Http(base);
    const l = await anon.req<any>('POST', '/auth/login', { email, password: provisional });
    expect(l.status).toBe(200);
    expect(l.body.status).toBe('password_change_required');
    expect(l.body.accessToken).toBeUndefined();

    // token da troca não serve para MFA e a senha provisória não pode ser reaproveitada
    expect((await anon.req('POST', '/auth/mfa/verify', { mfaToken: l.body.mfaToken, code: '123456' })).status).toBe(401);
    expect((await anon.req('POST', '/auth/first-password', { mfaToken: l.body.mfaToken, newPassword: provisional })).status).toBeGreaterThanOrEqual(400);

    const ok = await anon.req<any>('POST', '/auth/first-password', { mfaToken: l.body.mfaToken, newPassword: NEW_PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('authenticated');
    expect(ok.body.accessToken).toBeTruthy();
    // o mesmo token não pode ser usado de novo
    expect((await anon.req('POST', '/auth/first-password', { mfaToken: l.body.mfaToken, newPassword: 'OutraSenha2026y' })).status).toBe(401);
    await new Http(base).login(email, NEW_PASSWORD);
  });

  it('redefinição pelo dono; bloqueada para quem também participa de outra empresa', async () => {
    const F = await makeTenant('Reset F');
    const G = await makeTenant('Reset G');
    const ownerF = await new Http(base).login(F.ownerEmail);
    const ownerG = await new Http(base).login(G.ownerEmail);
    const email = `rec.${randomUUID().slice(0, 8)}@ordemcerta.test`;
    const c = await ownerF.req<any>('POST', '/members', { name: 'Recepção', email, role: 'RECEPTIONIST', branchIds: [F.branchId], password: 'Provisoria2026' });
    expect(c.body.temporaryPassword).toBe('Provisoria2026');
    const membershipId = c.body.membershipId as string;

    const r = await ownerF.req<any>('POST', `/members/${membershipId}/reset-password`, {});
    expect(r.status).toBe(200);
    expect((await new Http(base).req('POST', '/auth/login', { email, password: 'Provisoria2026' })).status).toBe(401);
    const l = await new Http(base).req<any>('POST', '/auth/login', { email, password: r.body.temporaryPassword });
    expect(l.body.status).toBe('password_change_required');

    // mesmo e-mail cadastrado em G: só ganha o vínculo, sem trocar a senha
    const g = await ownerG.req<any>('POST', '/members', { name: 'Recepção', email, role: 'RECEPTIONIST', branchIds: [G.branchId] });
    expect(g.status).toBe(201);
    expect(g.body.existingAccount).toBe(true);
    expect(g.body.temporaryPassword).toBeNull();
    // agora nenhuma das duas empresas pode redefinir a senha dessa pessoa
    expect((await ownerF.req('POST', `/members/${membershipId}/reset-password`, {})).status).toBe(403);
    expect((await ownerG.req('POST', `/members/${g.body.membershipId}/reset-password`, {})).status).toBe(403);
    // proprietário nunca
    const ownerMembership = await system.tenantMembership.findFirstOrThrow({ where: { tenantId: F.tenantId, role: 'TENANT_OWNER' } });
    expect((await ownerF.req('POST', `/members/${ownerMembership.id}/reset-password`, {})).status).toBe(403);
  });
});

describe('peça comprada para a OS', () => {
  it('dinheiro do caixa gera sangria e custo; sem saldo é recusada; cancelamento devolve ao caixa', async () => {
    const F = await makeTenant('Compra peça');
    const h = await new Http(base).login(F.ownerEmail);
    const session = (await h.req('POST', '/cash-sessions/open', { registerId: F.registerId, openingFloatCents: 10000 }, { 'Idempotency-Key': idem() })).body.id;
    const c = await h.req('POST', '/customers', { name: 'João', phone: '11944443333' });
    const created = await h.req('POST', '/service-orders', { branchId: F.branchId, customerId: c.body.id, device: { brand: 'Apple', model: 'iPhone 13' }, reportedIssue: 'Tela quebrada' }, { 'Idempotency-Key': idem() });
    const id = created.body.order.id as string;
    const buy = (body: Record<string, unknown>) => h.req<any>('POST', `/service-orders/${id}/part-purchases`, body, { 'Idempotency-Key': idem() });
    const cogs = async () =>
      (await system.financialLedger.aggregate({ where: { tenantId: F.tenantId, sourceType: 'SERVICE_ORDER', sourceId: id, entryType: 'COGS' }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
    const cashInDrawer = async () => (await h.req<any>('GET', `/cash-sessions/${session}/summary`)).body.expected.CASH as number;

    // mais do que há no caixa: recusada, nada é gravado
    expect((await buy({ description: 'Tela', qty: 1, unitCostCents: 20000, paymentMethod: 'CASH_REGISTER', cashSessionId: session })).status).toBe(422);
    expect(await cogs()).toBe(0);

    const p = await buy({ description: 'Tela incell', qty: 2, unitCostCents: 3000, supplierName: 'Distribuidora', paymentMethod: 'CASH_REGISTER', cashSessionId: session });
    expect(p.status).toBe(201);
    expect(p.body.totalCostCents).toBe(6000);
    expect(p.body.cashMovementId).toBeTruthy();
    expect(await cashInDrawer()).toBe(4000);

    const pix = await buy({ description: 'Conector de carga', qty: 1, unitCostCents: 1500, paymentMethod: 'PIX' });
    expect(pix.status).toBe(201);
    expect(pix.body.cashMovementId).toBeNull();
    expect(await cashInDrawer()).toBe(4000);
    expect(await cogs()).toBe(7500);
    expect((await h.req<any>('GET', `/service-orders/${id}`)).body.partPurchases).toHaveLength(2);

    // cancelamento: devolve ao caixa (aberto) e estorna o custo; não cancela duas vezes
    expect((await h.req('POST', `/service-orders/${id}/part-purchases/${p.body.id}/cancel`, { reason: 'abc' })).status).toBe(422);
    expect((await h.req('POST', `/service-orders/${id}/part-purchases/${p.body.id}/cancel`, { reason: 'Peça errada, devolvida' })).status).toBe(200);
    expect(await cashInDrawer()).toBe(10000);
    expect(await cogs()).toBe(1500);
    expect((await h.req('POST', `/service-orders/${id}/part-purchases/${p.body.id}/cancel`, { reason: 'De novo, por engano' })).status).toBe(409);

    const hist = await h.req<any[]>('GET', `/service-orders/${id}/history`);
    expect(hist.body.map((e) => e.eventType)).toEqual(expect.arrayContaining(['part_purchased', 'part_purchase_canceled']));
  });
});

describe('assinatura no celular do cliente', () => {
  // PNG 1x1 válido (magic bytes conferidos pela API)
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  it('QR → cliente assina no celular → loja registra o termo (uso único); papel também é aceito', async () => {
    const F = await makeTenant('Assinatura');
    const h = await new Http(base).login(F.ownerEmail);
    const c = await h.req('POST', '/customers', { name: 'Ana Paula', phone: '11933332222' });
    const newOrder = async () =>
      (await h.req<any>('POST', '/service-orders', { branchId: F.branchId, customerId: c.body.id, device: { brand: 'Motorola', model: 'G84' }, reportedIssue: 'Não carrega' }, { 'Idempotency-Key': idem() })).body.order
        .id as string;
    const id = await newOrder();

    const cap = await h.req<any>('POST', `/service-orders/${id}/signature-captures`, { purpose: 'INTAKE' });
    expect(cap.status).toBe(201);
    const token = new URL(cap.body.url).hash.replace('#token=', '');
    expect(token.length).toBeGreaterThan(20);

    const pub = new Http(base);
    const view = await pub.req<any>('POST', '/public/signature/view', { token });
    expect(view.status).toBe(200);
    expect(view.body.title).toContain('recebimento');
    expect(view.body.suggestedName).toBe('Ana Paula');
    expect((await pub.req<any>('POST', '/public/signature/view', { token: 'x'.repeat(40) })).status).toBe(404);

    expect((await h.req<any>('GET', `/service-orders/${id}/signature-captures/${cap.body.captureId}`)).body.status).toBe('PENDING');
    expect((await pub.req('POST', '/public/signature/submit', { token, signerName: 'Ana Paula Souza', signaturePng: PNG })).status).toBe(200);
    // segunda assinatura no mesmo link: recusada
    expect((await pub.req('POST', '/public/signature/submit', { token, signerName: 'Outra', signaturePng: PNG })).status).toBe(409);
    const st = await h.req<any>('GET', `/service-orders/${id}/signature-captures/${cap.body.captureId}`);
    expect(st.body.status).toBe('CAPTURED');
    expect(st.body.signerName).toBe('Ana Paula Souza');
    expect(st.body.previewPng).toMatch(/^data:image\/png;base64,/);

    const term = await h.req<any>('POST', `/service-orders/${id}/intake-signature`, { signerName: 'Atendente digitou', signatureCaptureId: cap.body.captureId, accepted: true });
    expect(term.status).toBe(201);
    expect(term.body.signerName).toBe('Ana Paula Souza');
    expect(term.body.signatureFileId).toBeTruthy();
    expect((term.body.evidenceJson as any).method).toBe('assinatura_no_celular_do_cliente');
    // a mesma assinatura não serve para outro termo
    expect((await h.req('POST', `/service-orders/${id}/intake-signature`, { signerName: 'X', signatureCaptureId: cap.body.captureId, accepted: true })).status).toBe(409);
    // link consumido não abre mais
    expect((await pub.req('POST', '/public/signature/view', { token })).status).toBe(404);

    // ficha impressa: sem imagem, método registrado
    const id2 = await newOrder();
    const paper = await h.req<any>('POST', `/service-orders/${id2}/intake-signature`, { signerName: 'Ana Paula', paper: true, accepted: true });
    expect(paper.status).toBe(201);
    expect(paper.body.signatureFileId).toBeNull();
    expect((paper.body.evidenceJson as any).method).toBe('assinatura_em_papel_na_ficha_impressa');
    // nenhuma forma ou duas formas: inválido
    expect((await h.req('POST', `/service-orders/${id2}/intake-signature`, { signerName: 'Ana', accepted: true })).status).toBe(422);
    expect((await h.req('POST', `/service-orders/${id2}/intake-signature`, { signerName: 'Ana', paper: true, signaturePng: PNG, accepted: true })).status).toBe(422);
  });
});

describe('fluxo completo da OS', () => {
  it('recepção → diagnóstico → orçamento → aprovação → reparo → baixa de peça → conclusão → pagamento → entrega → PDF', async () => {
    const F = await makeTenant('Fluxo');
    const h = await new Http(base).login(F.ownerEmail);
    const part = await product(F, 3, 15000);
    const session = (await h.req('POST', '/cash-sessions/open', { registerId: F.registerId, openingFloatCents: 0 }, { 'Idempotency-Key': idem() })).body.id;
    const c = await h.req('POST', '/customers', { name: 'Maria', phone: '11955554444', consentWhatsapp: true });
    const created = await h.req('POST', '/service-orders', { branchId: F.branchId, customerId: c.body.id, device: { brand: 'Samsung', model: 'A54' }, reportedIssue: 'Tela quebrada', technicianUserId: F.ownerUserId }, { 'Idempotency-Key': idem() });
    expect(created.status).toBe(201);
    expect(created.body.trackingToken).toBeTruthy();
    const id = created.body.order.id;
    let v = async () => (await h.req('GET', `/service-orders/${id}`)).body.version as number;
    expect((await h.req('POST', `/service-orders/${id}/start-diagnosis`, { version: await v() })).status).toBe(200);
    const q = await h.req('POST', `/service-orders/${id}/quotes`, { lines: [{ kind: 'PART', productId: part.id, description: 'Tela', qty: 1, unitPriceCents: 15000 }, { kind: 'LABOR', description: 'Mão de obra', qty: 1, unitPriceCents: 5000 }] });
    expect(q.status).toBe(201);
    expect((await h.req('POST', `/service-orders/${id}/submit-diagnosis`, { version: await v(), diagnosis: 'Display danificado' })).status).toBe(200);
    expect((await h.req('POST', `/quotes/${q.body.id}/send`)).status).toBe(200);
    // sem aprovação não há reparo
    expect((await h.req('POST', `/service-orders/${id}/start-repair`, { version: await v() })).status).toBe(409);
    expect((await h.req('POST', `/quotes/${q.body.id}/approve`, { customerName: 'Maria', method: 'IN_PERSON' })).status).toBe(200);
    expect((await h.req('POST', `/service-orders/${id}/start-repair`, { version: await v() })).status).toBe(200);
    const res = await h.req('POST', '/stock/reserve', { orderId: id, productId: part.id, quantity: 1 }, { 'Idempotency-Key': idem() });
    expect(res.status).toBe(201);
    expect((await h.req('POST', '/stock/consume', { reservationId: res.body.id }, { 'Idempotency-Key': idem() })).status).toBe(200);
    expect((await h.req('POST', `/service-orders/${id}/start-testing`, { version: await v() })).status).toBe(200);
    const checklist = (await h.req('GET', '/settings')).body['os.post_repair_checklist'].map((i: { key: string; label: string }) => ({ ...i, ok: true }));
    expect((await h.req('POST', `/service-orders/${id}/complete-repair`, { version: await v(), checklist: checklist.slice(1) })).status).toBe(422);
    expect((await h.req('POST', `/service-orders/${id}/complete-repair`, { version: await v(), checklist })).status).toBe(200);
    // entrega sem pagamento é bloqueada
    expect((await h.req('POST', `/service-orders/${id}/deliver`, { version: await v(), receivedByName: 'Maria' }, { 'Idempotency-Key': idem() })).status).toBe(422);
    const order = (await h.req('GET', `/service-orders/${id}`)).body;
    expect(order.receivable.amountCents).toBe(20000);
    const pay = await h.req('POST', '/payments', { branchId: F.branchId, cashSessionId: session, receivableId: order.receivable.id, parts: [{ method: 'PIX', amountCents: 10000 }, { method: 'CASH', amountCents: 10000 }] }, { 'Idempotency-Key': idem() });
    expect(pay.status).toBe(201);
    expect((await h.req('POST', `/service-orders/${id}/deliver`, { version: await v(), receivedByName: 'Maria' }, { 'Idempotency-Key': idem() })).status).toBe(200);
    const final = (await h.req('GET', `/service-orders/${id}`)).body;
    expect(final.deliveryStatus).toBe('DELIVERED');
    expect(final.paymentStatus).toBe('PAID');
    const outbox = await system.notificationOutbox.findMany({ where: { tenantId: F.tenantId, aggregateId: id } });
    expect(outbox.map((e) => e.eventType)).toEqual(expect.arrayContaining(['os.created', 'quote.sent', 'quote.approved', 'os.ready', 'os.delivered']));
    const pdf = await fetch(`${base}/api/v1/service-orders/${id}/pdf?type=pickup`, { headers: { Authorization: `Bearer ${h.token}` } });
    expect(pdf.headers.get('content-type')).toContain('application/pdf');
    const ledger = await system.financialLedger.groupBy({ by: ['entryType'], where: { tenantId: F.tenantId }, _sum: { amountCents: true } });
    const sum = Object.fromEntries(ledger.map((l) => [l.entryType, l._sum.amountCents]));
    expect(sum.REVENUE_SERVICE).toBe(20000);
    expect(sum.PAYMENT_RECEIVED).toBe(20000);
    expect(sum.COGS).toBe(1000);
  });
});
