# OrdemCerta

SaaS multiempresa para assistências técnicas de celulares: recepção e ordens de serviço, fila técnica em tempo real, orçamentos com aprovação, portal do cliente, WhatsApp oficial (BYOK), clientes, catálogo e estoque, PDV, caixa, financeiro, garantias, relatórios, administração da plataforma e assinaturas via Mercado Pago.

Produção: `https://ordemcerta.adapterco.com.br` (site, portal `/status` e API `/api/v1` no mesmo host, via Traefik).

> **Situação real:** consulte [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md). Integrações externas (Mercado Pago, Meta/WhatsApp, SMTP) **não estão homologadas**: sem credenciais, o sistema responde "integração não configurada" e nunca simula sucesso.

## Stack

| Camada | Tecnologia |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| Web | React 19, Vite, TypeScript, React Router 7, TanStack Query, Tailwind 4, componentes estilo shadcn (Radix), React Hook Form + Zod |
| API | NestJS 11, REST `/api/v1`, OpenAPI em `/api/docs`, Prisma 6, Socket.IO (adapter Redis) |
| Worker | NestJS (application context) + BullMQ |
| Dados | PostgreSQL 17 (RLS), Redis 7 — sem storage de objetos (não guarda fotos; assinatura e exportações ficam no banco) |
| PDF | pdfkit (A4 e térmico 80 mm) |

```
apps/{api,web,worker}  packages/{shared,server}  prisma/{schema.prisma,migrations,seed.ts}
infra/{docker,traefik,backup}  docs/{architecture,api,permissions,states,runbooks,privacy}  tests/{integration,e2e}
```

`packages/shared` (enums, RBAC, máquinas de estado, regras de dinheiro/billing, schemas Zod) é usado por API, worker e web. `packages/server` concentra adapters (Mercado Pago, WhatsApp Cloud API, e-mail), criptografia, PDFs, relatórios e o motor de billing.

## Requisitos

- Node.js ≥ 22 (imagens usam Node 24), pnpm 10.13
- Docker + Docker Compose v2 (VPS)
- PostgreSQL 17 e Redis 7 (via compose)

## Variáveis

Copie `.env.example` para `.env` e preencha. Pontos críticos:

- Três papéis de banco: `ordemcerta_owner` (migrations), `ordemcerta_app` (API, **sem BYPASSRLS**), `ordemcerta_system` (BYPASSRLS; auth, plataforma, billing, webhooks, worker). Criados por `infra/docker/postgres/init/01-roles.sh` no primeiro start do volume.
- `JWT_SECRET` (`openssl rand -base64 48`), `ENCRYPTION_KEY` (`openssl rand -base64 32`). Rotação: novo `ENCRYPTION_KEY_ID` + antigas em `ENCRYPTION_KEYS_PREVIOUS`.
- Se o seu `docker compose` não interpolar `${VAR}` dentro do `.env`, escreva as URLs completas.

## Desenvolvimento local

```bash
cp .env.example .env            # ajuste NODE_ENV=development, MAIL_TRANSPORT=console, COOKIE_SECURE=false, APP_URL=http://localhost:5173
pnpm install --frozen-lockfile
docker compose up -d oc-postgres oc-redis
pnpm db:generate
DATABASE_MIGRATION_URL=... pnpm db:migrate:deploy
SEED_DEMO=true pnpm db:seed     # planos + empresa fictícia (demo.dono@ordemcerta.test / DemoOrdemCerta2026)
pnpm dev                        # api :3001, worker :3002, web :5173 (proxy /api)
```

## Build e testes

```bash
pnpm build                 # turbo: shared → server → api/worker/web
pnpm test                  # unitários (shared, worker)
pnpm test:integration      # PostgreSQL + Redis reais: RLS, isolamento, concorrência, quotas, billing, fluxo da OS
pnpm test:e2e              # Playwright contra a stack em execução (E2E_BASE_URL, E2E_OWNER_*, E2E_TECH_*)
pnpm db:validate           # valida o schema Prisma
```

O CI (`.github/workflows/ci.yml`) cria os papéis, aplica as migrations do zero, roda o seed duas vezes (idempotência) e executa unitários + integração.

## Deploy na VPS (EasyPanel/Traefik existente)

1. Inspecione o Traefik (rede, entrypoint, certresolver): [`infra/traefik/README.md`](infra/traefik/README.md). Ajuste `TRAEFIK_*` no `.env`.
2. Valide DNS do domínio apontando para a VPS (não presumir).
3. Primeira instalação:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml build
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d oc-postgres oc-redis
   docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm oc-migrate
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d oc-api oc-worker oc-web
   ```
4. Verifique `https://ordemcerta.adapterco.com.br/health/ready` e os logs.

PostgreSQL e Redis **não** são publicados no host; o compose não usa as portas 80/443/3000 do EasyPanel.

### Atualização e rollback

- Imagens versionadas com `IMAGE_TAG`. Migrações são backward-compatible e rodam **antes** da troca de imagens, por job dedicado (`oc-migrate`). Nunca `prisma db push` em produção.
- Rollback: `IMAGE_TAG=<anterior> docker compose ... up -d oc-api oc-worker oc-web`. Detalhes em [`docs/runbooks`](docs/runbooks/README.md).
- Nunca execute migração destrutiva sem backup recente e confirmação.

## Backup

`infra/backup/backup.sh` (dump criptografado AES-256 em `BACKUP_DIR` na VPS + retenção; copie esse diretório para fora da VPS), `restore.sh` (destrutivo, exige `--confirm`), `restore-test.sh` (restauração mensal em banco temporário).

## Documentação

- Arquitetura e multi-tenancy: [`docs/architecture`](docs/architecture/README.md)
- RBAC: [`docs/permissions/matrix.md`](docs/permissions/matrix.md)
- Estados e regras: [`docs/states`](docs/states/README.md)
- Runbooks: [`docs/runbooks`](docs/runbooks/README.md)
- Privacidade/LGPD: [`docs/privacy`](docs/privacy/README.md)
- OpenAPI: [`docs/api/openapi.json`](docs/api/openapi.json) — importe no Postman ou Bruno (Import → OpenAPI).
