# Matriz de permissões (RBAC)

Gerada de `packages/shared/src/permissions.ts`. Negar por padrão; verificação no controller (guard) e no service.

| Permissão | Proprietário | Administrador | Gerente | Atendente | Técnico | Caixa | Estoquista |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `os:view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| `os:create` | ✅ | ✅ | ✅ | ✅ |  |  |  |
| `os:update` | ✅ | ✅ | ✅ | ✅ |  |  |  |
| `os:assign` | ✅ | ✅ | ✅ |  |  |  |  |
| `os:accept` | ✅ | ✅ | ✅ |  | ✅ |  |  |
| `os:diagnose` | ✅ | ✅ | ✅ |  | ✅ |  |  |
| `os:repair` | ✅ | ✅ | ✅ |  | ✅ |  |  |
| `os:approve_override` | ✅ | ✅ | ✅ |  |  |  |  |
| `os:deliver` | ✅ | ✅ | ✅ | ✅ |  | ✅ |  |
| `os:deliver_override` | ✅ | ✅ | ✅ |  |  |  |  |
| `os:cancel` | ✅ | ✅ | ✅ |  |  |  |  |
| `os:reopen` | ✅ | ✅ | ✅ |  |  |  |  |
| `os:internal_notes` | ✅ | ✅ | ✅ | ✅ | ✅ |  |  |
| `os:unlock_secret` | ✅ | ✅ | ✅ |  | ✅ |  |  |
| `quote:create` | ✅ | ✅ | ✅ | ✅ | ✅ |  |  |
| `quote:send` | ✅ | ✅ | ✅ | ✅ |  |  |  |
| `quote:approve_manual` | ✅ | ✅ | ✅ |  |  |  |  |
| `customer:view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| `customer:edit` | ✅ | ✅ | ✅ | ✅ |  | ✅ |  |
| `customer:export` | ✅ | ✅ | ✅ |  |  |  |  |
| `customer:anonymize` | ✅ | ✅ |  |  |  |  |  |
| `product:view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `product:edit` | ✅ | ✅ | ✅ |  |  |  | ✅ |
| `stock:view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `stock:receive` | ✅ | ✅ | ✅ |  |  |  | ✅ |
| `stock:adjust` | ✅ | ✅ | ✅ |  |  |  | ✅ |
| `stock:transfer` | ✅ | ✅ | ✅ |  |  |  | ✅ |
| `stock:reserve` | ✅ | ✅ | ✅ |  | ✅ |  | ✅ |
| `stock:override_negative` | ✅ | ✅ | ✅ |  |  |  |  |
| `sales:view` | ✅ | ✅ | ✅ | ✅ |  | ✅ |  |
| `sales:create` | ✅ | ✅ | ✅ | ✅ |  | ✅ |  |
| `sales:discount` | ✅ | ✅ | ✅ |  |  |  |  |
| `sales:cancel` | ✅ | ✅ | ✅ |  |  |  |  |
| `sales:refund` | ✅ | ✅ | ✅ |  |  |  |  |
| `payment:receive` | ✅ | ✅ | ✅ | ✅ |  | ✅ |  |
| `payment:refund` | ✅ | ✅ | ✅ |  |  |  |  |
| `cash:operate` | ✅ | ✅ | ✅ | ✅ |  | ✅ |  |
| `cash:close` | ✅ | ✅ | ✅ |  |  | ✅ |  |
| `cash:view_all` | ✅ | ✅ | ✅ |  |  |  |  |
| `cash:register_manage` | ✅ | ✅ | ✅ |  |  |  |  |
| `reports:view` | ✅ | ✅ | ✅ |  |  |  | ✅ |
| `reports:financial` | ✅ | ✅ | ✅ |  |  |  |  |
| `reports:export` | ✅ | ✅ | ✅ |  |  |  |  |
| `warranty:view` | ✅ | ✅ | ✅ | ✅ | ✅ |  |  |
| `warranty:manage` | ✅ | ✅ | ✅ | ✅ |  |  |  |
| `messaging:view` | ✅ | ✅ | ✅ | ✅ |  |  |  |
| `messaging:manage` | ✅ | ✅ |  |  |  |  |  |
| `settings:edit` | ✅ | ✅ |  |  |  |  |  |
| `documents:manage` | ✅ | ✅ |  |  |  |  |  |
| `branches:manage` | ✅ | ✅ |  |  |  |  |  |
| `users:manage` | ✅ | ✅ |  |  |  |  |  |
| `billing:view` | ✅ | ✅ |  |  |  |  |  |
| `billing:manage` | ✅ |  |  |  |  |  |  |
| `audit:view` | ✅ | ✅ | ✅ |  |  |  |  |

**PLATFORM_SUPERADMIN**: somente rotas `/platform/*` (MFA obrigatória). Sem acesso a dados de clientes, exceto por concessão temporária do proprietário (somente leitura, auditada).
