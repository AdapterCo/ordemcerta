import { defineConfig } from 'vitest/config';

/**
 * Testes de integração: PostgreSQL 17 real (papéis owner/app/system, migrations
 * aplicadas) + Redis 7. Executados no CI e na VPS — ver README.
 */
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    sequence: { concurrent: false },
  },
});
