/** Multímetro flutuante (pontas vermelha e preta) e pinça amperimétrica. */
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatQuantity } from '@faisca/sim-core';
import { setProbes, ui, useApp } from '../store';

export function Meter() {
  const { t } = useTranslation();
  const tool = useApp((s) => s.tool);
  const probes = useApp((s) => s.probes);
  const probe = useApp((s) => s.snapshot?.probe);
  const lang = useApp((s) => s.lang);
  const project = useApp((s) => s.project);
  const [pos, setPos] = useState({ x: 16, y: 16 });
  const drag = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null);
  const active = tool === 'probe' || tool === 'clamp' || probes.red || probes.clamp;
  if (!active) return null;
  const name = (id?: string) => project.devices.find((d) => d.id === id)?.name ?? '';
  const clampWire = project.wires.find((w) => w.id === probes.clamp);
  return (
    <div
      className="meter"
      style={{ right: pos.x, top: pos.y }}
      role="status"
      aria-live="polite"
      aria-label={t('ui.meter.title')}
      data-testid="meter"
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { sx: e.clientX, sy: e.clientY, ...pos };
      }}
      onPointerMove={(e) => drag.current && setPos({ x: drag.current.x - (e.clientX - drag.current.sx), y: drag.current.y + (e.clientY - drag.current.sy) })}
      onPointerUp={() => (drag.current = null)}
    >
      <div className="meter-head">
        <span>{t('ui.meter.title')}</span>
        <button
          className="link"
          aria-label={t('ui.meter.clear')}
          onClick={() => {
            setProbes({ red: null, black: null, clamp: null });
            ui.setTool('select');
          }}
        >
          ✕
        </button>
      </div>
      <div className="lcd" data-testid="meter-voltage">
        {probe?.voltage != null ? formatQuantity(probe.voltage, 'V', lang) : '— V'}
        <small>{probe?.voltage != null ? (probe.ac ? '~' : '⎓') : ''}</small>
      </div>
      <div className="leads">
        <span className="red">● {probes.red ? `${name(probes.red.device)}:${probes.red.terminal}` : t('ui.meter.pickRed')}</span>
        <span className="black">● {probes.black ? `${name(probes.black.device)}:${probes.black.terminal}` : probes.red ? t('ui.meter.pickBlack') : ''}</span>
      </div>
      <div className="lcd small" data-testid="meter-current">
        {probe?.current != null ? formatQuantity(probe.current, 'A', lang) : '— A'}
      </div>
      <div className="leads">
        <span>◎ {clampWire ? `${name(clampWire.a.device)} → ${name(clampWire.b.device)}` : t('ui.meter.pickWire')}</span>
      </div>
    </div>
  );
}
