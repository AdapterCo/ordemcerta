#!/usr/bin/env bash
# Backup criptografado do PostgreSQL + envio offsite + retenção.
# Uso (cron diário na VPS):  set -a; . ./.env; set +a; ./infra/backup/backup.sh
# Requer: docker, gpg, aws-cli (ou compatível S3) configurado para BACKUP_S3_URI.
set -euo pipefail

: "${BACKUP_PASSPHRASE:?defina BACKUP_PASSPHRASE}"
: "${BACKUP_S3_URI:?defina BACKUP_S3_URI}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FILE="$WORK/ordemcerta-$STAMP.dump"

echo "[backup] pg_dump (formato custom)"
docker compose exec -T postgres pg_dump -U postgres -d ordemcerta -Fc --no-owner > "$FILE"

echo "[backup] criptografando (AES256)"
gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" --symmetric --cipher-algo AES256 -o "$FILE.gpg" "$FILE"
sha256sum "$FILE.gpg" | awk '{print $1}' > "$FILE.gpg.sha256"

echo "[backup] enviando para $BACKUP_S3_URI"
aws s3 cp "$FILE.gpg" "$BACKUP_S3_URI/db/ordemcerta-$STAMP.dump.gpg"
aws s3 cp "$FILE.gpg.sha256" "$BACKUP_S3_URI/db/ordemcerta-$STAMP.dump.gpg.sha256"

echo "[backup] espelhando bucket de arquivos (MinIO)"
if docker compose ps minio >/dev/null 2>&1; then
  docker compose run --rm --entrypoint /bin/sh minio-init -c \
    "mc alias set oc http://minio:9000 \$MINIO_ROOT_USER \$MINIO_ROOT_PASSWORD >/dev/null && mc mirror --overwrite oc/\$S3_BUCKET /tmp/files >/dev/null && echo ok" || echo "[backup] aviso: espelhamento de arquivos falhou"
fi

echo "[backup] retenção: removendo backups com mais de $RETENTION_DAYS dias"
CUTOFF="$(date -u -d "-$RETENTION_DAYS days" +%Y%m%d)"
aws s3 ls "$BACKUP_S3_URI/db/" | awk '{print $4}' | while read -r name; do
  d="$(echo "$name" | sed -E 's/ordemcerta-([0-9]{8}).*/\1/')"
  if [[ "$d" =~ ^[0-9]{8}$ && "$d" < "$CUTOFF" ]]; then aws s3 rm "$BACKUP_S3_URI/db/$name"; fi
done
echo "[backup] concluído: ordemcerta-$STAMP"
