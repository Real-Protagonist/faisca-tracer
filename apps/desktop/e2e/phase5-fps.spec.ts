/**
 * Critério de aceitação da Fase 5 (desempenho): a vista 3D mantém 60 fps com 100 aparelhos.
 * Corre no projecto «fps», sozinho, depois dos outros testes (ver playwright.config.ts).
 */
import { chromium, expect, test, type Page } from '@playwright/test';

async function open(page: Page) {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('faisca.lang', 'pt');
  });
  await page.goto('http://localhost:1420/');
  await expect(page.getByTestId('canvas')).toBeVisible();
}

const stats = (page: Page) => page.evaluate(() => ({ ...(window as any).faisca3d }));

async function to3d(page: Page) {
  await page.getByRole('tab', { name: 'Físico 3D' }).click();
  await expect(page.getByTestId('view3d')).toBeVisible();
  await expect.poll(async () => (await stats(page)).fps, { timeout: 15_000 }).toBeGreaterThan(0);
}

/**
 * 60 fps com 100 aparelhos. O Chromium dos testes desenha por software (SwiftShader) sem janela;
 * aqui pede-se a placa gráfica da máquina (ANGLE/Direct3D). Sem GPU, o teste é saltado.
 */
test('100 aparelhos a 60 fps com a placa gráfica (bancada e instalação real)', async () => {
  test.setTimeout(120_000);
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await open(page);
    const gl = await page.evaluate(() => {
      const c = document.createElement('canvas').getContext('webgl2')!;
      const e = c.getExtension('WEBGL_debug_renderer_info');
      return String(e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER));
    });
    test.skip(/swiftshader|software|llvmpipe/i.test(gl), `sem GPU: ${gl}`);
    console.log(`GPU: ${gl}`);
    await page.evaluate(() => {
      const f = (window as any).faisca;
      const c = f.core;
      const P = c.createProject({ domain: 'industrial', level: 'pro' });
      const G = c.addDevice(P, 'grid3ph', { x: 0, y: 0 });
      const kinds = ['motorBreaker', 'contactor3p', 'thermalRelay', 'motor3ph', 'buttonNC', 'buttonNO', 'pilotLight', 'pilotLight', 'lampIncandescent'];
      for (let i = 0; i < 11 && P.devices.length < 100; i++) {
        const d: any = {};
        kinds.forEach((k, j) => {
          if (P.devices.length < 100) d[k + j] = c.addDevice(P, k, { x: (i % 4) * 700 + (j < 4 ? 0 : 320), y: Math.floor(i / 4) * 800 + 140 + (j < 4 ? j * 170 : (j - 4) * 120) });
        });
        const { motorBreaker0: Q, contactor3p1: K, thermalRelay2: F, motor3ph3: M } = d;
        if (!(Q && K && F && M)) continue;
        ['L1', 'L2', 'L3'].forEach((l, k) => c.addWire(P, G, l, Q, ['1', '3', '5'][k]));
        [['2', '1'], ['4', '3'], ['6', '5']].forEach(([a, b]) => c.addWire(P, Q, a, K, b));
        [['2', '1'], ['4', '3'], ['6', '5']].forEach(([a, b]) => c.addWire(P, K, a, F, b));
        ['U1', 'V1', 'W1'].forEach((t, k) => c.addWire(P, F, ['2', '4', '6'][k], M, t));
        K.state.closed = true;
      }
      f.loadProject(P);
    });
    expect(await page.evaluate(() => (window as any).faisca.useApp.getState().project.devices.length)).toBe(100);
    await to3d(page);
    for (const mode of ['bench', 'real']) {
      await page.getByTestId(`view3d-${mode}`).click();
      await page.waitForTimeout(3000);
      const samples: number[] = [];
      for (let i = 0; i < 4; i++) {
        await page.waitForTimeout(1000);
        samples.push((await stats(page)).fps);
      }
      const s = await stats(page);
      console.log(`${mode}: ${samples.join(', ')} fps, ${s.calls} chamadas de desenho, ${s.triangles} triângulos, ${s.frameMs.toFixed(2)} ms de lógica por fotograma`);
      expect(s.devices).toBe(100);
      if (process.env.FAISCA_SHOTS) await page.screenshot({ path: `${process.env.FAISCA_SHOTS}/p5-${mode}.png` });
      // 60 fps: média de pelo menos 58 e nenhuma amostra abaixo de 55 (um fotograma perdido por segundo).
      expect(samples.reduce((a, b) => a + b, 0) / samples.length).toBeGreaterThanOrEqual(58);
      expect(Math.min(...samples)).toBeGreaterThanOrEqual(55);
    }
  } finally {
    await browser.close();
  }
});
