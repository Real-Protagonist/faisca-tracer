/**
 * Critério de aceitação da Fase 2: um ponto de luz monta-se só com o rato em menos de 2 minutos
 * e o ficheiro reabre igual.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/** Arrasta um equipamento da biblioteca para o ponto (x, y) da área de trabalho. */
async function dragFromLibrary(page: Page, type: string, x: number, y: number) {
  const canvas = page.getByTestId('canvas');
  await page.getByTestId(`tile-${type}`).dragTo(canvas, { targetPosition: { x, y } });
}

/** Coloca um equipamento com dois cliques: azulejo e depois o esquema. */
async function clickPlace(page: Page, type: string, x: number, y: number) {
  await page.getByTestId(`tile-${type}`).click();
  await page.getByTestId('canvas').click({ position: { x, y } });
}

async function deviceId(page: Page, type: string) {
  return (await page.locator(`[data-type="${type}"]`).first().getAttribute('data-device'))!;
}

async function centre(page: Page, sel: string) {
  const b = (await page.locator(sel).first().boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Liga dois terminais arrastando o rato de um para o outro. */
async function wire(page: Page, a: string, b: string) {
  const pa = await centre(page, `[data-term="${a}"] .term-hit`);
  const pb = await centre(page, `[data-term="${b}"] .term-hit`);
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  await page.mouse.move((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, { steps: 4 });
  await page.mouse.move(pb.x, pb.y, { steps: 4 });
  await page.mouse.up();
}

const project = (page: Page) => page.evaluate(() => (window as any).faisca.useApp.getState().project);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('faisca.lang', 'pt');
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
});

test('ponto de luz só com o rato, em menos de 2 minutos, e o ficheiro reabre igual', async ({ page }) => {
  const t0 = Date.now();

  // 1. Colocar: dois por arrasto, dois por clique.
  await dragFromLibrary(page, 'grid1ph', 120, 70);
  await dragFromLibrary(page, 'mcb1pn', 120, 230);
  await clickPlace(page, 'switch1', 300, 230);
  await clickPlace(page, 'lampIncandescent', 460, 230);
  await expect(page.locator('[data-device]')).toHaveCount(4);

  const G = await deviceId(page, 'grid1ph');
  const Q = await deviceId(page, 'mcb1pn');
  const S = await deviceId(page, 'switch1');
  const H = await deviceId(page, 'lampIncandescent');

  // 2. Cabos arrastados de terminal a terminal.
  await wire(page, `${G}:L`, `${Q}:1`);
  await wire(page, `${G}:N`, `${Q}:3`);
  await wire(page, `${Q}:2`, `${S}:1`);
  await wire(page, `${S}:2`, `${H}:L`);
  await wire(page, `${Q}:4`, `${H}:N`);
  await expect(page.locator('[data-wire]')).toHaveCount(5);

  // Cores automáticas: fase castanha, neutro azul.
  const P1 = await project(page);
  expect(P1.wires.map((w: any) => w.conductor)).toEqual(['L1', 'N', 'L1', 'L1', 'N']);

  // 3. A lâmpada está apagada; «Porque não funciona?» aponta o interruptor.
  await page.locator(`[data-device="${H}"] .hit`).click();
  await page.getByTestId('why-not').click();
  await expect(page.getByTestId('why-not-result')).toHaveAttribute('data-code', 'PATH_OPEN');

  // 4. Operar o interruptor: a lâmpada acende e a corrente circula.
  await page.getByTestId('tool-operate').click();
  await page.locator(`[data-device="${S}"] .hit`).click();
  await expect(page.locator(`[data-device="${H}"]`)).toHaveAttribute('data-state', 'lit');
  const elapsed = (Date.now() - t0) / 1000;
  console.log(`Montagem concluída em ${elapsed.toFixed(1)} s`);
  expect(elapsed).toBeLessThan(120);

  // Corrente animada nos cabos e medição no painel.
  await page.getByTestId('tool-select').click();
  await page.locator(`[data-device="${H}"] .hit`).click();
  await expect(page.getByTestId('measurements').locator('tr[data-key="meas.state"] td')).toHaveText('Acesa');
  await expect(page.locator('[data-wire] .flow').first()).toBeVisible();
  await expect(page.getByTestId('dock-problems').locator('.badge')).toHaveCount(0);

  // 5. Guardar (Ctrl+S → descarga) e reabrir noutra sessão.
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  const saved = readFileSync((await download.path())!, 'utf-8');
  const before = await project(page);

  await page.reload();
  await expect(page.locator('[data-device]')).toHaveCount(0);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
  await chooser.setFiles({ name: 'ponto-de-luz.faisca', mimeType: 'application/json', buffer: Buffer.from(saved) });
  await expect(page.locator('[data-device]')).toHaveCount(4);

  const after = await project(page);
  const { name: _n1, ...a } = after;
  const { name: _n2, ...b } = before;
  expect(a).toEqual(b);
  // O interruptor continua ligado e a lâmpada acende sem mais nada.
  await expect(page.locator(`[data-device="${H}"]`)).toHaveAttribute('data-state', 'lit');
  // Guardar outra vez dá o mesmo ficheiro.
  const [d2] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  expect(JSON.parse(readFileSync((await d2.path())!, 'utf-8'))).toEqual({ ...JSON.parse(saved), name: after.name });
});

test('desfazer e refazer, rodar, copiar e colar com os cabos internos', async ({ page }) => {
  await clickPlace(page, 'lampIncandescent', 200, 150);
  await clickPlace(page, 'junction', 200, 300);
  const H = await deviceId(page, 'lampIncandescent');
  const J = await deviceId(page, 'junction');
  await wire(page, `${J}:a`, `${H}:L`);
  await expect(page.locator('[data-wire]')).toHaveCount(1);

  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-wire]')).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await expect(page.locator('[data-wire]')).toHaveCount(1);

  // Selecção por rectângulo, copiar e colar: os dois aparelhos e o cabo entre eles.
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 320, box.y + 380, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect(page.locator('[data-device]')).toHaveCount(4);
  await expect(page.locator('[data-wire]')).toHaveCount(2);
  const names = (await project(page)).devices.map((d: any) => d.name).sort();
  expect(names).toEqual(['H1', 'H2', 'X1', 'X2']);

  await page.keyboard.press('r');
  const rots = (await project(page)).devices.slice(2).map((d: any) => d.rot);
  expect(rots).toEqual([90, 90]);
});

test('modo passo a passo: o tempo pára e ⏭ avança 0,1 s', async ({ page }) => {
  await page.getByTestId('mode-step').click();
  const clock = page.getByTestId('clock');
  const t1 = await clock.textContent();
  await page.waitForTimeout(400);
  expect(await clock.textContent()).toBe(t1);
  await page.getByTestId('step').click();
  const v = (s: string | null) => Number(s!.replace(' s', '').replace(',', '.'));
  await expect.poll(async () => v(await clock.textContent())).toBeCloseTo(v(t1) + 0.1, 5);
});

test('a biblioteca procura nos três idiomas e o idioma muda sem reiniciar', async ({ page }) => {
  await page.getByTestId('lib-search').fill('breaker');
  await expect(page.getByTestId('tile-mcb1pn')).toBeVisible();
  await expect(page.getByTestId('tile-lampIncandescent')).toHaveCount(0);
  await page.getByTestId('lib-search').fill('disjoncteur');
  await expect(page.getByTestId('tile-mcb1pn')).toBeVisible();
  await page.getByTestId('lang').selectOption('en');
  await expect(page.getByTestId('menu-file')).toHaveText('File');
  await page.getByTestId('lang').selectOption('fr');
  await expect(page.getByTestId('menu-file')).toHaveText('Fichier');
});

test('multímetro: tensão entre os terminais de uma tomada', async ({ page }) => {
  await clickPlace(page, 'grid1ph', 160, 80);
  await clickPlace(page, 'voltmeter', 400, 260);
  const G = await deviceId(page, 'grid1ph');
  await page.getByTestId('tool-probe').click();
  await page.locator(`[data-term="${G}:L"] .term-hit`).click();
  await page.locator(`[data-term="${G}:N"] .term-hit`).click();
  await expect(page.getByTestId('meter-voltage')).toContainText('230 V');
});
