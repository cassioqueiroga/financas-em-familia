import { defineConfig } from 'vitest/config';

// Testes de integração do banco (migrações + RLS) contra um PostgreSQL real.
// Executados por `npm run test:db`, que cria um cluster local efêmero.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['supabase/tests/**/*.test.ts'],
    testTimeout: 20_000,
    fileParallelism: false,
  },
});
