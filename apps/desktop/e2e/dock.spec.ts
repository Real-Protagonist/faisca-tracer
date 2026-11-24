/** Doca da biblioteca: altura ajustável com o rato e o teclado, guardada nas preferências. */
import { expect, test } from '@playwright/test';

const dockH = async (page: import('@playwright/test').Page) => Math.round((await page.getByTestId('dock').boundingBox())!.height);

test('a doca aumenta e diminui com a barra do topo, e a altura fica guardada', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('init')) {
      localStorage.clear();
      localStorage.setItem('faisca.lang', 'pt');
      sessionStorage.setItem('init', '1');
    }
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  expect(await dockH(page)).toBe(210);
  const canvas0 = (await page.getByTestId('canvas').boundingBox())!.height;

  // Arrastar 150 px para cima.
  const bar = (await page.getByTestId('dock-resize').boundingBox())!;
  const y = bar.y + bar.height / 2;
  await page.mouse.move(bar.x + 300, y);
  await page.mouse.down();
  await page.mouse.move(bar.x + 300, y - 150, { steps: 6 });
  await page.mouse.up();
  expect(await dockH(page)).toBe(360);
  expect(Math.round(canvas0 - (await page.getByTestId('canvas').boundingBox())!.height)).toBe(150);

  await page.reload();
  await expect(page.getByTestId('canvas')).toBeVisible();
  expect(await dockH(page)).toBe(360);

  // Duplo clique repõe; teclado: End (mínimo), seta para cima (+20).
  await page.getByTestId('dock-resize').dblclick();
  expect(await dockH(page)).toBe(210);
  await page.getByTestId('dock-resize').focus();
  await page.keyboard.press('End');
  expect(await dockH(page)).toBe(40);
  await page.keyboard.press('ArrowUp');
  expect(await dockH(page)).toBe(60);
  await expect(page.getByTestId('dock-resize')).toHaveAttribute('aria-valuenow', '60');

  // Com a doca no mínimo, os separadores continuam a funcionar.
  await page.getByTestId('dock-events').click();
  await expect(page.getByTestId('dock-events')).toHaveAttribute('aria-selected', 'true');
});
