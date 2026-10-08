import { MESSAGE_TEMPLATE_VARIABLES, type DocumentTemplateType } from '@ordemcerta/shared';

/**
 * Renderização de modelos com placeholders {{variavel}}. Somente variáveis
 * conhecidas são substituídas; o valor é tratado como texto (sem HTML).
 */
export function renderPlaceholders(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, name: string) => {
    const v = vars[name];
    return v === null || v === undefined ? '' : sanitizeText(String(v));
  });
}

/** Remove caracteres de controle e limita tamanho de campos dinâmicos. */
export function sanitizeText(v: string, max = 2000): string {
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, max);
}

export function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Ordena os parâmetros do corpo do template Meta conforme as variáveis declaradas. */
export function templateBodyParams(variables: string[], values: Record<string, string>): string[] {
  const allowed = new Set<string>(MESSAGE_TEMPLATE_VARIABLES);
  return variables.filter((v) => allowed.has(v)).map((v) => sanitizeText(values[v] ?? '-', 900) || '-');
}

/**
 * Modelos padrão versionados de documentos. DEVEM ser revisados juridicamente
 * antes do uso comercial; não contêm cláusulas de exclusão de garantia legal.
 */
export const DEFAULT_DOCUMENT_TEMPLATES: Record<DocumentTemplateType, string> = {
  INTAKE: [
    'Declaro que entreguei o aparelho descrito nesta ficha para avaliação técnica, com os acessórios e o estado físico registrados acima.',
    'O orçamento será informado antes da execução de qualquer serviço cobrável, salvo taxa de diagnóstico previamente informada ({{taxa_diagnostico}}).',
    'Acompanhe o serviço em {{link_consulta}} usando o número da OS e o código deste comprovante.',
  ].join('\n'),
  RESPONSIBILITY_TERM: [
    'A assistência se responsabiliza pela guarda do aparelho enquanto estiver sob sua custódia.',
    'Recomenda-se que o cliente realize cópia de segurança dos dados antes da entrega do aparelho.',
    'Aparelhos não retirados serão tratados conforme a legislação aplicável, após comunicação ao cliente.',
  ].join('\n'),
  QUOTE: 'Orçamento válido até {{validade}}. Valores sujeitos a aprovação expressa do cliente antes da execução.',
  APPROVAL: 'Aprovo o orçamento versão {{versao}}, no valor total de {{total}}, para execução do serviço descrito.',
  SALE_RECEIPT: 'DOCUMENTO NÃO FISCAL. Comprovante de venda sem validade como nota fiscal.',
  WARRANTY_TERM: [
    'Garantia contratual de {{dias_garantia}} dias sobre os serviços e peças descritos, contados da entrega, sem prejuízo da garantia legal prevista no Código de Defesa do Consumidor.',
    'A garantia cobre defeitos relacionados ao serviço executado e às peças substituídas.',
  ].join('\n'),
  PICKUP_RECEIPT: 'Declaro que recebi o aparelho descrito, conferido no ato da retirada.',
};

/* ------------------------------------------------------ e-mails do sistema */

export interface EmailContent {
  subject: string;
  text: string;
}

export function emailTemplate(template: string, data: Record<string, string>): EmailContent {
  const d = (k: string) => sanitizeText(data[k] ?? '', 500);
  switch (template) {
    case 'password_reset':
      return {
        subject: 'Redefinição de senha — OrdemCerta',
        text: `Olá ${d('name')},\n\nRecebemos uma solicitação para redefinir sua senha. Use o link abaixo (válido por 30 minutos, uso único):\n${d('link')}\n\nSe você não solicitou, ignore este e-mail.`,
      };
    case 'invitation':
      return {
        subject: `Convite para ${d('tenantName')} — OrdemCerta`,
        text: `Você foi convidado para acessar ${d('tenantName')} como ${d('role')}.\nAceite o convite (válido por 7 dias): ${d('link')}`,
      };
    case 'subscription_activated':
      return {
        subject: 'Assinatura ativada — OrdemCerta',
        text: `Pagamento confirmado. Sua assinatura do plano ${d('plan')} está ativa até ${d('periodEnd')}.\nRecibo de assinatura (não fiscal): ${d('link')}`,
      };
    case 'invoice_due':
      return {
        subject: 'Sua fatura OrdemCerta vence hoje',
        text: `A fatura de ${d('amount')} vence em ${d('dueAt')}. Pague em: ${d('link')}`,
      };
    case 'invoice_overdue':
      return {
        subject: 'Fatura OrdemCerta em atraso',
        text: `Não identificamos o pagamento da fatura de ${d('amount')}. A operação continua até ${d('graceUntil')}; após essa data a conta ficará suspensa (somente leitura). Regularize em: ${d('link')}`,
      };
    case 'suspension_warning':
      return {
        subject: 'Último aviso antes da suspensão — OrdemCerta',
        text: `Sua conta será suspensa em ${d('graceUntil')} por falta de pagamento. Seus dados não serão apagados. Regularize em: ${d('link')}`,
      };
    case 'subscription_suspended':
      return {
        subject: 'Conta suspensa — OrdemCerta',
        text: `Sua conta está suspensa por falta de pagamento: o acesso está em modo somente leitura e nenhum dado foi apagado. Regularize em: ${d('link')}`,
      };
    case 'payment_failed':
      return {
        subject: 'Pagamento não aprovado — OrdemCerta',
        text: `O pagamento da sua assinatura não foi aprovado (${d('reason')}). Tente novamente em: ${d('link')}`,
      };
    default:
      return { subject: 'OrdemCerta', text: d('text') };
  }
}
