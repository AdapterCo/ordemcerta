-- Peças compradas para a OS (fora do estoque): custo, fornecedor e forma de pagamento.

-- CreateEnum
CREATE TYPE "PartPaymentMethod" AS ENUM ('CASH_REGISTER', 'CASH_OTHER', 'PIX', 'DEBIT_CARD', 'CREDIT_CARD', 'BANK_SLIP', 'ON_CREDIT', 'OTHER');

-- CreateTable
CREATE TABLE "order_part_purchases" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_cost_cents" INTEGER NOT NULL,
    "total_cost_cents" INTEGER NOT NULL,
    "supplier_name" VARCHAR(120),
    "payment_method" "PartPaymentMethod" NOT NULL,
    "cash_movement_id" UUID,
    "purchased_at" TIMESTAMPTZ(3) NOT NULL,
    "notes" VARCHAR(500),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "canceled_at" TIMESTAMPTZ(3),
    "canceled_by" UUID,
    "cancel_reason" VARCHAR(300),
    CONSTRAINT "order_part_purchases_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "order_part_purchases_tenant_id_order_id_idx" ON "order_part_purchases"("tenant_id", "order_id");
CREATE UNIQUE INDEX "order_part_purchases_tenant_id_id_key" ON "order_part_purchases"("tenant_id", "id");
ALTER TABLE "order_part_purchases" ADD CONSTRAINT "order_part_purchases_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "service_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Regras de valor
ALTER TABLE order_part_purchases ADD CONSTRAINT order_part_purchases_amounts
  CHECK (qty > 0 AND unit_cost_cents >= 0 AND total_cost_cents = qty * unit_cost_cents);
ALTER TABLE order_part_purchases ADD CONSTRAINT order_part_purchases_cash_link
  CHECK ((payment_method = 'CASH_REGISTER') = (cash_movement_id IS NOT NULL));
ALTER TABLE order_part_purchases ADD CONSTRAINT order_part_purchases_cancel
  CHECK ((canceled_at IS NULL AND canceled_by IS NULL AND cancel_reason IS NULL) OR (canceled_at IS NOT NULL AND canceled_by IS NOT NULL AND cancel_reason IS NOT NULL));

-- Isolamento por empresa (deny-by-default)
ALTER TABLE order_part_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_part_purchases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON order_part_purchases;
CREATE POLICY tenant_isolation ON order_part_purchases USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

-- Referências da mesma empresa
CREATE TRIGGER trg_order_part_purchases_branch_id_tenant BEFORE INSERT OR UPDATE OF branch_id ON order_part_purchases
  FOR EACH ROW EXECUTE FUNCTION oc_assert_same_tenant('branch_id', 'branches');
CREATE TRIGGER trg_order_part_purchases_cash_movement_id_tenant BEFORE INSERT OR UPDATE OF cash_movement_id ON order_part_purchases
  FOR EACH ROW EXECUTE FUNCTION oc_assert_same_tenant('cash_movement_id', 'cash_movements');
CREATE TRIGGER trg_order_part_purchases_created_by_member BEFORE INSERT OR UPDATE OF created_by ON order_part_purchases
  FOR EACH ROW EXECUTE FUNCTION oc_assert_tenant_member('created_by');

-- Sem exclusão física (cancelamento auditado)
CREATE TRIGGER trg_order_part_purchases_nodelete BEFORE DELETE ON order_part_purchases FOR EACH ROW EXECUTE FUNCTION oc_forbid_delete();

-- Permissões
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
    -- sem exclusão: só criação e cancelamento/atualização (tabelas novas entram quando existirem)
    FOREACH t IN ARRAY ARRAY['order_part_purchases','signature_captures'] LOOP
      IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
        EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO ordemcerta_app', t);
      END IF;
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
