/**
 * Vista 3D, bancada: duplo clique aproxima sem operar; no modo «Ligações», desligar um cabo de um
 * disjuntor apaga a lâmpada (com o diagnóstico «cabo desligado»), voltar a ligá-lo acende-a, e
 * cria-se um cabo novo entre dois bornes. Tudo com o rato, como um utilizador.
 */
import { expect, test, type Page } from '@playwright/test';

async function open(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('init')) {
      localStorage.clear();
      localStorage.setItem('faisca.lang', 'pt');
      sessionStorage.setItem('init', '1');
    }
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByTestId('menu-project').click();
  await page.getByTestId('item-ui.menu.wizard').click();
  await page.getByTestId('wizard-area-domestic').click();
  await page.getByTestId('wizard-level-beginner').click();
  await page.getByTestId('wizard-example').click();
  await page.getByTestId('wizard-ex-light-point').click();
  await expect(page.getByTestId('wizard')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Físico 3D' }).click();
  await page.getByTestId('view3d-bench').click();
  await expect.poll(() => page.evaluate(() => (window as any).faisca3d.fps), { timeout: 15_000 }).toBeGreaterThan(0);
  return errors;
}

const lamp = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).faisca.useApp.getState();
    const H = s.project.devices.find((d: any) => d.name === 'H1');
    return s.snapshot?.measurements[H.id]?.find((m: any) => m.key === 'meas.state')?.value.key;
  });
const idOf = (page: Page, name: string) => page.evaluate((n) => (window as any).faisca.useApp.getState().project.devices.find((d: any) => d.name === n).id as string, name);
const screen = (page: Page, fn: 'screenOf' | 'terminalScreen' | 'looseScreen', key: string) =>
  page.evaluate(([f, k]) => (window as any).faisca3d[f](k) as { x: number; y: number } | null, [fn, key] as const);
/** Espera que a câmara pare (fim do voo do duplo clique ou de «Ver tudo»). */
async function settle(page: Page) {
  let last = -1;
  await expect
    .poll(async () => {
      const d = await page.evaluate(() => (window as any).faisca3d.distance as number);
      const still = Math.abs(d - last) < 1e-3;
      last = d;
      return still;
    }, { intervals: [150] })
    .toBe(true);
}
const why = (page: Page) =>
  page.evaluate(() => {
    const f = (window as any).faisca;
    const sim = new f.core.Simulator(f.useApp.getState().project);
    sim.step(0.02);
    const d = f.core.whyNotWorking(sim, 'H1');
    return { code: d.code, terminal: d.values?.terminal };
  });

test('duplo clique aproxima o disjuntor sem o operar; desligar e ligar um cabo no modo «Ligações»', async ({ page }) => {
  const errors = await open(page);
  // Um clique em S1 acende H1.
  const s1 = await screen(page, 'screenOf', await idOf(page, 'S1'));
  await page.mouse.click(s1!.x, s1!.y);
  await expect.poll(() => lamp(page)).toBe('state.lit');

  // Duplo clique em Q1: a câmara aproxima-se e o disjuntor continua ligado.
  await settle(page);
  const far = await page.evaluate(() => (window as any).faisca3d.distance as number);
  const q1 = await idOf(page, 'Q1');
  const pq = await screen(page, 'screenOf', q1);
  await page.mouse.dblclick(pq!.x, pq!.y);
  await settle(page);
  expect(await page.evaluate(() => (window as any).faisca3d.distance)).toBeLessThan(far * 0.6);
  await page.waitForTimeout(400);
  expect(await lamp(page)).toBe('state.lit');

  // Modo «Ligações»: borne Q1:2 → menu → desligar o cabo para S1.
  await page.getByTestId('view3d-wiring').click();
  const t2 = await screen(page, 'terminalScreen', `${q1}:2`);
  await page.mouse.move(t2!.x, t2!.y);
  await expect(page.getByTestId('view3d-hint')).toContainText('Q1 · borne 2');
  await page.mouse.click(t2!.x, t2!.y);
  await expect(page.getByTestId('view3d-menu')).toBeVisible();
  const wire = await page.evaluate((q) => (window as any).faisca.useApp.getState().project.wires.find((w: any) => w.a.device === q && w.a.terminal === '2').id as string, q1);
  await page.getByTestId(`view3d-detach-${wire}`).click();
  await expect.poll(() => lamp(page)).toBe('state.unlit');
  expect(await why(page)).toEqual({ code: 'WIRE_DETACHED', terminal: 'Q1-2' });
  // O painel do cabo mostra a ponta desligada.
  await expect(page.getByTestId('wire-end-a')).toContainText('desligada');

  // Ponta solta → borne Q1:2: volta a acender.
  const loose = await screen(page, 'looseScreen', `${wire}:a`);
  await page.mouse.click(loose!.x, loose!.y);
  await expect(page.getByTestId('view3d-hint')).toContainText('Escolha o borne');
  const t2b = await screen(page, 'terminalScreen', `${q1}:2`);
  await page.mouse.click(t2b!.x, t2b!.y);
  await expect.poll(() => lamp(page)).toBe('state.lit');
  expect((await why(page)).code).toBe('LOAD_OK');

  // Cabo novo: Q1:4 → «Novo cabo a partir daqui» → G1:N.
  await page.getByTestId('view3d-fit').click();
  await settle(page);
  const n0 = await page.evaluate(() => (window as any).faisca.useApp.getState().project.wires.length);
  const t4 = await screen(page, 'terminalScreen', `${q1}:4`);
  await page.mouse.click(t4!.x, t4!.y);
  await page.getByTestId('view3d-new-wire').click();
  await expect(page.getByTestId('view3d-hint')).toContainText('destino');
  const g1 = await idOf(page, 'G1');
  const tn = await screen(page, 'terminalScreen', `${g1}:N`);
  await page.mouse.click(tn!.x, tn!.y);
  await expect.poll(() => page.evaluate(() => (window as any).faisca.useApp.getState().project.wires.length)).toBe(n0 + 1);

  // Na instalação real não há ligações.
  await page.getByTestId('view3d-real').click();
  await expect(page.getByTestId('view3d-wiring')).toBeDisabled();
  expect(errors).toEqual([]);
});
