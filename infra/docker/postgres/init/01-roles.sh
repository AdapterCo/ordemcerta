#!/bin/bash
# Executado UMA vez na criação do volume do PostgreSQL (docker-entrypoint-initdb.d).
# Cria os três papéis e o banco. Para instalações existentes, execute manualmente
# com um superusuário (substituindo as senhas).
set -euo pipefail

: "${OC_OWNER_PASSWORD:?defina OC_OWNER_PASSWORD}"
: "${OC_APP_PASSWORD:?defina OC_APP_PASSWORD}"
: "${OC_SYSTEM_PASSWORD:?defina OC_SYSTEM_PASSWORD}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_pw="$OC_OWNER_PASSWORD" -v app_pw="$OC_APP_PASSWORD" -v sys_pw="$OC_SYSTEM_PASSWORD" <<'EOSQL'
CREATE ROLE ordemcerta_owner LOGIN PASSWORD :'owner_pw';
-- Papel da API: RLS sempre aplicado
CREATE ROLE ordemcerta_app LOGIN PASSWORD :'app_pw' NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
-- Papel de sistema: BYPASSRLS, uso restrito (auth, plataforma, billing, webhooks, worker)
CREATE ROLE ordemcerta_system LOGIN PASSWORD :'sys_pw' BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE ordemcerta OWNER ordemcerta_owner;
EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname ordemcerta <<'EOSQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO ordemcerta_owner;
GRANT USAGE ON SCHEMA public TO ordemcerta_app, ordemcerta_system;
REVOKE CREATE ON DATABASE ordemcerta FROM PUBLIC;
GRANT CONNECT ON DATABASE ordemcerta TO ordemcerta_app, ordemcerta_system;
EOSQL
echo "papéis OrdemCerta criados"
