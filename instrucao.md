# INSTRUÇÃO DE IMPLEMENTAÇÃO — OrdemCerta | SaaS de Gestão de Assistências Técnicas

Versão: 1.2 | Data: 08/10/2026 | Status: especificação para desenvolvimento integral

## 0. Objetivo e definição de pronto

Construir um SaaS web responsivo, em português do Brasil, para empresas de assistência técnica de celulares, com múltiplas empresas (tenants), múltiplas filiais, recepção, ordens de serviço (OS), fila de técnicos em tempo real, orçamento/aprovação, fotos e documentos, WhatsApp, clientes, catálogo e estoque, PDV, caixas, financeiro, garantias, relatórios, administração da plataforma, planos e assinaturas. O sistema deve ser funcional de ponta a ponta, não um protótipo com botões falsos. Não declarar concluído qualquer fluxo sem migração, API, UI, validações, permissões, testes e tratamento de erros.

A imagem de referência enviada representa uma ficha de entrada de assistência com: atendente, tipo orçamento/OS/venda, número, data, cliente, telefone, marca/modelo, IMEI, acessórios, defeito informado, laudo técnico, peças/serviços, valores, garantia, termo de responsabilidade, assinatura, pagamento, retirada e responsável. Preservar estes campos e melhorar o fluxo digital.

### Convenções
- Moeda BRL, centavos inteiros no domínio financeiro; exibição pt-BR; datas ISO UTC no banco, renderização no fuso da filial (padrão America/Sao_Paulo).
- IDs UUIDv7 (ou UUIDv4 se a biblioteca não suportar v7); números de OS legíveis e sequenciais por empresa, com contador transacional e UNIQUE(tenant_id, numero).
- Exigir `tenant_id` em todas as tabelas de negócio pertencentes a empresa; `branch_id` onde houver escopo por filial. `tenant_id` nunca deve vir de corpo da requisição confiável; obter do contexto autenticado.
- Valores de planos, preços e regras comerciais configuráveis, não hardcoded.
- UI em português, acessível, mobile-first para atendente/técnico, desktop-first para PDV e relatórios.

## 1. Stack e infraestrutura

- Monorepo pnpm + Turborepo: `apps/web` (React, Vite, TypeScript, React Router, TanStack Query, Tailwind, shadcn/ui, React Hook Form, Zod), `apps/api` (NestJS, TypeScript, REST OpenAPI, Prisma), `apps/worker` (NestJS/BullMQ), `packages/shared` (contratos, validações, enums), `packages/ui` (componentes opcionais).
- PostgreSQL 17 (persistência), Redis 7 (filas, rate limits, cache), armazenamento S3 compatível (MinIO privado ou provedor S3) para fotos, anexos e PDFs; PDFs gerados server-side com Playwright/Chromium em worker dedicado ou biblioteca PDF adequada.
- WebSocket Socket.IO com autenticação e rooms `tenant:<id>:branch:<id>`; não depender de eventos websocket como fonte da verdade (refetch REST em reconexão).
- Nginx para servir frontend estático, Traefik existente como reverse proxy HTTPS; Docker Compose com API, web, worker, postgres, redis e storage quando self-hosted. Não publicar PostgreSQL, Redis ou MinIO diretamente na internet. Não interferir nas portas 80/443 ou 3000 do EasyPanel; integrar rede Traefik externa configurável.
- Variáveis em `.env.example` sem segredos; secrets reais fora do Git. Health `/health/live` e `/health/ready`; migrations automatizadas por job explícito idempotente, nunca `prisma db push` em produção.
- Logs estruturados com correlation ID, tracing, métricas, alertas, backup criptografado e teste de restauração. Deploy com rollback de imagem e migrações backward-compatible.
- Marca definida: **OrdemCerta**. Domínio de produção: `ordemcerta.adapterco.com.br`; site, portal `/status`, e API `/api/v1` sob o mesmo host via Traefik. Variáveis `APP_DOMAIN=ordemcerta.adapterco.com.br`, `APP_URL=https://ordemcerta.adapterco.com.br`, `TRAEFIK_NETWORK=traefik9`, `TRAEFIK_ENTRYPOINT=https`, `TRAEFIK_CERT_RESOLVER=letsencrypt` (verificar os nomes efetivos antes do deploy). DNS/TLS devem ser validados, não presumidos.

## 2. Arquitetura multi-tenant e autorização

- Banco compartilhado, schema compartilhado, `tenant_id` em entidades de empresa. Toda consulta/mutação obrigatoriamente escopada; usar camada de contexto tenant + políticas, com PostgreSQL Row Level Security (RLS) para tabelas de negócio sempre que viável. Política RLS deny-by-default, contexto transacional `SET LOCAL app.tenant_id` definido no servidor, pool com transações para impedir vazamento de contexto. Testar isolamento com dois tenants em cada endpoint, inclusive exportações, arquivos, websocket e jobs.
- Usuário global (`users`) e vínculos (`tenant_memberships`) com papel e status; usuário pode pertencer a várias empresas; troca de empresa autenticada. Filiais autorizadas via `membership_branches`; não confiar em branch_id do cliente sem verificar associação.
- Papéis: PLATFORM_SUPERADMIN (somente administração SaaS), TENANT_OWNER, TENANT_ADMIN, MANAGER, RECEPTIONIST, TECHNICIAN, CASHIER, INVENTORY. Permissões granulares por ação (OS:create, OS:assign, OS:approve_override, stock:adjust, cash:close, sales:discount, reports:view, settings:edit etc.). Negar por padrão; suporte da plataforma não pode ler dados do cliente sem mecanismo auditado de acesso temporário e autorizado.
- Autenticação: login email/senha com Argon2id, recuperação por token de uso único e expiração, refresh token rotativo em cookie HttpOnly Secure SameSite adequado, CSRF nas rotas baseadas em cookie, MFA opcional (obrigatório para plataforma), sessões revogáveis, rate limit e bloqueio progressivo.
- Convites com expiração, desativação de usuário, transferência de propriedade com confirmação, trilha de auditoria imutável (sem guardar segredos).
- LGPD: consentimentos/fundamento legal por finalidade, aviso de privacidade, retenção configurável, exportação e exclusão/anomização conforme obrigações legais, criptografia em trânsito e repouso. Não armazenar senhas de desbloqueio do celular em texto puro; preferir fluxo assistido, campo excepcional criptografado com acesso restrito, prazo de expiração e auditoria; jamais incluir em PDF/WhatsApp/logs.

## 3. Módulos e telas

### 3.1 SaaS / administração da plataforma
- Login exclusivo, dashboard de MRR, empresas ativas, trial, inadimplência, churn, consumo de armazenamento, mensagens, número de filiais e usuários.
- CRUD administrativo de planos mensais com quatro SKUs fixados no seed inicial (seção 17); preços versionados e histórico; quotas obrigatórias de filiais, técnicos por filial e caixas por filial. Não criar trial nem plano anual por padrão; recursos adicionais somente por decisão comercial explícita.
- Cadastro/ativação/suspensão de tenant; billing por provedor com checkout hospedado, webhook assinado, idempotência e reconciliação; nenhuma liberação apenas por redirect do navegador.
- Estados de assinatura: TRIALING, ACTIVE, PAST_DUE, SUSPENDED, CANCELED; políticas de tolerância e modo somente leitura configuráveis, sem apagar dados por inadimplência.
- Painel de incidentes, jobs com erro, consumo, auditoria de acesso de suporte e status dos provedores.

### 3.2 Onboarding da assistência
- Contratação self-service começa pela escolha obrigatória de um dos quatro planos OrdemCerta, cadastro da empresa e responsável, aceite dos termos e pagamento inicial por cartão recorrente ou Pix manual; somente depois da confirmação do pagamento liberar a operação. Após ativação, configurar endereço, fuso, logo, cor, termos, garantia padrão, filiais, horários, usuários, categorias de produtos, métodos de pagamento da loja e conexão WhatsApp BYOK.
- Permitir uma filial inicial e adicionar outras conforme plano; cadastro de numeradores por empresa.

### 3.3 Dashboard da assistência
- KPIs de OS abertas, aguardando aprovação/peças, em execução, prontas, não retiradas, atrasadas, faturamento recebido, vendas, margens estimadas, alertas de estoque e caixa.
- Filtros por filial, período, técnico; ações rápidas para nova OS, venda, cliente, abrir caixa.

### 3.4 Clientes e aparelhos
- Clientes: nome, telefone normalizado E.164, WhatsApp, CPF/CNPJ opcional, email, endereço opcional, consentimentos, observações; busca por telefone/nome/documento.
- Aparelhos: marca, modelo, cor, IMEI/serial opcional (dado sensível operacional), acessórios, histórico de OS e fotos. Cliente pode ter vários aparelhos; aparelho pode ter várias OS.
- Impedir acesso cruzado entre empresas mesmo com telefone/IMEI iguais; deduplicação apenas dentro do tenant.

### 3.5 Ordem de serviço (recepção)
- Criar OS: filial, atendente, cliente, aparelho, categoria (diagnóstico/reparo), defeito relatado, data, prioridade, previsão, acessórios recebidos (chip, SD, capa, carregador, outros), checklist de estado físico e testes iniciais, fotos de entrada, observações e termo de recebimento.
- Anexos com validação MIME, antivírus/varredura, limite de tamanho, armazenamento privado e URLs assinadas curtas.
- Assinatura de aceite em dispositivo, com hash do documento, data/hora, identificador do signatário e evidências de aceite. Não afirmar que toda assinatura simples equivale automaticamente a assinatura qualificada.
- Gerar ficha PDF A4 e formato térmico opcional, contendo número, dados de cliente/aparelho, estado e acessórios, termos versionados, protocolo de consulta (token opaco), garantia quando aplicável, campos de pagamento e retirada. Nunca expor dados secretos.
- Status técnico separado de status comercial, financeiro e entrega; comentários internos não aparecem no portal público.

### 3.6 Painel técnico
- Fila por filial, técnico, prioridade, SLA, status e data. Nova OS gera evento em tempo real; alerta visual/sonoro opcional.
- Aceitar/atribuir OS conforme permissão, iniciar diagnóstico, laudo, fotos, testes, orçamento, solicitar peça, registrar início/fim de reparo, consumo de peças, checklist pós-reparo, conclusão e reabertura autorizada.
- Não permitir concluir sem checklist final configurado; manter histórico cronológico de transições e autores.

### 3.7 Orçamentos e aprovação
- Orçamento versionado com linhas de peça, mão de obra, quantidade, custo estimado, preço, desconto autorizado, impostos quando aplicáveis, total e prazo de validade.
- Enviar link com token opaco de uso limitado para visualizar e aprovar/rejeitar; autenticação adicional por OTP quando política exigir; guardar evidência de quem aprovou, versão exata, data/hora, IP minimizado, texto do aceite. Aprovado não pode ser alterado silenciosamente; mudança material gera nova versão e nova aprovação.
- Não iniciar reparo cobrável antes de aprovação quando `requires_approval=true`; permitir diagnóstico previamente autorizado e eventual taxa informada no aceite.
- Rejeição encaminha para devolução sem reparo ou novo orçamento; registrar custos e política de taxa de diagnóstico.

### 3.8 WhatsApp e notificações
- Cada tenant configura um ou mais canais por filial conforme plano. Implementar interface `MessagingProvider` com adaptador oficial WhatsApp Business Platform como padrão para produção. Conexão via QR Code (biblioteca não oficial) apenas adaptador opcional explicitamente identificado como não oficial, com riscos de desconexão/restrição e sem garantia de continuidade.
- Na API oficial, implementar configuração de número, verificação de webhook, validação de assinatura, templates aprovados para mensagens iniciadas pela empresa fora da janela de atendimento, opt-in quando exigido e política de opt-out. Não presumir que todas as mensagens livres são permitidas.
- Eventos configuráveis: OS recebida, diagnóstico iniciado, orçamento disponível, aprovado, aguardando peça, reparo iniciado, concluído/pronto para retirada, entregue, garantia. O usuário solicitou principalmente notificações no início e fim do serviço.
- Templates com variáveis permitidas, prévia, teste, controle de horário, logs, tentativas com backoff, deduplicação por event_id + template + destinatário, DLQ, estado queued/sent/delivered/read/failed quando suportado. Nunca bloquear transação de OS por falha no WhatsApp: usar outbox transacional + worker.
- Preferências do cliente e logs de consentimento; não enviar IMEI completo, senha ou informação sensível. Mensagem nunca é fonte da verdade do status da OS.

### 3.8.1 WhatsApp oficial BYOK — faturamento próprio obrigatório
- **Decisão de produto:** cada tenant usa sua própria conta Meta Business/WhatsApp Business Account (WABA), seu próprio número e sua própria responsabilidade financeira pelo consumo da WhatsApp Business Platform. A mensalidade do SaaS é separada das tarifas da Meta. Não subsidiar mensagens nem usar a linha de crédito do operador do SaaS.
- Adotar **WhatsApp Business Platform Cloud API oficial** como integração padrão. Implementar onboarding via **Embedded Signup**, quando disponível e autorizado para o tipo de app/parceiro, com permissões, revisão de app e configuração exigidas pela Meta. Caso esse fluxo não esteja habilitado, oferecer conexão oficial assistida com credenciais do cliente, sem prometer disponibilidade do Embedded Signup.
- BYOK significa titularidade da conta/credenciais do cliente; não exige que o usuário cole tokens manualmente. Usar tokens de acesso apropriados, escopos mínimos e ciclo de renovação/rotação conforme o modelo oficial aprovado; criptografar tokens em cofre/armazenamento seguro, nunca exibir segredo completo na interface, logs ou exportações.
- **Condição de ativação:** exigir comprovação verificável de que a WABA do tenant possui **faturamento próprio configurado e elegível** para cobrança direta pela Meta, sem compartilhamento de linha de crédito da plataforma ou de BSP intermediário. Não confundir número conectado com faturamento validado. Se a API não expuser evidência suficiente, registrar checagem assistida e evidência auditável, marcando o status como `BILLING_REVIEW_REQUIRED` até validação. Nunca afirmar que a cobrança direta é garantida para todas as contas, países ou modelos de integração.
- Não implementar compartilhamento de crédito (`credit line sharing`), cobrança das tarifas Meta pelo SaaS, nem fallback silencioso para uma WABA/número da plataforma. Se o modelo de integração exigir cobrança centralizada, bloquear ativação e informar a incompatibilidade; mudança dessa política exige decisão comercial explícita.
- Onboarding com estados `NOT_CONNECTED`, `ONBOARDING`, `CONNECTED_BILLING_PENDING`, `BILLING_REVIEW_REQUIRED`, `ACTIVE`, `SUSPENDED`, `ERROR`, `DISCONNECTED`. Somente `ACTIVE` autoriza envios reais. Validar permissões, propriedade/associação da WABA, phone_number_id, webhook, template aprovado quando necessário e condição de faturamento.
- Tela **Configurações > WhatsApp**: conectar conta oficial; visualizar WABA e número mascarados, status de conexão, status do faturamento, responsabilidade financeira do cliente, templates, opt-in, logs de envios, falhas e botão desconectar. Informar que tarifas e regras de cobrança são definidas pela Meta e podem mudar. Consumo exibido no SaaS é estimativo/operacional quando não houver dados oficiais suficientes, não uma fatura emitida pela Meta.
- Segurança multi-tenant: relacionar WABA, número, tokens, webhook e templates ao tenant correto; rejeitar vinculação cruzada indevida; validar assinatura de webhook e mapear eventos pelo identificador oficial do número/WABA, nunca confiar em tenant_id fornecido no payload externo. Revogação/desconexão desabilita imediatamente novos envios, preservando histórico permitido.
- Se a Meta exigir recursos, permissões ou termos específicos para um provedor SaaS, documentar e concluir aprovação/homologação antes de ativar em produção. O sistema não pode marcar a integração como pronta sem uma mensagem real entregue, webhook recebido e teste do faturamento próprio/ausência de linha de crédito da plataforma.
- **Critérios de aceite:** (1) Tenant A e B conectam WABAs distintas; (2) nenhum token ou mensagem vaza entre tenants; (3) sem faturamento próprio validado, envio fica bloqueado; (4) Meta indisponível não interrompe a OS; (5) reconexão, expiração/revogação de token e falha de webhook têm estados e alertas; (6) histórico de envios e opt-out auditáveis; (7) nenhuma cobrança de consumo Meta entra no faturamento do SaaS.

### 3.9 Consulta de serviço e portal público
- Busca interna por número OS, cliente, telefone, IMEI parcial, modelo, técnico, período e status; paginação, filtros e exportação autorizada.
- Portal do cliente por URL com token opaco, expiração/rotação e verificação adicional quando necessário; exibir apenas dados mínimos, status público, orçamento e previsão, sem laudos internos, notas privadas ou identificadores sensíveis. Não permitir enumeração de OS.

### 3.10 Catálogo, fornecedores e estoque
- Categorias, SKU, código de barras, descrição, imagem, unidade, custo, preço, preço promocional, estoque mínimo, ativo, fornecedor, compatibilidade com modelos, localização física.
- Estoque por filial e depósitos opcionais. Movimentações imutáveis de entrada, venda, consumo OS, devolução, transferência, ajuste, perda e reserva. Cada movimentação tem origem, autor, quantidade e custo registrado.
- Reserva de peças para OS e baixa no consumo efetivo; estorno controlado no cancelamento; impedir estoque negativo por padrão com override auditado.
- Transferência interfiliais com origem, trânsito, confirmação de recebimento e diferenças. Alertas de mínimo e inventário com reconciliação.

### 3.11 PDV e vendas
- Carrinho por filial e caixa, leitura de código de barras, busca, cliente opcional, itens e quantidades, descontos por permissão, total, pagamento único ou misto, dinheiro e troco, Pix, crédito/débito, estorno/devolução autorizados, comprovante não fiscal identificado.
- Pagamento de OS no mesmo motor financeiro, sem criar uma venda duplicada para a mesma cobrança. Uma OS pode ter peças e mão de obra faturadas; acessórios adicionais vendidos na retirada podem integrar pedido próprio vinculado à OS.
- Integração real de adquirência/Pix como módulo separado; sem integração, permitir registro manual do recebimento, identificado como manual, nunca simular aprovação automática.
- Documento fiscal NF-e/NFC-e/NFS-e fora do escopo inicial; não rotular recibo como nota fiscal. Arquitetura deve permitir integração futura.

### 3.12 Caixa e financeiro
- Sessão de caixa por operador/filial com abertura (fundo), recebimentos, suprimentos, sangrias, estornos, fechamento por método e conferência; proibir múltiplas sessões abertas conflitantes por política configurada.
- Ledger imutável de movimentos financeiros, `payment` com parcelas/alocações por origem, `cash_movement` para dinheiro físico, e conciliação. Evitar dupla contagem: faturamento de serviços/produtos não equivale a recebimentos e sangria não é despesa.
- Pagamentos parciais, mistos, antecipações, saldo em aberto, reembolso, estorno e diferença de fechamento. Ajustes por lançamento compensatório, nunca editar histórico silenciosamente.
- Relatórios de vendas por competência, recebimentos por caixa/data, contas a receber e margem bruta estimada; custos e taxas separados.

### 3.13 Garantias e pós-venda
- Garantia por linha de serviço/peça, com política e prazo informados, sem reduzir direitos legais obrigatórios. Termos versionados e aceitos.
- Solicitação de retorno vinculada à OS original; triagem, diagnóstico de garantia, resolução, eventual negativa fundamentada, fotos e histórico. Não apagar OS original.
- Registrar data de entrega e documento de retirada assinado.

### 3.14 Relatórios
- Filtros por tenant/filial/período/técnico/atendente; OS por status, tempo de execução, SLA, retorno/garantia, receita por tipo, recebimentos por meio, vendas de acessórios, CMV, margem estimada, descontos, caixa, sangrias, estoque e peças usadas.
- Exportar CSV e PDF com jobs assíncronos, permissões e escopo tenant. Distinguir faturamento, recebimento e lucro; não confundir saldo de caixa com receita.

## 4. Máquina de estados e regras de transição

Manutenção (`technical_status`): RECEIVED -> WAITING_DIAGNOSIS -> DIAGNOSING -> WAITING_QUOTE_APPROVAL -> APPROVED -> WAITING_PARTS (opcional) -> IN_REPAIR -> TESTING -> READY; caminhos REJECTED, CANCELED, RETURNED_UNREPAIRED; REOPENED via ocorrência auditada. Para orçamento previamente aprovado, permitir transição DIAGNOSING -> APPROVED conforme política. `WAITING_PARTS` pode retornar a `IN_REPAIR` ou `APPROVED` com registro.

Entrega (`delivery_status`): IN_CUSTODY -> READY_FOR_PICKUP -> DELIVERED; devolver sem reparo com motivo. Financeiro (`payment_status`): UNBILLED, UNPAID, PARTIALLY_PAID, PAID, REFUNDED, PARTIALLY_REFUNDED. Orçamento (`quote_status`): DRAFT, SENT, APPROVED, REJECTED, EXPIRED, SUPERSEDED. Cada transição deve ter permissão, pré-condições, evento de auditoria, evento de domínio e testes. Não derivar pagamento de status técnico.

Regras: concluir reparo não implica entrega; entrega pode exigir quitação ou override; aprovação se vincula a uma versão imutável do orçamento; consumo de peça é transação atômica com estoque; uma venda confirmada não pode ser apagada, somente cancelada/estornada; OS cancelada não desaparece; reabertura preserva histórico; operações financeiras e de estoque usam idempotency key e locking/controle de concorrência.

## 5. Modelo de dados PostgreSQL / Prisma

Entidades obrigatórias (campos básicos `id`, `created_at`, `updated_at` quando aplicável):

**Plataforma:** `users(email unique,password_hash,name,mfa_enabled,status)`, `sessions(user_id,refresh_hash,expires_at,revoked_at)`, `tenants(name,legal_name,document,status,timezone)`, `branches(tenant_id,name,address,timezone,status)`, `tenant_memberships(tenant_id,user_id,role,status)`, `membership_branches(membership_id,branch_id)`, `invitations(tenant_id,email,role,token_hash,expires_at)`, `plans(name,price_cents,currency,billing_period,limits_json,features_json)`, `subscriptions(tenant_id,plan_id,status,current_period_start,current_period_end,provider,external_id)`, `billing_invoices(tenant_id,subscription_id,amount_cents,status,due_at,paid_at,external_id)`, `billing_webhook_events(provider,event_id,payload_hash,processed_at,status)`, `feature_usage(tenant_id,period,metric,value)`, `audit_logs(tenant_id nullable,actor_id,action,entity,entity_id,metadata_json,created_at)`.

**Atendimento:** `customers(tenant_id,name,phone_e164,email,document,notes)`, `customer_consents(tenant_id,customer_id,channel,purpose,granted_at,revoked_at,source)`, `devices(tenant_id,customer_id,brand,model,color,imei_encrypted,serial_encrypted)`, `service_orders(tenant_id,branch_id,number,customer_id,device_id,created_by,assigned_technician_id,technical_status,delivery_status,payment_status,priority,reported_issue,diagnosis,estimated_delivery_at,received_at,completed_at,delivered_at,version)`, `service_order_accessories(tenant_id,order_id,type,description,received)`, `service_order_checklists(tenant_id,order_id,phase,items_json,completed_by,completed_at)`, `service_order_events(tenant_id,order_id,actor_id,event_type,from_status,to_status,payload_json,created_at)`, `service_order_notes(tenant_id,order_id,author_id,visibility,text)`, `service_order_files(tenant_id,order_id,storage_key,type,mime,checksum,uploaded_by)`, `service_order_terms(tenant_id,order_id,term_version,document_hash,accepted_at,signature_file_id)`, `quotes(tenant_id,order_id,version,status,total_cents,expires_at,approved_at,approved_by_customer_id,approval_evidence_json)`, `quote_lines(tenant_id,quote_id,kind,product_id nullable,description,qty,unit_price_cents,unit_cost_cents,discount_cents)`, `warranty_claims(tenant_id,order_id,original_line_id,status,reason,resolution)`, `pickup_receipts(tenant_id,order_id,received_by,delivered_by,signature_file_id,delivered_at)`.

**Catálogo e estoque:** `categories(tenant_id,name)`, `suppliers(tenant_id,name,contact)`, `products(tenant_id,sku,barcode,name,category_id,supplier_id,kind,cost_cents,price_cents,min_stock,active)`, `product_compatibility(tenant_id,product_id,brand,model)`, `stock_locations(tenant_id,branch_id,name)`, `stock_balances(tenant_id,location_id,product_id,on_hand,reserved,version)`, `stock_movements(tenant_id,branch_id,location_id,product_id,type,quantity,unit_cost_cents,reference_type,reference_id,actor_id,created_at)`, `stock_reservations(tenant_id,order_id,product_id,location_id,quantity,status)`, `stock_transfers(tenant_id,source_branch_id,dest_branch_id,status,created_by,received_by)`, `stock_transfer_lines(tenant_id,transfer_id,product_id,quantity_sent,quantity_received)`.

**PDV e financeiro:** `sales(tenant_id,branch_id,customer_id nullable,order_id nullable,created_by,status,subtotal_cents,discount_cents,total_cents,created_at)`, `sale_items(tenant_id,sale_id,product_id,qty,unit_price_cents,unit_cost_cents,discount_cents)`, `receivables(tenant_id,branch_id,source_type,source_id,amount_cents,due_at,status)`, `payments(tenant_id,branch_id,method,amount_cents,status,provider,external_id,received_at,idempotency_key)`, `payment_allocations(tenant_id,payment_id,receivable_id,amount_cents)`, `refunds(tenant_id,payment_id,amount_cents,reason,status,created_by)`, `cash_registers(tenant_id,branch_id,name,active)`, `cash_sessions(tenant_id,branch_id,register_id,opened_by,opened_at,opening_float_cents,status,closed_by,closed_at,declared_totals_json)`, `cash_movements(tenant_id,cash_session_id,type,method,amount_cents,payment_id nullable,reason,actor_id,created_at)`, `financial_ledger(tenant_id,branch_id,source_type,source_id,entry_type,amount_cents,created_at)`.

**Mensagens e configurações:** `messaging_channels(tenant_id,branch_id nullable,provider,status,encrypted_credentials_ref,external_phone_id,external_waba_id,billing_status,billing_verified_at,billing_verification_method,connected_at,disconnected_at)`, `messaging_billing_checks(tenant_id,channel_id,status,method,evidence_ref,checked_by,checked_at,notes)`, `message_templates(tenant_id,event_type,provider,body,external_template_id,enabled,version)`, `notification_outbox(tenant_id,event_id,event_type,payload_json,status,created_at)`, `message_deliveries(tenant_id,channel_id,order_id nullable,customer_id,template_id,event_id,status,provider_message_id,attempts,last_error,created_at)`, `settings(tenant_id,branch_id nullable,key,value_json)`, `document_templates(tenant_id,type,version,content,active)`, `public_tracking_tokens(tenant_id,order_id,token_hash,expires_at,revoked_at)`, `idempotency_records(tenant_id,actor_id,key,route,request_hash,response_json,expires_at)`.

**Restrições críticas:** índices por `(tenant_id, branch_id, status, created_at)` quando aplicável; chaves estrangeiras compostas que incluam `tenant_id` para impedir associação entre tenants; UNIQUE por tenant para SKU, número de OS e números de caixa conforme necessidade; CHECK quantidade positiva, valores não negativos onde aplicável; totais financeiros coerentes; `ON DELETE RESTRICT` para registros financeiros e de auditoria. Definir migrations versionadas e seed apenas com dados fictícios.

## 6. API REST v1 (rotas mínimas)

Prefixo `/api/v1`; OpenAPI em `/api/docs` protegido em produção. Listagens paginadas, filtros e ordenação permitida; formato uniforme de erros `{code,message,details,requestId}`. Autorização aplicada em controllers E services. `Idempotency-Key` obrigatório para criar venda, registrar pagamento, movimentar caixa/estoque e receber webhooks; concorrência protegida por transações.

- Auth: `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password`; `GET /auth/me`; `POST /auth/switch-tenant`.
- Tenant: `GET/PATCH /tenant`, `GET/POST /branches`, `GET/PATCH /branches/:id`, `GET/POST /members`, `PATCH /members/:id`, `POST /members/invite`.
- Clientes: `GET/POST /customers`, `GET/PATCH /customers/:id`, `GET/POST /customers/:id/devices`.
- OS: `GET/POST /service-orders`, `GET/PATCH /service-orders/:id`, `POST /service-orders/:id/assign`, `/start-diagnosis`, `/submit-diagnosis`, `/start-repair`, `/request-parts`, `/complete-repair`, `/deliver`, `/cancel`, `/reopen`; `GET /service-orders/:id/history`; `POST /service-orders/:id/files`, `/checklists`, `/notes`; `GET /service-orders/:id/pdf`.
- Orçamentos: `GET/POST /service-orders/:id/quotes`, `POST /quotes/:id/send`, `POST /quotes/:id/approve`, `/reject` (rotas públicas de aprovação separadas por token seguro/OTP).
- Portal OrdemCerta: página `GET /status`, URL de acompanhamento `GET /status/os:numero?token=<segredo>` (frontend); API `POST /public/status/lookup` com número da OS + token, `GET /public/status/orders/:numero?token=...` apenas se medidas anti-vazamento de URL forem atendidas (preferir token em cabeçalho/POST), `GET /public/status/timeline`, `POST /public/status/otp/request`, `POST /public/status/quotes/:id/approve`, `/reject`. Gerar token aleatório na criação da OS, guardar hash, exibir ao atendente, imprimir comprovante/QR, permitir copiar link e enviar via WhatsApp; reemissão revoga o anterior. OTP adicional para aprovar/recusar orçamento, auditoria e rate limit. Não expor dados privados em URL ou logs; nunca usar número de OS isolado como autenticação.
- Produtos: `GET/POST /products`, `GET/PATCH /products/:id`, `GET/POST /categories`, `GET/POST /suppliers`.
- Estoque: `GET /stock/balances`, `GET /stock/movements`, `POST /stock/receive`, `/stock/adjust`, `/stock/reserve`, `/stock/consume`, `/stock/release`, `GET/POST /stock/transfers`, `POST /stock/transfers/:id/receive`.
- Vendas: `GET/POST /sales`, `GET /sales/:id`, `POST /sales/:id/confirm`, `/cancel`, `/refund`, `GET /sales/:id/receipt`.
- Pagamentos: `GET/POST /receivables`, `POST /payments`, `GET /payments`, `POST /payments/:id/refund`.
- Caixa: `GET /cash-registers`, `POST /cash-registers`, `POST /cash-sessions/open`, `GET /cash-sessions/current`, `POST /cash-sessions/:id/supply`, `/withdraw`, `/close`, `GET /cash-sessions/:id/summary`.
- WhatsApp: `GET/POST /messaging/channels`, `GET /messaging/channels/:id/status`, `POST /messaging/channels/:id/connect`, `/disconnect`, `POST /messaging/channels/:id/onboarding/start`, `POST /messaging/channels/:id/onboarding/complete`, `GET /messaging/channels/:id/billing-status`, `POST /messaging/channels/:id/billing-verification`, `GET/PUT /messaging/templates`, `GET /messaging/deliveries`, `POST /messaging/test`; `GET/POST /webhooks/whatsapp` com verificação adequada.
- Garantias: `GET/POST /warranties/claims`, `GET/PATCH /warranties/claims/:id`.
- Relatórios: `GET /reports/overview`, `/service-orders`, `/technicians`, `/sales`, `/stock`, `/cash`, `/warranties`; `POST /reports/exports`, `GET /reports/exports/:id`.
- Billing Mercado Pago: `GET /billing/plans`, `/billing/subscription`, `/billing/invoices`, `/billing/payment-methods`; `POST /billing/signup`, `/billing/checkout/card`, `/billing/checkout/pix`, `/billing/invoices/:id/pix`, `/billing/subscription/change-plan`, `/billing/subscription/cancel`, `/billing/subscription/reactivate`; `GET /billing/invoices/:id`; `POST /webhooks/mercadopago` público com validação de autenticidade e reconciliação via API oficial. Rotas exatas internas a implementar conforme seção 17.
- Plataforma (guard próprio): `GET/POST /platform/plans`, `GET /platform/tenants`, `PATCH /platform/tenants/:id/status`, `GET /platform/metrics`, `/platform/audit`.

Para cada rota, implementar DTO, validação Zod/class-validator consistente, RBAC, escopo tenant/filial, erros de domínio, OpenAPI e testes. Não inventar endpoints de provedor externo sem consultar sua documentação atual.

## 7. Telas e rotas do frontend

**Público:** `/login`, `/forgot-password`, `/reset-password`, `/signup`, `/pricing`, `/track/:token`, `/quote/:token`.

**Tenant:** `/app/dashboard`, `/app/service-orders`, `/app/service-orders/new`, `/app/service-orders/:id`, `/app/technician/queue`, `/app/technician/orders/:id`, `/app/customers`, `/app/customers/:id`, `/app/sales/pos`, `/app/sales`, `/app/products`, `/app/stock`, `/app/stock/transfers`, `/app/cash`, `/app/cash/sessions/:id`, `/app/reports`, `/app/warranties`, `/app/messaging`, `/app/settings/company`, `/app/settings/branches`, `/app/settings/users`, `/app/settings/documents`, `/app/billing`.

**Plataforma:** `/platform/dashboard`, `/platform/tenants`, `/platform/tenants/:id`, `/platform/plans`, `/platform/subscriptions`, `/platform/audit`, `/platform/jobs`.

UX: navegação lateral por permissão; busca global; estados loading/empty/error; confirmação em operações destrutivas; atalhos no PDV; filtros persistentes na URL; impressão A4 e recibo; badge de conexão WhatsApp; toasts; proteção contra dupla submissão; websocket com atualização incremental; suporte a teclado e acessibilidade WCAG 2.2 AA onde aplicável.

## 8. Documentos e termos

Modelos versionados por tenant: ficha de entrada, termo de responsabilidade, orçamento, aprovação, comprovante de venda NÃO FISCAL, termo de garantia e recibo de retirada. Campos dinâmicos com escaping e proteção contra injeção HTML. Registrar versão usada, checksum SHA-256, momento de emissão, usuário e assinatura/evidências quando houver. Termos devem ser revisados juridicamente antes do uso comercial; não aplicar automaticamente cláusulas abusivas de exclusão de responsabilidade ou garantia.

## 9. Eventos, filas e integridade

Eventos: `os.created`, `os.diagnosis_started`, `quote.sent`, `quote.approved`, `quote.rejected`, `os.repair_started`, `os.ready`, `os.delivered`, `stock.consumed`, `sale.confirmed`, `payment.received`, `cash.closed`, `subscription.updated`. Usar transactional outbox na mesma transação das alterações de estado. Worker processa e registra entregas idempotentes; retries com backoff e dead-letter; dashboard para reprocessar falhas sem duplicar mensagens. Eventos websocket emitidos após commit. Nunca confiar no status de webhook recebido sem validar assinatura e idempotência.

## 10. Segurança, observabilidade e conformidade

HTTPS, HSTS, CSP, CORS por allowlist, cookies seguros, sanitização, validação server-side, proteção CSRF, rate limits por IP/tenant/usuário, prevenção IDOR, SQL injection e XSS, upload seguro, secrets manager, rotação de credenciais, criptografia de dados sensíveis, backups offsite com retenção e testes de restore. Política de retenção e descarte. Audit log append-only com diffs minimizados; acesso a dados sensíveis com justificativa. Nunca logar tokens, mensagens completas, senhas, IMEI completo ou dados de pagamento. Pagamento com cartão sempre via adquirente/gateway; não capturar PAN/CVV.

## 11. Testes e critérios de aceite obrigatórios

- Unitários para preços, descontos, orçamento, estados, garantia, estoque, caixa e limites de plano.
- Integração com PostgreSQL real em ambiente de teste, Redis e storage mock/isolado; migrations aplicadas do zero e upgrade em banco com dados.
- E2E Playwright para: onboarding -> cliente -> aparelho -> OS -> técnico recebe em tempo real -> diagnóstico -> orçamento -> aprovação -> reparo -> baixa de peça -> conclusão -> notificação enfileirada -> pagamento -> entrega -> PDF; PDV -> pagamento misto -> estoque -> caixa -> sangria -> fechamento -> relatórios; assinatura -> webhook -> liberação/suspensão; garantia -> retorno.
- Testes de isolamento: dois tenants com mesmos IDs externos/telefones; usuários sem filial; websocket rooms; download de anexos; exportação; jobs e endpoints públicos. Qualquer vazamento bloqueia release.
- Testes de concorrência: duas vendas da última unidade; dupla confirmação de pagamento; duas sangrias simultâneas; OS com versão desatualizada; webhook duplicado; clique duplo em confirmar.
- Testes de falha: WhatsApp desconectado, API de cobrança fora, storage indisponível, worker reiniciado, timeout e retry. Fluxo transacional deve continuar consistente.
- Sem `TODO`, placeholders ou mock em caminhos de produção. Provedores externos não configurados devem mostrar 'integração não configurada', jamais fingir sucesso.

## 12. Plano de execução com marcos verificáveis

**M0 Fundação:** monorepo, compose, migrations, auth, tenant/filial, RBAC, RLS, auditoria, CI e health. Entrega verificável: login e isolamento funcionando. Ainda não há OS/PDV.

**M1 Atendimento:** clientes, aparelhos, OS, fotos, termos, PDFs, fila técnica, websocket, histórico, laudo, orçamento e aprovação. Entrega verificável: OS até conclusão e retirada, mas sem financeiro/estoque se M2 não estiver pronto.

**M2 Operação:** catálogo, estoque, reservas/consumo, PDV, recebíveis, pagamentos manuais, caixa, sangria, fechamento, estornos e relatórios. Entrega verificável: venda/OS integradas e conciliação sem duplicidade.

**M3 Comunicação:** canais oficiais WhatsApp, templates, opt-in, outbox, workers, logs, portal de consulta e links de aprovação. Entrega verificável: notificações reais apenas quando canal/template estiver configurado e aprovado.

**M4 Comercialização SaaS:** planos, quotas, billing com provedor selecionado, trial, webhooks, inadimplência, painel plataforma e onboarding self-service. Entrega verificável: empresa assina, opera, paga, muda de plano e tem limites aplicados.

**M5 Produção:** testes de carga, pentest orientado a multi-tenancy, backups/restauração, monitoramento, documentação, homologação operacional e rollout. Entrega verificável: checklist de produção aprovado.

Regra: implementar todas as etapas previstas, em sequência, sem declarar o sistema completo após M0/M1. Ao finalizar cada marco, informar exatamente o que funciona, o que falta, integrações não configuradas e endpoints que ainda retornam erro/501. Não inventar credenciais nem afirmar que WhatsApp, Pix ou billing estão operacionais sem validação real.

## 13. Estrutura sugerida do repositório

```text
ordemcerta/
  apps/
    api/src/modules/{auth,platform,tenants,branches,users,customers,devices,service-orders,quotes,technicians,products,stock,sales,payments,cash,warranties,messaging,reports,billing,documents,audit}/
    web/src/{app,components,features,pages,lib}/
    worker/src/{jobs,processors,providers}/
  packages/{shared,ui}/
  prisma/{schema.prisma,migrations,seed.ts}/
  infra/{docker,traefik,monitoring,backup}/
  docs/{architecture,api,permissions,states,runbooks,privacy}/
  tests/{integration,e2e,security}/
  docker-compose.yml
  docker-compose.prod.yml
  .env.example
  README.md
```

## 14. Comandos e entregáveis esperados do implementador

Fornecer README com requisitos, instalação, variáveis, migrações, seed, comandos de teste, build, execução local, deploy VPS e rollback; `.env.example`; `docker-compose.yml` e override produção; Dockerfiles multi-stage; schema Prisma e migrações; OpenAPI; coleção Postman/Bruno; templates PDF; testes e CI; documentação de RBAC e fluxos; scripts de backup/restore e runbooks.

Sequência operacional pretendida (adaptar nomes reais dos serviços):

```bash
cp .env.example .env
# preencher segredos, domínios e credenciais reais
pnpm install --frozen-lockfile
pnpm build
pnpm test
# em ambiente local, subir infraestrutura com Docker Compose
# em produção, usar job dedicado de migração antes de trocar imagens
# subir stack em rede externa do Traefik sem publicar banco/cache
```

Não executar migração destrutiva ou deploy em VPS de produção sem backup e confirmação. Documentar a configuração exata do Traefik existente após inspecionar suas redes, entrypoints e certresolver.

## 15. Decisões de negócio configuráveis e dependências externas

Definidos: marca OrdemCerta, domínio `ordemcerta.adapterco.com.br`, quatro planos mensais e limites de lojas/técnicos/caixa, Mercado Pago para cartão recorrente e Pix manual sem renovação automática por Pix. Ainda validar antes do go-live: disponibilidade efetiva da API de assinaturas e das credenciais da conta Mercado Pago, comportamento de renovação e homologação dos webhooks; habilitação da integração oficial Meta, elegibilidade do Embedded Signup e validação do faturamento BYOK direto do cliente; provedor de storage; política de garantia e termos revisados; retenção de fotos/documentos; regras de entrega com saldo em aberto; política de estoque negativo; uso de documento fiscal (integração futura). Nenhuma dessas escolhas deve impedir implementar a base com adapters e configurações, mas funcionalidades dependentes de credenciais/contratos externos não podem ser declaradas prontas antes da homologação.

## 16. Instrução final ao agente de desenvolvimento

Leia integralmente este documento. Antes de codar, produza mapa de entidades, migrations, matriz de permissões e contratos de API coerentes com os fluxos. Implemente backend, frontend, worker, banco, eventos, PDFs, testes e deploy de forma integrada. Evite dados fictícios em produção. Priorize transações, segurança multi-tenant e consistência financeira. Ao concluir, execute testes automatizados e E2E, liste evidências, limitações reais e todos os fluxos ainda não operacionais. Não confunda tela desenhada com funcionalidade pronta.


## 17. CONTRATO COMERCIAL DEFINITIVO — ORDEMCERTA E MERCADO PAGO (OBRIGATÓRIO)

### 17.1 Planos oficiais e seed imutável por código

| Código | Nome | Mensalidade BRL | `price_cents` | Máximo de filiais ativas | Técnicos ativos por filial | Caixas cadastrados ativos por filial |
|---|---|---:|---:|---:|---:|---:|
| `ESSENCIAL` | Essencial | R$ 29,99 | 2999 | 1 | 3 | 1 |
| `PROFISSIONAL` | Profissional | R$ 59,99 | 5999 | 3 | 3 | 1 |
| `AVANCADO` | Avançado | R$ 89,99 | 8999 | 5 | 3 | 1 |
| `REDE` | Rede | R$ 129,99 | 12999 | 10 | 3 | 1 |

- Todos os planos têm período **mensal**, moeda BRL e todos os módulos operacionais previstos neste documento, sujeitos apenas aos limites explicitados. Capacidade agregada de técnicos: 3, 9, 15 e 30; capacidade agregada de caixas: 1, 3, 5 e 10, respectivamente, **se** todas as filiais permitidas forem utilizadas.
- **Uma assinatura por tenant/empresa**, cobrindo todas as suas filiais; não cobrar uma assinatura por filial. Técnicos são usuários com vínculo `TECHNICIAN` ativo na filial (contar associações por filial, não apenas usuários globais). Um técnico associado a duas filiais ocupa uma vaga em cada uma. Um caixa = um registro de `cash_register` ativo por filial; sessões de abertura/fechamento sucessivas são permitidas, mas não simultâneas para o mesmo caixa.
- Dono, gerentes, atendentes e outros perfis não consomem vaga de técnico, salvo quando também tiverem habilitação técnica operacional. Não criar limites artificiais de atendentes sem decisão comercial; proteção antiabuso e controles de acesso continuam obrigatórios.
- O seed é idempotente (`code` UNIQUE), nunca duplica planos; não sobrescrever preços históricos de assinaturas existentes. Alteração de tabela de preços cria nova versão comercial e exige regra explícita para clientes antigos.
- Validar limites no backend com transações e locks nas operações de criar/ativar/reabrir filial, atribuir função técnica, associar técnico à filial, cadastrar/reativar caixa e restaurar registros. Retornar `PLAN_LIMIT_REACHED` (HTTP 409 ou 422), com limite, uso atual e plano. Não contornar limite por API direta, importação ou concorrência.

### 17.2 Separação absoluta dos fluxos financeiros

- **Billing da plataforma:** a empresa paga à OrdemCerta via **conta Mercado Pago da operadora do SaaS**, em um módulo isolado (`platform_billing_*`). Não entra no PDV, caixa, receitas, estoque ou relatórios comerciais de uma filial cliente.
- **Vendas da assistência:** são recebimentos da própria loja, com os métodos configurados por ela; não usar automaticamente a conta Mercado Pago da OrdemCerta para receber pagamentos de OS/acessórios. Integração de recebimento própria da assistência é outro projeto/credencial, não pressuposta.
- **WhatsApp Meta BYOK:** consumo de mensagens é responsabilidade financeira da assistência, com conta e faturamento próprios; não misturar com billing do SaaS.

### 17.3 Formas de cobrança e regras de renovação

**Cartão de crédito recorrente:** usar mecanismo oficial de **assinaturas/Preapproval do Mercado Pago**, após confirmar na documentação atual os recursos efetivamente disponíveis para a conta brasileira. Criar vínculo de assinatura no provedor com identificador interno opaco, plano/valor/periodicidade e autorização do pagador. O cartão e seus dados sensíveis ficam exclusivamente no ambiente/tokenização autorizada do Mercado Pago; nunca guardar PAN/CVV no OrdemCerta. A assinatura só fica `ACTIVE` quando existir evidência confirmada de **pagamento do primeiro período**, não apenas autorização, criação de preapproval ou retorno do navegador. Renovação automática conforme cobranças efetivamente confirmadas pelo provedor; registrar falhas e atrasos.

**Pix manual:** a cada período mensal, gerar uma **fatura interna** e uma cobrança Pix avulsa no Mercado Pago, com vencimento, QR Code e código copia-e-cola; não chamar isso de Pix automático ou assinatura Pix recorrente. A criação de fatura ou emissão de QR **não** libera acesso. O cliente paga manualmente todo mês. Para cada nova fatura vencível, oferecer `Gerar Pix`, `Copiar código`, `Ver QR`, `Consultar pagamento`. Gerar no máximo uma cobrança ativa por fatura, com chave idempotente e política explícita de expiração/substituição; não emitir cobranças duplicadas em retry. O período pago deve ser prorrogado **uma vez** após confirmação de pagamento da fatura correspondente.

- Data de renovação: **dia-âncora da contratação**, preservado ao longo dos ciclos; para dias 29–31 em meses curtos, usar o último dia do mês, sem deriva da âncora. Definir timezone de cobrança `America/Sao_Paulo` e datas em UTC no banco.
- Sem trial por padrão; preço do plano é mensal, sem taxa de implantação por padrão. Descontos, cupons, anualidade e testes grátis só após nova definição comercial.
- O Mercado Pago pode exigir condições específicas para assinatura, meios de pagamento e notificações. **Não inventar nomes de campos, endpoints externos, comportamento de status ou garantia de entrega de webhooks**; conferir documentação vigente e homologar conta/credenciais antes de ativar produção.

### 17.4 Fluxo completo de contratação no cadastro

1. Página pública `/planos` mostra os quatro planos e limites; seleção leva a `/cadastro?plano=<code>` com valores buscados da API, nunca aceitos do navegador como preço definitivo.
2. Cadastro coleta nome, e-mail, senha, documento da empresa/responsável conforme necessidade legal, telefone, aceite de termos e política de privacidade; confirmar e-mail quando configurado. Normalizar documento/e-mail; proteger contra enumeração e duplicação. Criar tenant `PENDING_PAYMENT`, usuário `TENANT_OWNER`, assinatura interna `PENDING_PAYMENT` e tentativa de checkout em transação idempotente. Não liberar criação de OS, PDV ou filial operacional antes de `ACTIVE`.
3. Cliente escolhe **Cartão recorrente** ou **Pix manual**. O backend cria a intenção no Mercado Pago usando credenciais da plataforma, com referência externa opaca e `Idempotency-Key` persistida. Se falhar, registrar erro e permitir retry seguro sem duplicar tenant ou cobrança.
4. Cartão: redirecionar ou apresentar checkout/tokenização oficial e acompanhar status; Pix: apresentar QR/copia-e-cola, vencimento e opção de nova emissão segura. O frontend exibe `Aguardando confirmação` mesmo após retorno de checkout.
5. Receber evento do provedor, verificar autenticidade, consultar objeto oficial na API e correlacionar com cobrança/assinatura/tenant/valor/moeda/período; persistir o evento bruto minimizado e processar idempotentemente.
6. Somente **pagamento confirmado** marca a fatura `PAID`, cria registro de pagamento, ativa a assinatura e libera o onboarding da primeira filial. Enviar confirmação por e-mail e mostrar recibo de assinatura (não emitir documento fiscal automaticamente).
7. Se pagamento for recusado, pendente, expirado ou cancelado, manter `PENDING_PAYMENT`/`PAST_DUE` conforme fase, mostrar motivo seguro e permitir nova tentativa. Reconciliação agendada cobre webhook ausente ou fora de ordem.

### 17.5 Webhooks, reconciliação e idempotência

- Endpoint interno `POST /api/v1/webhooks/mercadopago`, acessível externamente via Traefik; verificar assinatura/autenticidade **conforme documentação oficial vigente**, segredo por ambiente, proteção contra replay quando suportado. Responder rapidamente após persistência durável; processar em worker.
- Não confiar no corpo do webhook como prova de pagamento. Consultar API oficial com credenciais server-side, identificar recurso e verificar status final, valor exato em centavos, moeda BRL, referência, tenant, plano, fatura e eventual estorno/chargeback.
- `UNIQUE(provider,event_id)` para eventos quando o identificador existir; deduplicar também por `(provider,resource_type,resource_id,status_or_version)` e `provider_payment_id` UNIQUE, respeitando notificações de status diferentes do mesmo pagamento. Aplicar transação com lock de fatura/assinatura e transição monotônica por eventos efetivos; evento antigo não desfaz pagamento novo. Armazenar evidência de status consultado e data.
- Worker de reconciliação: verificar pendências e pagamentos com falhas, assinaturas em renovação, faturas vencidas, eventos não processados, estornos e cancelamentos; backoff e dead-letter com painel para reprocessar. Nunca criar duas faturas para o mesmo `(subscription_id, period_start)`.
- Segredos Mercado Pago no secret store/ambiente, nunca frontend, PDF, logs, banco em texto claro ou repositório. Credenciais de teste e produção isoladas. TLS, rate limit, correlação e auditoria.

### 17.6 Máquina de estados e inadimplência

- Assinatura interna: `PENDING_PAYMENT`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`, `CANCEL_AT_PERIOD_END`, `CANCELED`. `ACTIVE` depende de período pago vigente; não equiparar estado da autorização recorrente no provedor a fatura quitada.
- Fatura: `DRAFT`, `OPEN`, `PENDING`, `PAID`, `EXPIRED`, `VOID`, `REFUNDED`, `CHARGEBACK`. Pagamento: `CREATED`, `PENDING`, `APPROVED`, `REJECTED`, `CANCELED`, `REFUNDED`, `CHARGEBACK` (mapear estados reais do provedor no adapter).
- **Política comercial inicial:** vencimento não pago -> `PAST_DUE` com **3 dias corridos de tolerância**; durante a tolerância, operação continua e há avisos de pagamento. Após 3 dias, `SUSPENDED`: bloquear novas OS, vendas, movimentações de estoque e caixa, convites e configurações operacionais, mantendo login, visualização dos dados, exportações autorizadas e página de regularização. Permitir fechar caixa já aberto de forma controlada para evitar inconsistência financeira; registrar exceção auditada. Não excluir dados automaticamente. Política parametrizável pelo superadmin.
- Enviar avisos de cobrança no vencimento, após 1 dia e antes da suspensão por e-mail/canal permitido, sem depender do WhatsApp BYOK do tenant. Portal público de consulta de OS existentes permanece **somente leitura**, com proteção de dados; aprovações que mudem o serviço devem ser bloqueadas ou enfileiradas segundo política explícita, nunca aceitas silenciosamente durante suspensão.
- Ao confirmar quitação válida, reativar idempotentemente a empresa e liberar operações; definir como regularizar períodos em atraso sem criar cobrança retroativa duplicada. Estorno/chargeback revoga a quitação correspondente e dispara revisão/reconciliação e eventual suspensão conforme período ainda coberto.
- Cancelamento solicitado: `CANCEL_AT_PERIOD_END`, sem novas renovações quando o provedor confirmar cancelamento da autorização; preservar acesso até fim do período pago e depois `CANCELED`. Cancelamento imediato com reembolso somente por fluxo administrativo específico e política jurídica. Falha no cancelamento do provedor deve ficar visível e ser reconciliada, sem prometer cancelamento concluído.

### 17.7 Upgrade e downgrade

- Upgrade solicitado pelo `TENANT_OWNER`: mostrar plano atual/novo, preço e **valor proporcional** antes de confirmar; calcular pró-rata com base no tempo restante do ciclo, usando centavos e arredondamento determinístico. Por padrão, cobrar **diferença proporcional** em cobrança avulsa Mercado Pago (cartão conforme método autorizado e suporte real, ou Pix manual), manter ciclo original e aplicar o plano maior **somente após pagamento confirmado**. Não alterar unilateralmente a autorização de cartão no provedor; sincronizar valor de renovação futura por API oficial e verificar resultado. Se atualização falhar, manter upgrade pendente e reconciliar antes de confirmar. Nenhum upgrade grátis por redirect.
- Downgrade: agendar para **próxima renovação**, sem devolução proporcional por padrão. Antes de agendar, validar número de filiais ativas e técnicos/caixas por filial contra o novo plano; se exceder, informar exatamente o que deve ser desativado. Não excluir filiais, técnicos, OS, caixa ou histórico automaticamente. Mudança de valor futuro do cartão exige sincronização confirmada com o provedor; no Pix, próxima fatura usa o novo plano. Registrar `plan_change_requests` e cancelar substituições obsoletas com controle de concorrência.
- Cancelamento de upgrade pendente, downgrade agendado e falha no pagamento precisam ter fluxos de UI, API e testes. Mudança de preço geral não altera automaticamente assinaturas existentes sem política explícita.

### 17.8 Banco de dados adicional obrigatório

Ampliar as entidades genéricas da seção 5 com:

- `plans(code UNIQUE,name,price_cents,currency='BRL',billing_period='MONTHLY',max_branches,max_technicians_per_branch=3,max_cash_registers_per_branch=1,active,price_version)`; `plan_price_history(plan_id,version,price_cents,effective_at)`.
- `subscriptions(tenant_id UNIQUE,plan_id,provider='MERCADO_PAGO',payment_mode ENUM CARD_RECURRING|PIX_MANUAL,status,anchor_day,current_period_start,current_period_end,grace_until,provider_subscription_id nullable,provider_payer_ref nullable,scheduled_plan_id nullable,cancel_at_period_end,version)`.
- `billing_invoices(tenant_id,subscription_id,plan_id,period_start,period_end,amount_cents,currency,due_at,status,paid_at,provider_invoice_ref nullable,UNIQUE(subscription_id,period_start))`.
- `billing_payment_attempts(invoice_id,tenant_id,provider,method,provider_payment_id nullable UNIQUE,idempotency_key UNIQUE,amount_cents,status,qr_payload_encrypted nullable,qr_expires_at nullable,attempt_no,created_at)`.
- `billing_payments(invoice_id,attempt_id,provider_payment_id UNIQUE,amount_cents,confirmed_at,status)`; `billing_webhook_events(provider,event_id,resource_id,event_type,payload_hash,signature_valid,processed_at,status,error)`; `plan_change_requests(tenant_id,subscription_id,from_plan_id,to_plan_id,type,effective_at,proration_cents,payment_attempt_id nullable,status,created_by)`; `billing_audit_logs(...)`.
- Adicionar índices para jobs de cobrança, períodos, status, `tenant_id`, `due_at`; constraints de preço positivo, moeda BRL, ausência de período sobreposto e FKs; proteção de concorrência e migrations reais. Manter nomes existentes da seção 5 compatíveis, sem duplicar modelos Prisma.

### 17.9 Telas, rotas e permissões do billing

- Públicas: `/planos`, `/cadastro`, `/checkout/cartao`, `/checkout/pix`, `/checkout/pendente`, `/checkout/resultado` (resultado informativo, sem ativação por redirect).
- Tenant owner: `/app/billing` (plano, uso por filial, situação, vencimento, método, faturas, Pix), `/app/billing/planos` (upgrade/downgrade), `/app/billing/faturas/:id` (QR, copia-e-cola, comprovante/estado). Não permitir alterações de assinatura por técnicos, caixa ou atendentes.
- Plataforma: `/platform/plans`, `/platform/subscriptions`, `/platform/invoices`, `/platform/billing-events`, `/platform/reconciliation`, com filtros e reprocessamento auditado.
- API complementar: `GET /api/v1/billing/plans`, `POST /api/v1/billing/signup`, `POST /api/v1/billing/checkout/card`, `POST /api/v1/billing/checkout/pix`, `POST /api/v1/billing/invoices/:id/pix`, `GET /api/v1/billing/invoices/:id`, `GET /api/v1/billing/subscription`, `POST /api/v1/billing/subscription/change-plan`, `/cancel`, `/reactivate`, `POST /api/v1/webhooks/mercadopago`; ações administrativas separadas e autorizadas. Para todas: DTO, validação, RBAC, rate limit, idempotência, auditoria e OpenAPI.

### 17.10 Testes de aceitação obrigatórios (M4 não está pronto sem estes)

1. Cada plano é criado no seed uma vez, preço exato e limites corretos; usuário não altera preço pelo frontend.
2. Cadastro com cartão: pending -> cobrança confirmada -> active -> primeira filial liberada; retorno do navegador sem pagamento não ativa.
3. Cadastro com Pix: QR/copia-e-cola -> pending -> webhook validado + consulta -> active; Pix expirado/recusado não ativa; retry não duplica cobrança.
4. Renovação cartão: cobrança mensal confirmada avança período exatamente uma vez; falha leva a `PAST_DUE`; cobrança posterior regulariza.
5. Renovação Pix: nova fatura por período, pagamento manual, sem suposta recorrência Pix automática; pagamento atrasado ou duplicado não estende dois meses.
6. Webhook duplicado, fora de ordem, falso, assinatura inválida, timeout, worker reiniciado, API indisponível: nenhuma ativação indevida ou cobrança duplicada; reconciliação recupera pendências.
7. Upgrade pago: diferença proporcional calculada e exibida, confirmação real, sincronização do valor futuro, quotas novas aplicadas; falha não altera plano.
8. Downgrade: agendamento futuro, impedimento com filiais excedentes, preservação dos dados e troca correta no ciclo seguinte.
9. 3 dias de tolerância e suspensão: limites de operação aplicados pelo backend; consulta/exportação autorizadas e regularização funcionam; nenhuma OS/venda nova após suspensão.
10. Concorrência: duas criações de filial/técnico/caixa não ultrapassam quotas; duas tentativas de checkout não duplicam assinatura; dois webhooks não duplicam pagamento.
11. Billing da plataforma não aparece no caixa/PDV da assistência; cobrança Meta BYOK permanece independente.
12. Teste E2E real em sandbox/homologação Mercado Pago quando suportado, mais mocks determinísticos para estados não reproduzíveis; evidências de status, logs sem dados sensíveis e testes de isolamento entre dois tenants.

**Regra de conclusão:** não declarar billing em produção até confirmar credenciais reais, comportamento do cartão recorrente, Pix avulso, webhooks, cancelamento/alteração de assinatura e reconciliação no ambiente autorizado do Mercado Pago. Não criar cobranças reais em testes sem consentimento expresso.
