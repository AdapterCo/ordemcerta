#!/usr/bin/env bash
# Teste de restauração (mensal): restaura o backup mais recente em um banco
# temporário, valida integridade básica e descarta. Não toca o banco de produção.
set -euo pipefail
: "${BACKUP_S3_URI:?defina BACKUP_S3_URI}"
LATEST="$(aws s3 ls "$BACKUP_S3_URI/db/" | awk '{print $4}' | grep -E '\.dump\.gpg$' | sort | tail -1)"
[[ -n "$LATEST" ]] || { echo "nenhum backup encontrado"; exit 1; }
TMP_DB="ordemcerta_restore_test"
"$(dirname "$0")/restore.sh" "$LATEST" "$TMP_DB" --confirm
docker compose exec -T postgres psql -U postgres -d "$TMP_DB" -v ON_ERROR_STOP=1 <<'EOSQL'
SELECT count(*) AS migrations FROM _prisma_migrations WHERE finished_at IS NOT NULL;
SELECT count(*) AS tenants FROM tenants;
SELECT count(*) AS orders FROM service_orders;
SELECT count(*) AS plans FROM plans;
EOSQL
docker compose exec -T postgres dropdb -U postgres "$TMP_DB"
echo "[restore-test] OK: $LATEST"
