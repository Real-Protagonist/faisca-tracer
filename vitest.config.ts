import { defineConfig } from 'vitest/config';

/**
 * O teste de desempenho (5 ms por passo) corre sozinho, depois dos outros (ver scripts/vitest.mjs):
 * em paralelo com as simulações longas dos outros ficheiros, mediria a carga da máquina, não o solver.
 */
const perf = process.env.FAISCA_PERF === '1';

export default defineConfig({
  test: {
    include: perf ? ['packages/**/test/**/performance.test.ts'] : ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'],
    exclude: perf ? [] : ['**/node_modules/**', '**/performance.test.ts'],
    testTimeout: 120000,
  },
});
