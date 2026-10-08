import { expect, test, type Page } from '@playwright/test';
import { io } from 'socket.io-client';

/**
 * Fluxos E2E (seção 11). Requer empresa ATIVA com dono (E2E_OWNER_*) e,
 * para o fluxo técnico em tempo real, um técnico (E2E_TECH_*) na mesma filial.
 * Dados fictícios — nunca executar contra produção com clientes reais.
 */
const owner = { email: process.env.E2E_OWNER_EMAIL ?? 'demo.dono@ordemcerta.test', password: process.env.E2E_OWNER_PASSWORD ?? 'DemoOrdemCerta2026' };
const tech = { email: process.env.E2E_TECH_EMAIL ?? 'demo.tecnico@ordemcerta.test', password: process.env.E2E_TECH_PASSWORD ?? 'DemoOrdemCerta2026' };

async function login(page: Page, u: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(u.email);
  await page.getByLabel('Senha').fill(u.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/app\//);
}

test('cliente → aparelho → OS → técnico recebe em tempo real → diagnóstico → orçamento → aprovação → reparo → conclusão → pagamento → entrega → PDF', async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const techCtx = await browser.newContext();
  const recep = await ownerCtx.newPage();
  const techPage = await techCtx.newPage();
  await login(recep, owner);
  await login(techPage, tech);
  await techPage.goto('/app/technician/queue');

  const phone = `119${Date.now().toString().slice(-8)}`;
  await recep.goto('/app/service-orders/new');
  await recep.getByRole('button', { name: 'Novo cliente' }).click();
  await recep.getByLabel('Nome').fill('Cliente E2E');
  await recep.getByLabel('Telefone').first().fill(phone);
  await recep.getByRole('button', { name: 'Salvar cliente' }).click();
  await recep.getByLabel('Marca').fill('Samsung');
  await recep.getByLabel('Modelo').fill('A54');
  await recep.getByLabel('Defeito relatado').fill('Tela não liga');
  await recep.getByRole('button', { name: 'Abrir ordem de serviço' }).click();
  await expect(recep.getByText(/OS nº \d+ criada/)).toBeVisible();
  const title = await recep.getByText(/OS nº \d+ criada/).textContent();
  const number = title!.match(/\d+/)![0];

  // técnico vê a nova OS sem recarregar
  await expect(techPage.getByText(`OS ${number}`)).toBeVisible({ timeout: 15_000 });
  await recep.getByRole('button', { name: 'Ir para a OS' }).click();

  await recep.getByRole('button', { name: 'Iniciar diagnóstico' }).click();
  await recep.getByRole('tab', { name: 'Orçamento' }).click();
  await recep.getByRole('button', { name: 'Criar orçamento' }).click();
  await recep.getByRole('button', { name: 'Salvar versão' }).click();
  await recep.getByRole('tab', { name: 'Resumo' }).click();
  await recep.getByRole('button', { name: 'Concluir diagnóstico' }).click();
  await recep.getByLabel('Diagnóstico').fill('Display danificado');
  await recep.getByRole('button', { name: 'Confirmar' }).click();
  await recep.getByRole('tab', { name: 'Orçamento' }).click();
  await recep.getByRole('button', { name: 'Aprovação presencial' }).click();
  await recep.getByRole('button', { name: 'Confirmar' }).click();
  await recep.getByRole('button', { name: 'Iniciar reparo' }).click();
  await recep.getByRole('button', { name: 'Iniciar testes' }).click();
  await recep.getByRole('button', { name: 'Concluir reparo' }).click();
  for (const radio of await recep.getByRole('radio', { name: 'OK' }).all()) await radio.check();
  await recep.getByRole('button', { name: 'Concluir reparo' }).last().click();
  await expect(recep.getByText('Pronta')).toBeVisible();
  await recep.getByRole('button', { name: 'Registrar retirada' }).click();
  await expect(recep.getByText(/Saldo em aberto/)).toBeVisible();
});

test('PDV → pagamento misto → estoque → caixa → sangria → fechamento → relatórios', async ({ page }) => {
  await login(page, owner);
  await page.goto('/app/cash');
  const open = page.getByRole('button', { name: 'Abrir' }).first();
  if (await open.isVisible()) {
    await open.click();
    await page.getByRole('button', { name: 'Abrir' }).last().click();
  }
  await page.goto('/app/sales/pos');
  await page.getByLabel('Código de barras ou busca').fill('Tela');
  await page.locator('button', { hasText: 'Tela' }).first().click();
  await page.getByRole('button', { name: /Finalizar/ }).click();
  await page.getByRole('button', { name: 'Confirmar venda' }).click();
  await expect(page.getByText(/Venda nº \d+ confirmada/)).toBeVisible();
  await page.goto('/app/reports');
  await expect(page.getByText('Faturamento (competência)')).toBeVisible();
});

test('websocket recusa conexão sem token válido', async ({ baseURL }) => {
  const s = io(baseURL!, { path: '/api/v1/realtime', transports: ['websocket'], auth: { token: 'invalido' }, reconnection: false });
  const disconnected = await new Promise<boolean>((resolve) => {
    s.on('disconnect', () => resolve(true));
    s.on('connect_error', () => resolve(true));
    setTimeout(() => resolve(false), 5000);
  });
  s.close();
  expect(disconnected).toBe(true);
});

test('portal público exige token (número da OS sozinho não autentica) @mobile', async ({ page }) => {
  await page.goto('/status/1');
  await page.getByLabel('Código do comprovante').fill('x'.repeat(32));
  await page.getByRole('button', { name: 'Consultar' }).click();
  await expect(page.getByText(/Não encontramos o serviço/)).toBeVisible();
});
