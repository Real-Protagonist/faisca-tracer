/** Geometria do esquema e operações do editor (sem browser). */
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, defaultRegistry, type Device } from '@faisca/sim-core';
import { estimateLength, layoutWires, polyLength, rotateLocal, routeWire, separateWires, snap, terminalPos, type Pt } from '../src/editor/geometry';
import {
  connect,
  copySelection,
  deleteSelection,
  groupInFrame,
  loadProject,
  paste,
  placeDevice,
  redo,
  rotateSelection,
  select,
  undo,
  useApp,
} from '../src/store';

describe('geometria', () => {
  it('a grelha é de 20 px', () => {
    expect(snap(29)).toBe(20);
    expect(snap(31)).toBe(40);
  });

  it('rodar 90° quatro vezes volta ao início', () => {
    let p = { x: 20, y: 0 };
    for (let i = 0; i < 4; i++) p = rotateLocal(p, 80, 100, 90);
    expect(p).toEqual({ x: 20, y: 0 });
  });

  it('o terminal de cima de um disjuntor rodado 90° fica à direita e aponta para fora', () => {
    const d: Device = { id: 'd', type: 'mcb1p', name: 'Q1', x: 0, y: 0, rot: 90, params: defaultRegistry.defaults('mcb1p'), state: {} };
    const p = terminalPos(defaultRegistry, d, '1')!;
    expect(p).toMatchObject({ nx: 1, ny: 0 });
    expect(p.x).toBeGreaterThan(30);
  });

  it('o cabo é ortogonal: só segmentos horizontais ou verticais', () => {
    const pts = routeWire({ x: 0, y: 0, nx: 0, ny: 1 }, { x: 200, y: 140, nx: 0, ny: -1 }, [{ x: 100, y: 60 }]);
    for (let i = 1; i < pts.length; i++) expect(pts[i]!.x === pts[i - 1]!.x || pts[i]!.y === pts[i - 1]!.y).toBe(true);
  });

  it('a rota automática não atravessa os aparelhos das pontas', () => {
    // Borne de baixo de um disjuntor (x 40..120, y 0..100) para o borne de cima de um interruptor à direita.
    const boxes = [{ x: 40, y: 0, w: 80, h: 100 }, { x: 200, y: 0, w: 60, h: 80 }];
    const pts = routeWire({ x: 60, y: 100, nx: 0, ny: 1 }, { x: 230, y: 0, nx: 0, ny: -1 }, [], boxes);
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1]!, pts[i]!];
      for (const r of boxes) {
        const inside = (p: { x: number; y: number }) => p.x > r.x + 2 && p.x < r.x + r.w - 2 && p.y > r.y + 2 && p.y < r.y + r.h - 2;
        expect(inside({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })).toBe(false);
      }
    }
  });

  it('comprimento estimado: 40 px = 1 m, arredondado a 0,5 m', () => {
    const pts = routeWire({ x: 0, y: 0, nx: 0, ny: 1 }, { x: 0, y: 200, nx: 0, ny: -1 });
    expect(polyLength(pts)).toBe(200);
    expect(estimateLength(pts)).toBe(5);
    expect(estimateLength([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toBe(0.5);
  });
});

/** Troços paralelos de cabos diferentes que se sobrepõem (comprimento comum, em px). */
function sharedLength(routes: Map<string, Pt[]>, skip: (a: string, b: string) => boolean = () => false): number {
  const segs: { id: string; a: Pt; b: Pt }[] = [];
  for (const [id, pts] of routes) for (let i = 1; i < pts.length; i++) segs.push({ id, a: pts[i - 1]!, b: pts[i]! });
  let total = 0;
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i]!;
      const t = segs[j]!;
      if (s.id === t.id || skip(s.id, t.id)) continue;
      const hs = s.a.y === s.b.y;
      const ht = t.a.y === t.b.y;
      if (hs !== ht) continue;
      if (hs && s.a.y !== t.a.y) continue;
      if (!hs && s.a.x !== t.a.x) continue;
      const [s0, s1] = hs ? [Math.min(s.a.x, s.b.x), Math.max(s.a.x, s.b.x)] : [Math.min(s.a.y, s.b.y), Math.max(s.a.y, s.b.y)];
      const [t0, t1] = hs ? [Math.min(t.a.x, t.b.x), Math.max(t.a.x, t.b.x)] : [Math.min(t.a.y, t.b.y), Math.max(t.a.y, t.b.y)];
      total += Math.max(0, Math.min(s1, t1) - Math.max(s0, t0));
    }
  return total;
}

/** Cruzamentos entre troços de cabos diferentes (um horizontal e um vertical que se atravessam). */
function crossings(routes: Map<string, Pt[]>): number {
  const segs: { id: string; a: Pt; b: Pt }[] = [];
  for (const [id, pts] of routes) for (let i = 1; i < pts.length; i++) segs.push({ id, a: pts[i - 1]!, b: pts[i]! });
  let n = 0;
  for (const h of segs.filter((s) => s.a.y === s.b.y))
    for (const v of segs.filter((s) => s.a.x === s.b.x && s.a.y !== s.b.y)) {
      if (h.id === v.id) continue;
      const x0 = Math.min(h.a.x, h.b.x);
      const x1 = Math.max(h.a.x, h.b.x);
      const y0 = Math.min(v.a.y, v.b.y);
      const y1 = Math.max(v.a.y, v.b.y);
      if (v.a.x > x0 && v.a.x < x1 && h.a.y > y0 && h.a.y < y1) n++;
    }
  return n;
}

const orthogonal = (pts: Pt[]) => pts.slice(1).every((p, i) => p.x === pts[i]!.x || p.y === pts[i]!.y);

describe('separação de cabos sobrepostos', () => {
  it('cabos que partilham um troço passam a faixas distintas, sem cruzamentos desnecessários', () => {
    const routes = new Map<string, Pt[]>([
      ['w1', [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }]],
      ['w2', [{ x: 40, y: 0 }, { x: 40, y: 100 }, { x: 240, y: 100 }, { x: 240, y: 200 }]],
    ]);
    expect(sharedLength(routes)).toBe(160);
    const out = separateWires(routes);
    expect(sharedLength(out)).toBe(0);
    expect(crossings(out)).toBe(0);
    for (const [id, pts] of out) {
      expect(orthogonal(pts)).toBe(true);
      expect(pts[0]).toEqual(routes.get(id)![0]);
      expect(pts[pts.length - 1]).toEqual(routes.get(id)!.at(-1));
    }
    // w1 desce em x = 200, dentro do troço de w2: fica por baixo para não o atravessar.
    const yOf = (pts: Pt[]) => pts.find((p, i) => i > 0 && p.y === pts[i - 1]!.y && p.y !== 0 && p.y !== 200)!.y;
    expect(yOf(out.get('w1')!)).toBeGreaterThan(yOf(out.get('w2')!));
  });

  it('as saídas dos terminais ficam no sítio; o cabo desloca-se depois delas', () => {
    const routes = new Map<string, Pt[]>([
      ['a', [{ x: 0, y: 0 }, { x: 300, y: 0 }]],
      ['b', [{ x: 100, y: 0 }, { x: 400, y: 0 }]],
    ]);
    const out = separateWires(routes);
    expect(sharedLength(out)).toBe(0);
    for (const [id, pts] of out) {
      const src = routes.get(id)!;
      expect(pts[0]).toEqual(src[0]);
      expect(pts[1]).toEqual({ x: src[0]!.x + 10, y: 0 }); // saída de 10 px a direito
      expect(pts.at(-2)).toEqual({ x: src[1]!.x - 10, y: 0 });
      expect(orthogonal(pts)).toBe(true);
    }
  });

  it('um feixe de três cabos fica em três faixas, 8 px entre si', () => {
    const route = (x: number): Pt[] => [{ x, y: 0 }, { x, y: 60 }, { x: x + 300, y: 60 }, { x: x + 300, y: 120 }];
    const out = separateWires(new Map([['a', route(0)], ['b', route(20)], ['c', route(40)]]));
    const lanes = [...out.values()].map((pts) => pts.find((p, i) => i > 0 && p.y === pts[i - 1]!.y)!.y).sort((x, y) => x - y);
    expect(lanes).toEqual([52, 60, 68]);
    expect(sharedLength(out)).toBe(0);
  });

  it('cabos que não se sobrepõem ficam iguais', () => {
    const routes = new Map<string, Pt[]>([
      ['a', [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }]],
      ['b', [{ x: 200, y: 0 }, { x: 200, y: 100 }, { x: 300, y: 100 }]],
    ]);
    expect(separateWires(routes)).toEqual(routes);
  });

  it('nos exemplos, nenhum par de cabos fica desenhado por cima um do outro', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(__dirname, '../../../packages/content/examples');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.fast'))) {
      const P = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      const routes = layoutWires(defaultRegistry, P);
      expect(routes.size, f).toBe(P.wires.length);
      // Cabos que saem do mesmo terminal partilham a saída; os outros não se sobrepõem (tolerância de 10 px).
      const ends = (id: string) => {
        const w = P.wires.find((x: { id: string }) => x.id === id);
        return [`${w.a.device}:${w.a.terminal}`, `${w.b.device}:${w.b.terminal}`];
      };
      const sameTerminal = (a: string, b: string) => ends(a).some((e) => ends(b).includes(e));
      expect(sharedLength(routes, sameTerminal), f).toBeLessThanOrEqual(10);
      for (const pts of routes.values()) expect(orthogonal(pts), f).toBe(true);
    }
  });
});

describe('editor', () => {
  beforeEach(() => loadProject(createProject()));
  const P = () => useApp.getState().project;

  it('colocar, ligar, desfazer e refazer', () => {
    const g = placeDevice('grid1ph', { x: 100, y: 60 });
    const h = placeDevice('lampIncandescent', { x: 100, y: 260 });
    expect(P().devices.map((d) => d.name)).toEqual(['G1', 'H1']);
    const w = connect({ device: g, terminal: 'L' }, { device: h, terminal: 'L' })!;
    expect(P().wires[0]).toMatchObject({ id: w, conductor: 'L1' });
    expect(P().wires[0]!.length).toBeGreaterThanOrEqual(0.5);
    expect(connect({ device: g, terminal: 'L' }, { device: h, terminal: 'L' })).toBeNull(); // cabo repetido
    undo();
    expect(P().wires).toHaveLength(0);
    redo();
    expect(P().wires).toHaveLength(1);
  });

  it('apagar um aparelho apaga os seus cabos', () => {
    const g = placeDevice('grid1ph', { x: 100, y: 60 });
    const h = placeDevice('lampIncandescent', { x: 100, y: 260 });
    connect({ device: g, terminal: 'N' }, { device: h, terminal: 'N' });
    select({ devices: [h] });
    deleteSelection();
    expect(P().devices).toHaveLength(1);
    expect(P().wires).toHaveLength(0);
  });

  it('copiar e colar leva só os cabos internos e dá nomes novos', () => {
    const g = placeDevice('grid1ph', { x: 100, y: 60 });
    const h = placeDevice('lampIncandescent', { x: 100, y: 260 });
    const x = placeDevice('socket', { x: 300, y: 260 });
    connect({ device: g, terminal: 'L' }, { device: h, terminal: 'L' });
    connect({ device: h, terminal: 'N' }, { device: x, terminal: 'N' });
    select({ devices: [h, x] });
    copySelection();
    paste();
    expect(P().devices.map((d) => d.name)).toEqual(['G1', 'H1', 'X1', 'H2', 'X2']);
    expect(P().wires).toHaveLength(3);
  });

  it('rodar e agrupar num quadro', () => {
    const h = placeDevice('lampIncandescent', { x: 100, y: 100 });
    rotateSelection();
    expect(P().devices[0]!.rot).toBe(90);
    select({ devices: [h] });
    groupInFrame();
    expect(P().devices[0]!.type).toBe('frame');
  });

  it('o histórico de desfazer aguenta centenas de passos', () => {
    for (let i = 0; i < 300; i++) placeDevice('junction', { x: 20 * (i % 30), y: 20 * Math.floor(i / 30) });
    for (let i = 0; i < 300; i++) undo();
    expect(P().devices).toHaveLength(0);
  });
});

describe('relógio da simulação', () => {
  it('formato de hora hh:mm:ss; décimas só no modo passo a passo', async () => {
    const { fmtClock } = await import('../src/format');
    expect(fmtClock(0, false, 'pt')).toBe('00:00:00');
    expect(fmtClock(3725.4, false, 'pt')).toBe('01:02:05');
    expect(fmtClock(3725.4, true, 'pt')).toBe('01:02:05,4');
    expect(fmtClock(3725.4, true, 'en')).toBe('01:02:05.4');
    // 0,1 + 0,2 não dá 0,30000000000000004 no ecrã.
    expect(fmtClock(0.1 + 0.2, true, 'fr')).toBe('00:00:00,3');
    expect(fmtClock(59.96, true, 'pt')).toBe('00:01:00,0');
  });
});
