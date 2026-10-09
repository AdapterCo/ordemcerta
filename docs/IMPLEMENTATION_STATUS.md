# Status de implementação — OrdemCerta

Documento vivo, atualizado ao fim de cada marco (seção 12 da especificação).
Ambiente local de desenvolvimento sem Docker/PostgreSQL: validação local por build,
typecheck, testes unitários, `prisma validate` e `prisma migrate diff`. Testes de
integração/E2E são executados na VPS (PostgreSQL 17 + Redis 7).

## Estrutura

- `packages/shared` — enums, permissões (RBAC), máquinas de estado, dinheiro, CPF/CNPJ (inclui alfanumérico), telefone E.164, datas/fuso, regras de billing (âncora, pró-rata, tolerância), planos (seed 17.1), schemas Zod usados por API e web. 28 testes unitários.
- `packages/server` — env (Zod), criptografia AES-256-GCM com rotação + índice cego, Prisma helpers (RLS `SET LOCAL app.tenant_id`, contador transacional), adapter Mercado Pago (SDK oficial), adapter WhatsApp Cloud API oficial + adaptador não oficial bloqueado, mailer, PDFs (pdfkit), filas BullMQ, motor de billing.
- `prisma/` — schema (71 tabelas), migration `init` gerada e migration `rls_integrity` (RLS deny-by-default, FKs compostas com tenant_id, triggers de imutabilidade e referência entre tenants, CHECKs, exclusão de períodos sobrepostos, grants por papel), seed idempotente.
- `apps/api` — NestJS. Núcleo: contexto ALS, TenantDb (RLS), guards (auth/sessão revalidada, permissões, MFA plataforma, assinatura operacional, suporte somente leitura), idempotência, auditoria, outbox, realtime Socket.IO (rooms tenant/branch), quotas do plano com advisory lock, rate limit Redis, filtro de erros uniforme.

## Módulos da API

| Módulo | Situação |
|---|---|
| auth (login Argon2id, bloqueio progressivo, MFA TOTP, refresh rotativo + reuso, CSRF, reset, convites, sessões, troca de empresa) | implementado |
| tenant/filiais/membros/configurações/suporte auditado | implementado |
| clientes/aparelhos/consentimentos/LGPD | implementado |
| financeiro (recebíveis, pagamentos mistos, estornos, ledger, caixa) | implementado |
| catálogo/estoque/transferências/inventário | implementado |
| PDV/vendas | implementado |
| ordens de serviço (estados, fila técnica, arquivos, PDFs, entrega) | implementado |
| orçamentos + aprovação | implementado |
| portal público | implementado |
| garantias | implementado |
| mensageria WhatsApp BYOK | implementado (homologação Meta pendente) |
| relatórios/exportações | implementado |
| billing Mercado Pago (API) | implementado (homologação MP pendente) |
| plataforma | implementado |
| worker | implementado |
| web (React: público, portal, tenant, plataforma — 50+ telas) | implementado; typecheck + build OK |
| infra/docker/traefik/backup/CI/docs | implementado (não executado: sem Docker local) |

## Verificações locais executadas

- `packages/shared`: 28 testes unitários OK; build tsup OK.
- `packages/server`: typecheck OK.
- `apps/api`: typecheck OK; inicialização real com env fictícia — DI resolvido, 173 rotas OpenAPI, erros uniformes, `/health/ready` 503 sem banco/Redis.
- `apps/worker`: typecheck OK; 3 testes unitários OK.
- `apps/web`: typecheck OK; `vite build` OK; tela de login renderizada no navegador.
- `prisma validate` OK; migration `init` gerada por `prisma migrate diff` (71 tabelas).

## Marcos (seção 12)

| Marco | Código | Verificado localmente | Depende de validação externa |
|---|---|---|---|
| M0 Fundação | ✅ | build, typecheck, boot da API, unit | migrations/RLS/seed no PostgreSQL real (CI/VPS) |
| M1 Atendimento | ✅ | build, typecheck | testes de integração/E2E na VPS |
| M2 Operação | ✅ | build, typecheck | testes de concorrência na VPS |
| M3 Comunicação | ✅ | unit (assinatura, parsing) | app Meta aprovado, webhook, template, mensagem real, faturamento BYOK |
| M4 Comercialização | ✅ | unit (âncora, pró-rata, monotonicidade) | credenciais MP, sandbox, webhooks reais, cartão/Pix |
| M5 Produção | parcial | — | deploy, carga, pentest, backup/restore, monitoramento |

## Testes

- Unitários: 40 (shared 28, server 9, worker 3) — verdes localmente.
- Integração (`tests/integration`): RLS/isolamento, FKs compostas e triggers, imutabilidade, endpoints entre empresas, concorrência (última unidade, pagamento duplicado, sangrias simultâneas, versão de OS, quotas), suspensão, fluxo completo da OS, billing (Pix idempotente, ativação só com pagamento, webhook duplicado/fora de ordem, renovação única, tolerância → suspensão → reativação, upgrade/downgrade, contestação aberta/ganha só audita, contestação perdida suspende e regularização reativa). **Não executados localmente** (sem PostgreSQL/Redis); executar no CI/VPS.
- E2E (`tests/e2e`): fluxos principais com Playwright; requer stack em execução e dados de homologação.

## Limitações conhecidas

- Integrações Mercado Pago, Meta/WhatsApp e SMTP implementadas, porém **não homologadas** — sem credenciais retornam "integração não configurada".
- Cobrança avulsa por cartão da diferença de upgrade não implementada (exige checkout/tokenização); a diferença é paga via Pix mesmo para assinaturas de cartão.
- Adaptador WhatsApp por QR Code (não oficial) não habilitado (falha explicitamente).
- Embedded Signup da Meta depende de habilitação do app; fluxo assistido disponível.
- Confirmação de e-mail no cadastro não implementada (opcional na especificação).
- Documento fiscal fora do escopo (comprovantes marcados como NÃO FISCAL).
- Termos/políticas são modelos e exigem revisão jurídica.

## Decisão: sem armazenamento de objetos (2026-10-09)

A pedido do responsável, removidos MinIO/S3, antivírus (ClamAV) e upload de fotos/anexos de OS (desvio consciente da instrução original). Consequências:
- Assinatura do cliente (entrada/retirada) gravada no PostgreSQL (`service_order_files.content`, PNG ≤ 400 KB, append-only para o papel da aplicação).
- Exportações CSV/PDF gravadas no banco (`report_exports.content`) e baixadas por `GET /reports/exports/:id/download`; conteúdo apagado após 7 dias.
- Backups em diretório local da VPS (`BACKUP_DIR`); a cópia para fora da VPS fica a cargo do operador.
- Migração `20261009000100_remove_object_storage` descarta registros de anexos/assinaturas antigos (não havia produção).

