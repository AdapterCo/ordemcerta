import { defineConfig } from 'vitest/config';

// Testes da API rodam como integração (PostgreSQL/Redis reais) em tests/integration.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
