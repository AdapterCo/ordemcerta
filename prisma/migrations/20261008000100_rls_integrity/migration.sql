-- OrdemCerta — RLS, integridade entre tenants, imutabilidade e permissões.
--
-- Papéis (criados fora das migrations, ver infra/docker/postgres/init/01-roles.sh):
--   ordemcerta_owner  : dono do schema, executa migrations.
--   ordemcerta_app    : usado pela API em requisições de tenant. SEM BYPASSRLS.
--                       Toda transação define `SET LOCAL app.tenant_id`.
--   ordemcerta_system : BYPASSRLS. Usado apenas por autenticação, plataforma,
--                       webhooks, billing e workers, com escopo explícito no código.
--
-- Política deny-by-default: sem app.tenant_id definido, nenhuma linha é visível
-- nem gravável pelo papel da aplicação.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ------------------------------------------------------------- contexto tenant
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

-- -------------------------------------------------------------------- RLS
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'branches','tenant_memberships','membership_branches','invitations','support_access_grants',
    'subscriptions','billing_invoices','billing_payment_attempts','plan_change_requests','feature_usage','counters',
    'customers','customer_consents','devices','service_orders','service_order_accessories','service_order_checklists',
    'service_order_events','service_order_notes','service_order_files','service_order_terms','device_unlock_secrets',
    'quotes','quote_lines','quote_access_tokens','public_tracking_tokens','public_otps','warranty_claims','pickup_receipts',
    'categories','suppliers','products','product_compatibility','stock_locations','stock_balances','stock_movements',
    'stock_reservations','stock_transfers','stock_transfer_lines',
    'sales','sale_items','receivables','payments','payment_allocations','refunds','cash_registers','cash_sessions',
    'cash_movements','financial_ledger',
    'messaging_channels','messaging_billing_checks','message_templates','message_deliveries',
    'settings','document_templates','issued_documents','report_exports',
    -- tenant_id anulável: linhas sem tenant ficam invisíveis ao papel da aplicação
    'audit_logs','notification_outbox','idempotency_records','email_outbox'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t
    );
  END LOOP;
END $$;

-- tenants: o tenant enxerga apenas a própria linha
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_self ON tenants;
CREATE POLICY tenant_self ON tenants USING (id = app_current_tenant()) WITH CHECK (id = app_current_tenant());

-- ------------------------------------------------------- tabelas imutáveis
CREATE OR REPLACE FUNCTION oc_forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Tabela % é somente inserção (append-only)', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_logs','billing_audit_logs','service_order_events','stock_movements','cash_movements','financial_ledger','payment_allocations','messaging_billing_checks'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_immutable ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION oc_forbid_mutation()', t, t);
  END LOOP;
END $$;

-- Registros financeiros nunca são apagados (somente cancelados/estornados)
CREATE OR REPLACE FUNCTION oc_forbid_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Registros de % não podem ser excluídos; use cancelamento/estorno', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['service_orders','quotes','quote_lines','sales','sale_items','receivables','payments','refunds','cash_sessions','billing_invoices','billing_payments','billing_payment_attempts','subscriptions','pickup_receipts','service_order_terms','warranty_claims'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_nodelete ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_nodelete BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION oc_forbid_delete()', t, t);
  END LOOP;
END $$;

-- Orçamento aprovado não pode ser alterado silenciosamente (só SUPERSEDED)
CREATE OR REPLACE FUNCTION oc_quote_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('APPROVED','REJECTED','SUPERSEDED','EXPIRED') THEN
    IF NEW.total_cents <> OLD.total_cents OR NEW.subtotal_cents <> OLD.subtotal_cents
       OR NEW.discount_cents <> OLD.discount_cents OR NEW.content_hash <> OLD.content_hash
       OR NEW.version <> OLD.version THEN
      RAISE EXCEPTION 'Orçamento % finalizado não pode ser alterado; crie nova versão', OLD.id USING ERRCODE = '42501';
    END IF;
    IF OLD.status = 'APPROVED' AND NEW.status NOT IN ('APPROVED','SUPERSEDED') THEN
      RAISE EXCEPTION 'Orçamento aprovado só pode ser substituído' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_quotes_guard ON quotes;
CREATE TRIGGER trg_quotes_guard BEFORE UPDATE ON quotes FOR EACH ROW EXECUTE FUNCTION oc_quote_guard();

CREATE OR REPLACE FUNCTION oc_quote_lines_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  st text;
BEGIN
  SELECT status INTO st FROM quotes WHERE id = COALESCE(NEW.quote_id, OLD.quote_id);
  IF st IS NOT NULL AND st <> 'DRAFT' THEN
    RAISE EXCEPTION 'Linhas de orçamento enviado/finalizado são imutáveis' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_quote_lines_guard ON quote_lines;
CREATE TRIGGER trg_quote_lines_guard BEFORE UPDATE OR DELETE ON quote_lines FOR EACH ROW EXECUTE FUNCTION oc_quote_lines_guard();

-- -------------------------------------------- referências opcionais entre tenants
CREATE OR REPLACE FUNCTION oc_assert_same_tenant() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  col text := TG_ARGV[0];
  parent text := TG_ARGV[1];
  ref uuid;
  ok boolean;
BEGIN
  EXECUTE format('SELECT ($1).%I::uuid', col) INTO ref USING NEW;
  IF ref IS NULL THEN
    RETURN NEW;
  END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1 AND tenant_id = $2)', parent) INTO ok USING ref, NEW.tenant_id;
  IF NOT ok THEN
    RAISE EXCEPTION 'Referência entre empresas rejeitada: %.%', TG_TABLE_NAME, col USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION oc_assert_tenant_member() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  col text := TG_ARGV[0];
  ref uuid;
  ok boolean;
BEGIN
  EXECUTE format('SELECT ($1).%I::uuid', col) INTO ref USING NEW;
  IF ref IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT EXISTS (SELECT 1 FROM tenant_memberships WHERE user_id = ref AND tenant_id = NEW.tenant_id) INTO ok;
  IF NOT ok THEN
    RAISE EXCEPTION 'Usuário não pertence à empresa: %.%', TG_TABLE_NAME, col USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('service_orders','approved_quote_id','quotes'),
    ('service_orders','warranty_of_order_id','service_orders'),
    ('service_order_terms','signature_file_id','service_order_files'),
    ('pickup_receipts','signature_file_id','service_order_files'),
    ('quote_lines','product_id','products'),
    ('warranty_claims','original_line_id','quote_lines'),
    ('warranty_claims','return_order_id','service_orders'),
    ('products','category_id','categories'),
    ('products','supplier_id','suppliers'),
    ('sales','customer_id','customers'),
    ('sales','order_id','service_orders'),
    ('sales','cash_session_id','cash_sessions'),
    ('receivables','customer_id','customers'),
    ('payments','cash_session_id','cash_sessions'),
    ('refunds','cash_session_id','cash_sessions'),
    ('cash_movements','payment_id','payments'),
    ('messaging_channels','branch_id','branches'),
    ('message_deliveries','channel_id','messaging_channels'),
    ('message_deliveries','order_id','service_orders'),
    ('message_deliveries','template_id','message_templates'),
    ('settings','branch_id','branches'),
    ('stock_transfers','source_location_id','stock_locations'),
    ('stock_transfers','dest_location_id','stock_locations')
  ) AS v(tbl, col, parent) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_%s_tenant ON %I', r.tbl, r.col, r.tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_%s_tenant BEFORE INSERT OR UPDATE OF %I ON %I FOR EACH ROW EXECUTE FUNCTION oc_assert_same_tenant(%L, %L)',
      r.tbl, r.col, r.col, r.tbl, r.col, r.parent
    );
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_service_orders_technician_member ON service_orders;
CREATE TRIGGER trg_service_orders_technician_member BEFORE INSERT OR UPDATE OF assigned_technician_id ON service_orders
  FOR EACH ROW EXECUTE FUNCTION oc_assert_tenant_member('assigned_technician_id');

-- ------------------------------------------------------------- CHECKs
ALTER TABLE plans ADD CONSTRAINT plans_price_positive CHECK (price_cents > 0);
ALTER TABLE plans ADD CONSTRAINT plans_currency_brl CHECK (currency = 'BRL');
ALTER TABLE plans ADD CONSTRAINT plans_limits_positive CHECK (max_branches > 0 AND max_technicians_per_branch > 0 AND max_cash_registers_per_branch > 0);
ALTER TABLE plan_price_history ADD CONSTRAINT plan_price_history_positive CHECK (price_cents > 0);
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_price_positive CHECK (price_cents > 0);
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_anchor_day CHECK (anchor_day IS NULL OR anchor_day BETWEEN 1 AND 31);
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_period_order CHECK (current_period_end IS NULL OR current_period_start IS NULL OR current_period_end > current_period_start);
ALTER TABLE billing_invoices ADD CONSTRAINT billing_invoices_amount_nonneg CHECK (amount_cents >= 0);
ALTER TABLE billing_invoices ADD CONSTRAINT billing_invoices_currency_brl CHECK (currency = 'BRL');
ALTER TABLE billing_invoices ADD CONSTRAINT billing_invoices_period_order CHECK (period_end > period_start);
-- Ausência de período sobreposto entre faturas de assinatura não anuladas
ALTER TABLE billing_invoices ADD CONSTRAINT billing_invoices_no_overlap
  EXCLUDE USING gist (subscription_id WITH =, tstzrange(period_start, period_end, '[)') WITH &&)
  WHERE (kind = 'SUBSCRIPTION' AND status NOT IN ('VOID'));
ALTER TABLE billing_payment_attempts ADD CONSTRAINT billing_attempts_amount_positive CHECK (amount_cents > 0);
ALTER TABLE billing_payments ADD CONSTRAINT billing_payments_amount_positive CHECK (amount_cents > 0);
ALTER TABLE billing_payments ADD CONSTRAINT billing_payments_currency_brl CHECK (currency = 'BRL');
ALTER TABLE plan_change_requests ADD CONSTRAINT plan_change_proration_nonneg CHECK (proration_cents >= 0);

ALTER TABLE service_orders ADD CONSTRAINT service_orders_number_positive CHECK (number > 0);
ALTER TABLE service_orders ADD CONSTRAINT service_orders_amounts_nonneg CHECK (total_cents >= 0 AND diagnosis_fee_cents >= 0);
ALTER TABLE quotes ADD CONSTRAINT quotes_totals CHECK (subtotal_cents >= 0 AND discount_cents >= 0 AND total_cents >= 0 AND total_cents = subtotal_cents - discount_cents);
ALTER TABLE quote_lines ADD CONSTRAINT quote_lines_qty_positive CHECK (qty > 0);
ALTER TABLE quote_lines ADD CONSTRAINT quote_lines_amounts CHECK (unit_price_cents >= 0 AND unit_cost_cents >= 0 AND discount_cents >= 0 AND discount_cents <= qty * unit_price_cents);

ALTER TABLE products ADD CONSTRAINT products_amounts CHECK (cost_cents >= 0 AND price_cents >= 0 AND (promo_price_cents IS NULL OR promo_price_cents >= 0) AND min_stock >= 0);
ALTER TABLE stock_balances ADD CONSTRAINT stock_balances_reserved CHECK (reserved >= 0);
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_qty_nonzero CHECK (quantity <> 0);
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_cost_nonneg CHECK (unit_cost_cents >= 0);
ALTER TABLE stock_reservations ADD CONSTRAINT stock_reservations_qty CHECK (quantity > 0 AND consumed_qty >= 0 AND consumed_qty <= quantity);
ALTER TABLE stock_transfer_lines ADD CONSTRAINT stock_transfer_lines_qty CHECK (quantity_sent > 0 AND (quantity_received IS NULL OR quantity_received >= 0));
ALTER TABLE stock_transfers ADD CONSTRAINT stock_transfers_distinct CHECK (source_branch_id <> dest_branch_id);

ALTER TABLE sales ADD CONSTRAINT sales_totals CHECK (subtotal_cents >= 0 AND discount_cents >= 0 AND total_cents >= 0 AND total_cents = subtotal_cents - discount_cents AND refunded_cents >= 0 AND refunded_cents <= total_cents);
ALTER TABLE sale_items ADD CONSTRAINT sale_items_qty CHECK (qty > 0 AND refunded_qty >= 0 AND refunded_qty <= qty);
ALTER TABLE sale_items ADD CONSTRAINT sale_items_amounts CHECK (unit_price_cents >= 0 AND unit_cost_cents >= 0 AND discount_cents >= 0 AND discount_cents <= qty * unit_price_cents);
ALTER TABLE receivables ADD CONSTRAINT receivables_amounts CHECK (amount_cents >= 0 AND paid_cents >= 0 AND refunded_cents >= 0 AND refunded_cents <= paid_cents AND paid_cents - refunded_cents <= amount_cents);
ALTER TABLE payments ADD CONSTRAINT payments_amounts CHECK (amount_cents > 0 AND change_cents >= 0 AND refunded_cents >= 0 AND refunded_cents <= amount_cents);
ALTER TABLE payments ADD CONSTRAINT payments_change_cash_only CHECK (change_cents = 0 OR method = 'CASH');
ALTER TABLE payment_allocations ADD CONSTRAINT payment_allocations_positive CHECK (amount_cents > 0);
ALTER TABLE refunds ADD CONSTRAINT refunds_positive CHECK (amount_cents > 0);
ALTER TABLE cash_sessions ADD CONSTRAINT cash_sessions_float_nonneg CHECK (opening_float_cents >= 0);
ALTER TABLE cash_sessions ADD CONSTRAINT cash_sessions_lock CHECK ((status = 'OPEN' AND open_lock = register_id) OR (status = 'CLOSED' AND open_lock IS NULL));
ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_positive CHECK (amount_cents > 0);
ALTER TABLE pickup_receipts ADD CONSTRAINT pickup_receipts_outstanding CHECK (outstanding_cents >= 0 AND (outstanding_cents = 0 OR balance_override));

-- ------------------------------------------------------------- permissões
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
      'service_order_notes','service_order_files','service_order_terms','device_unlock_secrets',
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
      'payment_allocations','messaging_billing_checks','notification_outbox','issued_documents','email_outbox'] LOOP
      EXECUTE format('GRANT SELECT, INSERT ON %I TO ordemcerta_app', t);
    END LOOP;
    -- somente leitura (escrita exclusiva do billing/plataforma via papel de sistema)
    FOREACH t IN ARRAY ARRAY['tenants','plans','plan_price_history','subscriptions','billing_invoices',
      'billing_payment_attempts','plan_change_requests'] LOOP
      EXECUTE format('GRANT SELECT ON %I TO ordemcerta_app', t);
    END LOOP;
    EXECUTE 'GRANT UPDATE (name, legal_name, document, timezone, phone, email, address, logo_storage_key, primary_color, onboarding_completed_at, updated_at) ON tenants TO ordemcerta_app';
    -- usuários: somente colunas não sensíveis (nunca password_hash, mfa_secret_enc)
    EXECUTE 'GRANT SELECT (id, name, email, status, created_at) ON users TO ordemcerta_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION app_current_tenant() TO ordemcerta_app';
  END IF;
END $$;

SELECT oc_apply_grants();
