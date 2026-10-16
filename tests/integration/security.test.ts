import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Http, idem, makeTenant, PASSWORD, system } from './helpers';

/**
 * Regressões da varredura de segurança (2026-10-15): OTP do portal, pré-sequestro
 * de conta, refresh com várias abas e webhook forjado do Mercado Pago.
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

/** Login guardando os cookies (refresh HttpOnly + CSRF). */
async function cookieLogin(email: string) {
  const r = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  expect(r.status).toBe(200);
  const cookies = r.headers.getSetCookie().map((c) => c.split(';')[0]!);
  const csrf = cookies.find((c) => c.startsWith('oc_csrf='))!.slice('oc_csrf='.length);
  return { cookie: cookies.join('; '), csrf };
}

const refresh = (cookie: string, csrf: string) =>
  fetch(`${base}/api/v1/auth/refresh`, { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': csrf } });

describe('refresh rotativo com várias abas', () => {
  it('duas abas renovando juntas não derrubam a sessão; token antigo fora da janela revoga', async () => {
    const F = await makeTenant('Abas');
    const { cookie, csrf } = await cookieLogin(F.ownerEmail);
    const [r1, r2] = await Promise.all([refresh(cookie, csrf), refresh(cookie, csrf)]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    // a sessão continua válida com o cookie mais novo
    const newest = [r1, r2].flatMap((r) => r.headers.getSetCookie()).find((c) => c.startsWith('oc_rt='))!.split(';')[0]!;
    const r3 = await refresh(`${newest}; oc_csrf=${csrf}`, csrf);
    expect(r3.status).toBe(200);
    const sid = newest.slice('oc_rt='.length).split('.')[0]!;
    expect((await system.session.findUniqueOrThrow({ where: { id: sid } })).revokedAt).toBeNull();

    // reuso do token original depois da janela de tolerância = roubo: sessão revogada
    await system.session.update({ where: { id: sid }, data: { rotatedAt: new Date(Date.now() - 120_000) } });
    expect((await refresh(cookie, csrf)).status).toBe(401);
    expect((await system.session.findUniqueOrThrow({ where: { id: sid } })).revokeReason).toBe('refresh_reuse');
  });
});

describe('vínculo de conta existente entre empresas', () => {
  it('conta criada por outra empresa só é vinculada depois de confirmar o e-mail', async () => {
    const A = await makeTenant('Pre A');
    const B = await makeTenant('Pre B');
    const ownerA = await new Http(base).login(A.ownerEmail);
    const ownerB = await new Http(base).login(B.ownerEmail);
    const email = `vitima.${randomUUID().slice(0, 8)}@ordemcerta.test`;
    // empresa A "pré-cadastra" o e-mail com senha que ela conhece
    expect((await ownerA.req('POST', '/members', { name: 'Vítima', email, role: 'RECEPTIONIST', branchIds: [A.branchId], password: 'SenhaDaEmpresaA1' })).status).toBe(201);
    // empresa B tenta vincular a mesma pessoa: recusado enquanto o e-mail não for confirmado
    const linked = await ownerB.req('POST', '/members', { name: 'Vítima', email, role: 'RECEPTIONIST', branchIds: [B.branchId] });
    expect(linked.status).toBe(409);
    expect(await system.tenantMembership.count({ where: { tenantId: B.tenantId, user: { email } } })).toBe(0);
    // dono do e-mail confirma (prova de posse) → vínculo liberado
    await system.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
    expect((await ownerB.req('POST', '/members', { name: 'Vítima', email, role: 'RECEPTIONIST', branchIds: [B.branchId] })).status).toBe(201);
  });

  it('confirmação de e-mail: link de uso único marca o e-mail como confirmado', async () => {
    const F = await makeTenant('Confirma');
    const h = await new Http(base).login(F.ownerEmail);
    expect((await h.req<any>('GET', '/auth/me')).body.user.emailVerified).toBe(false);
    expect((await h.req('POST', '/auth/email/verify-request')).status).toBe(200);
    const out = await system.emailOutbox.findFirstOrThrow({ where: { toEmail: F.ownerEmail, template: 'email_verification' }, orderBy: { createdAt: 'desc' } });
    const token = String((out.payloadJson as { link: string }).link).split('#token=')[1]!;
    expect((await new Http(base).req('POST', '/auth/email/verify', { token })).status).toBe(204);
    expect((await new Http(base).req('POST', '/auth/email/verify', { token })).status).toBeGreaterThanOrEqual(400);
    expect((await h.req<any>('GET', '/auth/me')).body.user.emailVerified).toBe(true);
  });
});

describe('OTP do portal', () => {
  it('tentativas erradas ficam gravadas (o rollback da decisão não zera o contador)', async () => {
    const F = await makeTenant('Otp');
    const h = await new Http(base).login(F.ownerEmail);
    await system.setting.create({ data: { tenantId: F.tenantId, scope: 'tenant', key: 'portal.require_otp_for_quote', valueJson: true } });
    const c = await h.req('POST', '/customers', { name: 'Cliente OTP', phone: '11944443333', email: `cli.${randomUUID().slice(0, 8)}@ordemcerta.test` });
    const created = await h.req('POST', '/service-orders', { branchId: F.branchId, customerId: c.body.id, device: { brand: 'Moto', model: 'G' }, reportedIssue: 'Bateria' }, { 'Idempotency-Key': idem() });
    const id = created.body.order.id as string;
    const v = async () => (await h.req('GET', `/service-orders/${id}`)).body.version as number;
    await h.req('POST', `/service-orders/${id}/start-diagnosis`, { version: await v() });
    const q = await h.req('POST', `/service-orders/${id}/quotes`, { lines: [{ kind: 'LABOR', description: 'Troca de bateria', qty: 1, unitPriceCents: 9000 }] });
    await h.req('POST', `/service-orders/${id}/submit-diagnosis`, { version: await v(), diagnosis: 'Bateria estufada' });
    const sent = await h.req<any>('POST', `/quotes/${q.body.id}/send`);
    const token = String(sent.body.quoteUrl).split('#token=')[1]!;

    const portal = new Http(base);
    expect((await portal.req('POST', '/public/status/otp/request', { token, quoteId: q.body.id })).status).toBe(200);
    for (let i = 0; i < 3; i++) {
      const r = await portal.req('POST', `/public/status/quotes/${q.body.id}/reject`, { token, otpCode: '000000', signerName: 'Cliente', acceptText: '', reason: 'teste' });
      expect(r.status).toBe(422);
    }
    const otp = await system.publicOtp.findFirstOrThrow({ where: { tenantId: F.tenantId, orderId: id }, orderBy: { createdAt: 'desc' } });
    // '000000' pode coincidir com o código sorteado (1 em 1 milhão): nesse caso a 1ª tentativa teria passado
    expect(otp.attempts).toBe(3);
  });
});

describe('webhook Mercado Pago forjado', () => {
  it('assinatura inválida não é gravada (não bloqueia o evento verdadeiro)', async () => {
    const dataId = `${Date.now()}`;
    const r = await fetch(`${base}/api/v1/webhooks/mercadopago?data.id=${dataId}&type=payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-signature': 'ts=1,v1=00', 'x-request-id': randomUUID() },
      body: JSON.stringify({ id: 999_000_111, type: 'payment', data: { id: dataId } }),
    });
    expect(r.status).toBe(403);
    expect(await system.billingWebhookEvent.count({ where: { resourceId: dataId } })).toBe(0);
  });
});
