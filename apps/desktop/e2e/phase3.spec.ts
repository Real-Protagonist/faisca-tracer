/**
 * Critérios de aceitação da Fase 3:
 *  - os códigos de erro da tabela (área doméstica) aparecem nos cenários descritos, nos três idiomas;
 *  - um utilizador novo completa o tour sem ajuda (só com as instruções do tour e o rato).
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { clickDevice, clickPlace, deviceId, dragFromLibrary, wire } from './helpers';

const i18nFile = (l: string) => JSON.parse(readFileSync(new URL(`../../../packages/i18n/${l}.json`, import.meta.url), 'utf-8'));
const LANGS: Record<string, any> = { pt: i18nFile('pt'), en: i18nFile('en'), fr: i18nFile('fr') };

/** Expressão regular a partir do modelo da mensagem: as variáveis valem qualquer texto. */
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

/** Cenários da tabela de erros do prompt, montados com o núcleo no próprio navegador. */
const SCENARIOS: Record<string, string> = {
  LOAD_NO_RETURN: `const G=a('grid1ph',40,20),Q=a('mcb1pn',60,200),H=a('lampIncandescent',300,200);w(G,'L',Q,'1');w(G,'N',Q,'3');w(Q,'2',H,'L');`,
  SWITCH_ON_NEUTRAL: `const G=a('grid1ph',40,20),Q=a('mcb1pn',60,200),H=a('lampIncandescent',300,200),S=a('switch1',460,200,{},{on:true});w(G,'L',Q,'1');w(G,'N',Q,'3');w(Q,'2',H,'L');w(H,'N',S,'1',{conductor:'N'});w(S,'2',Q,'4',{conductor:'N'});`,
  MCB_MAGNETIC_TRIP: `const G=a('grid1ph',40,20),Q=a('mcb1pn',60,200),C=a('shortCircuit',300,200,{},{active:true});w(G,'L',Q,'1');w(G,'N',Q,'3');w(Q,'2',C,'1');w(Q,'4',C,'2');`,
  MCB_THERMAL_TRIP: `const G=a('grid1ph',40,20),Q=a('mcb1pn',60,200,{In:16,curve:'B'}),J=a('junction',260,220),K=a('junction',260,300);w(G,'L',Q,'1',{section:4});w(G,'N',Q,'3',{section:4});w(Q,'2',J,'a',{section:4});w(Q,'4',K,'a',{section:4});['b','c','d'].forEach((t,i)=>{const E=a('heater',360+i*100,200);w(J,t,E,'L',{section:4});w(K,t,E,'N',{section:4});w(G,'PE',E,'PE',{section:4});});P.devices[0].params.earthing='TN-S';`,
  RCD_TRIP: `const G=a('grid1ph',40,20),R=a('rcd2p',60,200),X=a('socket',300,200,{appliance:'laptop',defect:'leak'}),E=a('earthElectrode',460,200);w(G,'L',R,'1');w(G,'N',R,'3');w(R,'2',X,'L');w(R,'4',X,'N');w(X,'PE',E,'PE');`,
  CABLE_UNPROTECTED: `const G=a('grid1ph',40,20,{earthing:'TN-S'}),Q=a('mcb1pn',60,200,{In:25}),E=a('heater',300,200);w(G,'L',Q,'1',{section:6});w(G,'N',Q,'3',{section:6});w(Q,'2',E,'L',{section:2.5});w(Q,'4',E,'N',{section:2.5});w(G,'PE',E,'PE',{section:2.5});`,
  PE_MISSING: `const G=a('grid1ph',40,20),Q=a('mcb1pn',60,200,{In:16}),E=a('heater',300,200);w(G,'L',Q,'1');w(G,'N',Q,'3');w(Q,'2',E,'L',{section:2.5});w(Q,'4',E,'N',{section:2.5});`,
  WRONG_VOLTAGE: `const G=a('grid1ph',40,20),Q=a('mcb1pn',60,200,{In:16}),H=a('lampIncandescent',300,200,{Vn:12,P:21});w(G,'L',Q,'1');w(G,'N',Q,'3');w(Q,'2',H,'L');w(Q,'4',H,'N');`,
  VOLTAGE_DROP: `const G=a('grid1ph',40,20,{earthing:'TN-S'}),Q=a('mcb1pn',60,200,{In:16}),E=a('heater',300,200);w(G,'L',Q,'1',{section:4});w(G,'N',Q,'3',{section:4});w(Q,'2',E,'L',{section:2.5,length:60});w(Q,'4',E,'N',{section:2.5,length:60});w(G,'PE',E,'PE',{section:2.5,length:60});E.params.P=4500;`,
  BODY_CURRENT: `const G=a('grid1ph',40,20),Q=a('mcb1pn',60,200,{In:16}),E=a('heater',300,200,{defect:'frank'},{on:false}),Z=a('person',460,200);w(G,'L',Q,'1');w(G,'N',Q,'3');w(Q,'2',E,'L');w(Q,'4',E,'N');w(Z,'M',E,'PE');`,
  SOURCE_SHORT: `const G=a('grid1ph',40,20),Q=a('mcb1pn',60,200);w(G,'L',Q,'1');w(G,'N',Q,'3');w(Q,'2',Q,'4');`,
};

async function loadScenario(page: Page, body: string) {
  await page.evaluate((src) => {
    const f = (window as any).faisca;
    const P = f.core.createProject({ level: 'beginner' });
    const a = (type: string, x: number, y: number, params = {}, state = {}) => f.core.addDevice(P, type, { x, y, params, state });
    const w = (A: any, ta: string, B: any, tb: string, o = {}) => f.core.addWire(P, A, ta, B, tb, o);
    // eslint-disable-next-line no-new-func
    new Function('P', 'a', 'w', src)(P, a, w);
    f.loadProject(P);
  }, body);
}

for (const lang of ['pt', 'en', 'fr']) {
  test(`códigos de erro da tabela aparecem nos cenários — ${lang}`, async ({ page }) => {
    test.setTimeout(180_000);
    await open(page, lang);
    // A sobrecarga térmica demora ~110 s de simulação: corre a ×50.
    await page.evaluate(() => (window as any).faisca.useApp.setState((s: any) => ({ sim: { ...s.sim, speed: 50 } })));
    for (const [code, body] of Object.entries(SCENARIOS)) {
      await loadScenario(page, body);
      const card = page.locator(`.card[data-code="${code}"]`).first();
      await expect(card, code).toBeVisible({ timeout: 15_000 });
      const k = code.toLowerCase();
      await expect(card.locator('.card-title'), `${code} título`).toHaveText(template(lang, `diag.${k}.title`));
      await expect(card.locator('.card-cause'), `${code} causa`).toHaveText(template(lang, `diag.${k}.cause`));
      await expect(card.locator('.card-hint'), `${code} dica`).toHaveText(template(lang, `diag.${k}.hint`));
    }
    // PATH_OPEN chega pelo botão «Porque não funciona?».
    await loadScenario(page, `const G=a('grid1ph',40,20),Q=a('mcb1pn',60,200,{},{closed:false}),H=a('lampIncandescent',300,200);w(G,'L',Q,'1');w(G,'N',Q,'3');w(Q,'2',H,'L');w(Q,'4',H,'N');`);
    await clickDevice(page, await deviceId(page, 'lampIncandescent'));
    await page.getByTestId('why-not').click();
    const r = page.getByTestId('why-not-result');
    await expect(r).toHaveAttribute('data-code', 'PATH_OPEN');
    await expect(r.locator('strong')).toHaveText(template(lang, 'diag.path_open.title'));
  });
}

test('cartão de erro: Mostrar selecciona, Como corrigir abre a explicação, Saber mais mostra a figura, fechar', async ({ page }) => {
  await open(page, 'pt');
  await loadScenario(page, SCENARIOS.MCB_MAGNETIC_TRIP!);
  const card = page.locator('.card[data-code="MCB_MAGNETIC_TRIP"]');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Mostrar' }).click();
  await expect(page.locator('[data-type="mcb1pn"].selected')).toHaveCount(1);
  await card.getByTestId('card-how-to-fix').click();
  await expect(card.getByTestId('card-full-hint')).toBeVisible();
  await card.getByTestId('card-learn').click();
  await expect(card.locator('svg.figure')).toBeVisible();
  await card.getByRole('button', { name: 'Fechar mensagem' }).click();
  await expect(card).toHaveCount(0);
  // Continua no painel Problemas.
  await page.getByTestId('dock-problems').click();
  await expect(page.locator('[data-testid="problems"] li[data-code="MCB_MAGNETIC_TRIP"]')).toBeVisible();
});

test('assistente: primeira abertura pede o idioma, deixa voltar atrás e abre exemplos filtrados', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  const wiz = page.getByTestId('wizard');
  await expect(wiz).toHaveAttribute('data-screen', 'lang');
  await page.getByTestId('wizard-lang-en').click();
  await expect(wiz).toHaveAttribute('data-screen', 'area');
  await expect(page.getByTestId('menu-file')).toHaveText('File');
  await page.getByTestId('wizard-back').click();
  await expect(wiz).toHaveAttribute('data-screen', 'lang');
  await page.getByTestId('wizard-lang-pt').click();
  await page.getByTestId('wizard-area-domestic').click();
  await page.getByTestId('wizard-level-pro').click();
  await page.getByTestId('wizard-example').click();
  await expect(page.locator('[data-testid^="wizard-ex-"]')).toHaveCount(2);
  await page.getByTestId('wizard-ex-house-board').click();
  await expect(wiz).toHaveCount(0);
  await expect(page.locator('[data-device]')).toHaveCount(14);
  await expect(page.locator('.chip')).toHaveText('Electricidade doméstica · Profissional');
  // «Novo projecto» volta a abrir o assistente, já sem o idioma.
  await page.keyboard.press('Control+n');
  page.once('dialog', (d) => d.accept());
  await expect(wiz).toHaveAttribute('data-screen', 'area');
});

/** Percorre o tour só com as instruções e o rato, como um utilizador novo. */
test('tour doméstico completo pelo utilizador, com um erro pelo caminho', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await page.getByTestId('wizard-lang-pt').click();
  await page.getByTestId('wizard-area-domestic').click();
  await page.getByTestId('wizard-level-beginner').click();
  await page.getByTestId('wizard-empty').click();
  const tour = page.getByTestId('tour');
  const at = (id: string) => expect(tour).toHaveAttribute('data-step', id, { timeout: 10_000 });

  await at('screen-canvas');
  await expect(tour).toContainText('Passo 1 de 12');
  for (const s of ['screen-canvas', 'screen-library', 'screen-props', 'screen-sim']) {
    await at(s);
    await page.getByTestId('tour-next').click();
  }
  await at('place-grid');
  await dragFromLibrary(page, 'grid1ph', 120, 80);
  await at('place-mcb');
  await dragFromLibrary(page, 'mcb1pn', 120, 270);
  const G = await deviceId(page, 'grid1ph');
  const Q = await deviceId(page, 'mcb1pn');
  await at('wire-phase');
  await wire(page, `${G}:L`, `${Q}:1`);
  await at('wire-neutral');
  await wire(page, `${G}:N`, `${Q}:3`);
  await at('place-switch-lamp');
  await dragFromLibrary(page, 'switch1', 320, 270);
  await dragFromLibrary(page, 'lampIncandescent', 480, 270);
  const S = await deviceId(page, 'switch1');
  const H = await deviceId(page, 'lampIncandescent');
  await at('phase-path');

  // Erro: o interruptor ligado ao neutro. O tour não avança e explica com o diagnóstico.
  await wire(page, `${Q}:4`, `${S}:1`);
  await wire(page, `${S}:2`, `${H}:L`);
  const m = page.getByTestId('tour-mistake');
  await expect(m).toBeVisible({ timeout: 10_000 });
  expect(['SWITCH_ON_NEUTRAL', 'WIRE_COLOR']).toContain(await m.getAttribute('data-code'));
  await at('phase-path');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');

  await wire(page, `${Q}:2`, `${S}:1`);
  await wire(page, `${S}:2`, `${H}:L`);
  await at('neutral-return');
  await wire(page, `${Q}:4`, `${H}:N`);
  await at('switch-on');
  await page.getByTestId('tool-operate').click();
  await clickDevice(page, S);
  await at('measure');
  await page.getByTestId('tool-probe').click();
  await page.locator(`[data-term="${H}:L"] .term-hit`).click();
  await page.locator(`[data-term="${H}:N"] .term-hit`).click();
  await at('view-3d');
  await page.getByRole('tab', { name: 'Físico 3D' }).click();
  await at('fault');
  await page.getByRole('tab', { name: 'Esquema lógico' }).click();
  await page.getByTestId('tool-select').click();
  await clickPlace(page, 'shortCircuit', 640, 160);
  const C = await deviceId(page, 'shortCircuit');
  await wire(page, `${C}:1`, `${H}:L`);
  await wire(page, `${C}:2`, `${H}:N`);
  await page.getByTestId('tool-operate').click();
  await clickDevice(page, C);
  await at('fix');
  await page.locator('.card[data-code="MCB_MAGNETIC_TRIP"]').getByTestId('card-how-to-fix').click();
  await clickDevice(page, C);
  await clickDevice(page, Q);
  await expect(page.getByTestId('tour-done')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(`[data-device="${H}"]`)).toHaveAttribute('data-state', 'lit');
});

test('tour completo só com «Mostrar-me», em francês', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await page.getByTestId('wizard-lang-fr').click();
  await page.getByTestId('wizard-area-domestic').click();
  await page.getByTestId('wizard-level-beginner').click();
  await page.getByTestId('wizard-empty').click();
  const tour = page.getByTestId('tour');
  await expect(tour).toContainText('Étape 1 sur 12');
  for (let i = 0; i < 40 && !(await page.getByTestId('tour-done').isVisible()); i++) {
    const step = await tour.getAttribute('data-step').catch(() => null);
    if (!step) break;
    const next = page.getByTestId('tour-next');
    if (await next.isVisible()) await next.click();
    else await page.getByTestId('tour-show-me').click();
    await expect(tour.or(page.getByTestId('tour-done'))).not.toHaveAttribute('data-step', step, { timeout: 10_000 });
  }
  await expect(page.getByTestId('tour-done')).toContainText('Vous avez monté votre premier circuit');
  // No fim, o tour propõe o primeiro exercício do mesmo tema.
  await page.getByTestId('tour-first-exercise').click();
  await expect(page.getByTestId('exercise')).toContainText('Point lumineux simple');
});

test('o tour retoma no mesmo passo pelo menu Ajuda', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('init')) {
      localStorage.clear();
      sessionStorage.setItem('init', '1');
    }
  });
  await page.goto('/');
  await page.getByTestId('wizard-lang-pt').click();
  await page.getByTestId('wizard-area-domestic').click();
  await page.getByTestId('wizard-level-beginner').click();
  await page.getByTestId('wizard-empty').click();
  for (let i = 0; i < 4; i++) await page.getByTestId('tour-next').click();
  await expect(page.getByTestId('tour')).toHaveAttribute('data-step', 'place-grid');
  await page.getByTestId('tour-exit').click();
  await expect(page.getByTestId('tour')).toHaveCount(0);
  await page.getByTestId('menu-help').click();
  await page.getByTestId('item-ui.menu.tour').click();
  await expect(page.getByTestId('tour')).toHaveAttribute('data-step', 'place-grid');
});
