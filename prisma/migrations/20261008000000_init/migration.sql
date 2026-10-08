-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED', 'PENDING');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('PLATFORM_SUPERADMIN');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'SUSPENDED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ActiveStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TenantRole" AS ENUM ('TENANT_OWNER', 'TENANT_ADMIN', 'MANAGER', 'RECEPTIONIST', 'TECHNICIAN', 'CASHIER', 'INVENTORY');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'INVITED', 'DISABLED');

-- CreateEnum
CREATE TYPE "TechnicalStatus" AS ENUM ('RECEIVED', 'WAITING_DIAGNOSIS', 'DIAGNOSING', 'WAITING_QUOTE_APPROVAL', 'APPROVED', 'WAITING_PARTS', 'IN_REPAIR', 'TESTING', 'READY', 'REJECTED', 'CANCELED', 'RETURNED_UNREPAIRED', 'REOPENED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('IN_CUSTODY', 'READY_FOR_PICKUP', 'DELIVERED', 'RETURNED_UNREPAIRED');

-- CreateEnum
CREATE TYPE "OrderPaymentStatus" AS ENUM ('UNBILLED', 'UNPAID', 'PARTIALLY_PAID', 'PAID', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "OrderCategory" AS ENUM ('DIAGNOSIS', 'REPAIR');

-- CreateEnum
CREATE TYPE "AccessoryType" AS ENUM ('CHIP', 'SD_CARD', 'CASE', 'CHARGER', 'CABLE', 'OTHER');

-- CreateEnum
CREATE TYPE "ChecklistPhase" AS ENUM ('INTAKE', 'POST_REPAIR');

-- CreateEnum
CREATE TYPE "NoteVisibility" AS ENUM ('INTERNAL', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "FileType" AS ENUM ('PHOTO_INTAKE', 'PHOTO_DIAGNOSIS', 'PHOTO_REPAIR', 'PHOTO_WARRANTY', 'DOCUMENT', 'SIGNATURE');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'NOT_SCANNED', 'ERROR');

-- CreateEnum
CREATE TYPE "TermType" AS ENUM ('INTAKE', 'PICKUP', 'WARRANTY', 'QUOTE_APPROVAL');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'APPROVED', 'REJECTED', 'EXPIRED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "QuoteLineKind" AS ENUM ('PART', 'LABOR', 'SERVICE', 'FEE');

-- CreateEnum
CREATE TYPE "WarrantyClaimStatus" AS ENUM ('OPEN', 'IN_ANALYSIS', 'APPROVED', 'DENIED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ProductKind" AS ENUM ('PRODUCT', 'PART', 'SERVICE');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('RECEIPT', 'SALE', 'SALE_CANCEL', 'OS_CONSUMPTION', 'OS_CONSUMPTION_REVERSAL', 'RETURN', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT', 'LOSS', 'RESERVE', 'RELEASE');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('IN_TRANSIT', 'RECEIVED', 'RECEIVED_WITH_DIFF', 'CANCELED');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "ReceivableSource" AS ENUM ('SALE', 'SERVICE_ORDER');

-- CreateEnum
CREATE TYPE "ReceivableStatus" AS ENUM ('OPEN', 'PARTIALLY_PAID', 'PAID', 'CANCELED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'BANK_TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CONFIRMED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'CANCELED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "CashSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('OPENING', 'PAYMENT_IN', 'SUPPLY', 'WITHDRAWAL', 'REFUND_OUT', 'CHANGE_OUT');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('REVENUE_SALE', 'REVENUE_SERVICE', 'DISCOUNT', 'COGS', 'PAYMENT_RECEIVED', 'REFUND', 'REVENUE_REVERSAL', 'CASH_DIFFERENCE');

-- CreateEnum
CREATE TYPE "MessagingProviderKind" AS ENUM ('WHATSAPP_CLOUD', 'WHATSAPP_UNOFFICIAL_QR');

-- CreateEnum
CREATE TYPE "MessagingChannelStatus" AS ENUM ('NOT_CONNECTED', 'ONBOARDING', 'CONNECTED_BILLING_PENDING', 'BILLING_REVIEW_REQUIRED', 'ACTIVE', 'SUSPENDED', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "MessagingBillingStatus" AS ENUM ('UNKNOWN', 'PENDING_REVIEW', 'VERIFIED_OWN_BILLING', 'REJECTED');

-- CreateEnum
CREATE TYPE "TemplateApprovalStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "DeliveryMsgStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "DocumentTemplateType" AS ENUM ('INTAKE', 'RESPONSIBILITY_TERM', 'QUOTE', 'APPROVAL', 'SALE_RECEIPT', 'WARRANTY_TERM', 'PICKUP_RECEIPT');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('QUEUED', 'PROCESSING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "ExportFormat" AS ENUM ('CSV', 'PDF');

-- CreateEnum
CREATE TYPE "BillingPeriod" AS ENUM ('MONTHLY');

-- CreateEnum
CREATE TYPE "BillingProvider" AS ENUM ('MERCADO_PAGO');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('CARD_RECURRING', 'PIX_MANUAL');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCEL_AT_PERIOD_END', 'CANCELED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PENDING', 'PAID', 'EXPIRED', 'VOID', 'REFUNDED', 'CHARGEBACK');

-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('SUBSCRIPTION', 'PRORATION');

-- CreateEnum
CREATE TYPE "BillingMethod" AS ENUM ('CARD', 'PIX');

-- CreateEnum
CREATE TYPE "BillingPaymentStatus" AS ENUM ('CREATED', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELED', 'REFUNDED', 'CHARGEBACK');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'IGNORED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "PlanChangeType" AS ENUM ('UPGRADE', 'DOWNGRADE');

-- CreateEnum
CREATE TYPE "PlanChangeStatus" AS ENUM ('PENDING_PAYMENT', 'PENDING_PROVIDER_SYNC', 'SCHEDULED', 'APPLIED', 'CANCELED', 'FAILED');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('QUOTE_DECISION', 'STATUS_VIEW');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(20),
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "platform_role" "PlatformRole",
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_secret_enc" TEXT,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "email_verified_at" TIMESTAMPTZ(3),
    "password_changed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_hash" VARCHAR(128) NOT NULL,
    "tenant_id" UUID,
    "membership_id" UUID,
    "mfa_verified" BOOLEAN NOT NULL DEFAULT false,
    "user_agent" VARCHAR(300),
    "ip_hash" VARCHAR(64),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoke_reason" VARCHAR(60),
    "rotated_at" TIMESTAMPTZ(3),
    "last_used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "legal_name" VARCHAR(200),
    "document" VARCHAR(20),
    "status" "TenantStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
    "phone" VARCHAR(20),
    "email" VARCHAR(254),
    "address" JSONB,
    "logo_storage_key" TEXT,
    "primary_color" VARCHAR(7),
    "onboarding_completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(20),
    "address" JSONB,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
    "business_hours" JSONB,
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_memberships" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "TenantRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_branches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "is_technician" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "role" "TenantRole" NOT NULL,
    "branch_ids" UUID[],
    "technician_branch_ids" UUID[],
    "token_hash" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "invited_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_access_grants" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "platform_user_id" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "granted_by" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "billing_period" "BillingPeriod" NOT NULL DEFAULT 'MONTHLY',
    "max_branches" INTEGER NOT NULL,
    "max_technicians_per_branch" INTEGER NOT NULL DEFAULT 3,
    "max_cash_registers_per_branch" INTEGER NOT NULL DEFAULT 1,
    "limits_json" JSONB NOT NULL DEFAULT '{}',
    "features_json" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "price_version" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_price_history" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "effective_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "provider" "BillingProvider" NOT NULL DEFAULT 'MERCADO_PAGO',
    "payment_mode" "PaymentMode" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "anchor_day" INTEGER,
    "current_period_start" TIMESTAMPTZ(3),
    "current_period_end" TIMESTAMPTZ(3),
    "grace_until" TIMESTAMPTZ(3),
    "provider_subscription_id" VARCHAR(120),
    "provider_subscription_status" VARCHAR(40),
    "provider_payer_ref" VARCHAR(120),
    "external_reference" VARCHAR(64) NOT NULL,
    "scheduled_plan_id" UUID,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "cancel_requested_at" TIMESTAMPTZ(3),
    "provider_cancel_pending" BOOLEAN NOT NULL DEFAULT false,
    "suspended_at" TIMESTAMPTZ(3),
    "canceled_at" TIMESTAMPTZ(3),
    "activated_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "kind" "InvoiceKind" NOT NULL DEFAULT 'SUBSCRIPTION',
    "period_start" TIMESTAMPTZ(3) NOT NULL,
    "period_end" TIMESTAMPTZ(3) NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "paid_at" TIMESTAMPTZ(3),
    "provider_invoice_ref" VARCHAR(120),
    "external_reference" VARCHAR(64) NOT NULL,
    "applied_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "billing_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_payment_attempts" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider" "BillingProvider" NOT NULL DEFAULT 'MERCADO_PAGO',
    "method" "BillingMethod" NOT NULL,
    "provider_payment_id" VARCHAR(120),
    "idempotency_key" VARCHAR(120) NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" "BillingPaymentStatus" NOT NULL DEFAULT 'CREATED',
    "status_detail" VARCHAR(120),
    "qr_payload_encrypted" TEXT,
    "qr_expires_at" TIMESTAMPTZ(3),
    "ticket_url" TEXT,
    "checkout_url" TEXT,
    "attempt_no" INTEGER NOT NULL DEFAULT 1,
    "error_code" VARCHAR(120),
    "active_lock" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "billing_payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_payments" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "attempt_id" UUID,
    "provider_payment_id" VARCHAR(120) NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "status" "BillingPaymentStatus" NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3),
    "status_evidence_json" JSONB,
    "checked_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "billing_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_webhook_events" (
    "id" UUID NOT NULL,
    "provider" "BillingProvider" NOT NULL DEFAULT 'MERCADO_PAGO',
    "event_id" VARCHAR(120),
    "request_id" VARCHAR(120),
    "resource_type" VARCHAR(60) NOT NULL,
    "resource_id" VARCHAR(120) NOT NULL,
    "event_type" VARCHAR(80),
    "payload_hash" VARCHAR(64) NOT NULL,
    "payload_min_json" JSONB NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" VARCHAR(1000),
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "billing_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_change_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "from_plan_id" UUID NOT NULL,
    "to_plan_id" UUID NOT NULL,
    "type" "PlanChangeType" NOT NULL,
    "effective_at" TIMESTAMPTZ(3) NOT NULL,
    "proration_cents" INTEGER NOT NULL DEFAULT 0,
    "invoice_id" UUID,
    "payment_attempt_id" UUID,
    "status" "PlanChangeStatus" NOT NULL,
    "provider_sync_error" VARCHAR(500),
    "created_by" UUID NOT NULL,
    "applied_at" TIMESTAMPTZ(3),
    "canceled_at" TIMESTAMPTZ(3),
    "pending_lock" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plan_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "actor_id" UUID,
    "action" VARCHAR(80) NOT NULL,
    "entity" VARCHAR(60) NOT NULL,
    "entity_id" VARCHAR(120),
    "metadata_json" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_usage" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "metric" VARCHAR(60) NOT NULL,
    "value" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "feature_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "actor_id" UUID,
    "actor_type" VARCHAR(20) NOT NULL DEFAULT 'USER',
    "action" VARCHAR(80) NOT NULL,
    "entity" VARCHAR(60) NOT NULL,
    "entity_id" VARCHAR(120),
    "metadata_json" JSONB,
    "request_id" VARCHAR(64),
    "ip_hash" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" VARCHAR(80) NOT NULL,
    "value_json" JSONB NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "counters" (
    "tenant_id" UUID NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "counters_pkey" PRIMARY KEY ("tenant_id","key")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "actor_id" UUID,
    "scope" VARCHAR(80) NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "route" VARCHAR(200) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "status_code" INTEGER,
    "response_json" JSONB,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_outbox" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "to_email" VARCHAR(254) NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "template" VARCHAR(60) NOT NULL,
    "payload_json" JSONB NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "phone_e164" VARCHAR(20),
    "whatsapp_e164" VARCHAR(20),
    "email" VARCHAR(254),
    "document" VARCHAR(20),
    "address" JSONB,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "anonymized_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_consents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "purpose" VARCHAR(40) NOT NULL,
    "legal_basis" VARCHAR(40) NOT NULL DEFAULT 'CONSENT',
    "granted_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "source" VARCHAR(60) NOT NULL,
    "actor_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "brand" VARCHAR(60) NOT NULL,
    "model" VARCHAR(80) NOT NULL,
    "color" VARCHAR(40),
    "imei_encrypted" TEXT,
    "imei_hash" VARCHAR(64),
    "imei_last4" VARCHAR(4),
    "serial_encrypted" TEXT,
    "serial_last4" VARCHAR(4),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "customer_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "assigned_technician_id" UUID,
    "category" "OrderCategory" NOT NULL DEFAULT 'REPAIR',
    "technical_status" "TechnicalStatus" NOT NULL DEFAULT 'RECEIVED',
    "delivery_status" "DeliveryStatus" NOT NULL DEFAULT 'IN_CUSTODY',
    "payment_status" "OrderPaymentStatus" NOT NULL DEFAULT 'UNBILLED',
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "reported_issue" TEXT NOT NULL,
    "diagnosis" TEXT,
    "technical_report" TEXT,
    "requires_approval" BOOLEAN NOT NULL DEFAULT true,
    "diagnosis_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "approved_quote_id" UUID,
    "total_cents" INTEGER NOT NULL DEFAULT 0,
    "warranty_days" INTEGER,
    "warranty_until" TIMESTAMPTZ(3),
    "estimated_delivery_at" TIMESTAMPTZ(3),
    "sla_due_at" TIMESTAMPTZ(3),
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diagnosis_started_at" TIMESTAMPTZ(3),
    "repair_started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "canceled_at" TIMESTAMPTZ(3),
    "cancel_reason" VARCHAR(500),
    "warranty_of_order_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_order_accessories" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "type" "AccessoryType" NOT NULL,
    "description" VARCHAR(200),
    "received" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_order_accessories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_order_checklists" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "phase" "ChecklistPhase" NOT NULL,
    "items_json" JSONB NOT NULL,
    "completed_by" UUID NOT NULL,
    "completed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_order_checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_order_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_type" VARCHAR(20) NOT NULL DEFAULT 'USER',
    "event_type" VARCHAR(60) NOT NULL,
    "from_status" "TechnicalStatus",
    "to_status" "TechnicalStatus",
    "payload_json" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_order_notes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "visibility" "NoteVisibility" NOT NULL DEFAULT 'INTERNAL',
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_order_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_order_files" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "type" "FileType" NOT NULL,
    "mime" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "scan_status" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "uploaded_by" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_order_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_order_terms" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "term_type" "TermType" NOT NULL,
    "term_version" INTEGER NOT NULL,
    "document_hash" VARCHAR(64) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3) NOT NULL,
    "signer_name" VARCHAR(120) NOT NULL,
    "signer_document" VARCHAR(20),
    "signature_file_id" UUID,
    "evidence_json" JSONB NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_order_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_unlock_secrets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "secret_encrypted" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "purged_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_unlock_secrets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal_cents" INTEGER NOT NULL,
    "discount_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL,
    "estimated_days" INTEGER,
    "notes" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "created_by" UUID NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "approved_at" TIMESTAMPTZ(3),
    "approved_by_customer_id" UUID,
    "approval_evidence_json" JSONB,
    "rejected_at" TIMESTAMPTZ(3),
    "rejection_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "kind" "QuoteLineKind" NOT NULL,
    "product_id" UUID,
    "description" VARCHAR(300) NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "unit_cost_cents" INTEGER NOT NULL DEFAULT 0,
    "discount_cents" INTEGER NOT NULL DEFAULT 0,
    "warranty_days" INTEGER NOT NULL DEFAULT 90,

    CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_access_tokens" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "max_uses" INTEGER NOT NULL DEFAULT 50,
    "used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_tracking_tokens" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "last_used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_tracking_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_otps" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "target_id" UUID,
    "code_hash" VARCHAR(64) NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warranty_claims" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "original_line_id" UUID,
    "return_order_id" UUID,
    "status" "WarrantyClaimStatus" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT NOT NULL,
    "triage_notes" TEXT,
    "resolution" TEXT,
    "denial_reason" TEXT,
    "created_by" UUID NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "warranty_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pickup_receipts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "received_by_name" VARCHAR(120) NOT NULL,
    "received_by_document" VARCHAR(20),
    "delivered_by" UUID NOT NULL,
    "signature_file_id" UUID,
    "balance_override" BOOLEAN NOT NULL DEFAULT false,
    "override_reason" VARCHAR(500),
    "outstanding_cents" INTEGER NOT NULL DEFAULT 0,
    "delivered_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pickup_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "document" VARCHAR(20),
    "phone" VARCHAR(20),
    "email" VARCHAR(254),
    "contact_name" VARCHAR(120),
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sku" VARCHAR(60) NOT NULL,
    "barcode" VARCHAR(60),
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "category_id" UUID,
    "supplier_id" UUID,
    "kind" "ProductKind" NOT NULL DEFAULT 'PRODUCT',
    "unit" VARCHAR(10) NOT NULL DEFAULT 'UN',
    "cost_cents" INTEGER NOT NULL DEFAULT 0,
    "price_cents" INTEGER NOT NULL,
    "promo_price_cents" INTEGER,
    "min_stock" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "location" VARCHAR(60),
    "image_storage_key" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_compatibility" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "brand" VARCHAR(60) NOT NULL,
    "model" VARCHAR(80) NOT NULL,

    CONSTRAINT "product_compatibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_locations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "on_hand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_cost_cents" INTEGER NOT NULL DEFAULT 0,
    "reference_type" VARCHAR(40),
    "reference_id" UUID,
    "reason" VARCHAR(300),
    "override_negative" BOOLEAN NOT NULL DEFAULT false,
    "actor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "consumed_qty" INTEGER NOT NULL DEFAULT 0,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "source_branch_id" UUID NOT NULL,
    "dest_branch_id" UUID NOT NULL,
    "source_location_id" UUID NOT NULL,
    "dest_location_id" UUID NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'IN_TRANSIT',
    "notes" VARCHAR(500),
    "receive_notes" VARCHAR(500),
    "created_by" UUID NOT NULL,
    "received_by" UUID,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity_sent" INTEGER NOT NULL,
    "quantity_received" INTEGER,
    "unit_cost_cents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "stock_transfer_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "customer_id" UUID,
    "order_id" UUID,
    "cash_session_id" UUID,
    "created_by" UUID NOT NULL,
    "status" "SaleStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal_cents" INTEGER NOT NULL DEFAULT 0,
    "discount_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL DEFAULT 0,
    "refunded_cents" INTEGER NOT NULL DEFAULT 0,
    "confirmed_at" TIMESTAMPTZ(3),
    "canceled_at" TIMESTAMPTZ(3),
    "cancel_reason" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "description" VARCHAR(160) NOT NULL,
    "qty" INTEGER NOT NULL,
    "refunded_qty" INTEGER NOT NULL DEFAULT 0,
    "unit_price_cents" INTEGER NOT NULL,
    "unit_cost_cents" INTEGER NOT NULL,
    "discount_cents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivables" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "source_type" "ReceivableSource" NOT NULL,
    "source_id" UUID NOT NULL,
    "customer_id" UUID,
    "amount_cents" INTEGER NOT NULL,
    "paid_cents" INTEGER NOT NULL DEFAULT 0,
    "refunded_cents" INTEGER NOT NULL DEFAULT 0,
    "due_at" TIMESTAMPTZ(3),
    "status" "ReceivableStatus" NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "receivables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "cash_session_id" UUID,
    "method" "PaymentMethod" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "tendered_cents" INTEGER,
    "change_cents" INTEGER NOT NULL DEFAULT 0,
    "refunded_cents" INTEGER NOT NULL DEFAULT 0,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CONFIRMED',
    "provider" VARCHAR(40) NOT NULL DEFAULT 'MANUAL',
    "is_manual" BOOLEAN NOT NULL DEFAULT true,
    "external_id" VARCHAR(120),
    "idempotency_key" VARCHAR(120) NOT NULL,
    "received_by" UUID NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "receivable_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "cash_session_id" UUID,
    "amount_cents" INTEGER NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'COMPLETED',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_registers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cash_registers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "register_id" UUID NOT NULL,
    "opened_by" UUID NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opening_float_cents" INTEGER NOT NULL,
    "status" "CashSessionStatus" NOT NULL DEFAULT 'OPEN',
    "open_lock" UUID,
    "closed_by" UUID,
    "closed_at" TIMESTAMPTZ(3),
    "declared_totals_json" JSONB,
    "expected_totals_json" JSONB,
    "difference_cents" INTEGER,
    "close_notes" VARCHAR(1000),
    "closed_while_suspended" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cash_session_id" UUID NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "payment_id" UUID,
    "reason" VARCHAR(300),
    "idempotency_key" VARCHAR(120),
    "actor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_ledger" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "source_type" VARCHAR(40) NOT NULL,
    "source_id" UUID NOT NULL,
    "entry_type" "LedgerEntryType" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "method" "PaymentMethod",
    "competence_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "memo" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messaging_channels" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID,
    "name" VARCHAR(80) NOT NULL,
    "provider" "MessagingProviderKind" NOT NULL,
    "status" "MessagingChannelStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
    "encrypted_credentials_ref" TEXT,
    "external_phone_id" VARCHAR(40),
    "external_waba_id" VARCHAR(40),
    "display_phone_masked" VARCHAR(30),
    "billing_status" "MessagingBillingStatus" NOT NULL DEFAULT 'UNKNOWN',
    "billing_verified_at" TIMESTAMPTZ(3),
    "billing_verification_method" VARCHAR(20),
    "token_expires_at" TIMESTAMPTZ(3),
    "webhook_last_received_at" TIMESTAMPTZ(3),
    "first_delivered_at" TIMESTAMPTZ(3),
    "last_error" VARCHAR(500),
    "connected_at" TIMESTAMPTZ(3),
    "disconnected_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "messaging_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messaging_billing_checks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "status" "MessagingBillingStatus" NOT NULL,
    "method" VARCHAR(20) NOT NULL,
    "evidence_ref" TEXT,
    "checked_by" UUID NOT NULL,
    "checked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "messaging_billing_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "event_type" VARCHAR(40) NOT NULL,
    "provider" "MessagingProviderKind" NOT NULL DEFAULT 'WHATSAPP_CLOUD',
    "name" VARCHAR(512) NOT NULL,
    "language" VARCHAR(10) NOT NULL DEFAULT 'pt_BR',
    "body" TEXT NOT NULL,
    "variables_json" JSONB NOT NULL DEFAULT '[]',
    "external_template_id" VARCHAR(60),
    "approval_status" "TemplateApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_outbox" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "event_id" UUID NOT NULL,
    "event_type" VARCHAR(60) NOT NULL,
    "aggregate_type" VARCHAR(40) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "payload_json" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_deliveries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "channel_id" UUID,
    "order_id" UUID,
    "customer_id" UUID NOT NULL,
    "template_id" UUID,
    "event_id" UUID NOT NULL,
    "event_type" VARCHAR(40) NOT NULL,
    "dedupe_key" VARCHAR(64) NOT NULL,
    "recipient_masked" VARCHAR(30) NOT NULL,
    "status" "DeliveryMsgStatus" NOT NULL DEFAULT 'QUEUED',
    "provider_message_id" VARCHAR(120),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    "sent_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "message_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID,
    "scope" VARCHAR(40) NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "value_json" JSONB NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "DocumentTemplateType" NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issued_documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "DocumentTemplateType" NOT NULL,
    "template_version" INTEGER NOT NULL,
    "reference_type" VARCHAR(40) NOT NULL,
    "reference_id" UUID NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "format" VARCHAR(10) NOT NULL DEFAULT 'A4',
    "issued_by" UUID,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issued_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_exports" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "report_type" VARCHAR(40) NOT NULL,
    "format" "ExportFormat" NOT NULL,
    "params_json" JSONB NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'QUEUED',
    "storage_key" TEXT,
    "error" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),

    CONSTRAINT "report_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE INDEX "branches_tenant_id_status_idx" ON "branches"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "branches_tenant_id_id_key" ON "branches"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "tenant_memberships_user_id_idx" ON "tenant_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_memberships_tenant_id_user_id_key" ON "tenant_memberships"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_memberships_tenant_id_id_key" ON "tenant_memberships"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "membership_branches_tenant_id_branch_id_is_technician_idx" ON "membership_branches"("tenant_id", "branch_id", "is_technician");

-- CreateIndex
CREATE UNIQUE INDEX "membership_branches_membership_id_branch_id_key" ON "membership_branches"("membership_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_tenant_id_email_idx" ON "invitations"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "support_access_grants_tenant_id_platform_user_id_expires_at_idx" ON "support_access_grants"("tenant_id", "platform_user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "plan_price_history_plan_id_version_key" ON "plan_price_history"("plan_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_tenant_id_key" ON "subscriptions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_provider_subscription_id_key" ON "subscriptions"("provider_subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_external_reference_key" ON "subscriptions"("external_reference");

-- CreateIndex
CREATE INDEX "subscriptions_status_current_period_end_idx" ON "subscriptions"("status", "current_period_end");

-- CreateIndex
CREATE INDEX "subscriptions_status_grace_until_idx" ON "subscriptions"("status", "grace_until");

-- CreateIndex
CREATE UNIQUE INDEX "billing_invoices_external_reference_key" ON "billing_invoices"("external_reference");

-- CreateIndex
CREATE INDEX "billing_invoices_tenant_id_status_idx" ON "billing_invoices"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "billing_invoices_status_due_at_idx" ON "billing_invoices"("status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_invoices_subscription_id_period_start_key" ON "billing_invoices"("subscription_id", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "billing_payment_attempts_provider_payment_id_key" ON "billing_payment_attempts"("provider_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_payment_attempts_idempotency_key_key" ON "billing_payment_attempts"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "billing_payment_attempts_active_lock_key" ON "billing_payment_attempts"("active_lock");

-- CreateIndex
CREATE INDEX "billing_payment_attempts_tenant_id_status_idx" ON "billing_payment_attempts"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "billing_payments_provider_payment_id_key" ON "billing_payments"("provider_payment_id");

-- CreateIndex
CREATE INDEX "billing_payments_invoice_id_idx" ON "billing_payments"("invoice_id");

-- CreateIndex
CREATE INDEX "billing_webhook_events_status_received_at_idx" ON "billing_webhook_events"("status", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_webhook_events_provider_event_id_key" ON "billing_webhook_events"("provider", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_webhook_events_provider_resource_type_resource_id_p_key" ON "billing_webhook_events"("provider", "resource_type", "resource_id", "payload_hash");

-- CreateIndex
CREATE UNIQUE INDEX "plan_change_requests_pending_lock_key" ON "plan_change_requests"("pending_lock");

-- CreateIndex
CREATE INDEX "plan_change_requests_tenant_id_status_idx" ON "plan_change_requests"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "billing_audit_logs_tenant_id_created_at_idx" ON "billing_audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "feature_usage_tenant_id_period_metric_key" ON "feature_usage"("tenant_id", "period", "metric");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_entity_entity_id_idx" ON "audit_logs"("tenant_id", "entity", "entity_id");

-- CreateIndex
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_scope_route_key_key" ON "idempotency_records"("scope", "route", "key");

-- CreateIndex
CREATE INDEX "email_outbox_status_created_at_idx" ON "email_outbox"("status", "created_at");

-- CreateIndex
CREATE INDEX "customers_tenant_id_phone_e164_idx" ON "customers"("tenant_id", "phone_e164");

-- CreateIndex
CREATE INDEX "customers_tenant_id_document_idx" ON "customers"("tenant_id", "document");

-- CreateIndex
CREATE INDEX "customers_tenant_id_name_idx" ON "customers"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_id_key" ON "customers"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "customer_consents_tenant_id_customer_id_channel_purpose_idx" ON "customer_consents"("tenant_id", "customer_id", "channel", "purpose");

-- CreateIndex
CREATE INDEX "devices_tenant_id_customer_id_idx" ON "devices"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "devices_tenant_id_imei_hash_idx" ON "devices"("tenant_id", "imei_hash");

-- CreateIndex
CREATE INDEX "devices_tenant_id_imei_last4_idx" ON "devices"("tenant_id", "imei_last4");

-- CreateIndex
CREATE UNIQUE INDEX "devices_tenant_id_id_key" ON "devices"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "service_orders_tenant_id_branch_id_technical_status_created_idx" ON "service_orders"("tenant_id", "branch_id", "technical_status", "created_at");

-- CreateIndex
CREATE INDEX "service_orders_tenant_id_assigned_technician_id_technical_s_idx" ON "service_orders"("tenant_id", "assigned_technician_id", "technical_status");

-- CreateIndex
CREATE INDEX "service_orders_tenant_id_customer_id_idx" ON "service_orders"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "service_orders_tenant_id_delivery_status_idx" ON "service_orders"("tenant_id", "delivery_status");

-- CreateIndex
CREATE UNIQUE INDEX "service_orders_tenant_id_number_key" ON "service_orders"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "service_orders_tenant_id_id_key" ON "service_orders"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "service_order_accessories_tenant_id_order_id_idx" ON "service_order_accessories"("tenant_id", "order_id");

-- CreateIndex
CREATE INDEX "service_order_checklists_tenant_id_order_id_phase_idx" ON "service_order_checklists"("tenant_id", "order_id", "phase");

-- CreateIndex
CREATE INDEX "service_order_events_tenant_id_order_id_created_at_idx" ON "service_order_events"("tenant_id", "order_id", "created_at");

-- CreateIndex
CREATE INDEX "service_order_notes_tenant_id_order_id_idx" ON "service_order_notes"("tenant_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_order_files_storage_key_key" ON "service_order_files"("storage_key");

-- CreateIndex
CREATE INDEX "service_order_files_tenant_id_order_id_idx" ON "service_order_files"("tenant_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_order_files_tenant_id_id_key" ON "service_order_files"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "service_order_terms_tenant_id_order_id_idx" ON "service_order_terms"("tenant_id", "order_id");

-- CreateIndex
CREATE INDEX "device_unlock_secrets_tenant_id_order_id_idx" ON "device_unlock_secrets"("tenant_id", "order_id");

-- CreateIndex
CREATE INDEX "device_unlock_secrets_expires_at_purged_at_idx" ON "device_unlock_secrets"("expires_at", "purged_at");

-- CreateIndex
CREATE INDEX "quotes_tenant_id_status_idx" ON "quotes"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_order_id_version_key" ON "quotes"("order_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_tenant_id_id_key" ON "quotes"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "quote_lines_tenant_id_quote_id_idx" ON "quote_lines"("tenant_id", "quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "quote_lines_tenant_id_id_key" ON "quote_lines"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "quote_access_tokens_token_hash_key" ON "quote_access_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "public_tracking_tokens_token_hash_key" ON "public_tracking_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "public_tracking_tokens_tenant_id_order_id_idx" ON "public_tracking_tokens"("tenant_id", "order_id");

-- CreateIndex
CREATE INDEX "public_otps_tenant_id_order_id_purpose_idx" ON "public_otps"("tenant_id", "order_id", "purpose");

-- CreateIndex
CREATE INDEX "warranty_claims_tenant_id_status_idx" ON "warranty_claims"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "warranty_claims_tenant_id_order_id_idx" ON "warranty_claims"("tenant_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "pickup_receipts_tenant_id_order_id_key" ON "pickup_receipts"("tenant_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_tenant_id_name_key" ON "categories"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "categories_tenant_id_id_key" ON "categories"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tenant_id_id_key" ON "suppliers"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "products_tenant_id_barcode_idx" ON "products"("tenant_id", "barcode");

-- CreateIndex
CREATE INDEX "products_tenant_id_name_idx" ON "products"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_sku_key" ON "products"("tenant_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_id_key" ON "products"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "product_compatibility_tenant_id_brand_model_idx" ON "product_compatibility"("tenant_id", "brand", "model");

-- CreateIndex
CREATE UNIQUE INDEX "stock_locations_tenant_id_branch_id_name_key" ON "stock_locations"("tenant_id", "branch_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "stock_locations_tenant_id_id_key" ON "stock_locations"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "stock_balances_tenant_id_product_id_idx" ON "stock_balances"("tenant_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balances_location_id_product_id_key" ON "stock_balances"("location_id", "product_id");

-- CreateIndex
CREATE INDEX "stock_movements_tenant_id_branch_id_created_at_idx" ON "stock_movements"("tenant_id", "branch_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_tenant_id_product_id_created_at_idx" ON "stock_movements"("tenant_id", "product_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_tenant_id_reference_type_reference_id_idx" ON "stock_movements"("tenant_id", "reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "stock_reservations_tenant_id_order_id_status_idx" ON "stock_reservations"("tenant_id", "order_id", "status");

-- CreateIndex
CREATE INDEX "stock_transfers_tenant_id_status_idx" ON "stock_transfers"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_tenant_id_number_key" ON "stock_transfers"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_tenant_id_id_key" ON "stock_transfers"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "stock_transfer_lines_tenant_id_transfer_id_idx" ON "stock_transfer_lines"("tenant_id", "transfer_id");

-- CreateIndex
CREATE INDEX "sales_tenant_id_branch_id_status_created_at_idx" ON "sales"("tenant_id", "branch_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sales_tenant_id_number_key" ON "sales"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_tenant_id_id_key" ON "sales"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "sale_items_tenant_id_sale_id_idx" ON "sale_items"("tenant_id", "sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_items_tenant_id_id_key" ON "sale_items"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "receivables_tenant_id_branch_id_status_idx" ON "receivables"("tenant_id", "branch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "receivables_tenant_id_source_type_source_id_key" ON "receivables"("tenant_id", "source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "receivables_tenant_id_id_key" ON "receivables"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_branch_id_received_at_idx" ON "payments"("tenant_id", "branch_id", "received_at");

-- CreateIndex
CREATE INDEX "payments_tenant_id_cash_session_id_idx" ON "payments"("tenant_id", "cash_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenant_id_idempotency_key_key" ON "payments"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenant_id_id_key" ON "payments"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "payment_allocations_tenant_id_receivable_id_idx" ON "payment_allocations"("tenant_id", "receivable_id");

-- CreateIndex
CREATE INDEX "refunds_tenant_id_payment_id_idx" ON "refunds"("tenant_id", "payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_registers_tenant_id_branch_id_name_key" ON "cash_registers"("tenant_id", "branch_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "cash_registers_tenant_id_id_key" ON "cash_registers"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_sessions_open_lock_key" ON "cash_sessions"("open_lock");

-- CreateIndex
CREATE INDEX "cash_sessions_tenant_id_branch_id_status_idx" ON "cash_sessions"("tenant_id", "branch_id", "status");

-- CreateIndex
CREATE INDEX "cash_sessions_tenant_id_opened_by_status_idx" ON "cash_sessions"("tenant_id", "opened_by", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cash_sessions_tenant_id_id_key" ON "cash_sessions"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "cash_movements_tenant_id_cash_session_id_idx" ON "cash_movements"("tenant_id", "cash_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_movements_tenant_id_idempotency_key_key" ON "cash_movements"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "financial_ledger_tenant_id_branch_id_entry_type_competence__idx" ON "financial_ledger"("tenant_id", "branch_id", "entry_type", "competence_at");

-- CreateIndex
CREATE INDEX "financial_ledger_tenant_id_source_type_source_id_idx" ON "financial_ledger"("tenant_id", "source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_channels_external_phone_id_key" ON "messaging_channels"("external_phone_id");

-- CreateIndex
CREATE INDEX "messaging_channels_tenant_id_status_idx" ON "messaging_channels"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_channels_tenant_id_id_key" ON "messaging_channels"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "messaging_billing_checks_tenant_id_channel_id_idx" ON "messaging_billing_checks"("tenant_id", "channel_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_tenant_id_event_type_provider_key" ON "message_templates"("tenant_id", "event_type", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_tenant_id_id_key" ON "message_templates"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_outbox_event_id_key" ON "notification_outbox"("event_id");

-- CreateIndex
CREATE INDEX "notification_outbox_status_available_at_idx" ON "notification_outbox"("status", "available_at");

-- CreateIndex
CREATE UNIQUE INDEX "message_deliveries_dedupe_key_key" ON "message_deliveries"("dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "message_deliveries_provider_message_id_key" ON "message_deliveries"("provider_message_id");

-- CreateIndex
CREATE INDEX "message_deliveries_tenant_id_created_at_idx" ON "message_deliveries"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "message_deliveries_tenant_id_status_idx" ON "message_deliveries"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "message_deliveries_tenant_id_order_id_idx" ON "message_deliveries"("tenant_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "settings_tenant_id_scope_key_key" ON "settings"("tenant_id", "scope", "key");

-- CreateIndex
CREATE INDEX "document_templates_tenant_id_type_active_idx" ON "document_templates"("tenant_id", "type", "active");

-- CreateIndex
CREATE UNIQUE INDEX "document_templates_tenant_id_type_version_key" ON "document_templates"("tenant_id", "type", "version");

-- CreateIndex
CREATE INDEX "issued_documents_tenant_id_reference_type_reference_id_idx" ON "issued_documents"("tenant_id", "reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "report_exports_tenant_id_created_at_idx" ON "report_exports"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_branches" ADD CONSTRAINT "membership_branches_tenant_id_membership_id_fkey" FOREIGN KEY ("tenant_id", "membership_id") REFERENCES "tenant_memberships"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_branches" ADD CONSTRAINT "membership_branches_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_price_history" ADD CONSTRAINT "plan_price_history_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_scheduled_plan_id_fkey" FOREIGN KEY ("scheduled_plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_payment_attempts" ADD CONSTRAINT "billing_payment_attempts_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "billing_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "billing_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "billing_payment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_change_requests" ADD CONSTRAINT "plan_change_requests_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_change_requests" ADD CONSTRAINT "plan_change_requests_from_plan_id_fkey" FOREIGN KEY ("from_plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_change_requests" ADD CONSTRAINT "plan_change_requests_to_plan_id_fkey" FOREIGN KEY ("to_plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_change_requests" ADD CONSTRAINT "plan_change_requests_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "billing_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_usage" ADD CONSTRAINT "feature_usage_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counters" ADD CONSTRAINT "counters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_consents" ADD CONSTRAINT "customer_consents_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_tenant_id_device_id_fkey" FOREIGN KEY ("tenant_id", "device_id") REFERENCES "devices"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_order_accessories" ADD CONSTRAINT "service_order_accessories_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "service_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_order_checklists" ADD CONSTRAINT "service_order_checklists_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "service_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_order_events" ADD CONSTRAINT "service_order_events_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "service_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_order_notes" ADD CONSTRAINT "service_order_notes_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "service_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_order_files" ADD CONSTRAINT "service_order_files_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "service_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_order_terms" ADD CONSTRAINT "service_order_terms_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "service_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_unlock_secrets" ADD CONSTRAINT "device_unlock_secrets_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "service_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "service_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_tenant_id_quote_id_fkey" FOREIGN KEY ("tenant_id", "quote_id") REFERENCES "quotes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_access_tokens" ADD CONSTRAINT "quote_access_tokens_tenant_id_quote_id_fkey" FOREIGN KEY ("tenant_id", "quote_id") REFERENCES "quotes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_tracking_tokens" ADD CONSTRAINT "public_tracking_tokens_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "service_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_otps" ADD CONSTRAINT "public_otps_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "service_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "service_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_receipts" ADD CONSTRAINT "pickup_receipts_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "service_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_compatibility" ADD CONSTRAINT "product_compatibility_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_tenant_id_location_id_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "stock_locations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_location_id_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "stock_locations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "service_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_tenant_id_location_id_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "stock_locations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_tenant_id_source_branch_id_fkey" FOREIGN KEY ("tenant_id", "source_branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_tenant_id_dest_branch_id_fkey" FOREIGN KEY ("tenant_id", "dest_branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_tenant_id_transfer_id_fkey" FOREIGN KEY ("tenant_id", "transfer_id") REFERENCES "stock_transfers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_tenant_id_sale_id_fkey" FOREIGN KEY ("tenant_id", "sale_id") REFERENCES "sales"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_tenant_id_payment_id_fkey" FOREIGN KEY ("tenant_id", "payment_id") REFERENCES "payments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_tenant_id_receivable_id_fkey" FOREIGN KEY ("tenant_id", "receivable_id") REFERENCES "receivables"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenant_id_payment_id_fkey" FOREIGN KEY ("tenant_id", "payment_id") REFERENCES "payments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_tenant_id_register_id_fkey" FOREIGN KEY ("tenant_id", "register_id") REFERENCES "cash_registers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_tenant_id_cash_session_id_fkey" FOREIGN KEY ("tenant_id", "cash_session_id") REFERENCES "cash_sessions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_ledger" ADD CONSTRAINT "financial_ledger_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messaging_channels" ADD CONSTRAINT "messaging_channels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messaging_billing_checks" ADD CONSTRAINT "messaging_billing_checks_tenant_id_channel_id_fkey" FOREIGN KEY ("tenant_id", "channel_id") REFERENCES "messaging_channels"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
