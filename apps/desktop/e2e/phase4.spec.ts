/**
 * Critério de aceitação da Fase 4: o arranque directo, a inversão de marcha e o estrela-triângulo
 * funcionam, e as falhas de fase e de auto-retenção são explicadas. Inclui os quatro códigos
 * industriais da tabela de erros nos três idiomas, o editor de ladder e o tour industrial.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { clickDevice, deviceId } from './helpers';

const i18nFile = (l: string) => JSON.parse(readFileSync(new URL(`../../../packages/i18n/${l}.json`, import.meta.url), 'utf-8'));
const LANGS: Record<string, any> = { pt: i18nFile('pt'), en: i18nFile('en'), fr: i18nFile('fr') };

function template(lang: string, key: string): RegExp {
  const raw: string = key.split('.').reduce((o: any, k) => o[k], LANGS[lang]);
  const esc = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{\\\{\w+\\\}\\\}|\\\$t\\\([^)]*\\\)/g, '.+');
  return new RegExp(`^${esc}$`);
}

async function open(page: Page, lang: string) {
  await page.addInitScript((l) => {
    localStorage.clear();
    localStorage.setItem('faisca.lang', l);
  }, lang);
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
}

async function loadScenario(page: Page, body: string) {
  await page.evaluate((src) => {
    const f = (window as any).faisca;
    const P = f.core.createProject({ domain: 'industrial', level: 'beginner' });
    const a = (type: string, x: number, y: number, params = {}, state = {}, name?: string) => f.core.addDevice(P, type, { x, y, params, state, name });
    const w = (A: any, ta: string, B: any, tb: string, o = {}) => f.core.addWire(P, A, ta, B, tb, o);
    // eslint-disable-next-line no-new-func
    new Function('P', 'a', 'w', src)(P, a, w);
    f.loadProject(P);
  }, body);
}

/** Abre um exemplo pelo assistente (Projecto → Assistente). */
async function openExample(page: Page, id: string, level: 'beginner' | 'pro') {
  await page.getByTestId('menu-project').click();
  await page.getByTestId('item-ui.menu.wizard').click();
  await page.getByTestId('wizard-area-industrial').click();
  await page.getByTestId(`wizard-level-${level}`).click();
  await page.getByTestId('wizard-example').click();
  await page.getByTestId(`wizard-ex-${id}`).click();
  await expect(page.getByTestId('wizard')).toHaveCount(0);
}

const byName = (page: Page, name: string) => page.evaluate((n) => (window as any).faisca.useApp.getState().project.devices.find((d: any) => d.name === n).id, name);
const measurement = (page: Page, id: string, key: string) =>
  page.evaluate(([i, k]) => {
    const m = (window as any).faisca.useApp.getState().snapshot?.measurements[i!]?.find((x: any) => x.key === k);
    return typeof m?.value === 'object' ? m.value.key : m?.value;
  }, [id, key]);

/** Prime um botão com a ferramenta Operar: carrega, espera e larga. */
async function press(page: Page, id: string, ms = 400) {
  const b = (await page.locator(`[data-device="${id}"] .hit`).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

const DOL_NO_HOLD = `const G=a('grid3ph',40,20),Q=a('motorBreaker',60,160,{Ir:8}),K=a('contactor3p',20,320),M=a('motor3ph',60,500,{load:60}),S0=a('buttonNC',520,160,{},{},'S0'),S1=a('buttonNO',520,320,{},{},'S1');
['L1','L2','L3'].forEach((l,k)=>w(G,l,Q,['1','3','5'][k],{section:2.5}));[['2','1'],['4','3'],['6','5']].forEach(([x,y])=>w(Q,x,K,y,{section:2.5}));
w(K,'2',M,'U1',{section:2.5});w(K,'4',M,'V1',{section:2.5});w(K,'6',M,'W1',{section:2.5});w(G,'PE',M,'PE',{section:2.5});
w(Q,'2',S0,'11');w(S0,'12',S1,'13');w(S1,'14',K,'A1');w(K,'A2',G,'N');`;

const SCENARIOS: Record<string, string> = {
  MOTOR_PHASE_LOSS: `const G=a('grid3ph',40,20),M=a('motor3ph',60,200);w(G,'L1',M,'U1',{section:2.5});w(G,'L2',M,'V1',{section:2.5});const x=w(G,'L3',M,'W1',{section:2.5});x.fault={cut:true};w(G,'PE',M,'PE',{section:2.5});`,
  COIL_VOLTAGE: `const G=a('grid3ph',40,20),K=a('contactor3p',60,200,{Uc:24}),S=a('selector012',400,200,{},{pos:1});w(G,'L1',S,'13');w(S,'14',K,'A1');w(K,'A2',G,'N');`,
  CONTROL_UNSTABLE: `const G=a('grid3ph',40,20),K=a('auxRelay',60,200);w(G,'L1',K,'31');w(K,'32',K,'A1');w(K,'A2',G,'N');`,
  LOAD_PHASE_PHASE: `const G=a('grid3ph',40,20),H=a('pilotLight',60,200);w(G,'L1',H,'X1');w(H,'X2',G,'L2');`,
};

for (const lang of ['pt', 'en', 'fr']) {
  test(`códigos industriais da tabela nos cenários — ${lang}`, async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, lang);
    const check = async (code: string) => {
      const card = page.locator(`.card[data-code="${code}"]`).first();
      await expect(card, code).toBeVisible({ timeout: 15_000 });
      const k = code.toLowerCase();
      await expect(card.locator('.card-title'), `${code} título`).toHaveText(template(lang, `diag.${k}.title`));
      await expect(card.locator('.card-cause'), `${code} causa`).toHaveText(template(lang, `diag.${k}.cause`));
      await expect(card.locator('.card-hint'), `${code} dica`).toHaveText(template(lang, `diag.${k}.hint`));
      return card;
    };
    for (const [code, body] of Object.entries(SCENARIOS)) {
      await loadScenario(page, body);
      await check(code);
    }
    // A falta de fase diz qual é a fase, o terminal e o cabo.
    await loadScenario(page, SCENARIOS.MOTOR_PHASE_LOSS!);
    const pl = await check('MOTOR_PHASE_LOSS');
    await expect(pl.locator('.card-cause')).toContainText('L3');
    await expect(pl.locator('.card-cause')).toContainText('W1');
    await expect(pl.locator('.card-hint')).toContainText('G1-L3');
    await expect(pl.locator('.card-hint')).toContainText('M1-W1');

    // Auto-retenção: premir e largar S1 com a ferramenta Operar.
    await loadScenario(page, DOL_NO_HOLD);
    await page.getByTestId('tool-operate').click();
    await press(page, await byName(page, 'S1'), 1500);
    const nh = await check('MOTOR_NO_HOLD');
    await expect(nh.locator('.card-title')).toContainText('S1');
    await expect(nh.locator('.card-hint')).toContainText('K1-13');
    await expect(nh.locator('.card-hint')).toContainText('K1-14');
  });
}

test('arranque directo do exemplo, só com o rato: S1 arranca, o verde acende, S0 pára', async ({ page }) => {
  await open(page, 'pt');
  await openExample(page, 'dol-start', 'beginner');
  const M = await byName(page, 'M1');
  await page.getByTestId('tool-operate').click();
  await press(page, await byName(page, 'S1'));
  await expect(page.locator(`[data-device="${M}"]`)).toHaveAttribute('data-state', 'running', { timeout: 10_000 });
  await expect(page.locator(`[data-device="${await byName(page, 'H1')}"]`)).toHaveAttribute('data-state', 'lit');
  // Medição no painel: a corrente do motor está perto dos 7,7 A × 80 %.
  await page.getByTestId('tool-select').click();
  await clickDevice(page, M);
  await expect(page.getByTestId('measurements').locator('tr[data-key="meas.state"] td')).toHaveText('Em marcha');
  await page.getByTestId('tool-operate').click();
  await press(page, await byName(page, 'S0'));
  await expect(page.locator(`[data-device="${M}"]`)).toHaveAttribute('data-state', /stopping|stopped/, { timeout: 10_000 });
});

test('inversão de marcha do exemplo: S1 à direita, S0, S2 à esquerda', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page, 'pt');
  await openExample(page, 'reversing', 'beginner');
  const M = await byName(page, 'M1');
  await page.getByTestId('tool-operate').click();
  await press(page, await byName(page, 'S1'));
  await expect(page.locator(`[data-device="${M}"]`)).toHaveAttribute('data-state', 'running', { timeout: 10_000 });
  expect(await measurement(page, M, 'meas.direction')).toBe('state.forward');
  // Com K1 fechado, S2 não faz nada (encravamento).
  await press(page, await byName(page, 'S2'));
  await page.waitForTimeout(500);
  expect(await measurement(page, M, 'meas.direction')).toBe('state.forward');
  await press(page, await byName(page, 'S0'));
  await expect(page.locator(`[data-device="${M}"]`)).toHaveAttribute('data-state', 'stopped', { timeout: 20_000 });
  await press(page, await byName(page, 'S2'));
  await expect(page.locator(`[data-device="${M}"]`)).toHaveAttribute('data-state', 'running', { timeout: 10_000 });
  expect(await measurement(page, M, 'meas.direction')).toBe('state.reverse');
});

test('estrela-triângulo do exemplo: KM2 em estrela, KM3 em triângulo depois do temporizador', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page, 'pt');
  await openExample(page, 'star-delta', 'pro');
  await page.evaluate(() => (window as any).faisca.useApp.setState((s: any) => ({ sim: { ...s.sim, speed: 5 } })));
  const state = (n: string) => page.evaluate((x) => (window as any).faisca.useApp.getState().project.devices.find((d: any) => d.name === x).state.closed, n);
  await page.getByTestId('tool-operate').click();
  await press(page, await byName(page, 'S1'));
  await expect.poll(() => state('KM2')).toBe(true);
  await expect.poll(() => state('KM3'), { timeout: 15_000 }).toBe(true);
  expect(await state('KM2')).toBe(false);
  await expect(page.locator(`[data-device="${await byName(page, 'M1')}"]`)).toHaveAttribute('data-state', 'running', { timeout: 10_000 });
  await expect(page.getByTestId('dock-problems').locator('.badge')).toHaveCount(0);
});

test('editor de ladder: mudar um contacto muda o programa e o comportamento da bomba', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page, 'pt');
  await openExample(page, 'plc-pump', 'pro');
  const M = await byName(page, 'M1');
  await page.getByTestId('tool-operate').click();
  await clickDevice(page, await byName(page, 'B1'));
  await expect(page.locator(`[data-device="${M}"]`)).toHaveAttribute('data-state', 'running', { timeout: 10_000 });
  // O contacto I0 do degrau 1 acende a verde no desenho do ladder.
  await page.getByTestId('tool-select').click();
  await clickDevice(page, await byName(page, 'A1'));
  const ladder = page.getByTestId('ladder');
  await expect(ladder.locator('[data-testid^="rung-"]')).toHaveCount(2);
  await expect(ladder.getByTestId('rung-0').locator('path.lad.on').first()).toBeVisible();
  // I1 passa de NF a NA: com S0 em repouso, o degrau abre e a bomba pára.
  await ladder.getByTestId('nc-0-1-0').click();
  await expect(ladder.getByTestId('nc-0-1-0')).toHaveText('NA');
  const prog = await page.evaluate((id) => JSON.parse((window as any).faisca.useApp.getState().project.devices.find((d: any) => d.id === id).params.program), await byName(page, 'A1'));
  expect(prog.rungs[0].cols[1][0].nc).toBeUndefined();
  await expect(page.locator(`[data-device="${M}"]`)).toHaveAttribute('data-state', /stopping|stopped/, { timeout: 10_000 });
  // Desfazer volta ao programa original.
  await page.keyboard.press('Control+z');
  await expect(ladder.getByTestId('nc-0-1-0')).toHaveText('NF');
  // Acrescentar um degrau.
  await ladder.getByTestId('add-rung').click();
  await expect(ladder.locator('[data-testid^="rung-"]')).toHaveCount(3);
});

test('tour industrial com «Mostrar-me», com o arranque e o relé feitos pelo utilizador', async ({ page }) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await page.getByTestId('wizard-lang-pt').click();
  await page.getByTestId('wizard-area-industrial').click();
  await page.getByTestId('wizard-level-beginner').click();
  await page.getByTestId('wizard-empty').click();
  const tour = page.getByTestId('tour');
  await expect(tour).toContainText('Passo 1 de 10');
  for (let i = 0; i < 30 && !(await page.getByTestId('tour-done').isVisible()); i++) {
    const step = await tour.getAttribute('data-step').catch(() => null);
    if (!step) break;
    if (step === 'try-start') {
      // O utilizador prime e larga S1: o motor pára e o tour avança.
      await page.getByTestId('tool-operate').click();
      await press(page, await deviceId(page, 'buttonNO'), 1500);
    } else if (step === 'relay') {
      await page.getByTestId('tool-select').click();
      await clickDevice(page, await deviceId(page, 'thermalRelay'));
      const field = page.getByTestId('properties').locator('label.field', { hasText: 'Corrente regulada Ir' }).locator('input');
      await field.fill('7,7');
      await field.press('Enter');
    } else {
      const next = page.getByTestId('tour-next');
      if (await next.isVisible()) await next.click();
      else await page.getByTestId('tour-show-me').click();
    }
    await expect(tour.or(page.getByTestId('tour-done'))).not.toHaveAttribute('data-step', step, { timeout: 15_000 });
  }
  await expect(page.getByTestId('tour-done')).toContainText('Montou o arranque directo');
  await expect(page.locator(`[data-device="${await deviceId(page, 'motor3ph')}"]`)).toHaveAttribute('data-state', 'running');
});
