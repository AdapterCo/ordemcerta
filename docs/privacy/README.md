# Privacidade e LGPD

- **Papéis:** a assistência (tenant) é controladora dos dados de seus clientes; a OrdemCerta atua como operadora. A plataforma não acessa dados de clientes, salvo concessão temporária do proprietário (somente leitura, auditada).
- **Minimização:** IMEI/serial criptografados (AES-256-GCM) com índice cego para busca e exibição mascarada; revelação completa exige permissão + motivo (auditado). Portal público expõe apenas status, previsão, orçamento e mensagens marcadas como visíveis ao cliente.
- **Senha de desbloqueio:** preferir desbloqueio assistido. Quando necessária, é criptografada, com acesso restrito e auditado, expira (padrão 7 dias) e é purgada na entrega; nunca aparece em PDF, WhatsApp ou logs.
- **Consentimento:** registrado por canal e finalidade (`customer_consents`), com origem, data e revogação. Opt-out por WhatsApp ("SAIR", "PARAR", "STOP"…) revoga automaticamente.
- **Direitos do titular:** exportação (`GET /customers/:id/export`) e anonimização (`POST /customers/:id/anonymize`), preservando registros exigidos por obrigação legal (OS, financeiro).
- **Fotos/anexos:** o sistema não armazena fotos nem anexos de aparelhos (sem storage de objetos). A única imagem guardada é a assinatura do cliente (PNG, no banco, imutável).
- **Retenção:** exportações de relatório ficam no banco e são apagadas após 7 dias; tokens/OTPs expiram; assinaturas e documentos são preservados como evidência.
- **Segurança:** TLS, HSTS, CSP, cookies HttpOnly/Secure/SameSite, CSRF, rate limit, RLS, criptografia em repouso para dados sensíveis, URLs assinadas curtas para arquivos privados, logs sem tokens/senhas/IMEI/mensagens completas, backups criptografados.
- **Assinatura eletrônica:** termos aceitos com hash SHA-256, data/hora, signatário e evidências — assinatura eletrônica simples, sem equivalência automática a assinatura qualificada.
- **Pendente (jurídico):** aviso de privacidade e termos de uso definitivos, base legal por finalidade, política de retenção oficial e DPA com as assistências.
