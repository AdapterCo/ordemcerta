-- Remoção do armazenamento de objetos (MinIO/S3) e do antivírus (ClamAV).
--  * Fotos/anexos de OS deixam de existir. service_order_files passa a guardar SOMENTE a
--    assinatura do cliente (PNG pequeno) no próprio banco, como evidência imutável.
--  * Exportações de relatório (CSV/PDF) ficam no banco até expirar (7 dias).
--
-- Atenção: registros antigos apontavam para objetos externos e não têm conteúdo no banco;
-- por isso são descartados (sistema ainda não estava em produção). As referências de
-- termos/recibos de retirada a esses registros são anuladas antes.

UPDATE service_order_terms SET signature_file_id = NULL WHERE signature_file_id IS NOT NULL;
UPDATE pickup_receipts SET signature_file_id = NULL WHERE signature_file_id IS NOT NULL;
DELETE FROM service_order_files;

DROP INDEX IF EXISTS "service_order_files_storage_key_key";
ALTER TABLE "service_order_files"
  DROP COLUMN "storage_key",
  DROP COLUMN "type",
  DROP COLUMN "scan_status",
  DROP COLUMN "deleted_at",
  ADD COLUMN "content" BYTEA NOT NULL;
ALTER TABLE "service_order_files" ADD CONSTRAINT service_order_files_signature_png
  CHECK (mime = 'image/png' AND size_bytes > 0 AND size_bytes <= 400000 AND octet_length(content) = size_bytes);

DROP TYPE "FileType";
DROP TYPE "ScanStatus";

UPDATE "report_exports" SET "status" = 'FAILED', "error" = 'armazenamento removido' WHERE "status" IN ('DONE', 'QUEUED', 'PROCESSING');
ALTER TABLE "report_exports"
  DROP COLUMN "storage_key",
  ADD COLUMN "content" BYTEA,
  ADD COLUMN "content_type" VARCHAR(60);

ALTER TABLE "products" DROP COLUMN "image_storage_key";
ALTER TABLE "tenants" DROP COLUMN "logo_storage_key";

-- Permissões: assinatura vira append-only (sem UPDATE/DELETE para o papel da aplicação);
-- coluna de logo removida do GRANT de tenants.
CREATE OR REPLACE FUNCTION oc_apply_grants() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ordemcerta_system') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO ordemcerta_system';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ordemcerta_system';
    EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ordemcerta_system';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ordemcerta_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO ordemcerta_app';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ordemcerta_app';
    -- tabelas operacionais do tenant (protegidas por RLS)
    FOREACH t IN ARRAY ARRAY[
      'branches','tenant_memberships','membership_branches','invitations','support_access_grants','counters',
      'customers','customer_consents','devices','service_orders','service_order_accessories','service_order_checklists',
      'service_order_notes','service_order_terms','device_unlock_secrets',
      'quotes','quote_lines','quote_access_tokens','public_tracking_tokens','public_otps','warranty_claims','pickup_receipts',
      'categories','suppliers','products','product_compatibility','stock_locations','stock_balances',
      'stock_reservations','stock_transfers','stock_transfer_lines',
      'sales','sale_items','receivables','payments','refunds','cash_registers','cash_sessions',
      'messaging_channels','message_templates','message_deliveries',
      'settings','document_templates','report_exports','idempotency_records','feature_usage'
    ] LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO ordemcerta_app', t);
    END LOOP;
    -- append-only
    FOREACH t IN ARRAY ARRAY['audit_logs','service_order_events','stock_movements','cash_movements','financial_ledger',
      'payment_allocations','messaging_billing_checks','notification_outbox','issued_documents','email_outbox','service_order_files'] LOOP
      EXECUTE format('GRANT SELECT, INSERT ON %I TO ordemcerta_app', t);
    END LOOP;
    -- somente leitura (escrita exclusiva do billing/plataforma via papel de sistema)
    FOREACH t IN ARRAY ARRAY['tenants','plans','plan_price_history','subscriptions','billing_invoices',
      'billing_payment_attempts','plan_change_requests'] LOOP
      EXECUTE format('GRANT SELECT ON %I TO ordemcerta_app', t);
    END LOOP;
    EXECUTE 'GRANT UPDATE (name, legal_name, document, timezone, phone, email, address, primary_color, onboarding_completed_at, updated_at) ON tenants TO ordemcerta_app';
    -- usuários: somente colunas não sensíveis (nunca password_hash, mfa_secret_enc)
    EXECUTE 'GRANT SELECT (id, name, email, status, created_at) ON users TO ordemcerta_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION app_current_tenant() TO ordemcerta_app';
  END IF;
END $$;

SELECT oc_apply_grants();
