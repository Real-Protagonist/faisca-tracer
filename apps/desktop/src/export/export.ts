/**
 * Exportações: esquema em PNG e PDF (com legenda e lista de material), lista de material em CSV
 * (abre no Excel), impressão e relatório da verificação de conformidade em PDF.
 * Tudo é gerado na aplicação, sem internet (o jsPDF faz parte do instalador).
 */
import { i18n } from '../i18n';
import { billOfMaterials, formatNumber, type ComplianceResult, type ComplianceRules, type Lang } from '@faisca/sim-core';
import { registry, useApp } from '../store';
import { saveExport } from '../platform/files';
import { buildSheet, specText, type Sheet } from './sheet';

const t = (k: string, o: Record<string, unknown> = {}) => i18n.t(k, o);
const base = () => {
  const P = useApp.getState().project;
  return (P.name || t('ui.untitled')).replace(/[\\/:*?"<>|]+/g, '_');
};
const sheetNow = (): Sheet => {
  const { project, snapshot, lang } = useApp.getState();
  return buildSheet(project, snapshot?.measurements ?? {}, i18n.t.bind(i18n), lang);
};

/** Desenha a folha num canvas (escala 2) e devolve o PNG. */
async function sheetPng(sheet: Sheet, scale = 2): Promise<{ bytes: Uint8Array; dataUrl: string }> {
  const url = URL.createObjectURL(new Blob([sheet.svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((ok, fail) => {
      img.onload = () => ok();
      img.onerror = () => fail(new Error('svg'));
      img.src = url;
    });
    const c = document.createElement('canvas');
    c.width = Math.round(sheet.width * scale);
    c.height = Math.round(sheet.height * scale);
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL('image/png');
    const bin = atob(dataUrl.split(',')[1]!);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, dataUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exportPng() {
  const { bytes } = await sheetPng(sheetNow());
  return saveExport(bytes, `${base()}.png`, { name: 'PNG', extensions: ['png'] }, 'image/png');
}

export async function exportPdf() {
  const sheet = sheetNow();
  const { dataUrl } = await sheetPng(sheet);
  const { jsPDF } = await import('jspdf');
  const landscape = sheet.width >= sheet.height;
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a3' });
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const k = Math.min((pw - 20) / sheet.width, (ph - 20) / sheet.height);
  doc.addImage(dataUrl, 'PNG', 10, 10, sheet.width * k, sheet.height * k);
  doc.setProperties({ title: base(), creator: 'Faísca', subject: t('app.disclaimer') });
  return saveExport(new Uint8Array(doc.output('arraybuffer')), `${base()}.pdf`, { name: 'PDF', extensions: ['pdf'] }, 'application/pdf');
}

/** Lista de material em CSV. Em PT e FR, separador «;» (o Excel desses idiomas usa a vírgula decimal). */
export function bomCsv(lang: Lang = useApp.getState().lang): string {
  const P = useApp.getState().project;
  const bom = billOfMaterials(P, registry);
  const sep = lang === 'en' ? ',' : ';';
  const q = (v: string | number) => {
    const s = String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const n = (v: number) => formatNumber(v, lang, 2);
  const tt = i18n.t.bind(i18n);
  const lines = [
    [t('ui.export.qty'), t('ui.export.names'), t('ui.export.device'), t('ui.export.spec')],
    ...bom.devices.map((r) => [r.qty, r.names.join(' '), tt(`device.${r.type}.name`), specText(r, tt, lang)]),
    [],
    [t('ui.export.length'), t('ui.export.section'), t('ui.export.material'), t('ui.export.conductor'), t('ui.export.runsHeader')],
    ...bom.cables.map((c) => [n(c.length), n(c.section), c.material, `${c.conductor} · ${tt(`color.${c.conductor}`)}`, c.count]),
  ];
  // BOM UTF-8 para o Excel reconhecer os acentos.
  return '﻿' + lines.map((l) => l.map(q).join(sep)).join('\r\n') + '\r\n';
}

export function exportBomCsv() {
  return saveExport(bomCsv(), `${base()} - ${t('ui.export.bomFile')}.csv`, { name: 'CSV', extensions: ['csv'] }, 'text/csv');
}

/** Imprime a folha (esquema, legenda e lista de material) pelo diálogo de impressão do sistema. */
export function printSheet() {
  const sheet = sheetNow();
  let area = document.getElementById('print-area');
  if (!area) {
    area = document.createElement('div');
    area.id = 'print-area';
    document.body.appendChild(area);
  }
  area.innerHTML = sheet.svg.replace(/^<\?xml[^>]*>/, '');
  document.body.classList.add('printing');
  const done = () => {
    document.body.classList.remove('printing');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
  // Alguns ambientes não emitem «afterprint».
  setTimeout(done, 1000);
}

/** Relatório da verificação de conformidade em PDF, com o aviso de ferramenta didáctica. */
export async function exportCompliancePdf(results: ComplianceResult[], rules: ComplianceRules) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const P = useApp.getState().project;
  const lang = useApp.getState().lang;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  let y = 18;
  const line = (text: string, size = 10, bold = false, color: [number, number, number] = [38, 48, 64], indent = 14) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
    for (const l of doc.splitTextToSize(text, W - indent - 14) as string[]) {
      if (y > H - 22) footerAndPage();
      doc.text(l, indent, y);
      y += size * 0.45;
    }
  };
  const footer = () => {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(90, 101, 119);
    doc.text(doc.splitTextToSize(`Faísca — ${t('app.disclaimer')}`, W - 28) as string[], 14, H - 12);
  };
  const footerAndPage = () => {
    footer();
    doc.addPage();
    y = 18;
  };
  const date = new Date().toLocaleDateString(lang === 'en' ? 'en-GB' : lang === 'fr' ? 'fr-FR' : 'pt-PT');
  line(t('ui.check.reportTitle'), 16, true);
  y += 2;
  line(`${P.name || t('ui.untitled')} · ${t(`domain.${P.domain}`)} · ${date}`, 10);
  line(`${t('ui.check.rules')}: ${rules.name}`, 10);
  y += 4;
  const colors: Record<string, [number, number, number]> = { pass: [31, 157, 85], fail: [214, 58, 58], na: [120, 128, 140] };
  for (const r of results) {
    line(`${t(`ui.check.status.${r.status}`)} — ${t(`compliance.${r.id}.title`)}`, 11, true, colors[r.status]);
    line(`${t('ui.check.reference')}: ${r.reference}`, 9, false, [90, 101, 119], 20);
    for (const it of r.items) line(`${it.ok ? '✓' : '✗'} ${t(`compliance.${r.id}.item`, it.values)}`.replace('✓', '+').replace('✗', '−'), 9, false, it.ok ? [38, 48, 64] : [214, 58, 58], 20);
    y += 3;
  }
  footer();
  return saveExport(new Uint8Array(doc.output('arraybuffer')), `${base()} - ${t('ui.check.reportFile')}.pdf`, { name: 'PDF', extensions: ['pdf'] }, 'application/pdf');
}
