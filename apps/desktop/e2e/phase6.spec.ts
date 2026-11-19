/**
 * Critério de aceitação da Fase 6: todos os exercícios da tabela podem ser completados.
 * Também: editor de exercícios (.fast-ex com selo), verificação de conformidade, exportações.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { deviceId, wire } from './helpers';

async function open(page: Page, lang = 'pt') {
  await page.addInitScript((l) => {
    localStorage.clear();
    localStorage.setItem('faisca.lang', l);
  }, lang);
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
}

const IDS = [
  'dom-light-point', 'dom-stair', 'dom-sockets', 'dom-bell', 'dom-board', 'dom-tt', 'dom-cable', 'dom-solar',
  'ind-dol', 'ind-signal', 'ind-reversing', 'ind-star-delta', 'ind-pf', 'ind-selectivity', 'ind-plc-pump', 'ind-vfd',
];

async function openFromList(page: Page, id: string) {
  await page.getByTestId('menu-exercises').click();
  await page.getByTestId('item-ui.menu.exerciseList').click();
  const list = page.getByTestId('exercise-list');
  const all = list.getByRole('checkbox');
  if (await all.count()) await all.check();
  await list.getByTestId(`ex-${id}`).click();
  await expect(page.getByTestId('exercise')).toBeVisible();
}

const download = async (page: Page, click: () => Promise<void>) => {
  const [d] = await Promise.all([page.waitForEvent('download'), click()]);
  return { name: d.suggestedFilename(), bytes: readFileSync((await d.path())!) };
};

test('os 16 exercícios da tabela abrem, começam por resolver e ficam completos com a solução', async ({ page }) => {
  test.setTimeout(240_000);
  await open(page);
  for (const id of IDS) {
    await openFromList(page, id);
    const score = page.getByTestId('exercise-score');
    await expect(score, id).toHaveAttribute('data-percent', /\d+/, { timeout: 20_000 });
    await expect(page.getByTestId('exercise-done'), id).toHaveCount(0);
    page.once('dialog', (d) => d.accept());
    await page.getByTestId('exercise-solution').click();
    await expect(page.getByTestId('exercise-done'), id).toBeVisible({ timeout: 30_000 });
    await expect(score, id).toHaveAttribute('data-percent', '100');
    await expect(score, id).toContainText('solução vista');
  }
});

test('ponto de luz resolvido pelo aluno só com o rato, pelo assistente (sem ver a solução)', async ({ page }) => {
  await open(page);
  await page.getByTestId('menu-project').click();
  await page.getByTestId('item-ui.menu.wizard').click();
  await page.getByTestId('wizard-area-domestic').click();
  await page.getByTestId('wizard-level-beginner').click();
  await page.getByTestId('wizard-exercise').click();
  await expect(page.locator('[data-testid^="wizard-exr-"]')).toHaveCount(4);
  await page.getByTestId('wizard-exr-dom-light-point').click();
  const score = page.getByTestId('exercise-score');
  await expect(score).toContainText('0 de 4', { timeout: 15_000 });
  const G = await deviceId(page, 'grid1ph');
  const Q = await deviceId(page, 'mcb1pn');
  const S = await deviceId(page, 'switch1');
  const H = await deviceId(page, 'lampIncandescent');
  await wire(page, `${G}:L`, `${Q}:1`);
  await wire(page, `${G}:N`, `${Q}:3`);
  await wire(page, `${Q}:2`, `${S}:1`);
  await wire(page, `${S}:2`, `${H}:L`);
  await wire(page, `${Q}:4`, `${H}:N`);
  await expect(page.getByTestId('exercise-done')).toBeVisible({ timeout: 15_000 });
  await expect(score).toHaveText('4 de 4 objectivos');
  await expect(page.locator('[data-objective][data-ok="true"]')).toHaveCount(4);
});

test('erro do aluno: interruptor no neutro deixa o objectivo «S1 corta a fase» por cumprir', async ({ page }) => {
  await open(page);
  await openFromList(page, 'dom-light-point');
  const G = await deviceId(page, 'grid1ph');
  const Q = await deviceId(page, 'mcb1pn');
  const S = await deviceId(page, 'switch1');
  const H = await deviceId(page, 'lampIncandescent');
  await wire(page, `${G}:L`, `${Q}:1`);
  await wire(page, `${G}:N`, `${Q}:3`);
  await wire(page, `${Q}:2`, `${H}:L`);
  await wire(page, `${H}:N`, `${S}:1`);
  await wire(page, `${S}:2`, `${Q}:4`);
  await expect(page.locator('[data-objective="lit"]')).toHaveAttribute('data-ok', 'true', { timeout: 15_000 });
  await expect(page.locator('[data-objective="phase"]')).toHaveAttribute('data-ok', 'false');
  await expect(page.getByTestId('exercise-done')).toHaveCount(0);
});

test('editor de exercícios: criar, testar, exportar com selo e reabrir; um ficheiro alterado é recusado', async ({ page }) => {
  await open(page);
  // Projecto de partida: o exemplo do ponto de luz.
  await page.getByTestId('menu-project').click();
  await page.getByTestId('item-ui.menu.wizard').click();
  await page.getByTestId('wizard-area-domestic').click();
  await page.getByTestId('wizard-level-beginner').click();
  await page.getByTestId('wizard-example').click();
  await page.getByTestId('wizard-ex-light-point').click();
  await page.getByTestId('menu-exercises').click();
  await page.getByTestId('item-ui.menu.exerciseCreate').click();
  const ed = page.getByTestId('exercise-editor');
  await ed.getByTestId('ed-title').fill('Luz da cozinha');
  await ed.getByTestId('ed-statement').fill('Ligue a lâmpada da cozinha ao interruptor.');
  await ed.getByTestId('ed-add').click();
  await ed.getByTestId('ed-obj-text-0').fill('H1 acende com S1 ligado');
  await ed.getByTestId('ed-obj-device-0').selectOption('H1');
  // Sem o comando, a lâmpada está apagada: o teste falha e o ficheiro não é exportado.
  await ed.getByTestId('ed-export').click();
  await expect(ed.getByTestId('ed-message')).toContainText('não cumpre');
  const obj = ed.getByTestId('ed-obj-0');
  await obj.locator('select[aria-label="Aparelho"]').selectOption('S1');
  await obj.locator('select[aria-label="Comando"]').selectOption('switch_on');
  await obj.getByRole('button', { name: '+ comando' }).click();
  await ed.getByTestId('ed-test').click();
  await expect(obj.locator('.mark.ok')).toBeVisible();
  const file = await download(page, () => ed.getByTestId('ed-export').click());
  expect(file.name).toBe('Luz da cozinha.fast-ex');
  const text = file.bytes.toString('utf-8');
  expect(JSON.parse(text)).toMatchObject({ app: 'faisca-ex', exercise: { title: { text: 'Luz da cozinha' } } });
  await ed.getByRole('button', { name: 'Fechar' }).click();

  // Reabrir: o exercício abre com o enunciado do formador e o projecto sem cabos.
  await page.getByTestId('menu-exercises').click();
  // Um só manipulador para os diálogos (confirmação de descartar e alertas), que guarda os alertas.
  const alerts: string[] = [];
  page.on('dialog', (d) => {
    if (d.type() === 'alert') alerts.push(d.message());
    void d.accept();
  });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('item-ui.menu.exerciseOpen').click()]);
  await chooser.setFiles({ name: 'cozinha.fast-ex', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(page.getByTestId('exercise')).toContainText('Luz da cozinha');
  await expect(page.getByTestId('exercise')).toContainText('H1 acende com S1 ligado');
  await expect(page.locator('[data-wire]')).toHaveCount(0);

  // Um aluno altera o ficheiro à mão: é recusado.
  const raw = JSON.parse(text);
  raw.exercise.objectives[0].rule.value = false;
  await page.getByTestId('menu-exercises').click();
  const [chooser2] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('item-ui.menu.exerciseOpen').click()]);
  await chooser2.setFiles({ name: 'batota.faisca-ex', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(raw)) });
  await expect.poll(() => alerts.join(' ')).toContain('alterado fora do editor');
});

test('verificação de conformidade e relatório PDF; exportação do esquema em PNG, PDF e CSV; impressão', async ({ page }) => {
  await open(page);
  await page.getByTestId('menu-project').click();
  await page.getByTestId('item-ui.menu.wizard').click();
  await page.getByTestId('wizard-area-domestic').click();
  await page.getByTestId('wizard-level-pro').click();
  await page.getByTestId('wizard-example').click();
  await page.getByTestId('wizard-ex-house-board').click();
  await page.waitForTimeout(800);

  await page.getByTestId('dock-check').click();
  await page.getByTestId('check-run').click();
  const rules = page.getByTestId('compliance').locator('[data-rule]');
  await expect(rules).toHaveCount(8);
  for (const r of ['ib_in_iz', 'rcd_sockets', 'pe', 'colors', 'tt_touch', 'breaking_capacity']) {
    await expect(page.locator(`[data-rule="${r}"]`), r).toHaveAttribute('data-status', 'pass');
  }
  const report = await download(page, () => page.getByTestId('check-pdf').click());
  expect(report.bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(report.name).toMatch(/verificação\.pdf$/);

  await page.getByTestId('menu-file').click();
  const png = await download(page, () => page.getByTestId('item-ui.menu.exportPng').click());
  expect([...png.bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  expect(png.bytes.length).toBeGreaterThan(20_000);

  await page.getByTestId('menu-file').click();
  const pdf = await download(page, () => page.getByTestId('item-ui.menu.exportPdf').click());
  expect(pdf.bytes.subarray(0, 5).toString()).toBe('%PDF-');

  await page.getByTestId('menu-file').click();
  const csv = await download(page, () => page.getByTestId('item-ui.menu.exportBom').click());
  const rows = csv.bytes.toString('utf-8').replace(/^﻿/, '').split('\r\n');
  expect(rows[0]).toBe('Qtd.;Designação;Equipamento;Características');
  expect(rows.some((r) => /^3;Q3 Q4 Q5;Disjuntor 1P\+N;/.test(r) || /Disjuntor 1P\+N/.test(r))).toBe(true);
  expect(rows.some((r) => r.startsWith('Comprimento (m);Secção (mm²)'))).toBe(true);

  // Impressão: a folha vai para a área de impressão e abre o diálogo do sistema.
  await page.evaluate(() => {
    (window as any).__printed = 0;
    window.print = () => void ((window as any).__printed += 1);
  });
  await page.keyboard.press('Control+p');
  await expect.poll(() => page.evaluate(() => (window as any).__printed)).toBe(1);
  await expect(page.locator('#print-area svg')).toHaveCount(1);
});

test('em inglês, os textos dos exercícios e da verificação estão traduzidos', async ({ page }) => {
  await open(page, 'en');
  await openFromList(page, 'ind-dol');
  await expect(page.getByTestId('exercise')).toContainText('Direct-on-line start with self-hold');
  await expect(page.getByTestId('exercise')).toContainText('M1 keeps running after S1 is released');
  await page.getByTestId('dock-check').click();
  await page.getByTestId('check-run').click();
  await expect(page.getByTestId('compliance')).toContainText('Class I exposed parts connected to the protective conductor');
});
