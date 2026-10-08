/**
 * Planos oficiais OrdemCerta (seção 17.1). Fonte única do seed idempotente.
 * Em runtime, preços e limites SEMPRE vêm do banco (tabela plans), nunca daqui
 * nem do navegador.
 */
export const PLAN_CODES = ['ESSENCIAL', 'PROFISSIONAL', 'AVANCADO', 'REDE'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export interface PlanSeed {
  code: PlanCode;
  name: string;
  priceCents: number;
  maxBranches: number;
  maxTechniciansPerBranch: number;
  maxCashRegistersPerBranch: number;
  sortOrder: number;
}

export const PLAN_SEED: readonly PlanSeed[] = [
  { code: 'ESSENCIAL', name: 'Essencial', priceCents: 2999, maxBranches: 1, maxTechniciansPerBranch: 3, maxCashRegistersPerBranch: 1, sortOrder: 1 },
  { code: 'PROFISSIONAL', name: 'Profissional', priceCents: 5999, maxBranches: 3, maxTechniciansPerBranch: 3, maxCashRegistersPerBranch: 1, sortOrder: 2 },
  { code: 'AVANCADO', name: 'Avançado', priceCents: 8999, maxBranches: 5, maxTechniciansPerBranch: 3, maxCashRegistersPerBranch: 1, sortOrder: 3 },
  { code: 'REDE', name: 'Rede', priceCents: 12999, maxBranches: 10, maxTechniciansPerBranch: 3, maxCashRegistersPerBranch: 1, sortOrder: 4 },
];

/** Módulos operacionais incluídos em todos os planos. */
export const PLAN_FEATURES = [
  'service_orders',
  'technician_queue',
  'quotes',
  'customers',
  'catalog_stock',
  'pos',
  'cash',
  'financial',
  'warranties',
  'reports',
  'whatsapp_byok',
  'public_portal',
] as const;
