#!/usr/bin/env bash
# Backup criptografado do PostgreSQL em diretório local da VPS + retenção.
# Uso (cron diário na VPS):  set -a; . ./.env; set +a; ./infra/backup/backup.sh
# Requer: docker e gpg. Recomendado: copiar BACKUP_DIR para fora da VPS (rsync/rclone/scp),
# pois um backup que só existe na própria VPS não protege contra perda do servidor.
set -euo pipefail

: "${BACKUP_PASSPHRASE:?defina BACKUP_PASSPHRASE}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/ordemcerta}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FILE="$WORK/ordemcerta-$STAMP.dump"
mkdir -p "$BACKUP_DIR/db"
chmod 700 "$BACKUP_DIR"

echo "[backup] pg_dump (formato custom)"
docker compose exec -T oc-postgres pg_dump -U postgres -d ordemcerta -Fc --no-owner > "$FILE"

echo "[backup] criptografando (AES256)"
gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" --symmetric --cipher-algo AES256 -o "$FILE.gpg" "$FILE"
sha256sum "$FILE.gpg" | awk '{print $1}' > "$FILE.gpg.sha256"

echo "[backup] gravando em $BACKUP_DIR/db"
mv "$FILE.gpg" "$BACKUP_DIR/db/ordemcerta-$STAMP.dump.gpg"
mv "$FILE.gpg.sha256" "$BACKUP_DIR/db/ordemcerta-$STAMP.dump.gpg.sha256"

echo "[backup] retenção: removendo backups com mais de $RETENTION_DAYS dias"
find "$BACKUP_DIR/db" -maxdepth 1 -type f -name 'ordemcerta-*.dump.gpg*' -mtime "+$RETENTION_DAYS" -print -delete
echo "[backup] concluído: ordemcerta-$STAMP"
