import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  use: { baseURL: 'http://localhost:1420', viewport: { width: 1366, height: 768 }, locale: 'pt-PT' },
  webServer: { command: 'npx vite --port 1420 --strictPort', url: 'http://localhost:1420', reuseExistingServer: true, timeout: 60_000 },
  reporter: [['list']],
  projects: [
    { name: 'ui', testIgnore: /fps\.spec\.ts$/ },
    // A medição de fps corre sozinha, depois dos outros testes: em paralelo mediria a carga da máquina.
    { name: 'fps', testMatch: /fps\.spec\.ts$/, dependencies: ['ui'] },
  ],
});
