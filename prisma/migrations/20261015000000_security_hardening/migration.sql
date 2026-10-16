-- Endurecimento de segurança (varredura de 2026-10-15).

-- Confirmação de e-mail: prova de posse da caixa postal antes de vincular a conta a outra empresa.
CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");
CREATE INDEX "email_verification_tokens_user_id_idx" ON "email_verification_tokens"("user_id");
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Refresh rotativo com tolerância: duas abas renovando juntas não derrubam a sessão.
ALTER TABLE "sessions" ADD COLUMN "previous_refresh_hash" VARCHAR(128);

-- TOTP: último passo aceito (o mesmo código não vale duas vezes).
ALTER TABLE "users" ADD COLUMN "mfa_last_step" INTEGER;

-- Tabela nova: permissões do papel de sistema (a função é idempotente).
SELECT oc_apply_grants();
