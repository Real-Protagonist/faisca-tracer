/**
 * Exercícios incluídos (tabela do prompt: 4 + 4 domésticos, 3 + 5 industriais).
 * Cada um é escrito como a solução completa; o projecto inicial é a solução sem os cabos que o
 * aluno tem de ligar (e, às vezes, com um parâmetro a corrigir). Os textos estão nas traduções:
 * exercise.<id>.title, exercise.<id>.statement e exercise.<id>.obj.<objectivo>.
 * Gravados em `exercises/*.faisca-ex` (com selo) por `scripts/build-content.ts`.
 */
import { addDevice, addWire, createProject, type Device, type Domain, type Exercise, type Level, type Objective, type Project, type Rule, type Step, type Wire, type WireOptions } from '../sim-core/index';

type W = (a: Device, ta: string, b: Device, tb: string, o?: WireOptions) => Wire;
type Three = [string, string, string];

interface Spec {
  id: string;
  domain: Domain;
  level: Level;
  build: (P: Project, w: W, a: (type: string, name: string, x: number, y: number, params?: Record<string, unknown>, state?: Record<string, unknown>) => Device) => void;
  /** Cabos que ficam no projecto inicial (por omissão, nenhum). */
  keep?: (w: Wire, P: Project) => boolean;
  /** Alterações ao projecto inicial (parâmetros a corrigir pelo aluno). */
  adjust?: (P: Project) => void;
  objectives: [string, Rule, Step[]?][];
}

const L123: Three = ['L1', 'L2', 'L3'];
const IN3: Three = ['1', '3', '5'];
const OUT3: Three = ['2', '4', '6'];
const MOT: Three = ['U1', 'V1', 'W1'];
const w3 = (w: W, a: Device, ta: Three, b: Device, tb: Three, o?: WireOptions) => ta.forEach((t, k) => w(a, t, b, tb[k]!, o));
const PWR: WireOptions = { section: 2.5, length: 1 };
const CMD: WireOptions = { section: 1.5, length: 1 };

const state = (device: string, is: string | string[], key?: string): Rule => ({ type: 'state', device, is, ...(key ? { key } : {}) });
const running = (device: string): Rule => state(device, 'running');
const notRunning = (device: string): Rule => ({ type: 'not', rule: running(device) });
const all = (...rules: Rule[]): Rule => ({ type: 'all', rules });
const closed = (device: string, value: boolean): Rule => ({ type: 'deviceState', device, key: 'closed', value });
const NO_PROBLEMS: Rule = { type: 'noDiag' };
const then = (first: Rule, steps: Step[], rule: Rule): Rule => ({ type: 'then', first, steps, rule });
const press = (s: string, hold = 0.3): Step => ({ press: s, hold });
const run = (t: number): Step => ({ run: t });
const op = (o: string, action: string, phase?: 'down' | 'up'): Step => ({ op: o, action, ...(phase ? { phase } : {}) });

/** Wires da potência de um arranque directo (G → Q → K → F → M e PE). */
function dolPower(w: W, G: Device, Q: Device, K: Device, F: Device, M: Device) {
  w3(w, G, L123, Q, IN3, PWR);
  w3(w, Q, OUT3, K, IN3, PWR);
  w3(w, K, OUT3, F, IN3, PWR);
  w3(w, F, OUT3, M, MOT, { section: 2.5, length: 6 });
  w(G, 'PE', M, 'PE', { section: 2.5, length: 6 });
}
/** Comando com auto-retenção: Q-2 → F 95-96 → S0 → S1 (‖ K 13-14) → K A1; A2 → N. */
function dolControl(w: W, G: Device, Q: Device, K: Device, F: Device, S0: Device, S1: Device) {
  w(Q, '2', F, '95', CMD);
  w(F, '96', S0, '11', CMD);
  w(S0, '12', S1, '13', CMD);
  w(S1, '13', K, '13', CMD);
  w(S1, '14', K, '14', CMD);
  w(S1, '14', K, 'A1', CMD);
  w(K, 'A2', G, 'N', CMD);
}
const isPower = (w: Wire) => w.section >= 2.5;

const SPECS: Spec[] = [
  /* ---------------- Doméstica · Iniciante ---------------- */
  {
    id: 'dom-light-point',
    domain: 'domestic',
    level: 'beginner',
    build: (P, w, a) => {
      const G = a('grid1ph', 'G1', 40, 20);
      const Q = a('mcb1pn', 'Q1', 60, 200, { In: 10 });
      const S = a('switch1', 'S1', 260, 200);
      const H = a('lampIncandescent', 'H1', 420, 200);
      w(G, 'L', Q, '1');
      w(G, 'N', Q, '3');
      w(Q, '2', S, '1');
      w(S, '2', H, 'L');
      w(Q, '4', H, 'N');
    },
    objectives: [
      ['lit', state('H1', 'lit'), [op('S1', 'switch_on')]],
      ['off', then(state('H1', 'lit'), [op('S1', 'switch_off')], state('H1', 'unlit')), [op('S1', 'switch_on')]],
      ['phase', all(state('H1', 'lit'), { type: 'noDiag', codes: ['SWITCH_ON_NEUTRAL'] }), [op('S1', 'switch_on')]],
      ['clean', NO_PROBLEMS],
    ],
  },
  {
    id: 'dom-stair',
    domain: 'domestic',
    level: 'beginner',
    build: (P, w, a) => {
      const G = a('grid1ph', 'G1', 40, 20);
      const Q = a('mcb1pn', 'Q1', 60, 200, { In: 10 });
      const S1 = a('stairSwitch', 'S1', 240, 200);
      const S2 = a('stairSwitch', 'S2', 400, 200);
      const H = a('lampIncandescent', 'H1', 560, 200);
      w(G, 'L', Q, '1');
      w(G, 'N', Q, '3');
      w(Q, '2', S1, 'C');
      w(S1, '1', S2, '1', { length: 8 });
      w(S1, '2', S2, '2', { length: 8 });
      w(S2, 'C', H, 'L');
      w(Q, '4', H, 'N', { length: 10 });
    },
    objectives: [
      ['toggle', { type: 'toggles', device: 'H1', steps: [op('S1', 'toggle'), op('S2', 'toggle')] }],
      ['phase', all({ type: 'toggles', device: 'H1', steps: [op('S1', 'toggle'), op('S2', 'toggle')] }, { type: 'noDiag', codes: ['SWITCH_ON_NEUTRAL'] })],
      ['clean', NO_PROBLEMS],
    ],
  },
  {
    id: 'dom-sockets',
    domain: 'domestic',
    level: 'beginner',
    build: (P, w, a) => {
      const G = a('grid1ph', 'G1', 40, 20, { earthing: 'TT' });
      const R = a('rcd2p', 'Q1', 60, 200, { IDn: 30 });
      const Q = a('mcb1pn', 'Q2', 60, 360, { In: 16 });
      const X1 = a('socket', 'X1', 300, 380, { appliance: 'laptop' });
      const X2 = a('socket', 'X2', 460, 380, { appliance: 'kettle' });
      const E = a('earthElectrode', 'E1', 640, 420, { Ra: 20 });
      w(G, 'L', R, '1');
      w(G, 'N', R, '3');
      w(R, '2', Q, '1');
      w(R, '4', Q, '3');
      for (const X of [X1, X2]) {
        w(Q, '2', X, 'L', { section: 2.5, length: 6 });
        w(Q, '4', X, 'N', { section: 2.5, length: 6 });
        w(X, 'PE', E, 'PE', { section: 2.5, length: 6 });
      }
    },
    objectives: [
      ['x1', { type: 'working', device: 'X1' }],
      ['x2', { type: 'working', device: 'X2' }],
      ['pe', { type: 'noDiag', codes: ['PE_MISSING'] }],
      ['rcd', { type: 'deviceState', device: 'Q1', key: 'trip', value: 'residual' }, [{ set: 'X1', param: 'defect', value: 'strong' }, run(0.3)]],
    ],
  },
  {
    id: 'dom-bell',
    domain: 'domestic',
    level: 'beginner',
    build: (P, w, a) => {
      const G = a('grid1ph', 'G1', 40, 20);
      const Q = a('mcb1pn', 'Q1', 60, 200, { In: 6 });
      const T = a('transformer1ph', 'T1', 240, 200, { V1: 230, V2: 12, S: 16 });
      const S = a('pushButton', 'S1', 420, 200);
      const B = a('bell', 'B1', 560, 220, { Vn: 12 });
      w(G, 'L', Q, '1');
      w(G, 'N', Q, '3');
      w(Q, '2', T, 'P1');
      w(Q, '4', T, 'P2');
      w(T, 'S1', S, '1', { section: 1, length: 5 });
      w(S, '2', B, '1', { section: 1, length: 5 });
      w(B, '2', T, 'S2', { section: 1, length: 8 });
    },
    objectives: [
      ['rings', state('B1', 'ringing'), [op('S1', 'press', 'down'), run(0.5)]],
      ['silent', then(state('B1', 'ringing'), [op('S1', 'press', 'up'), run(0.3)], state('B1', 'silent')), [op('S1', 'press', 'down'), run(0.5)]],
      ['voltage', all(state('B1', 'ringing'), { type: 'noDiag', codes: ['WRONG_VOLTAGE'] }), [op('S1', 'press', 'down'), run(1)]],
    ],
  },

  /* ---------------- Doméstica · Profissional ---------------- */
  {
    id: 'dom-board',
    domain: 'domestic',
    level: 'pro',
    build: (P, w, a) => {
      const G = a('grid1ph', 'G1', 40, 20, { earthing: 'TT' });
      const QG = a('mainSwitch2p', 'Q0', 60, 200, { In: 40 });
      const RD = a('rcd2p', 'Q1', 60, 340, { IDn: 30, In: 40 });
      const BL = a('busbar', 'X0', 220, 340, { bus: 'L' });
      const BN = a('busbar', 'X9', 220, 420, { bus: 'N' });
      const BP = a('busbar', 'X8', 560, 200, { bus: 'PE' });
      const E0 = a('earthElectrode', 'E0', 860, 200, { Ra: 20 });
      w(G, 'L', QG, '1', { section: 10, length: 1 });
      w(G, 'N', QG, '3', { section: 10, length: 1 });
      w(QG, '2', RD, '1', { section: 10, length: 0.5 });
      w(QG, '4', RD, '3', { section: 10, length: 0.5 });
      w(RD, '2', BL, 'E', { section: 10, length: 0.5 });
      w(RD, '4', BN, 'E', { section: 10, length: 0.5 });
      w(BP, 'E', E0, 'PE', { section: 16, length: 5 });
      const circuits: [string, string, number, number, Record<string, unknown>, boolean][] = [
        ['lampLed', 'H1', 10, 1.5, { P: 12 }, false],
        ['socket', 'X1', 16, 2.5, { appliance: 'laptop' }, true],
        ['socket', 'X2', 16, 2.5, { appliance: 'microwave' }, true],
        ['heater', 'E1', 16, 2.5, { P: 2000 }, true],
        ['motor1ph', 'M1', 16, 2.5, { Pm: 0.75 }, true],
        ['lampIncandescent', 'H2', 10, 1.5, { P: 100 }, false],
      ];
      circuits.forEach(([type, name, In, section, params, pe], i) => {
        const Q = a('mcb1pn', `Q${i + 2}`, 360 + i * 140, 520, { In, curve: 'C' });
        const L = a(type, name, 360 + i * 140, 700, params);
        w(BL, `S${i + 1}`, Q, '1', { section, length: 0.5 });
        w(BN, `S${i + 1}`, Q, '3', { section, length: 0.5 });
        w(Q, '2', L, 'L', { section, length: 12 });
        w(Q, '4', L, 'N', { section, length: 12 });
        if (pe) w(BP, `S${i}`, L, 'PE', { section, length: 12 });
      });
    },
    keep: (w, P) => ['G1', 'Q0', 'X8', 'E0'].includes(P.devices.find((d) => d.id === w.a.device)?.name ?? '') && w.section >= 10,
    objectives: [
      ['all', all(...['H1', 'X1', 'X2', 'E1', 'M1', 'H2'].map((device): Rule => ({ type: 'working', device }))), [run(2)]],
      ['rcd', { type: 'deviceState', device: 'Q1', key: 'trip', value: 'residual' }, [{ set: 'X2', param: 'defect', value: 'strong' }, run(0.3)]],
      ['ib', { type: 'compliance', rule: 'ib_in_iz' }, [run(2)]],
      ['clean', NO_PROBLEMS, [run(2)]],
    ],
  },
  {
    id: 'dom-tt',
    domain: 'domestic',
    level: 'pro',
    build: (P, w, a) => {
      const G = a('grid1ph', 'G1', 40, 20, { earthing: 'TT' });
      const RD = a('rcd2p', 'Q1', 60, 200, { IDn: 30 });
      const Q = a('mcb1pn', 'Q2', 60, 360, { In: 16 });
      const X = a('socket', 'X1', 300, 380, { appliance: 'iron', defect: 'strong' }, { on: true });
      const E = a('earthElectrode', 'E1', 480, 460, { Ra: 200 });
      const Z = a('person', 'Z1', 300, 520, { floor: 'shoes' });
      w(G, 'L', RD, '1');
      w(G, 'N', RD, '3');
      w(RD, '2', Q, '1', { length: 0.5 });
      w(RD, '4', Q, '3', { length: 0.5 });
      w(Q, '2', X, 'L', { section: 2.5, length: 8 });
      w(Q, '4', X, 'N', { section: 2.5, length: 8 });
      w(X, 'PE', E, 'PE', { section: 2.5, length: 6 });
      w(Z, 'M', X, 'PE');
    },
    keep: (w, P) => !(P.devices.find((d) => d.id === w.a.device)?.name === 'X1' && w.a.terminal === 'PE' && w.b.terminal === 'PE'),
    adjust: (P) => void (P.devices.find((d) => d.name === 'Q1')!.params.IDn = 300),
    objectives: [
      ['safe', { type: 'noDiag', codes: ['BODY_CURRENT'] }, [run(0.5)]],
      ['trip', { type: 'deviceState', device: 'Q1', key: 'trip', value: 'residual' }, [run(0.5)]],
      ['touch', { type: 'compliance', rule: 'tt_touch' }],
    ],
  },
  {
    id: 'dom-cable',
    domain: 'domestic',
    level: 'pro',
    build: (P, w, a) => {
      const G = a('grid1ph', 'G1', 40, 20, { earthing: 'TN-S', Zs: 0.15 });
      const Q = a('mcb1pn', 'Q1', 60, 200, { In: 25 });
      const E = a('heater', 'E1', 360, 220, { P: 4500 });
      w(G, 'L', Q, '1', { section: 6, length: 1 });
      w(G, 'N', Q, '3', { section: 6, length: 1 });
      w(Q, '2', E, 'L', { section: 4, length: 40 });
      w(Q, '4', E, 'N', { section: 4, length: 40 });
      w(G, 'PE', E, 'PE', { section: 4, length: 40 });
    },
    keep: () => true,
    adjust: (P) => P.wires.filter((w) => w.length === 40).forEach((w) => (w.section = 1.5)),
    objectives: [
      ['works', { type: 'working', device: 'E1' }],
      ['protected', { type: 'noDiag', codes: ['CABLE_UNPROTECTED'] }],
      ['drop', { type: 'compliance', rule: 'voltage_drop' }],
      ['overload', { type: 'noDiag', codes: ['CABLE_OVERLOAD'] }, [run(5)]],
    ],
  },
  {
    id: 'dom-solar',
    domain: 'domestic',
    level: 'pro',
    build: (P, w, a) => {
      const PV = a('solarPanel', 'G1', 40, 20, { Voc: 22, Isc: 6, irr: 100 });
      const B = a('battery', 'G2', 260, 20, { V: 12, Ah: 100, soc0: 60 });
      const F = a('fuseGG', 'F1', 280, 200, { In: 10 });
      const S = a('switch1', 'S1', 440, 200);
      const H = a('lampIncandescent', 'H1', 600, 200, { Vn: 12, P: 21 });
      w(PV, 'P', B, 'P', { section: 4, length: 3 });
      w(PV, 'M', B, 'M', { section: 4, length: 3 });
      w(B, 'P', F, '1', { section: 2.5, length: 1 });
      w(F, '2', S, '1', { section: 2.5, length: 3 });
      w(S, '2', H, 'L', { section: 2.5, length: 3 });
      w(H, 'N', B, 'M', { section: 2.5, length: 5 });
    },
    objectives: [
      ['night', state('H1', 'lit'), [{ set: 'G1', param: 'irr', value: 0 }, op('S1', 'switch_on')]],
      ['charging', state('G2', 'charging', 'meas.mode'), [run(1)]],
      ['fuse', all(state('H1', 'lit'), { type: 'noDiag', codes: ['CABLE_UNPROTECTED'] }), [op('S1', 'switch_on')]],
      ['clean', NO_PROBLEMS, [op('S1', 'switch_on'), run(1)]],
    ],
  },

  /* ---------------- Industrial · Iniciante ---------------- */
  {
    id: 'ind-dol',
    domain: 'industrial',
    level: 'beginner',
    build: (P, w, a) => {
      const G = a('grid3ph', 'G1', 40, 20);
      const Q = a('motorBreaker', 'Q1', 60, 160, { Ir: 8 });
      const K = a('contactor3p', 'K1', 20, 320);
      const F = a('thermalRelay', 'F1', 60, 500, { Ir: 7.7 });
      const M = a('motor3ph', 'M1', 60, 660, { Pm: 4, load: 80 });
      const S0 = a('buttonNC', 'S0', 520, 160);
      const S1 = a('buttonNO', 'S1', 520, 320);
      dolPower(w, G, Q, K, F, M);
      dolControl(w, G, Q, K, F, S0, S1);
    },
    keep: isPower,
    objectives: [
      ['hold', running('M1'), [press('S1'), run(3)]],
      ['stop', then(running('M1'), [press('S0'), run(6)], notRunning('M1')), [press('S1'), run(3)]],
      ['relay', then(running('M1'), [op('F1', 'test'), run(6)], notRunning('M1')), [press('S1'), run(3)]],
      ['clean', NO_PROBLEMS],
    ],
  },
  {
    id: 'ind-signal',
    domain: 'industrial',
    level: 'beginner',
    build: (P, w, a) => {
      const G = a('grid3ph', 'G1', 40, 20);
      const Q = a('motorBreaker', 'Q1', 60, 160, { Ir: 8 });
      const K = a('contactor3p', 'K1', 20, 320);
      const F = a('thermalRelay', 'F1', 60, 500, { Ir: 7.7 });
      const M = a('motor3ph', 'M1', 60, 660, { Pm: 4, load: 80 });
      const S0 = a('buttonNC', 'S0', 520, 160);
      const S1 = a('buttonNO', 'S1', 520, 320);
      const H1 = a('pilotLight', 'H1', 680, 320, { color: 'green' });
      const H2 = a('pilotLight', 'H2', 800, 320, { color: 'red' });
      dolPower(w, G, Q, K, F, M);
      dolControl(w, G, Q, K, F, S0, S1);
      w(K, 'A1', H1, 'X1', CMD);
      w(H1, 'X2', G, 'N', CMD);
      w(Q, '2', F, '97', CMD);
      w(F, '98', H2, 'X1', CMD);
      w(H2, 'X2', G, 'N', CMD);
    },
    keep: (w, P) => !['H1', 'H2'].some((n) => [w.a.device, w.b.device].includes(P.devices.find((d) => d.name === n)!.id)) && w.b.terminal !== '97',
    objectives: [
      ['idle', then(state('H1', 'lit'), [press('S0'), run(6)], all(state('H1', 'unlit'), state('H2', 'unlit'))), [press('S1'), run(3)]],
      ['run', all(state('H1', 'lit'), state('H2', 'unlit')), [press('S1'), run(3)]],
      ['trip', all(state('H1', 'unlit'), state('H2', 'lit')), [press('S1'), run(3), op('F1', 'test'), run(1)]],
    ],
  },
  {
    id: 'ind-reversing',
    domain: 'industrial',
    level: 'beginner',
    build: (P, w, a) => {
      const G = a('grid3ph', 'G1', 40, 20);
      const Q = a('motorBreaker', 'Q1', 60, 160, { Ir: 8 });
      const K1 = a('contactor3p', 'K1', 20, 320);
      const K2 = a('contactor3p', 'K2', 300, 320);
      const F = a('thermalRelay', 'F1', 60, 500, { Ir: 7.7 });
      const M = a('motor3ph', 'M1', 60, 660, { Pm: 4, load: 60 });
      const S0 = a('buttonNC', 'S0', 620, 160);
      const S1 = a('buttonNO', 'S1', 620, 320);
      const S2 = a('buttonNO', 'S2', 760, 320);
      w3(w, G, L123, Q, IN3, PWR);
      w3(w, Q, OUT3, K1, IN3, PWR);
      w3(w, Q, OUT3, K2, ['5', '3', '1'], PWR);
      w3(w, K1, OUT3, F, IN3, PWR);
      w3(w, K2, OUT3, F, IN3, PWR);
      w3(w, F, OUT3, M, MOT, { section: 2.5, length: 6 });
      w(G, 'PE', M, 'PE', { section: 2.5, length: 6 });
      w(Q, '2', F, '95', CMD);
      w(F, '96', S0, '11', CMD);
      w(S0, '12', S1, '13', CMD);
      w(S1, '13', K1, '13', CMD);
      w(S1, '14', K1, '14', CMD);
      w(S1, '14', K2, '21', CMD);
      w(K2, '22', K1, 'A1', CMD);
      w(K1, 'A2', G, 'N', CMD);
      w(S0, '12', S2, '13', CMD);
      w(S2, '13', K2, '13', CMD);
      w(S2, '14', K2, '14', CMD);
      w(S2, '14', K1, '21', CMD);
      w(K1, '22', K2, 'A1', CMD);
      w(K2, 'A2', G, 'N', CMD);
    },
    keep: isPower,
    objectives: [
      ['forward', all(running('M1'), state('M1', 'forward', 'meas.direction')), [press('S1'), run(3)]],
      ['reverse', all(running('M1'), state('M1', 'reverse', 'meas.direction')), [press('S2'), run(3)]],
      ['interlock', then(closed('K1', true), [press('S2'), run(0.5)], all(closed('K2', false), closed('K1', true))), [press('S1'), run(2)]],
      ['stop', then(running('M1'), [press('S0'), run(6)], notRunning('M1')), [press('S1'), run(3)]],
    ],
  },

  /* ---------------- Industrial · Profissional ---------------- */
  {
    id: 'ind-star-delta',
    domain: 'industrial',
    level: 'pro',
    build: (P, w, a) => {
      const G = a('grid3ph', 'G1', 40, 20);
      const Q = a('motorBreaker', 'Q1', 60, 160, { Ir: 15 });
      const KM1 = a('contactor3p', 'KM1', 20, 320, { In: 18 });
      const KM3 = a('contactor3p', 'KM3', 300, 320);
      const KM2 = a('contactor3p', 'KM2', 300, 520);
      const F = a('thermalRelay', 'F1', 60, 500, { Ir: 8.5 });
      const M = a('motor3ph', 'M1', 60, 660, { Pm: 7.5, Vn: '400/690', connection: 'external', load: 60 });
      const KT = a('timerOn', 'KT', 900, 320, { t: 5 });
      const S0 = a('buttonNC', 'S0', 620, 160);
      const S1 = a('buttonNO', 'S1', 620, 320);
      w3(w, G, L123, Q, IN3, PWR);
      w3(w, Q, OUT3, KM1, IN3, PWR);
      w3(w, KM1, OUT3, F, IN3, PWR);
      w3(w, F, OUT3, M, MOT, { section: 2.5, length: 6 });
      w(G, 'PE', M, 'PE', { section: 2.5, length: 6 });
      w3(w, Q, OUT3, KM3, IN3, PWR);
      w3(w, KM3, OUT3, M, ['W2', 'U2', 'V2'], { section: 2.5, length: 6 });
      w3(w, M, ['W2', 'U2', 'V2'], KM2, IN3, { section: 2.5, length: 6 });
      w(KM2, '2', KM2, '4', { section: 2.5, length: 0.2 });
      w(KM2, '4', KM2, '6', { section: 2.5, length: 0.2 });
      w(Q, '2', F, '95', CMD);
      w(F, '96', S0, '11', CMD);
      w(S0, '12', S1, '13', CMD);
      w(S1, '13', KM1, '13', CMD);
      w(S1, '14', KM1, '14', CMD);
      w(S1, '14', KM1, 'A1', CMD);
      w(KM1, 'A2', G, 'N', CMD);
      w(S1, '14', KT, 'A1', CMD);
      w(KT, 'A2', G, 'N', CMD);
      w(S1, '14', KT, '15', CMD);
      w(KT, '16', KM3, '21', CMD);
      w(KM3, '22', KM2, 'A1', CMD);
      w(KM2, 'A2', G, 'N', CMD);
      w(KT, '18', KM2, '21', CMD);
      w(KM2, '22', KM3, 'A1', CMD);
      w(KM3, 'A2', G, 'N', CMD);
    },
    // Fica o circuito principal (G1 → Q1 → KM1 → F1 → U1 V1 W1); faltam a estrela, o triângulo e o comando.
    keep: (w, P) => {
      const n = (id: string) => P.devices.find((d) => d.id === id)?.name ?? '';
      const main = ['G1', 'Q1', 'KM1', 'F1', 'M1'];
      return isPower(w) && main.includes(n(w.a.device)) && main.includes(n(w.b.device)) && !['W2', 'U2', 'V2'].includes(w.b.terminal) && !['W2', 'U2', 'V2'].includes(w.a.terminal);
    },
    objectives: [
      ['star', all(closed('KM2', true), closed('KM3', false)), [press('S1'), run(1)]],
      ['delta', all(closed('KM3', true), closed('KM2', false), running('M1')), [press('S1'), run(7)]],
      ['current', all(closed('KM2', true), { type: 'measure', device: 'M1', key: 'meas.currentL1', min: 5, max: 50 }), [op('S1', 'press', 'down'), run(0.1)]],
    ],
  },
  {
    id: 'ind-pf',
    domain: 'industrial',
    level: 'pro',
    build: (P, w, a) => {
      const G = a('grid3ph', 'G1', 40, 20);
      const PA = a('powerAnalyzer', 'P1', 60, 160);
      const Q = a('motorBreaker', 'Q1', 60, 340, { Ir: 30 });
      const M = a('motor3ph', 'M1', 60, 520, { Pm: 15, load: 100 });
      const QC = a('mcb3p', 'Q2', 340, 340, { In: 16 });
      const C = a('capacitorBank', 'C1', 340, 520, { Q: 5 });
      w3(w, G, L123, PA, ['1', '3', '5'], { section: 10, length: 1 });
      w(G, 'N', PA, '7', { section: 10, length: 1 });
      w3(w, PA, ['2', '4', '6'], Q, IN3, { section: 6, length: 1 });
      w3(w, Q, OUT3, M, MOT, { section: 6, length: 6 });
      w(G, 'PE', M, 'PE', { section: 6, length: 6 });
      w3(w, PA, ['2', '4', '6'], QC, IN3, { section: 2.5, length: 1 });
      w3(w, QC, OUT3, C, L123, { section: 2.5, length: 2 });
      w(G, 'PE', C, 'PE', { section: 2.5, length: 2 });
    },
    keep: (w) => w.section !== 2.5,
    adjust: (P) => void (P.devices.find((d) => d.name === 'C1')!.params.Q = 2.5),
    objectives: [
      ['motor', running('M1'), [run(6)]],
      ['pf', all({ type: 'measure', device: 'P1', key: 'meas.powerFactor', min: 0.95 }, { type: 'measure', device: 'P1', key: 'meas.reactivePower', min: 0 }), [run(6)]],
    ],
  },
  {
    id: 'ind-selectivity',
    domain: 'industrial',
    level: 'pro',
    build: (P, w, a) => {
      const G = a('grid1ph', 'G1', 40, 20, { earthing: 'TN-S', Zs: 0.05 });
      const Q1 = a('mcb1pn', 'Q1', 60, 200, { In: 25, curve: 'D' });
      const Q2 = a('mcb1pn', 'Q2', 60, 380, { In: 16, curve: 'C' });
      const E = a('heater', 'E1', 320, 400, { P: 2000 });
      const Z = a('shortCircuit', 'Z1', 520, 400);
      w(G, 'L', Q1, '1', { section: 10, length: 1 });
      w(G, 'N', Q1, '3', { section: 10, length: 1 });
      w(Q1, '2', Q2, '1', { section: 4, length: 2 });
      w(Q1, '4', Q2, '3', { section: 4, length: 2 });
      w(Q2, '2', E, 'L', { section: 2.5, length: 30 });
      w(Q2, '4', E, 'N', { section: 2.5, length: 30 });
      w(G, 'PE', E, 'PE', { section: 2.5, length: 30 });
      w(Z, '1', E, 'L', { section: 2.5, length: 0.5 });
      w(Z, '2', E, 'N', { section: 2.5, length: 0.5 });
    },
    keep: () => true,
    adjust: (P) => void (P.devices.find((d) => d.name === 'Q1')!.params.curve = 'C'),
    objectives: [
      ['works', { type: 'working', device: 'E1' }],
      ['selective', all({ type: 'deviceState', device: 'Q2', key: 'trip', value: 'magnetic' }, closed('Q1', true)), [op('Z1', 'activate'), run(0.2)]],
      ['protected', { type: 'noDiag', codes: ['CABLE_UNPROTECTED'] }],
    ],
  },
  {
    id: 'ind-plc-pump',
    domain: 'industrial',
    level: 'pro',
    build: (P, w, a) => {
      const G = a('grid3ph', 'G1', 40, 20);
      const Q1 = a('motorBreaker', 'Q1', 60, 160, { Ir: 3.5 });
      const K = a('contactor3p', 'K1', 20, 320);
      const M = a('motor3ph', 'M1', 60, 500, { Pm: 1.5, load: 80 });
      const Q2 = a('mcb1pn', 'Q2', 360, 160, { In: 6 });
      const program = { rungs: [{ cols: [[{ op: 'I0' }], [{ op: 'I1', nc: true }]], coil: { kind: 'out', op: 'Q0' } }, { cols: [[{ op: 'I0' }]], coil: { kind: 'out', op: 'Q1' } }] };
      const A = a('plc', 'A1', 360, 320, { program: JSON.stringify(program) });
      const B = a('floatSwitch', 'B1', 700, 140);
      const S0 = a('buttonNO', 'S0', 860, 140);
      const H = a('pilotLight', 'H1', 560, 560, { color: 'orange' });
      w3(w, G, L123, Q1, IN3, PWR);
      w3(w, Q1, OUT3, K, IN3, PWR);
      w3(w, K, OUT3, M, MOT, { section: 2.5, length: 10 });
      w(G, 'PE', M, 'PE', { section: 2.5, length: 10 });
      w(G, 'L1', Q2, '1', CMD);
      w(G, 'N', Q2, '3', CMD);
      w(Q2, '2', A, 'L', CMD);
      w(Q2, '4', A, 'N', CMD);
      w(A, 'L+', B, '13', { section: 1, length: 1 });
      w(B, '14', A, 'I0', { section: 1, length: 1 });
      w(A, 'L+', S0, '13', { section: 1, length: 1 });
      w(S0, '14', A, 'I1', { section: 1, length: 1 });
      w(Q2, '2', A, '1L', CMD);
      w(A, 'Q0', K, 'A1', CMD);
      w(K, 'A2', Q2, '4', CMD);
      w(A, 'Q1', H, 'X1', CMD);
      w(H, 'X2', Q2, '4', CMD);
    },
    // Os cabos estão todos; falta o programa.
    keep: () => true,
    adjust: (P) => void (P.devices.find((d) => d.name === 'A1')!.params.program = JSON.stringify({ rungs: [] })),
    objectives: [
      ['high', running('M1'), [op('B1', 'level_high'), run(3)]],
      ['low', then(running('M1'), [op('B1', 'level_low'), run(6)], notRunning('M1')), [op('B1', 'level_high'), run(3)]],
      ['stop', then(running('M1'), [op('S0', 'press', 'down'), run(6)], notRunning('M1')), [op('B1', 'level_high'), run(3)]],
      ['lamp', state('H1', 'lit'), [op('B1', 'level_high'), run(1)]],
    ],
  },
  {
    id: 'ind-vfd',
    domain: 'industrial',
    level: 'pro',
    build: (P, w, a) => {
      const G = a('grid3ph', 'G1', 40, 20);
      const Q = a('mcb3p', 'Q1', 60, 160, { In: 16, curve: 'C' });
      const U = a('vfd', 'T1', 60, 320, { fTarget: 50, tAcc: 5, tDec: 5 });
      const M = a('motor3ph', 'M1', 60, 540, { Pm: 4, load: 70 });
      const S = a('selector012', 'S1', 400, 540);
      w3(w, G, L123, Q, IN3, PWR);
      w3(w, Q, OUT3, U, L123, PWR);
      w(G, 'PE', U, 'PE', PWR);
      w3(w, U, ['U', 'V', 'W'], M, MOT, { section: 2.5, length: 6 });
      w(G, 'PE', M, 'PE', { section: 2.5, length: 6 });
      w(U, '24V', S, '13', { section: 1, length: 1 });
      w(S, '14', U, 'DI1', { section: 1, length: 1 });
      w(U, '24V', S, '23', { section: 1, length: 1 });
      w(S, '24', U, 'DI2', { section: 1, length: 1 });
    },
    keep: isPower,
    adjust: (P) => void (P.devices.find((d) => d.name === 'T1')!.params.tAcc = 1),
    objectives: [
      ['forward', all({ type: 'measure', device: 'T1', key: 'meas.frequency', min: 49.9 }, state('M1', 'forward', 'meas.direction')), [op('S1', 'pos_1'), run(8)]],
      ['reverse', state('M1', 'reverse', 'meas.direction'), [op('S1', 'pos_2'), run(14)]],
      ['ramp', { type: 'measure', device: 'T1', key: 'meas.frequency', min: 20, max: 30 }, [op('S1', 'pos_1'), run(2.5)]],
    ],
  },
];

function buildSolution(s: Spec): Project {
  const P = createProject({ domain: s.domain, level: s.level });
  const a = (type: string, name: string, x: number, y: number, params?: Record<string, unknown>, st?: Record<string, unknown>) =>
    addDevice(P, type, { x, y, name, params: params as never, state: st });
  s.build(P, (x, tx, y, ty, o) => addWire(P, x, tx, y, ty, { length: 2, ...o }), a);
  return P;
}

export function buildExercises(): Exercise[] {
  return SPECS.map((s) => {
    const solution = buildSolution(s);
    const initial = structuredClone(solution);
    initial.wires = initial.wires.filter((w) => s.keep?.(w, initial) ?? false);
    s.adjust?.(initial);
    const objectives: Objective[] = s.objectives.map(([id, rule, given]) => ({
      id,
      text: { key: `exercise.${s.id}.obj.${id}` },
      rule,
      ...(given ? { given } : {}),
    }));
    return {
      id: s.id,
      domain: s.domain,
      level: s.level,
      title: { key: `exercise.${s.id}.title` },
      statement: { key: `exercise.${s.id}.statement` },
      objectives,
      initial,
      solution,
    };
  });
}
