-- Política de contestação (chargeback) perdida:
--  * nova espécie de fatura REGULARIZATION (reabre o ciclo a partir do pagamento após suspensão);
--  * faturas estornadas/contestadas deixam de bloquear períodos (não cobrem mais nada).
ALTER TYPE "InvoiceKind" ADD VALUE IF NOT EXISTS 'REGULARIZATION';

ALTER TABLE billing_invoices DROP CONSTRAINT IF EXISTS billing_invoices_no_overlap;
ALTER TABLE billing_invoices ADD CONSTRAINT billing_invoices_no_overlap
  EXCLUDE USING gist (subscription_id WITH =, tstzrange(period_start, period_end, '[)') WITH &&)
  WHERE (kind = 'SUBSCRIPTION' AND status NOT IN ('VOID', 'CHARGEBACK', 'REFUNDED'));
