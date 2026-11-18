/**
 * Exemplos completos e a funcionar, abertos pelo assistente de arranque.
 * São escritos aqui contra o núcleo e gravados em JSON (`examples/*.faisca`) pelo
 * script `scripts/build-content.ts`. Os títulos e descrições estão nas traduções:
 * example.<id>.title e example.<id>.desc.
 */
import { addDevice, addWire, createProject, type Device, type Domain, type Level, type Project, type WireOptions } from '../sim-core/index';
import { dolStart, plcPump, reversing, starDelta, vfdMotor } from './examples-industrial';

export interface ExampleMeta {
  id: string;
  file: string;
  domain: Domain;
  level: Level;
}

type W = (a: Device, ta: string, b: Device, tb: string, o?: WireOptions) => void;

function make(domain: Domain, level: Level, build: (P: Project, w: W) => void): Project {
  const P = createProject({ domain, level });
  build(P, (a, ta, b, tb, o) => void addWire(P, a, ta, b, tb, { length: 3, ...o }));
  return P;
}

/** Ponto de luz simples: disjuntor, interruptor na fase e lâmpada. */
function lightPoint(): Project {
  return make('domestic', 'beginner', (P, w) => {
    const G = addDevice(P, 'grid1ph', { x: 40, y: 20 });
    const Q = addDevice(P, 'mcb1pn', { x: 60, y: 200, params: { In: 10 } });
    const S = addDevice(P, 'switch1', { x: 260, y: 200 });
    const H = addDevice(P, 'lampIncandescent', { x: 420, y: 200 });
    w(G, 'L', Q, '1', { length: 1 });
    w(G, 'N', Q, '3', { length: 1 });
    w(Q, '2', S, '1');
    w(S, '2', H, 'L', { length: 4 });
    w(Q, '4', H, 'N', { length: 6 });
  });
}

/** Comando de escada: dois comutadores comandam a mesma lâmpada. */
function stairLight(): Project {
  return make('domestic', 'beginner', (P, w) => {
    const G = addDevice(P, 'grid1ph', { x: 40, y: 20 });
    const Q = addDevice(P, 'mcb1pn', { x: 60, y: 200, params: { In: 10 } });
    const S1 = addDevice(P, 'stairSwitch', { x: 240, y: 200 });
    const S2 = addDevice(P, 'stairSwitch', { x: 400, y: 200, state: { pos: 2 } });
    const H = addDevice(P, 'lampIncandescent', { x: 560, y: 200 });
    w(G, 'L', Q, '1', { length: 1 });
    w(G, 'N', Q, '3', { length: 1 });
    w(Q, '2', S1, 'C');
    w(S1, '1', S2, '1', { length: 8 });
    w(S1, '2', S2, '2', { length: 8 });
    w(S2, 'C', H, 'L');
    w(Q, '4', H, 'N', { length: 10 });
  });
}

/** Quadro de habitação: interruptor geral, diferencial de 30 mA e três circuitos com terra. */
function houseBoard(): Project {
  return make('domestic', 'pro', (P, w) => {
    addDevice(P, 'frame', { x: 20, y: 160, params: { title: '', W: 820, H: 300 } });
    const G = addDevice(P, 'grid1ph', { x: 40, y: 20, params: { earthing: 'TT' } });
    const QG = addDevice(P, 'mainSwitch2p', { x: 60, y: 200, params: { In: 40 } });
    const RD = addDevice(P, 'rcd2p', { x: 60, y: 340, params: { IDn: 30 } });
    const BL = addDevice(P, 'busbar', { x: 200, y: 340, params: { bus: 'L' } });
    const BN = addDevice(P, 'busbar', { x: 200, y: 400, params: { bus: 'N' } });
    const PE = addDevice(P, 'busbar', { x: 560, y: 200, params: { bus: 'PE' } });
    const EA = addDevice(P, 'earthElectrode', { x: 900, y: 200, params: { Ra: 20 } });
    w(G, 'L', QG, '1', { section: 10, length: 1 });
    w(G, 'N', QG, '3', { section: 10, length: 1 });
    w(QG, '2', RD, '1', { section: 10, length: 0.5 });
    w(QG, '4', RD, '3', { section: 10, length: 0.5 });
    w(RD, '2', BL, 'E', { section: 10, length: 0.5 });
    w(RD, '4', BN, 'E', { section: 10, length: 0.5 });
    w(PE, 'E', EA, 'PE', { section: 16, length: 5 });
    const circuits: [string, number, number, string, Record<string, number | string>][] = [
      ['lampLed', 10, 1.5, 'S1', { P: 12 }],
      ['socket', 16, 2.5, 'S2', { appliance: 'microwave' }],
      ['heater', 20, 2.5, 'S3', { P: 2000 }],
    ];
    circuits.forEach(([type, In, section, slot, params], i) => {
      const x = 360 + i * 140;
      const Q = addDevice(P, 'mcb1pn', { x, y: 480, params: { In, curve: 'C' } });
      const L = addDevice(P, type, { x, y: 640, params });
      w(BL, slot, Q, '1', { section, length: 0.5 });
      w(BN, slot, Q, '3', { section, length: 0.5 });
      w(Q, '2', L, 'L', { section, length: 12 });
      w(Q, '4', L, 'N', { section, length: 12 });
      if (type !== 'lampLed') w(PE, slot, L, 'PE', { section, length: 12 });
    });
  });
}

/** Protecção de pessoas em TT: aparelho com defeito, pessoa a tocar e diferencial de 30 mA. */
function ttProtection(): Project {
  return make('domestic', 'pro', (P, w) => {
    const G = addDevice(P, 'grid1ph', { x: 40, y: 20, params: { earthing: 'TT' } });
    const RD = addDevice(P, 'rcd2p', { x: 60, y: 200, params: { IDn: 30 } });
    const Q = addDevice(P, 'mcb1pn', { x: 60, y: 360, params: { In: 16 } });
    const X = addDevice(P, 'socket', { x: 300, y: 380, params: { appliance: 'iron', defect: 'strong' }, state: { on: true } });
    const EA = addDevice(P, 'earthElectrode', { x: 480, y: 460, params: { Ra: 50 } });
    const Z = addDevice(P, 'person', { x: 300, y: 520, params: { floor: 'shoes' } });
    w(G, 'L', RD, '1', { length: 1 });
    w(G, 'N', RD, '3', { length: 1 });
    w(RD, '2', Q, '1', { length: 0.5 });
    w(RD, '4', Q, '3', { length: 0.5 });
    w(Q, '2', X, 'L', { section: 2.5, length: 8 });
    w(Q, '4', X, 'N', { section: 2.5, length: 8 });
    w(X, 'PE', EA, 'PE', { section: 2.5, length: 6 });
    w(Z, 'M', X, 'PE', { length: 1 });
  });
}

export function buildExamples(): { meta: ExampleMeta; project: Project }[] {
  const list: [string, () => Project][] = [
    ['light-point', lightPoint],
    ['stair-light', stairLight],
    ['house-board', houseBoard],
    ['tt-protection', ttProtection],
    ['dol-start', dolStart],
    ['reversing', reversing],
    ['star-delta', starDelta],
    ['vfd-motor', vfdMotor],
    ['plc-pump', plcPump],
  ];
  return list.map(([id, f]) => {
    const project = f();
    return { meta: { id, file: `${id}.faisca`, domain: project.domain, level: project.level }, project };
  });
}
