/** Ficheiros `.faisca`, nomes IEC 81346, cor automática, biblioteca, formatação e worker. */
import { describe, expect, it } from 'vitest';
import {
  addDevice,
  addWire,
  autoName,
  createProject,
  createWorkerHandler,
  defaultRegistry,
  formatQuantity,
  parseProject,
  ProjectFileError,
  PROJECT_VERSION,
  serializeProject,
  Simulator,
  type WorkerResponse,
} from '../index';

function lightPoint() {
  const P = createProject({ name: 'Ponto de luz' });
  const G = addDevice(P, 'grid1ph', { x: 40, y: 40 });
  const Q = addDevice(P, 'mcb1pn', { x: 40, y: 160 });
  const S = addDevice(P, 'switch1', { x: 40, y: 300 });
  const H = addDevice(P, 'lampIncandescent', { x: 200, y: 300 });
  addWire(P, G, 'L', Q, '1');
  addWire(P, G, 'N', Q, '3');
  addWire(P, Q, '2', S, '1');
  addWire(P, S, '2', H, 'L');
  addWire(P, Q, '4', H, 'N');
  return { P, G, Q, S, H };
}

describe('ficheiro .faisca', () => {
  it('guardar e abrir devolve o mesmo projecto', () => {
    const { P } = lightPoint();
    const back = parseProject(serializeProject(P));
    expect(back).toEqual(P);
    expect(back).toMatchObject({ app: 'faisca', version: PROJECT_VERSION, domain: 'domestic', level: 'beginner', lang: 'pt', frequency: 50 });
  });

  it('o estado dos aparelhos (ligado, disparado) fica no ficheiro', () => {
    const { P, S } = lightPoint();
    const sim = new Simulator(P);
    sim.operate(S.id, 'switch_on');
    const back = parseProject(serializeProject(sim.project));
    expect(back.devices.find((d) => d.id === S.id)!.state.on).toBe(true);
    const sim2 = new Simulator(back);
    sim2.step(0.02);
    expect(sim2.measure('H1', 'meas.current')).toBeGreaterThan(0.25);
  });

  it('migra um projecto do protótipo (versão 0)', () => {
    const legacy = {
      app: 'faisca',
      ver: 1,
      name: 'Protótipo',
      f: 50,
      seq: 9,
      devices: [
        { id: 'd1', type: 'rede1', x: 0, y: 0, rot: 0, name: 'G1', p: { V: 230, esq: 'TT', Zs: 0.15 }, st: { on: true } },
        { id: 'd2', type: 'mcb2', x: 0, y: 0, rot: 0, name: 'Q1', p: { In: 16, curva: 'B', Icn: 6 }, st: { closed: true, trip: null } },
        { id: 'd3', type: 'tomada', x: 0, y: 0, rot: 0, name: 'X1', p: { app: 'chaleira', def: '5000' }, st: { on: true } },
        { id: 'd4', type: 'voltimetro', x: 0, y: 0, rot: 0, name: 'P1', p: {}, st: {} },
        { id: 'd5', type: 'nota', x: 0, y: 0, rot: 0, name: 'Nota', p: { texto: 'x' }, st: {} },
      ],
      wires: [
        { id: 'w6', a: { d: 'd1', t: 'L' }, b: { d: 'd2', t: '1' }, cond: 'L1', S: 2.5, len: 3, mat: 'Cu' },
        { id: 'w7', a: { d: 'd1', t: 'N' }, b: { d: 'd2', t: '3' }, cond: 'N', S: 2.5, len: 3, mat: 'Cu' },
        { id: 'w8', a: { d: 'd2', t: '2' }, b: { d: 'd3', t: 'L' }, cond: 'L1', S: 2.5, len: 3, mat: 'Cu' },
        { id: 'w9', a: { d: 'd2', t: '4' }, b: { d: 'd3', t: 'N' }, cond: 'N', S: 2.5, len: 3, mat: 'Cu' },
      ],
    };
    const P = parseProject(JSON.stringify(legacy));
    expect(P.version).toBe(PROJECT_VERSION);
    expect(P.devices.map((d) => d.type)).toEqual(['grid1ph', 'mcb1pn', 'socket', 'voltmeter']);
    expect(P.devices[0]!.params.earthing).toBe('TT');
    expect(P.devices[1]!.params).toMatchObject({ In: 16, curve: 'B' });
    expect(P.devices[2]!.params).toMatchObject({ appliance: 'kettle', defect: 'leak' });
    expect(P.wires[0]).toMatchObject({ a: { device: 'd1', terminal: 'L' }, conductor: 'L1', section: 2.5, length: 3, material: 'Cu' });
    const sim = new Simulator(P);
    sim.step(0.02);
    expect(sim.measure('X1', 'meas.current')).toBeGreaterThan(9);
  });

  it('erros de abertura usam chaves de tradução', () => {
    const err = (s: string) => {
      try {
        parseProject(s);
      } catch (e) {
        return (e as ProjectFileError).key;
      }
      return null;
    };
    expect(err('não é json')).toBe('file.error.not_faisca');
    expect(err('{"app":"outro"}')).toBe('file.error.not_faisca');
    expect(err(JSON.stringify({ ...createProject(), version: PROJECT_VERSION + 1 }))).toBe('file.error.newer_version');
    const { P } = lightPoint();
    P.wires[0]!.a.terminal = 'X';
    expect(err(serializeProject(P))).toBe('file.error.invalid');
    const P2 = createProject();
    P2.devices.push({ id: 'd1', type: 'flux-capacitor', name: 'Z1', x: 0, y: 0, rot: 0, params: {}, state: {} });
    expect(err(serializeProject(P2))).toBe('file.error.unknown_device');
  });
});

describe('edição do projecto', () => {
  it('nomes automáticos IEC 81346: Q1, Q2… por prefixo', () => {
    const P = createProject();
    expect(addDevice(P, 'mcb1pn').name).toBe('Q1');
    expect(addDevice(P, 'rcd2p').name).toBe('Q2');
    expect(addDevice(P, 'lampLed').name).toBe('H1');
    expect(addDevice(P, 'fuseGG').name).toBe('F1');
    expect(addDevice(P, 'socket').name).toBe('X1');
    addDevice(P, 'mcb1p', { name: 'Q7' });
    expect(autoName(P, 'mcb1p')).toBe('Q8');
  });

  it('a cor do cabo sai do tipo de terminal', () => {
    const { P } = lightPoint();
    expect(P.wires.map((w) => w.conductor)).toEqual(['L1', 'N', 'L1', 'L1', 'N']);
    const E = addDevice(P, 'earthElectrode');
    const X = addDevice(P, 'socket');
    expect(addWire(P, X, 'PE', E, 'PE').conductor).toBe('PE');
  });

  it('terminal inexistente é rejeitado', () => {
    const { P, Q, H } = lightPoint();
    expect(() => addWire(P, Q, '9', H, 'L')).toThrow();
  });
});

describe('biblioteca por área e nível', () => {
  it('Doméstica + Iniciante mostra só equipamentos «beginner»', () => {
    const lib = defaultRegistry.library('domestic', 'beginner');
    expect(lib.every((d) => d.level === 'beginner')).toBe(true);
    expect(lib.map((d) => d.type)).toContain('mcb1pn');
    expect(lib.map((d) => d.type)).not.toContain('rcbo');
  });
  it('Doméstica + Profissional mostra todos os domésticos', () => {
    const domestic = defaultRegistry.all().filter((d) => d.domain.includes('domestic'));
    expect(defaultRegistry.library('domestic', 'pro').map((d) => d.type).sort()).toEqual(domestic.map((d) => d.type).sort());
  });
  it('Doméstica não mostra equipamentos industriais', () => {
    expect(defaultRegistry.library('domestic', 'pro').map((d) => d.type)).not.toContain('contactor3p');
  });
  it('Industrial + Iniciante inclui os básicos domésticos', () => {
    const lib = defaultRegistry.library('industrial', 'beginner').map((d) => d.type);
    expect(lib).toContain('switch1');
    expect(lib).toContain('contactor3p');
    expect(lib).not.toContain('plc');
  });
  it('Industrial + Profissional mostra todos os industriais', () => {
    const lib = defaultRegistry.library('industrial', 'pro').map((d) => d.type);
    for (const d of defaultRegistry.all().filter((x) => x.domain.includes('industrial'))) expect(lib).toContain(d.type);
  });
  it('todos os equipamentos pertencem a uma área', () => {
    for (const d of defaultRegistry.all()) expect(d.domain.length, d.type).toBeGreaterThan(0);
  });
  it('a biblioteca tem pelo menos 20 equipamentos domésticos', () => {
    expect(defaultRegistry.all().filter((d) => d.domain.includes('domestic')).length).toBeGreaterThanOrEqual(20);
  });
});

describe('formatação por idioma', () => {
  it('229,8 V em PT e FR, 229.8 V em EN', () => {
    expect(formatQuantity(229.8, 'V', 'pt')).toBe('229,8 V');
    expect(formatQuantity(229.8, 'V', 'fr')).toBe('229,8 V');
    expect(formatQuantity(229.8, 'V', 'en')).toBe('229.8 V');
  });
  it('prefixos SI: mA, kA, kΩ', () => {
    expect(formatQuantity(0.261, 'A', 'pt')).toBe('261 mA');
    expect(formatQuantity(0.0458, 'A', 'en')).toBe('45.8 mA');
    expect(formatQuantity(13100, 'A', 'pt')).toBe('13,1 kA');
    expect(formatQuantity(5000, 'Ω', 'fr')).toBe('5 kΩ');
    expect(formatQuantity(2200, 'W', 'pt')).toBe('2200 W');
    expect(formatQuantity(6.2, '%', 'pt')).toBe('6,2 %');
  });
});

describe('protocolo do Web Worker', () => {
  it('carregar, avançar, operar e perguntar «porque não funciona?»', () => {
    const out: WorkerResponse[] = [];
    const handle = createWorkerHandler((m) => out.push(m));
    const { P, S } = lightPoint();
    handle({ type: 'load', project: P });
    expect(out.at(-1)!.type).toBe('snapshot');
    handle({ type: 'whyNot', device: 'H1' });
    expect(out.at(-1)).toMatchObject({ type: 'whyNot', diagnostic: { code: 'PATH_OPEN', values: { blocker: 'S1' } } });
    handle({ type: 'operate', device: S.id, action: 'switch_on' });
    handle({ type: 'step', dt: 0.1 });
    const snap = out.at(-1)!;
    expect(snap.type).toBe('snapshot');
    if (snap.type !== 'snapshot') return;
    const current = snap.measurements[P.devices.find((d) => d.name === 'H1')!.id]!.find((m) => m.key === 'meas.current')!.value;
    expect(current).toBeGreaterThan(0.25);
    expect(snap.devices.find((d) => d.id === S.id)!.state.on).toBe(true);
    handle({ type: 'operate', device: 'nada', action: 'x' });
    expect(out.at(-1)!.type).toBe('snapshot');
  });
});
