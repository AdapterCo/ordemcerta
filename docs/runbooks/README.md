# Runbooks

Prefixo de comando em produção: `DC="docker compose -f docker-compose.yml -f docker-compose.prod.yml"`.

## Deploy de nova versão

1. `./infra/backup/backup.sh` (confirme sucesso).
2. `IMAGE_TAG=<nova> $DC build api worker web`
3. `IMAGE_TAG=<nova> $DC run --rm migrate` — migrações backward-compatible (expand → deploy → contract em versões seguintes).
4. `IMAGE_TAG=<nova> $DC up -d api worker web`
5. Verificar `/health/ready`, logs (`$DC logs -f api worker`) e um fluxo manual (login, listar OS).

## Rollback

- Aplicação: `IMAGE_TAG=<anterior> $DC up -d api worker web`.
- Banco: migrações não são revertidas automaticamente. Só restaure backup (`restore.sh … --confirm`) com janela de manutenção e decisão explícita — há perda de dados posteriores ao backup.

## Backup e restauração

- Diário (cron): `set -a; . ./.env; set +a; ./infra/backup/backup.sh`
- Mensal: `./infra/backup/restore-test.sh` (banco temporário; registre o resultado).

## Incidentes

| Sintoma | Ação |
|---|---|
| `/health/ready` 503 database | `$DC ps postgres`, logs, espaço em disco; verificar senhas dos papéis |
| Filas paradas | Painel `/platform/jobs`; `$DC logs worker`; reprocessar falhas |
| Webhooks MP falhando | `/platform/billing-events`; checar `MP_WEBHOOK_SECRET`; reprocessar; `/platform/reconciliation/run` |
| WhatsApp `ERROR` | Token expirado/revogado: tenant revalida/reconecta em WhatsApp; envios ficam bloqueados (não afeta OS) |
| Pagamento sem correspondência | `/platform/reconciliation`; conferir no painel MP; estorno manual se duplicado |
| Tenant suspenso indevidamente | Conferir faturas; "Consultar pagamento" na fatura; reativação manual auditada em `/platform/tenants/:id` |

## Rotação de credenciais

- `ENCRYPTION_KEY`: gere nova chave, defina `ENCRYPTION_KEY_ID=k2`, mova a anterior para `ENCRYPTION_KEYS_PREVIOUS=k1:<base64>`; dados novos usam k2, antigos continuam legíveis.
- `JWT_SECRET`: trocar invalida access tokens (refresh continua válido; usuários renovam automaticamente).
- Senhas do PostgreSQL: `ALTER ROLE … PASSWORD …` e atualizar `.env`; reiniciar api/worker.
- Mercado Pago/Meta: gerar novo segredo no painel do provedor, atualizar `.env`, reiniciar.

## Checklist de produção (M5)

- [ ] DNS e TLS validados no domínio
- [ ] Rede/entrypoint/certresolver do Traefik confirmados
- [ ] Papéis do banco criados; `ordemcerta_app` sem BYPASSRLS
- [ ] Migrações do zero + seed (2x) OK
- [ ] `pnpm test:integration` verde na VPS
- [ ] Backup + teste de restauração executados
- [ ] Mercado Pago homologado (cartão, Pix, webhooks, cancelamento, alteração de valor, reconciliação) com credenciais de teste e depois de produção
- [ ] Meta: app aprovado, webhook verificado, template aprovado, mensagem real entregue, faturamento próprio validado
- [ ] SMTP com SPF/DKIM
- [ ] Cópia de `BACKUP_DIR` para fora da VPS agendada
- [ ] Termos de uso, privacidade, garantia e responsabilidade revisados juridicamente
- [ ] Monitoramento/alertas (health, filas, erros 5xx, disco) e pentest orientado a multi-tenancy
