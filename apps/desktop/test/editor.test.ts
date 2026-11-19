/** Geometria do esquema e operações do editor (sem browser). */
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, defaultRegistry, type Device } from '@faisca/sim-core';
import { estimateLength, polyLength, rotateLocal, routeWire, snap, terminalPos } from '../src/editor/geometry';
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
