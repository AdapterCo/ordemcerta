-- Token de acompanhamento também guardado criptografado (AES-256-GCM, chave da aplicação):
-- o worker monta o link completo /status/<nº>#token=... em qualquer notificação, não só na de "OS recebida".
-- A autenticação continua pelo hash (token_hash); token_enc nunca é exibido nem registrado em log.
ALTER TABLE "public_tracking_tokens" ADD COLUMN "token_enc" TEXT;
