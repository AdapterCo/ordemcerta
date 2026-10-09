# Estados e regras de transição

Fonte: `packages/shared/src/state-machines.ts` (testado em `packages/shared/test/state-machines.test.ts`).

## Status técnico (`technical_status`)

```
RECEIVED → WAITING_DIAGNOSIS → DIAGNOSING → WAITING_QUOTE_APPROVAL → APPROVED → [WAITING_PARTS] → IN_REPAIR → TESTING → READY
DIAGNOSING → APPROVED            (orçamento previamente aprovado: requires_approval=false ou permissão os:approve_override)
WAITING_QUOTE_APPROVAL → REJECTED → RETURNED_UNREPAIRED | DIAGNOSING (novo orçamento)
WAITING_PARTS → IN_REPAIR | APPROVED
TESTING → IN_REPAIR
READY | RETURNED_UNREPAIRED | CANCELED → REOPENED (ocorrência auditada) → DIAGNOSING | IN_REPAIR
(vários) → CANCELED
```

Cada transição: permissão específica, `version` esperada (409 VERSION_CONFLICT), evento em `service_order_events`, auditoria e, quando aplicável, evento de domínio no outbox.

Pré-condições adicionais:

- Reparo cobrável (`start-repair`) exige orçamento aprovado quando `requires_approval=true` (exceto retorno em garantia).
- `submit-diagnosis` sem pré-aprovação exige orçamento em rascunho/enviado.
- `complete-repair` exige todos os itens do checklist final configurado respondidos (reprovação com observação) e nenhuma reserva de peça ativa.
- Cancelamento libera reservas; a OS nunca é excluída.

## Entrega (`delivery_status`)

`IN_CUSTODY → READY_FOR_PICKUP → DELIVERED | RETURNED_UNREPAIRED`. Concluir reparo não implica entrega. Entrega exige quitação (política `os.require_payment_for_delivery`) ou liberação com `os:deliver_override` + motivo (auditado). Recibo de retirada com assinatura/evidência.

## Pagamento da OS (`payment_status`)

`UNBILLED, UNPAID, PARTIALLY_PAID, PAID, REFUNDED, PARTIALLY_REFUNDED` — derivado da cobrança (`receivables`), nunca do status técnico.

## Orçamento (`quote_status`)

`DRAFT → SENT → APPROVED | REJECTED | EXPIRED`; qualquer → `SUPERSEDED` em nova versão. Aprovação vinculada ao `content_hash` da versão; trigger impede alterar orçamento finalizado; linhas imutáveis após envio.

## Assinatura (`subscription_status`)

`PENDING_PAYMENT → ACTIVE → PAST_DUE (tolerância) → SUSPENDED`; `ACTIVE → CANCEL_AT_PERIOD_END → CANCELED`. Fatura: `OPEN, PENDING, PAID, EXPIRED, VOID, REFUNDED, CHARGEBACK` (espécies `SUBSCRIPTION`, `PRORATION`, `REGULARIZATION`). Contestação perdida: `ACTIVE|PAST_DUE → SUSPENDED` imediato (sem tolerância) + fatura `REGULARIZATION`; pagamento dela → `ACTIVE` com novo ciclo. Mudança de plano: `PENDING_PAYMENT, PENDING_PROVIDER_SYNC, SCHEDULED, APPLIED, CANCELED, FAILED`.

## Canal WhatsApp

`NOT_CONNECTED → ONBOARDING → CONNECTED_BILLING_PENDING → BILLING_REVIEW_REQUIRED → ACTIVE`; `ERROR`, `SUSPENDED`, `DISCONNECTED`. Somente `ACTIVE` envia.
