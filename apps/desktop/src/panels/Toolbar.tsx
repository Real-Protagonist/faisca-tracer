/** Barra de ferramentas: ferramentas, desfazer, rodar, próximo cabo, zoom, separadores e controlo do tempo. */
import { useTranslation } from 'react-i18next';
import { SECTIONS, type Conductor } from '@faisca/sim-core';
import { redo, rotateSelection, setSim, stepOnce, ui, undo, useApp, type Tool } from '../store';
import { fmtClock } from '../format';
import { fitView, zoomBy } from '../view';

const TOOLS: { id: Tool; icon: string; key: string }[] = [
  { id: 'select', icon: '↖', key: 'V' },
  { id: 'operate', icon: '✋', key: 'H' },
  { id: 'wire', icon: '〰', key: 'W' },
  { id: 'probe', icon: '⊸', key: 'M' },
  { id: 'clamp', icon: '◎', key: 'P' },
  { id: 'delete', icon: '✕', key: 'D' },
];
const CONDUCTORS: (Conductor | 'auto')[] = ['auto', 'L1', 'L2', 'L3', 'N', 'PE', 'C', 'DC+', 'DC-'];
const SPEEDS = [0.1, 0.5, 1, 2, 5, 10, 50];

export function Toolbar() {
  const { t } = useTranslation();
  const tool = useApp((s) => s.tool);
  const sim = useApp((s) => s.sim);
  const nextWire = useApp((s) => s.nextWire);
  const tab = useApp((s) => s.tab);
  const time = useApp((s) => s.snapshot?.t ?? 0);
  const lang = useApp((s) => s.lang);
  const past = useApp((s) => s.past.length);
  const future = useApp((s) => s.future.length);
  const zoom = useApp((s) => s.view.zoom);

  return (
    <div className="toolbar" role="toolbar" aria-label={t('ui.toolbar')}>
      <div className="group">
        {TOOLS.map((x) => (
          <button key={x.id} className={tool === x.id ? 'tool active' : 'tool'} aria-pressed={tool === x.id} aria-label={t(`ui.tool.${x.id}`)} title={`${t(`ui.tool.${x.id}`)} (${x.key})`} onClick={() => ui.setTool(x.id)} data-testid={`tool-${x.id}`}>
            <span aria-hidden>{x.icon}</span>
          </button>
        ))}
      </div>
      <div className="group">
        <button className="tool" disabled={!past} aria-label={t('ui.menu.undo')} title={`${t('ui.menu.undo')} (Ctrl+Z)`} onClick={undo}>
          ↶
        </button>
        <button className="tool" disabled={!future} aria-label={t('ui.menu.redo')} title={`${t('ui.menu.redo')} (Ctrl+Y)`} onClick={redo}>
          ↷
        </button>
        <button className="tool" aria-label={t('ui.menu.rotate')} title={`${t('ui.menu.rotate')} (R)`} onClick={rotateSelection}>
          ⟳
        </button>
      </div>
      <div className="group" title={t('ui.nextWire.title')}>
        <select aria-label={t('ui.nextWire.conductor')} value={nextWire.conductor} onChange={(e) => ui.setNextWire({ conductor: e.target.value as Conductor | 'auto' })}>
          {CONDUCTORS.map((c) => (
            <option key={c} value={c}>
              {c === 'auto' ? t('ui.nextWire.auto') : `${c} · ${t(`color.${c}`)}`}
            </option>
          ))}
        </select>
        <select aria-label={t('ui.nextWire.section')} value={nextWire.section} onChange={(e) => ui.setNextWire({ section: Number(e.target.value) })}>
          {SECTIONS.map((s) => (
            <option key={s} value={s}>
              {String(s).replace('.', lang === 'en' ? '.' : ',')} mm²
            </option>
          ))}
        </select>
      </div>
      <div className="group">
        <button className="tool" aria-label={t('ui.menu.zoomOut')} onClick={() => zoomBy(1 / 1.2)}>
          −
        </button>
        <span className="zoom">{Math.round(zoom * 100)}%</span>
        <button className="tool" aria-label={t('ui.menu.zoomIn')} onClick={() => zoomBy(1.2)}>
          +
        </button>
        <button className="tool" aria-label={t('ui.menu.fit')} title={t('ui.menu.fit')} onClick={() => fitView()}>
          ⛶
        </button>
      </div>
      <div className="group tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'logic'} className={tab === 'logic' ? 'tab active' : 'tab'} onClick={() => ui.setTab('logic')}>
          {t('ui.tab.logic')}
        </button>
        <button role="tab" aria-selected={tab === 'physical'} className={tab === 'physical' ? 'tab active' : 'tab'} onClick={() => ui.setTab('physical')}>
          {t('ui.tab.physical')}
        </button>
      </div>
      <div className="spacer" />
      <div className="group sim">
        <div className="seg" role="radiogroup" aria-label={t('ui.sim.mode')}>
          <button role="radio" aria-checked={sim.realtime} className={sim.realtime ? 'active' : ''} onClick={() => setSim({ realtime: true, running: true })} data-testid="mode-realtime">
            {t('ui.sim.realtime')}
          </button>
          <button role="radio" aria-checked={!sim.realtime} className={!sim.realtime ? 'active' : ''} onClick={() => setSim({ realtime: false, running: false })} data-testid="mode-step">
            {t('ui.sim.stepMode')}
          </button>
        </div>
        {sim.realtime ? (
          <button className="tool" aria-label={t(sim.running ? 'ui.sim.pause' : 'ui.sim.start')} title={`${t(sim.running ? 'ui.sim.pause' : 'ui.sim.start')} (F5)`} onClick={() => setSim({ running: !sim.running })} data-testid="play">
            {sim.running ? '❚❚' : '▶'}
          </button>
        ) : (
          <button className="tool" aria-label={t('ui.sim.step')} title={`${t('ui.sim.step')} (F6)`} onClick={() => stepOnce(0.1)} data-testid="step">
            ⏭
          </button>
        )}
        <select aria-label={t('ui.sim.speed')} value={sim.speed} onChange={(e) => setSim({ speed: Number(e.target.value) })} disabled={!sim.realtime}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              ×{String(s).replace('.', lang === 'en' ? '.' : ',')}
            </option>
          ))}
        </select>
        <span className="clock" aria-label={t('ui.sim.clock')} title={t('ui.sim.clockSeconds', { s: time.toFixed(2) })} data-testid="clock" data-seconds={time.toFixed(3)}>
          {fmtClock(time, !sim.realtime, lang)}
        </span>
      </div>
    </div>
  );
}
