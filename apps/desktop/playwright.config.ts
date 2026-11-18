import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  use: { baseURL: 'http://localhost:1420', viewport: { width: 1366, height: 768 }, locale: 'pt-PT' },
  webServer: { command: 'npx vite --port 1420 --strictPort', url: 'http://localhost:1420', reuseExistingServer: true, timeout: 60_000 },
  reporter: [['list']],
});
