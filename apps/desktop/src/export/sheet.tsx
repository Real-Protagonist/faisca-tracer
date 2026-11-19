/**
 * Folha de exportação: esquema, legenda das cores dos condutores, lista de material e carimbo
 * (nome do projecto, data e aviso didáctico). É um SVG independente, de onde saem o PNG, o PDF e
 * a impressão.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import type { TFunction } from 'i18next';
import { billOfMaterials, formatNumber, lookFrom, type Bom, type Lang, type Measurement, type Project } from '@faisca/sim-core';
import { bbox, sizeOf, terminalPos, toPath, wirePoints } from '../editor/geometry';
import { SymbolView } from '../editor/SymbolView';
import { registry } from '../store';

const WIRE: Record<string, string> = { L1: '#8b5a2b', L2: '#262626', L3: '#8a8f96', N: '#2f6fd6', PE: '#2e9e44', C: '#d33a3a', 'DC+': '#d33a3a', 'DC-': '#262626' };
const SYMBOL_CLASSES = ['.sl', '.txt', '.dot', '.ind', '.gauge', '.sun', '.junction', '.bus', '.person', '.frame', '.note', '.lad'];

/** Regras CSS dos símbolos (copiadas da folha de estilos da aplicação) e variáveis de cor. */
function symbolCss(): string {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const r of Array.from(rules)) {
      const sel = (r as CSSStyleRule).selectorText;
      if (sel && SYMBOL_CLASSES.some((c) => sel.split(',').some((s) => s.trim().startsWith(c)))) out.push(r.cssText);
    }
  }
  const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#263040';
  return `svg{--ink:${ink};font-family:system-ui,sans-serif}.dev-name{font-size:12px;font-weight:600;fill:#263040}.term-label{font-size:8px;fill:#5a6577}` + out.join('');
}

/** Texto de uma linha da lista de material: características com unidades ou opções traduzidas. */
export function specText(row: Bom['devices'][number], t: TFunction, lang: Lang): string {
  return row.spec
    .map((s) => (s.translated ? t(`option.${s.key}.${s.value}`) : typeof s.value === 'number' ? `${formatNumber(s.value, lang, 3)}${s.unit ? ' ' + s.unit : ''}` : `${s.value}${s.unit ? ' ' + s.unit : ''}`))
    .join(' · ');
}

export interface Sheet {
  svg: string;
  width: number;
  height: number;
}

export function buildSheet(P: Project, measurements: Record<string, Measurement[]>, t: TFunction, lang: Lang): Sheet {
  const devs = P.devices.filter((d) => registry.get(d.type));
  const boxes = devs.map((d) => bbox(registry, d));
  const x0 = (boxes.length ? Math.min(...boxes.map((b) => b.x)) : 0) - 40;
  const y0 = (boxes.length ? Math.min(...boxes.map((b) => b.y)) : 0) - 40;
  const x1 = (boxes.length ? Math.max(...boxes.map((b) => b.x + b.w)) : 400) + 80;
  const y1 = (boxes.length ? Math.max(...boxes.map((b) => b.y + b.h)) : 300) + 40;
  const bom = billOfMaterials(P, registry);
  const sw = Math.max(x1 - x0, 1000);
  const schH = y1 - y0;
  const rowH = 18;
  const bomH = 60 + (bom.devices.length + bom.cables.length + 3) * rowH;
  const width = sw;
  const height = schH + bomH + 70;
  const n = (v: number) => formatNumber(v, lang, 2);
  const legend = ['L1', 'L2', 'L3', 'N', 'PE'];
  const date = new Date().toLocaleDateString(lang === 'en' ? 'en-GB' : lang === 'fr' ? 'fr-FR' : 'pt-PT');
  let y = schH + 30;

  const svg = (
    <svg xmlns="http://www.w3.org/2000/svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <style>{symbolCss()}</style>
      <rect x={0} y={0} width={width} height={height} fill="#ffffff" />
      <g transform={`translate(${-x0} ${-y0})`}>
        {P.wires.map((w) => {
          const pts = wirePoints(registry, P, w);
          if (!pts) return null;
          return <path key={w.id} d={toPath(pts)} fill="none" stroke={WIRE[w.conductor] ?? '#888'} strokeWidth={w.conductor === 'PE' ? 2.6 : 2} strokeDasharray={w.fault?.cut ? '6 4' : undefined} />;
        })}
        {devs.map((d) => {
          const def = registry.require(d.type);
          const { w, h } = sizeOf(def, d);
          const b = bbox(registry, d);
          const prims = def.symbol?.(d, lookFrom(measurements[d.id] ?? []), n) ?? [];
          return (
            <g key={d.id}>
              <g transform={`translate(${d.x} ${d.y}) rotate(${d.rot} ${w / 2} ${h / 2})`}>
                <SymbolView prims={prims} />
              </g>
              {!def.annotation && (
                <text className="dev-name" x={b.x + b.w + 6} y={b.y + 12}>
                  {d.name}
                </text>
              )}
              {def.terminals.map((tm) => {
                const p = terminalPos(registry, d, tm.id)!;
                return (
                  <g key={tm.id}>
                    <circle cx={p.x} cy={p.y} r={2.5} fill="#263040" />
                    {tm.label && (
                      <text className="term-label" x={p.x + 5 + p.nx * 4} y={p.y - 4 + p.ny * 8}>
                        {tm.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </g>
      {/* Legenda das cores dos condutores */}
      <g transform={`translate(${width - 210} 20)`}>
        <rect x={0} y={0} width={190} height={22 + legend.length * 18} fill="#f7f8fa" stroke="#c7cdd6" />
        <text x={10} y={16} fontSize={12} fontWeight={600} fill="#263040">
          {t('ui.export.legend')}
        </text>
        {legend.map((c, i) => (
          <g key={c} transform={`translate(10 ${28 + i * 18})`}>
            <line x1={0} y1={0} x2={28} y2={0} stroke={WIRE[c]} strokeWidth={4} />
            <text x={36} y={4} fontSize={11} fill="#263040">
              {c} · {t(`color.${c}`)}
            </text>
          </g>
        ))}
      </g>
      {/* Lista de material */}
      <g fontSize={11} fill="#263040">
        <text x={20} y={y} fontSize={14} fontWeight={600}>
          {t('ui.export.bom')}
        </text>
        {(() => {
          const rows: JSX.Element[] = [];
          y += rowH + 4;
          rows.push(
            <g key="h" fontWeight={600}>
              <text x={20} y={y}>{t('ui.export.qty')}</text>
              <text x={70} y={y}>{t('ui.export.names')}</text>
              <text x={260} y={y}>{t('ui.export.device')}</text>
              <text x={560} y={y}>{t('ui.export.spec')}</text>
            </g>,
          );
          for (const r of bom.devices) {
            y += rowH;
            rows.push(
              <g key={r.names.join()}>
                <text x={20} y={y}>{r.qty}</text>
                <text x={70} y={y}>{r.names.join(', ').slice(0, 30)}</text>
                <text x={260} y={y}>{t(`device.${r.type}.name`)}</text>
                <text x={560} y={y}>{specText(r, t, lang)}</text>
              </g>,
            );
          }
          y += rowH;
          for (const c of bom.cables) {
            y += rowH;
            rows.push(
              <g key={`${c.section}${c.material}${c.conductor}`}>
                <text x={20} y={y}>{n(c.length)} m</text>
                <text x={260} y={y}>{t('ui.export.cable', { section: n(c.section), material: c.material, color: t(`color.${c.conductor}`), conductor: c.conductor })}</text>
                <text x={560} y={y}>{t('ui.export.runs', { count: c.count })}</text>
              </g>,
            );
          }
          return rows;
        })()}
      </g>
      {/* Carimbo */}
      <g transform={`translate(0 ${height - 40})`}>
        <line x1={20} y1={0} x2={width - 20} y2={0} stroke="#c7cdd6" />
        <text x={20} y={18} fontSize={13} fontWeight={600} fill="#263040">
          {P.name || t('ui.untitled')} · {t(`domain.${P.domain}`)} · {date}
        </text>
        <text x={20} y={33} fontSize={10} fill="#5a6577">
          Faísca Tracer — {t('app.disclaimer')}
        </text>
      </g>
    </svg>
  );
  return { svg: '<?xml version="1.0" encoding="UTF-8"?>' + renderToStaticMarkup(svg), width, height };
}
