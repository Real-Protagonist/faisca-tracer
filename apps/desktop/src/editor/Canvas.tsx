/** Área de trabalho 2D: grelha de 20 px, símbolos, cabos ortogonais, fluxo de corrente e falhas. */
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPE } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber, lookFrom, type Device, type Wire, type WireEnd } from '@faisca/sim-core';
import {
  beginDrag,
  connect,
  deleteItem,
  dragBend,
  dragSelection,
  endDrag,
  operate,
  placeDevice,
  registry,
  removeBend,
  select,
  setProbes,
  ui,
  useApp,
} from '../store';
import { bbox, endPos, layoutWires, midPoint, sizeOf, snap, terminalPos, toPath, type Pt } from './geometry';
import { SymbolView } from './SymbolView';

const TERM_COLOR: Record<string, string> = { L: '#8b5a2b', L1: '#8b5a2b', L2: '#222', L3: '#888', N: '#2f6fd6', PE: '#2e9e44', C: '#d33', 'DC+': '#d33', 'DC-': '#222', any: '#5b6676' };
export const WIRE_COLOR: Record<string, string> = { L1: '#8b5a2b', L2: '#262626', L3: '#8a8f96', N: '#2f6fd6', PE: '#2e9e44', C: '#d33a3a', 'DC+': '#d33a3a', 'DC-': '#262626' };

type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'move'; start: Pt }
  | { kind: 'rect'; start: Pt; cur: Pt }
  | { kind: 'wire'; from: WireEnd; moved: boolean }
  | { kind: 'bend'; wire: string; index: number }
  | { kind: 'press'; device: string; action: string };

const parseTerm = (s: string): WireEnd => {
  const i = s.lastIndexOf(':');
  return { device: s.slice(0, i), terminal: s.slice(i + 1) };
};

function hit(clientX: number, clientY: number) {
  const el = document.elementFromPoint(clientX, clientY) as Element | null;
  const term = el?.closest('[data-term]')?.getAttribute('data-term');
  const bend = el?.closest('[data-bend]')?.getAttribute('data-bend');
  const wire = el?.closest('[data-wire]')?.getAttribute('data-wire');
  const device = el?.closest('[data-device]')?.getAttribute('data-device');
  return { term: term ? parseTerm(term) : null, bend: bend ?? null, wire: wire ?? null, device: device ?? null };
}

export function Canvas() {
  const { t } = useTranslation();
  const svg = useRef<SVGSVGElement>(null);
  const project = useApp((s) => s.project);
  const selection = useApp((s) => s.selection);
  const tool = useApp((s) => s.tool);
  const placing = useApp((s) => s.placing);
  const wireStart = useApp((s) => s.wireStart);
  const view = useApp((s) => s.view);
  const snapshot = useApp((s) => s.snapshot);
  const probes = useApp((s) => s.probes);
  const lang = useApp((s) => s.lang);
  // Rotas de todos os cabos, com os troços sobrepostos afastados. Só mudam quando muda a geometria
  // (posição, rotação e largura dos aparelhos, pontas e pontos de curva dos cabos).
  const geomKey = JSON.stringify([project.devices.map((d) => [d.id, d.x, d.y, d.rot, d.params.W]), project.wires.map((w) => [w.id, w.a, w.b, w.points])]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const routes = useMemo(() => layoutWires(registry, project), [geomKey]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [mouse, setMouse] = useState<Pt>({ x: 0, y: 0 });
  const [space, setSpace] = useState(false);

  const toWorld = (cx: number, cy: number): Pt => {
    const r = svg.current!.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.zoom, y: (cy - r.top - view.y) / view.zoom };
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => e.code === 'Space' && !(e.target as HTMLElement).closest('input,select,textarea') && setSpace(true);
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpace(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // Falhas a contornar: erro vence aviso.
  const marks = useMemo(() => {
    const m = new Map<string, 'error' | 'warning'>();
    for (const d of snapshot?.diagnostics ?? []) {
      if (d.severity === 'info') continue;
      for (const tg of d.targets) if (m.get(tg.id) !== 'error') m.set(tg.id, d.severity);
    }
    return m;
  }, [snapshot]);

  const onPointerDown = (e: RPE<SVGSVGElement>) => {
    svg.current!.setPointerCapture(e.pointerId);
    const w = toWorld(e.clientX, e.clientY);
    if (e.button === 1 || (e.button === 0 && space)) {
      setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y });
      return;
    }
    if (e.button !== 0) return;
    if (placing) {
      placeDevice(placing, w);
      ui.setPlacing(null);
      return;
    }
    const h = hit(e.clientX, e.clientY);
    if (h.bend && tool === 'select') {
      const [wireId, idx] = h.bend.split('#');
      beginDrag();
      setDrag({ kind: 'bend', wire: wireId!, index: Number(idx) });
      return;
    }
    if (h.term) {
      if (tool === 'probe') {
        const { red, black } = useApp.getState().probes;
        if (!red || (red && black)) setProbes({ red: h.term, black: null });
        else setProbes({ black: h.term });
        return;
      }
      if (tool === 'select' || tool === 'wire') {
        if (wireStart) {
          connect(wireStart, h.term);
          return;
        }
        ui.setWireStart(h.term);
        setDrag({ kind: 'wire', from: h.term, moved: false });
        return;
      }
    }
    if (h.device) {
      const d = project.devices.find((x) => x.id === h.device)!;
      if (tool === 'operate') {
        const a = registry.require(d.type).actions?.(d).find((x) => !x.manualOnly);
        if (!a) return;
        if (a.momentary) {
          operate(d.id, a.id, 'down');
          setDrag({ kind: 'press', device: d.id, action: a.id });
        } else operate(d.id, a.id);
        return;
      }
      if (tool === 'delete') return deleteItem('device', d.id);
      if (tool === 'select') {
        if (!selection.devices.includes(d.id)) select({ devices: [d.id] }, e.shiftKey);
        else if (e.shiftKey) return select({ devices: [d.id] }, true);
        beginDrag();
        setDrag({ kind: 'move', start: w });
        return;
      }
    }
    if (h.wire) {
      if (tool === 'delete') return deleteItem('wire', h.wire);
      if (tool === 'clamp') return setProbes({ clamp: h.wire });
      if (tool === 'select') return select({ wires: [h.wire] }, e.shiftKey);
    }
    if (wireStart) ui.setWireStart(null);
    if (tool === 'select') {
      if (!e.shiftKey) select({});
      setDrag({ kind: 'rect', start: w, cur: w });
    }
  };

  const onPointerMove = (e: RPE<SVGSVGElement>) => {
    const w = toWorld(e.clientX, e.clientY);
    setMouse(w);
    if (!drag) return;
    if (drag.kind === 'pan') ui.setView({ x: drag.vx + e.clientX - drag.sx, y: drag.vy + e.clientY - drag.sy });
    else if (drag.kind === 'move') dragSelection(w.x - drag.start.x, w.y - drag.start.y);
    else if (drag.kind === 'rect') setDrag({ ...drag, cur: w });
    else if (drag.kind === 'bend') dragBend(drag.wire, drag.index, { x: snap(w.x), y: snap(w.y) });
    else if (drag.kind === 'wire' && !drag.moved) setDrag({ ...drag, moved: true });
  };

  const onPointerUp = (e: RPE<SVGSVGElement>) => {
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (d.kind === 'move' || d.kind === 'bend') endDrag();
    else if (d.kind === 'press') operate(d.device, d.action, 'up');
    else if (d.kind === 'wire' && d.moved) {
      const h = hit(e.clientX, e.clientY);
      if (h.term && !(h.term.device === d.from.device && h.term.terminal === d.from.terminal)) connect(d.from, h.term);
    } else if (d.kind === 'rect') {
      const x0 = Math.min(d.start.x, d.cur.x);
      const x1 = Math.max(d.start.x, d.cur.x);
      const y0 = Math.min(d.start.y, d.cur.y);
      const y1 = Math.max(d.start.y, d.cur.y);
      if (x1 - x0 < 4 && y1 - y0 < 4) return;
      const inside = project.devices.filter((dv) => {
        const b = bbox(registry, dv);
        return b.x + b.w / 2 >= x0 && b.x + b.w / 2 <= x1 && b.y + b.h / 2 >= y0 && b.y + b.h / 2 <= y1;
      });
      const ids = inside.map((x) => x.id);
      const wires = project.wires.filter((x) => ids.includes(x.a.device) && ids.includes(x.b.device)).map((x) => x.id);
      select({ devices: ids, wires }, e.shiftKey);
    }
  };

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const r = svg.current!.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const zoom = Math.min(3, Math.max(0.25, view.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    ui.setView({ zoom, x: mx - ((mx - view.x) * zoom) / view.zoom, y: my - ((my - view.y) * zoom) / view.zoom });
  };

  const onDrop = (e: React.DragEvent<SVGSVGElement>) => {
    const type = e.dataTransfer.getData('application/x-faisca-device');
    if (!type) return;
    e.preventDefault();
    placeDevice(type, toWorld(e.clientX, e.clientY));
  };

  const frames = project.devices.filter((d) => d.type === 'frame');
  const others = project.devices.filter((d) => d.type !== 'frame');
  const startPos = wireStart ? endPos(registry, project, wireStart) : null;
  const cursor = space || drag?.kind === 'pan' ? 'grab' : placing ? 'copy' : tool === 'wire' ? 'crosshair' : tool === 'delete' ? 'not-allowed' : tool === 'operate' ? 'pointer' : 'default';

  return (
    <svg
      ref={svg}
      className="canvas"
      role="application"
      aria-label={t('ui.canvas.label')}
      data-testid="canvas"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onDoubleClick={(e) => {
        const h = hit(e.clientX, e.clientY);
        if (h.bend) {
          const [wireId, idx] = h.bend.split('#');
          removeBend(wireId!, Number(idx));
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <defs>
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" className="grid-line" />
        </pattern>
      </defs>
      <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
        <rect x={-10000} y={-10000} width={20000} height={20000} fill="url(#grid)" />
        {frames.map((d) => (
          <DeviceView key={d.id} d={d} selected={selection.devices.includes(d.id)} mark={marks.get(d.id)} lang={lang} />
        ))}
        {project.wires.map((w) => (
          <WireView key={w.id} w={w} pts={routes.get(w.id)} selected={selection.wires.includes(w.id)} single={selection.wires.length === 1 && selection.devices.length === 0} mark={marks.get(w.id)} current={snapshot?.wires[w.id] ?? 0} clamp={probes.clamp === w.id} />
        ))}
        {others.map((d) => (
          <DeviceView key={d.id} d={d} selected={selection.devices.includes(d.id)} mark={marks.get(d.id)} lang={lang} />
        ))}
        <Probe end={probes.red} cls="probe-red" />
        <Probe end={probes.black} cls="probe-black" />
        {startPos && <path className="wire-preview" d={`M${startPos.x} ${startPos.y} L${mouse.x} ${mouse.y}`} />}
        {drag?.kind === 'rect' && (
          <rect className="sel-rect" x={Math.min(drag.start.x, drag.cur.x)} y={Math.min(drag.start.y, drag.cur.y)} width={Math.abs(drag.cur.x - drag.start.x)} height={Math.abs(drag.cur.y - drag.start.y)} />
        )}
        {placing && <Ghost type={placing} at={mouse} />}
      </g>
    </svg>
  );
}

function Probe({ end, cls }: { end: WireEnd | null; cls: string }) {
  const project = useApp((s) => s.project);
  const p = end ? endPos(registry, project, end) : null;
  return p ? <circle className={cls} cx={p.x} cy={p.y} r={7} /> : null;
}

function Ghost({ type, at }: { type: string; at: Pt }) {
  const def = registry.require(type);
  const fake: Device = { id: 'ghost', type, name: '', x: 0, y: 0, rot: 0, params: registry.defaults(type), state: def.initialState() };
  const { w, h } = sizeOf(def, fake);
  return (
    <g className="ghost" transform={`translate(${snap(at.x - w / 2)} ${snap(at.y - h / 2)})`}>
      <SymbolView prims={def.symbol?.(fake, lookFrom([]), String) ?? []} />
    </g>
  );
}

function DeviceView({ d, selected, mark, lang }: { d: Device; selected: boolean; mark?: 'error' | 'warning'; lang: 'pt' | 'en' | 'fr' }) {
  const { t } = useTranslation();
  const ms = useApp((s) => s.snapshot?.measurements[d.id]);
  const def = registry.get(d.type);
  if (!def) return null;
  const { w, h } = sizeOf(def, d);
  const look = lookFrom(ms ?? []);
  const prims = def.symbol?.(d, look, (v) => formatNumber(v, lang, 2)) ?? [];
  const b = bbox(registry, d);
  const cls = ['device', selected && 'selected', mark && `diag-${mark}`, def.annotation && 'annotation'].filter(Boolean).join(' ');
  return (
    <g className={cls} data-device={d.id} data-type={d.type} data-state={look.state} role="button" aria-label={`${d.name} — ${t(`device.${d.type}.name`)}`}>
      <rect className="hit" x={b.x - 4} y={b.y - 4} width={b.w + 8} height={b.h + 8} rx={4} />
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
          <g key={tm.id} className="term" data-term={`${d.id}:${tm.id}`}>
            <circle cx={p.x} cy={p.y} r={9} className="term-hit" />
            <circle cx={p.x} cy={p.y} r={3.5} style={{ fill: TERM_COLOR[tm.kind] }} />
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
}

function WireView({ w, pts, selected, single, mark, current, clamp }: { w: Wire; pts?: Pt[]; selected: boolean; single: boolean; mark?: 'error' | 'warning'; current: number; clamp: boolean }) {
  if (!pts) return null;
  const d = toPath(pts);
  const I = Math.abs(current);
  // A animação acelera com a corrente (escala logarítmica); só serve para mostrar o sentido e a ordem de grandeza.
  const dur = I > 1e-3 ? Math.max(0.15, 2.2 - 0.55 * Math.log10(1 + I * 100)) : 0;
  const mid = midPoint(pts);
  const cls = ['wire', selected && 'selected', mark && `diag-${mark}`, w.fault?.cut && 'cut'].filter(Boolean).join(' ');
  return (
    <g className={cls} data-wire={w.id} data-current={I.toFixed(4)}>
      <path className="wire-hit" d={d} />
      {selected && <path className="wire-halo" d={d} />}
      <path className="wire-line" d={d} style={{ stroke: WIRE_COLOR[w.conductor] }} />
      {w.conductor === 'PE' && <path className="wire-pe" d={d} />}
      {dur > 0 && !w.fault?.cut && <path className={current < 0 ? 'flow rev' : 'flow'} d={d} style={{ animationDuration: `${dur}s` }} />}
      {w.fault?.cut && <path className="cut-mark" d={`M${mid.x - 6} ${mid.y - 6} L${mid.x + 6} ${mid.y + 6} M${mid.x + 6} ${mid.y - 6} L${mid.x - 6} ${mid.y + 6}`} />}
      {clamp && <circle className="clamp" cx={mid.x} cy={mid.y} r={10} />}
      {selected && single && (
        <>
          {(w.points ?? []).map((p, i) => (
            <circle key={i} className="bend" data-bend={`${w.id}#${i}`} cx={p.x} cy={p.y} r={5} />
          ))}
          {!(w.points ?? []).length && <circle className="bend add" data-bend={`${w.id}#-1`} cx={snap(mid.x)} cy={snap(mid.y)} r={5} />}
        </>
      )}
    </g>
  );
}
