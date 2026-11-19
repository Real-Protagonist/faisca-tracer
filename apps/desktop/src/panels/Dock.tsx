/** Doca inferior: biblioteca, Eventos, Problemas, Verificação, Exercício e Matriz MNA (Profissional). */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber, lookFrom, type Category, type Device, type DeviceDef, type Diagnostic } from '@faisca/sim-core';
import { registry, requestMatrix, select, ui, useApp, type DockTab } from '../store';
import { SymbolView } from '../editor/SymbolView';
import { sizeOf } from '../editor/geometry';
import { fmtTime } from '../format';
import { centerOn } from '../view';
import { i18n } from '../i18n';
import { ExercisePanel } from './Exercise';
import { CompliancePanel } from './Compliance';

const CATEGORIES: Category[] = ['sources', 'protection', 'control', 'sensors', 'loads', 'motors', 'measurement', 'distribution', 'faults', 'annotations'];

export function Dock() {
  const { t } = useTranslation();
  const tab = useApp((s) => s.dockTab);
  const level = useApp((s) => s.project.level);
  const problems = useApp((s) => s.snapshot?.diagnostics.filter((d) => d.severity !== 'info').length ?? 0);
  const exercise = useApp((s) => !!s.exercise);
  const tabs: DockTab[] = ['library', 'events', 'problems', 'check', ...(exercise ? (['exercise'] as const) : []), ...(level === 'pro' ? (['matrix'] as const) : [])];
  return (
    <section className="dock" aria-label={t('ui.dock.title')}>
      <div className="dock-tabs" role="tablist">
        {tabs.map((x) => (
          <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'active' : ''} onClick={() => ui.setDock(x)} data-testid={`dock-${x}`}>
            {t(`ui.dock.${x}`)}
            {x === 'problems' && problems > 0 && <span className="badge">{problems}</span>}
          </button>
        ))}
      </div>
      <div className="dock-body">
        {tab === 'library' && <Library />}
        {tab === 'events' && <Events />}
        {tab === 'problems' && <Problems />}
        {tab === 'check' && <CompliancePanel />}
        {tab === 'exercise' && <ExercisePanel />}
        {tab === 'matrix' && <Matrix />}
      </div>
    </section>
  );
}

/** Texto pesquisável de um equipamento: nome e descrição nos três idiomas, tipo e designação. */
function haystack(def: DeviceDef): string {
  const parts = [def.type, def.prefix];
  for (const l of ['pt', 'en', 'fr']) parts.push(i18n.t(`device.${def.type}.name`, { lng: l }), i18n.t(`device.${def.type}.desc`, { lng: l }));
  return parts.join(' ').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

function Library() {
  const { t } = useTranslation();
  const P = useApp((s) => s.project);
  const placing = useApp((s) => s.placing);
  const [cat, setCat] = useState<Category | 'all'>('all');
  const [q, setQ] = useState('');
  const lib = useMemo(() => registry.library(P.domain, P.level), [P.domain, P.level]);
  const index = useMemo(() => new Map(lib.map((d) => [d.type, haystack(d)])), [lib]);
  const query = q.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const shown = lib.filter((d) => (cat === 'all' || d.category === cat) && (!query || query.split(/\s+/).every((w) => index.get(d.type)!.includes(w))));
  const cats = CATEGORIES.filter((c) => lib.some((d) => d.category === c));
  return (
    <div className="library">
      <div className="lib-cats" role="tablist" aria-label={t('ui.library.categories')}>
        <button className={cat === 'all' ? 'active' : ''} onClick={() => setCat('all')}>
          {t('ui.library.all')}
        </button>
        {cats.map((c) => (
          <button key={c} className={cat === c ? 'active' : ''} onClick={() => setCat(c)} data-testid={`cat-${c}`}>
            {t(`category.${c}`)}
          </button>
        ))}
        <input className="search" type="search" placeholder={t('ui.library.search')} aria-label={t('ui.library.search')} value={q} onChange={(e) => setQ(e.target.value)} data-testid="lib-search" />
      </div>
      <div className="tiles">
        {shown.map((def) => (
          <Tile key={def.type} def={def} active={placing === def.type} />
        ))}
        {!shown.length && <p className="muted">{t('ui.library.none')}</p>}
      </div>
    </div>
  );
}

function Tile({ def, active }: { def: DeviceDef; active: boolean }) {
  const { t } = useTranslation();
  const fake: Device = { id: 'tile', type: def.type, name: '', x: 0, y: 0, rot: 0, params: registry.defaults(def.type), state: def.initialState() };
  const { w, h } = sizeOf(def, fake);
  return (
    <button
      className={active ? 'tile active' : 'tile'}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-faisca-device', def.type);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => ui.setPlacing(active ? null : def.type)}
      title={t(`device.${def.type}.desc`)}
      data-testid={`tile-${def.type}`}
    >
      <svg viewBox={`-6 -6 ${w + 12} ${h + 12}`} aria-hidden>
        <SymbolView prims={def.symbol?.(fake, lookFrom([]), String) ?? []} />
      </svg>
      <span>{t(`device.${def.type}.name`)}</span>
    </button>
  );
}

function Events() {
  const { t } = useTranslation();
  const events = useApp((s) => s.events);
  const lang = useApp((s) => s.lang);
  const P = useApp((s) => s.project);
  if (!events.length) return <p className="muted pad">{t('ui.events.none')}</p>;
  return (
    <table className="list" data-testid="events">
      <tbody>
        {[...events].reverse().map((e) => (
          <tr key={e.seq} className={`sev-${e.severity}`} onClick={() => e.deviceId && select({ devices: [e.deviceId] })}>
            <td className="time">{fmtTime(e.t, lang)}</td>
            <td className="who">{P.devices.find((d) => d.id === e.deviceId)?.name ?? t('ui.events.system')}</td>
            <td>{t(`event.${e.code}`, e.values)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Problems() {
  const { t } = useTranslation();
  const diags = useApp((s) => s.snapshot?.diagnostics) ?? NONE;
  const pro = useApp((s) => s.project.level === 'pro');
  if (!diags.length) return <p className="muted pad">{t('ui.problems.none')}</p>;
  const groups: Diagnostic['severity'][] = ['error', 'warning', 'info'];
  const show = (d: Diagnostic) => {
    const devices = d.targets.filter((x) => x.kind === 'device').map((x) => x.id);
    const wires = d.targets.filter((x) => x.kind === 'wire').map((x) => x.id);
    select({ devices, wires });
    const first = d.fix ? { kind: (wires.includes(d.fix.id) ? 'wire' : 'device') as 'wire' | 'device', id: d.fix.id } : d.targets[0];
    if (first) centerOn(first.kind, first.id);
  };
  return (
    <div className="problems" data-testid="problems">
      {groups.map((g) => {
        const list = diags.filter((d) => d.severity === g);
        if (!list.length) return null;
        return (
          <div key={g}>
            <h4 className={`sev-${g}`}>
              {t(`severity.${g}`)} ({list.length})
            </h4>
            <ul>
              {list.map((d, i) => (
                <li key={i} className={`sev-${d.severity}`} data-code={d.code}>
                  <button className="link" onClick={() => show(d)}>
                    <b>{t(d.titleKey, d.values)}</b> — {t(d.causeKey, d.values)} <i>{t(d.hintKey, d.values)}</i>
                    {pro && <span className="muted"> {Object.entries(d.values).filter(([k]) => ['current', 'voltage', 'ratio', 'drop'].includes(k)).map(([, v]) => v).join(' · ')}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

const MAX_MATRIX = 40;
const NONE: Diagnostic[] = [];

function Matrix() {
  const { t } = useTranslation();
  const m = useApp((s) => s.matrix);
  const lang = useApp((s) => s.lang);
  const c = (re: number, im: number) => {
    if (Math.abs(re) < 1e-12 && Math.abs(im) < 1e-12) return '';
    const f = (v: number) => formatNumber(v, lang, Math.abs(v) >= 100 ? 1 : 4);
    return Math.abs(im) < 1e-12 ? f(re) : `${f(re)}${im < 0 ? '−' : '+'}j${f(Math.abs(im))}`;
  };
  return (
    <div className="matrix pad">
      <button onClick={requestMatrix} data-testid="matrix-refresh">
        {t('ui.matrix.refresh')}
      </button>
      <p className="muted small">{t('ui.matrix.explain')}</p>
      {m && m.n > MAX_MATRIX && <p>{t('ui.matrix.tooBig', { n: m.n, max: MAX_MATRIX })}</p>}
      {m && m.n <= MAX_MATRIX && (
        <div className="matrix-scroll">
          <table>
            <thead>
              <tr>
                <th />
                {m.labels.map((l, j) => (
                  <th key={j}>{l}</th>
                ))}
                <th>b</th>
              </tr>
            </thead>
            <tbody>
              {m.labels.map((l, i) => (
                <tr key={i}>
                  <th>{l}</th>
                  {m.labels.map((_, j) => (
                    <td key={j}>{c(m.re[i * m.n + j]!, m.im[i * m.n + j]!)}</td>
                  ))}
                  <td className="rhs">{c(m.bre[i]!, m.bim[i]!)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
