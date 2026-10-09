# Arquitetura

## Componentes

```
Navegador ──HTTPS──> Traefik ──/──────────────> web (Nginx, SPA)
                         └──/api, /health──> api (NestJS) ──> PostgreSQL 17 (RLS)
                                               │  Socket.IO   └─> Redis 7 (filas, rate limit, adapter WS)
                                               └─ outbox ──> worker (BullMQ) ──> Mercado Pago (plataforma)
                                                                            ├─> WhatsApp Cloud API (BYOK do tenant)
                                                                            └─> SMTP
```

## Multi-tenancy

- Banco e schema compartilhados; `tenant_id` em todas as tabelas de negócio.
- **RLS deny-by-default** (`FORCE ROW LEVEL SECURITY`) com política `tenant_id = app_current_tenant()`. A API (papel `ordemcerta_app`, sem BYPASSRLS) executa toda operação de tenant em transação com `SELECT set_config('app.tenant_id', $1, true)` (equivalente a `SET LOCAL`), sem vazamento entre conexões do pool (`TenantDb`).
- `tenant_id` vem sempre do contexto autenticado (JWT → sessão revalidada a cada requisição → vínculo ativo). `branch_id` do cliente é validado contra as filiais autorizadas do membro.
- FKs compostas `(tenant_id, x_id) → (tenant_id, id)` em relações obrigatórias; triggers `oc_assert_same_tenant` nas referências opcionais.
- Papel `ordemcerta_system` (BYPASSRLS) restrito a autenticação, plataforma, billing, webhooks, resolução de tokens públicos e worker — sempre com filtro de tenant explícito.
- Suporte da plataforma: sem acesso a dados de clientes, exceto concessão temporária do proprietário (somente leitura, auditada a cada requisição).

## Consistência

- Numeração de OS/venda/transferência por contador transacional (`INSERT … ON CONFLICT DO UPDATE … RETURNING`), `UNIQUE(tenant_id, number)`.
- Controle de concorrência otimista (`version`) em OS, vendas e sessões de caixa; `SELECT … FOR UPDATE` em saldos de estoque (ordem determinística), cobranças, pagamentos e sessões de caixa; advisory lock por tenant para quotas do plano.
- `Idempotency-Key` obrigatório em vendas, pagamentos, caixa e estoque (`idempotency_records`), com reutilização da resposta e rejeição de corpo divergente.
- Tabelas append-only por trigger: auditoria, eventos da OS, movimentos de estoque e caixa, ledger, alocações. Registros financeiros nunca são excluídos.
- Outbox transacional (`notification_outbox`) gravado na mesma transação da mudança de estado; worker despacha com `FOR UPDATE SKIP LOCKED`, retries com backoff e DEAD. Eventos websocket só após commit; o cliente refaz consultas REST (websocket não é fonte da verdade).

## Financeiro

- Uma cobrança (`receivables`) por origem (OS ou venda) — sem duplicidade.
- Pagamentos manuais identificados (`provider=MANUAL`), mistos, com troco; alocações; estornos parciais/totais com lançamento compensatório.
- Ledger imutável: `REVENUE_SERVICE` (competência na entrega), `REVENUE_SALE`, `DISCOUNT`, `COGS`, `PAYMENT_RECEIVED`, `REFUND`, `REVENUE_REVERSAL`, `CASH_DIFFERENCE`. Sangria não é despesa.
- Billing da plataforma (`subscriptions`, `billing_*`) isolado do PDV/caixa da assistência.

## Billing (Mercado Pago)

- Cartão recorrente via PreApproval; Pix manual via pagamento avulso por fatura (no máximo uma cobrança ativa por fatura, chave de idempotência persistida antes da chamada externa).
- Ativação somente com pagamento **consultado na API oficial** após webhook com assinatura `x-signature` válida (SDK oficial `WebhookSignatureValidator`) ou reconciliação periódica. Redirect do navegador nunca ativa.
- Transições monotônicas; período prorrogado uma vez por fatura (`applied_at`); dia-âncora preservado (29–31 → último dia do mês) em America/Sao_Paulo.
- PAST_DUE com 3 dias de tolerância (parametrizável) → SUSPENDED (somente leitura; fechamento de caixa aberto permitido e auditado).
- **Contestações (chargeback)** — webhook do tópico `payment` e do tópico "Contestações" (`topic_chargebacks_wh`, consulta `GET /v1/chargebacks/{id}`):
  - contestação aberta (`in_mediation` ou `charged_back` em andamento), ganha (`charged_back/reimbursed`) ou coberta pelo Mercado Pago (`coverage_applied`): **somente auditoria**, uma vez por pagamento;
  - contestação **perdida** (`charged_back/settled`): suspensão imediata **sem tolerância**, empresa SUSPENDED (dados preservados, somente leitura), demais faturas abertas anuladas, mudanças de plano pendentes canceladas (pró-rata contestada volta ao plano anterior), cartão desvinculado (PreApproval cancelado no MP; falha fica em `provider_cancel_pending` e a reconciliação tenta de novo), modo PIX_MANUAL e nova fatura `REGULARIZATION` com vencimento imediato. O pagamento dela reabre o ciclo a partir da data do pagamento. Proprietários recebem e-mail `chargeback_suspended`; auditoria `chargeback_lost_suspended` visível em Plataforma › Reconciliação.
  - Pelo tópico `payment` a cobertura do provedor não é conhecida; por isso o tópico "Contestações" deve estar marcado no painel do Mercado Pago.

## WhatsApp (BYOK)

Interface `MessagingProvider`; adaptador oficial (Cloud API) por padrão; adaptador QR explicitamente não oficial e desabilitado. Envio somente com canal `ACTIVE`, que exige faturamento próprio da WABA validado (evidência auditável revisada pela plataforma). Webhook validado por `X-Hub-Signature-256`; tenant derivado do `phone_number_id` cadastrado. Opt-out por palavras-chave. Variáveis permitidas sem IMEI/senha/laudo.
