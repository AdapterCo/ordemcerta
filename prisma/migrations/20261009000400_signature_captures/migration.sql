-- Assinatura no celular do cliente: QR code / link de uso único (15 min). O token só existe em hash.

CREATE TABLE "signature_captures" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "purpose" "TermType" NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "signer_name" VARCHAR(120),
    "content" BYTEA,
    "captured_at" TIMESTAMPTZ(3),
    "consumed_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "signature_captures_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "signature_captures_token_hash_key" ON "signature_captures"("token_hash");
CREATE INDEX "signature_captures_tenant_id_order_id_idx" ON "signature_captures"("tenant_id", "order_id");
ALTER TABLE "signature_captures" ADD CONSTRAINT "signature_captures_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "service_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Regras: só termos de entrada/retirada; conteúdo PNG pequeno e coerente com a captura; consumo só após captura.
ALTER TABLE signature_captures ADD CONSTRAINT signature_captures_purpose CHECK (purpose IN ('INTAKE', 'PICKUP'));
ALTER TABLE signature_captures ADD CONSTRAINT signature_captures_content
  CHECK ((captured_at IS NULL AND content IS NULL AND signer_name IS NULL)
      OR (captured_at IS NOT NULL AND content IS NOT NULL AND signer_name IS NOT NULL AND octet_length(content) <= 400000));
ALTER TABLE signature_captures ADD CONSTRAINT signature_captures_consumed CHECK (consumed_at IS NULL OR captured_at IS NOT NULL);

-- Isolamento por empresa (deny-by-default)
ALTER TABLE signature_captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE signature_captures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON signature_captures;
CREATE POLICY tenant_isolation ON signature_captures USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

CREATE TRIGGER trg_signature_captures_created_by_member BEFORE INSERT OR UPDATE OF created_by ON signature_captures
  FOR EACH ROW EXECUTE FUNCTION oc_assert_tenant_member('created_by');

-- Permissões: oc_apply_grants() (redefinida em 20261009000300) já inclui signature_captures quando ela existe.
SELECT oc_apply_grants();
