/**
 * Critério de aceitação da Fase 5: todos os equipamentos têm modelo e a vista mantém 60 fps com
 * 100 aparelhos num portátil comum. Também: estados animados e operação por clique na vista 3D.
 */
import { expect, test, type Page } from '@playwright/test';

async function open(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('init')) {
      localStorage.clear();
      localStorage.setItem('faisca.lang', 'pt');
      sessionStorage.setItem('init', '1');
    }
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  return errors;
}

async function openExample(page: Page, area: string, level: string, id: string) {
  await page.getByTestId('menu-project').click();
  await page.getByTestId('item-ui.menu.wizard').click();
  await page.getByTestId(`wizard-area-${area}`).click();
  await page.getByTestId(`wizard-level-${level}`).click();
  await page.getByTestId('wizard-example').click();
  await page.getByTestId(`wizard-ex-${id}`).click();
  await expect(page.getByTestId('wizard')).toHaveCount(0);
}

const byName = (page: Page, name: string) => page.evaluate((n) => (window as any).faisca.useApp.getState().project.devices.find((d: any) => d.name === n), name);
const stats = (page: Page) => page.evaluate(() => ({ ...(window as any).faisca3d }));

/** Centro de um aparelho no ecrã, na vista 3D. */
async function at3d(page: Page, name: string) {
  const d = await byName(page, name);
  await expect.poll(() => page.evaluate((id) => (window as any).faisca3d.screenOf(id), d.id)).not.toBeNull();
  return (await page.evaluate((id) => (window as any).faisca3d.screenOf(id), d.id)) as { x: number; y: number };
}

async function to3d(page: Page) {
  await page.getByRole('tab', { name: 'Físico 3D' }).click();
  await expect(page.getByTestId('view3d')).toBeVisible();
  await expect.poll(async () => (await stats(page)).fps, { timeout: 15_000 }).toBeGreaterThan(0);
}

test('todos os equipamentos da biblioteca aparecem em 3D, nos dois modos, sem erros', async ({ page }) => {
  const errors = await open(page);
  const n = await page.evaluate(() => {
    const f = (window as any).faisca;
    const P = f.core.createProject({ domain: 'industrial', level: 'pro' });
    const all = f.core.defaultRegistry.all();
    all.forEach((def: any, i: number) => f.core.addDevice(P, def.type, { x: (i % 10) * 340, y: Math.floor(i / 10) * 340 }));
    f.loadProject(P);
    return all.length;
  });
  await to3d(page);
  await page.getByTestId('view3d-bench').click();
  await expect.poll(async () => (await stats(page)).devices).toBe(n);
  await page.getByTestId('view3d-real').click();
  // Moldura e nota não existem na instalação real.
  await expect.poll(async () => (await stats(page)).devices).toBe(n - 2);
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test('ponto de luz em 3D: clicar no interruptor acende a lâmpada; clicar no disjuntor apaga-a', async ({ page }) => {
  await open(page);
  await openExample(page, 'domestic', 'beginner', 'light-point');
  await to3d(page);
  await page.getByTestId('view3d-bench').click();
  await page.waitForTimeout(300);
  const lit = async () => (await page.evaluate(() => (window as any).faisca.useApp.getState().snapshot?.measurements[(window as any).faisca.useApp.getState().project.devices.find((d: any) => d.name === 'H1').id]?.find((m: any) => m.key === 'meas.state')?.value.key));
  expect(await lit()).toBe('state.unlit');
  const s = await at3d(page, 'S1');
  await page.mouse.click(s.x, s.y);
  await expect.poll(lit).toBe('state.lit');
  expect((await byName(page, 'S1')).state.on).toBe(true);
  // O aparelho clicado fica seleccionado no painel de propriedades.
  await expect(page.getByTestId('properties').locator('h2')).toHaveText('Interruptor simples');
  const q = await at3d(page, 'Q1');
  await page.mouse.click(q.x, q.y);
  await expect.poll(lit).toBe('state.unlit');
  expect((await byName(page, 'Q1')).state.closed).toBe(false);
});

test('arranque directo em 3D: premir S1 arranca o motor; o modo escolhido fica guardado', async ({ page }) => {
  await open(page);
  await openExample(page, 'industrial', 'beginner', 'dol-start');
  await to3d(page);
  await page.getByTestId('view3d-real').click();
  await page.getByTestId('view3d-bench').click();
  await page.waitForTimeout(300);
  const s = await at3d(page, 'S1');
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.waitForTimeout(400);
  await page.mouse.up();
  const motorState = () => page.evaluate(() => {
    const st = (window as any).faisca.useApp.getState();
    const id = st.project.devices.find((d: any) => d.name === 'M1').id;
    return st.snapshot?.measurements[id]?.find((m: any) => m.key === 'meas.state')?.value.key;
  });
  await expect.poll(motorState, { timeout: 10_000 }).toBe('state.running');
  // Instalação real: a escolha mantém-se ao reabrir.
  await page.getByTestId('view3d-real').click();
  await page.reload();
  await page.getByRole('tab', { name: 'Físico 3D' }).click();
  await expect(page.getByTestId('view3d')).toHaveAttribute('data-mode', 'real');
});
