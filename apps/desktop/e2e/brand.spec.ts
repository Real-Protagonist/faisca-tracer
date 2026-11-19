/** Nome Faísca Tracer, ecrã de arranque, relógio em formato de hora, «Sobre» e «Doações». */
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('faisca.lang', 'pt');
  });
});

test('ecrã de arranque: logótipo, nome e barra de progresso; no navegador, sem versão; depois desaparece', async ({ page }) => {
  await page.goto('/');
  const splash = page.getByTestId('splash');
  await expect(splash.locator('img')).toHaveAttribute('src', '/icon.svg');
  await expect(splash).toContainText('Faísca Tracer');
  await expect(splash.getByRole('progressbar')).toBeAttached();
  await expect(page.getByTestId('splash-version')).toHaveText('');
  await expect(splash).toHaveCount(0, { timeout: 8_000 });
  await expect(page).toHaveTitle(/Faísca Tracer/);
});

test('relógio da simulação em formato de hora (hh:mm:ss)', async ({ page }) => {
  await page.goto('/');
  const clock = page.getByTestId('clock');
  await expect(clock).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
  // A ×50, passa do minuto em pouco mais de 1 s: «00:01:05», nunca «65,23 s».
  await page.evaluate(() => (window as any).faisca.useApp.setState((s: any) => ({ sim: { ...s.sim, speed: 50 } })));
  await expect(clock).toHaveText(/^00:0[1-9]:\d{2}$/, { timeout: 15_000 });
});

test('menu Ajuda: «Doações» antes de «Sobre»; Sobre tem o copyright de 2023', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('menu-help').click();
  const items = await page.locator('.dropdown [data-testid^="item-"]').allTextContents();
  expect(items).toEqual(['Tour guiado', 'Doações', 'Sobre o Faísca Tracer']);
  await page.getByTestId('item-ui.menu.donations').click();
  const d = page.getByTestId('donations');
  await expect(d.locator('[data-method]')).toHaveCount(3);
  await expect(d).toContainText('ajuda-o a continuar');
  await expect(d).toContainText('Do estrangeiro — transferência internacional');
  await expect(d).toContainText('Em Angola — transferência bancária');
  await expect(d).toContainText('Bitcoin');
  await d.getByRole('button', { name: 'Fechar' }).click();
  await page.getByTestId('menu-help').click();
  await page.getByTestId('item-ui.menu.about').click();
  await expect(page.getByTestId('copyright')).toContainText('© 2023');
});
