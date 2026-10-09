#!/usr/bin/env bash
# Restaura um backup criptografado. DESTRUTIVO para o banco de destino.
# Uso: ./infra/backup/restore.sh ordemcerta-20261008T030000Z.dump.gpg [banco_destino] --confirm
set -euo pipefail

NAME="${1:?informe o nome do backup}"
TARGET_DB="${2:-ordemcerta}"
[[ "${3:-}" == "--confirm" ]] || { echo "Operação destrutiva. Repita com --confirm após confirmar backup atual."; exit 1; }
: "${BACKUP_PASSPHRASE:?defina BACKUP_PASSPHRASE}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/ordemcerta}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cp "$BACKUP_DIR/db/$NAME" "$WORK/b.gpg"
cp "$BACKUP_DIR/db/$NAME.sha256" "$WORK/b.sha256"
[[ "$(sha256sum "$WORK/b.gpg" | awk '{print $1}')" == "$(cat "$WORK/b.sha256")" ]] || { echo "checksum inválido"; exit 2; }
gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" -o "$WORK/b.dump" -d "$WORK/b.gpg"

docker compose exec -T postgres psql -U postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$TARGET_DB' AND pid <> pg_backend_pid();" >/dev/null
docker compose exec -T postgres dropdb -U postgres --if-exists "$TARGET_DB"
docker compose exec -T postgres createdb -U postgres -O ordemcerta_owner "$TARGET_DB"
docker compose exec -T postgres pg_restore -U postgres -d "$TARGET_DB" --no-owner --role=ordemcerta_owner < "$WORK/b.dump"
echo "[restore] concluído em $TARGET_DB. Reaplique grants: SELECT oc_apply_grants();"
docker compose exec -T postgres psql -U postgres -d "$TARGET_DB" -c "SELECT oc_apply_grants();" >/dev/null
