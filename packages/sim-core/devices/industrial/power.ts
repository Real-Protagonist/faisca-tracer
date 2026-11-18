/**
 * Potência trifásica: rede 400/230 V, disjuntores 3P e 4P, disjuntor-motor, relé térmico,
 * relé de falta e sequência de fases, resistências e condensadores trifásicos, analisador de rede,
 * sequencímetro e falhas de fase (falta e inversão).
 */
import { cabs, cx, power, rms, type Complex } from '../../solver/complex';
import { diag, dev, type Diagnostic } from '../../diagnostics/types';
import { MCB_RATINGS } from '../../checks/tables';
import {
  breakerActions,
  breakerLogic,
  breakerStateKey,
  forceBreakerClosed,
  m,
  mcbTripTime,
  ms,
  num,
  p,
  ps,
  sel,
  toggleBreaker,
  type BreakerRT,
} from '../common';
import { tripDiagnostics } from '../protection';
import type { Device } from '../../project/types';
import type { DeviceDef, Measurement, SolutionView, SourceRole, TerminalDef, TerminalKind } from '../types';
import { Ci, indicator, L, Pa, pole, Re, Tx, type Prim } from '../symbols';
import { findConnected, overloadHeat, overloadTripTime, sequences, type OverloadRT } from './helpers';

const IND = ['industrial'] as const;
const SQ3 = Math.sqrt(3);

const top = (ids: string[], xs: number[], kinds: TerminalKind[] = [], labels: string[] = ids): TerminalDef[] =>
  ids.map((id, i) => ({ id, x: xs[i]!, y: 0, kind: kinds[i] ?? 'any', label: labels[i] }));
const bottom = (ids: string[], xs: number[], y: number, kinds: TerminalKind[] = [], labels: string[] = ids): TerminalDef[] =>
  ids.map((id, i) => ({ id, x: xs[i]!, y, kind: kinds[i] ?? 'any', label: labels[i] }));

/** Pólos 1-2, 3-4, 5-6 a 20, 60 e 100 px. */
const POLES = [
  ['1', '2'],
  ['3', '4'],
  ['5', '6'],
] as const;
const PX = [20, 60, 100];
const poles3 = (h: number): TerminalDef[] => [...top(['1', '3', '5'], PX), ...bottom(['2', '4', '6'], PX, h)];
const poleCurrents = (sol: SolutionView, d: Device) => POLES.map((_, k) => rms(sol.i(d, 'p' + k)));
const isMotor = (d: Device) => d.type === 'motor3ph' || d.type === 'motor1ph';

/** Nome do motor alimentado a partir das saídas de um aparelho (ou «—»). */
export function motorDownstream(ctx: { project: import('../../project/types').Project; registry: import('../registry').Registry }, d: Device, outputs: string[]): string {
  const M = findConnected(ctx.project, ctx.registry, outputs.map((t) => ({ device: d.id, terminal: t })), isMotor, d.id);
  return M?.name ?? '—';
}

/* ---------------- Rede trifásica ---------------- */

const PHASE_ANGLE = [0, -120, 120];

export const grid3ph: DeviceDef = {
  type: 'grid3ph',
  category: 'sources',
  domain: [...IND],
  level: 'beginner',
  prefix: 'G',
  size: { w: 200, h: 80 },
  terminals: bottom(['L1', 'L2', 'L3', 'N', 'PE'], [20, 60, 100, 140, 180], 80, ['L1', 'L2', 'L3', 'N', 'PE']),
  params: [
    num('V', 400, 'V', 200, 690, 1),
    sel('earthing', ['TN-S', 'TT'], 'TN-S', undefined, false, true),
    num('Zs', 0.03, 'Ω', 0.001, 5, 0.005, true),
    num('Rb', 2, 'Ω', 0.05, 100, 0.05, true),
  ],
  initialState: () => ({ on: true }),
  sourceRoles: (d): Record<string, SourceRole> =>
    ps(d, 'earthing') === 'TT'
      ? { L1: 'phase', L2: 'phase', L3: 'phase', N: 'neutral' }
      : { L1: 'phase', L2: 'phase', L3: 'phase', N: 'neutral', PE: 'pe' },
  stamp(d, b) {
    const n0 = b.internal('n0');
    const Zs = p(d, 'Zs');
    const Vph = d.state.on === false ? 0 : p(d, 'V') / SQ3;
    ['L1', 'L2', 'L3'].forEach((t, k) => {
      const li = b.internal('l' + k);
      b.V(li, n0, { ac: Vph, phase: PHASE_ANGLE[k] }, 'v' + k);
      b.R(li, b.node(t), Zs, 'z' + k);
    });
    b.R(n0, b.node('N'), Zs, 'zn');
    b.R(n0, b.ground, p(d, 'Rb'), 'rb');
    if (ps(d, 'earthing') !== 'TT') b.R(n0, b.node('PE'), Zs, 'zpe');
  },
  measure(d, sol) {
    const n0 = sol.vInternal(d, 'n0');
    let P = 0;
    let Q = 0;
    const I = [0, 1, 2].map((k) => {
      const v = sol.vInternal(d, 'l' + k);
      const i = sol.i(d, 'z' + k);
      const pw = power({ ac: cx(v.ac.re - n0.ac.re, v.ac.im - n0.ac.im), dc: 0 }, i);
      P += pw.P;
      Q += pw.Q;
      return rms(i);
    });
    const S = Math.hypot(P, Q);
    return [
      ms('meas.state', d.state.on === false ? 'no_power' : 'powered'),
      m('meas.lineVoltage', rms(sol.vv(d, 'L1', 'L2')), 'V'),
      m('meas.phaseVoltage', rms(sol.vv(d, 'L1', 'N')), 'V'),
      m('meas.currentL1', I[0]!, 'A'),
      m('meas.currentL2', I[1]!, 'A'),
      m('meas.currentL3', I[2]!, 'A'),
      m('meas.neutralCurrent', rms(sol.i(d, 'zn')), 'A', true),
      m('meas.activePower', P, 'W'),
      m('meas.reactivePower', Q, 'var', true),
      m('meas.apparentPower', S, 'VA', true),
      m('meas.powerFactor', S > 1e-9 ? P / S : 1, '', true),
      m('meas.prospectiveIcc3', p(d, 'V') / (SQ3 * p(d, 'Zs')), 'A', true),
    ];
  },
  actions: (d) => [{ id: d.state.on === false ? 'power_on' : 'power_off' }],
  operate(d, action) {
    if (action === 'power_off') d.state.on = false;
    else if (action === 'power_on') d.state.on = true;
    else return false;
    return true;
  },
  model3d: 'supply-cabinet',
  simplifications: ['simpl.grid_ideal'],
};

/* ---------------- Disjuntores 3P e 4P ---------------- */

const mcbParams3 = () => [
  sel('In', MCB_RATINGS, 16, 'A'),
  sel('curve', ['B', 'C', 'D'], 'C', undefined, false, true),
  sel('Icn', [6, 10, 15, 25], 10, 'kA', true),
];

const breakerMeasure3 = (d: Device, sol: SolutionView, rt: BreakerRT): Measurement[] => {
  const I = poleCurrents(sol, d);
  const In = p(d, 'In');
  const max = Math.max(...I);
  return [
    ms('meas.state', breakerStateKey(d)),
    m('meas.currentL1', I[0]!, 'A'),
    m('meas.currentL2', I[1]!, 'A'),
    m('meas.currentL3', I[2]!, 'A'),
    m('meas.loadRatio', (100 * max) / In, '%'),
    m('meas.thermal', 100 * (rt.heat ?? 0), '%'),
    m('meas.tripTime', mcbTripTime(max / In), 's', true),
  ];
};

export const mcb3p: DeviceDef<BreakerRT> = {
  type: 'mcb3p',
  category: 'protection',
  domain: [...IND],
  level: 'beginner',
  prefix: 'Q',
  size: { w: 120, h: 100 },
  terminals: poles3(100),
  params: mcbParams3(),
  initialState: () => ({ closed: true, trip: null }),
  conducts: (d) => POLES.map(([a, b]) => ({ a, b, closed: !!d.state.closed })),
  protection: { inputs: ['1', '3', '5'], outputs: ['2', '4', '6'], ratedCurrent: (d) => p(d, 'In') },
  stamp(d, b) {
    POLES.forEach(([x, y], k) => b.sw(b.node(x), b.node(y), !!d.state.closed, 'p' + k));
  },
  logic: (d, ctx, rt) => breakerLogic(d, ctx, rt, Math.max(...poleCurrents(ctx.sol, d))),
  measure: breakerMeasure3,
  actions: breakerActions,
  operate: (d, a) => (['open', 'close', 'reset'].includes(a) ? toggleBreaker(d) : false),
  diagnose: (d, ctx) => tripDiagnostics(d, ctx.fmt),
  forceClosed: forceBreakerClosed,
  model3d: 'din-3p',
  simplifications: ['simpl.mcb_thermal'],
};

export const mcb4p: DeviceDef<BreakerRT> = {
  ...mcb3p,
  type: 'mcb4p',
  level: 'pro',
  size: { w: 160, h: 100 },
  terminals: [...poles3(100), { id: '7', x: 140, y: 0, kind: 'N', label: 'N' }, { id: '8', x: 140, y: 100, kind: 'N', label: 'N' }],
  conducts: (d) => [...POLES.map(([a, b]) => ({ a, b, closed: !!d.state.closed })), { a: '7', b: '8', closed: !!d.state.closed }],
  protection: { inputs: ['1', '3', '5', '7'], outputs: ['2', '4', '6', '8'], ratedCurrent: (d) => p(d, 'In') },
  stamp(d, b) {
    POLES.forEach(([x, y], k) => b.sw(b.node(x), b.node(y), !!d.state.closed, 'p' + k));
    b.sw(b.node('7'), b.node('8'), !!d.state.closed, 'pn');
  },
  model3d: 'din-4p',
};

/* ---------------- Disjuntor-motor ---------------- */

interface MotorBreakerRT extends BreakerRT, OverloadRT {}

/** Disparo magnético do disjuntor-motor: 13 × Ir. */
export const MOTOR_BREAKER_MAGNETIC = 13;

function overloadDiag(d: Device, ctx: { fmt(v: number, u: string): string; project: any; registry: any }, rated: number): Diagnostic {
  const I = Number(d.state.tripCurrent ?? 0);
  return diag('MOTOR_OVERLOAD', 'error', [dev(d.id)], {
    device: d.name,
    motor: motorDownstream(ctx, d, ['2', '4', '6']),
    current: ctx.fmt(I, 'A'),
    rated: ctx.fmt(rated, 'A'),
    ratio: ctx.fmt(I / rated, ''),
  }, d.id);
}

export const motorBreaker: DeviceDef<MotorBreakerRT> = {
  type: 'motorBreaker',
  category: 'protection',
  domain: [...IND],
  level: 'beginner',
  prefix: 'Q',
  size: { w: 120, h: 100 },
  terminals: poles3(100),
  params: [num('Ir', 8, 'A', 0.1, 65, 0.1), sel('Icn', [15, 50, 100], 50, 'kA', true)],
  initialState: () => ({ closed: true, trip: null }),
  conducts: (d) => POLES.map(([a, b]) => ({ a, b, closed: !!d.state.closed })),
  protection: { inputs: ['1', '3', '5'], outputs: ['2', '4', '6'], ratedCurrent: (d) => p(d, 'Ir') },
  stamp(d, b) {
    POLES.forEach(([x, y], k) => b.sw(b.node(x), b.node(y), !!d.state.closed, 'p' + k));
  },
  logic(d, ctx, rt) {
    const I = poleCurrents(ctx.sol, d);
    const max = Math.max(...I);
    const Ir = p(d, 'Ir');
    if (!d.state.closed) {
      rt.heat = Math.max(0, (rt.heat ?? 0) - (ctx.dt * 1.25) / 400);
      return false;
    }
    const values = { device: d.name, current: ctx.fmt(max, 'A'), rated: ctx.fmt(Ir, 'A'), ratio: ctx.fmt(max / Ir, '') };
    if (max > MOTOR_BREAKER_MAGNETIC * Ir) {
      Object.assign(d.state, { closed: false, trip: 'magnetic', tripCurrent: max });
      ctx.emit({ code: 'mcb_magnetic_trip', severity: 'error', values });
      return true;
    }
    if (overloadHeat(ctx, rt, I, Ir, 10)) {
      Object.assign(d.state, { closed: false, trip: 'thermal', tripCurrent: max, tripUnbalanced: !!rt.unbalanced });
      ctx.emit({ code: 'motor_overload', severity: 'error', values });
      return true;
    }
    return false;
  },
  measure: (d, sol, rt) => {
    const I = poleCurrents(sol, d);
    const Ir = p(d, 'Ir');
    const max = Math.max(...I);
    return [
      ms('meas.state', breakerStateKey(d)),
      m('meas.currentL1', I[0]!, 'A'),
      m('meas.currentL2', I[1]!, 'A'),
      m('meas.currentL3', I[2]!, 'A'),
      m('meas.loadRatio', (100 * max) / Ir, '%'),
      m('meas.thermal', 100 * (rt.heat ?? 0), '%'),
      m('meas.tripTime', overloadTripTime(max / Ir, 10), 's', true),
    ];
  },
  actions: breakerActions,
  operate: (d, a) => (['open', 'close', 'reset'].includes(a) ? toggleBreaker(d) : false),
  diagnose(d, ctx) {
    if (d.state.trip === 'thermal' && d.state.tripUnbalanced)
      return [diag('OVERLOAD_PHASE_LOSS', 'error', [dev(d.id)], { device: d.name, motor: motorDownstream(ctx, d, ['2', '4', '6']), current: ctx.fmt(Number(d.state.tripCurrent ?? 0), 'A') }, d.id)];
    if (d.state.trip === 'thermal') return [overloadDiag(d, ctx, p(d, 'Ir'))];
    if (d.state.trip === 'magnetic') return tripDiagnostics({ ...d, params: { ...d.params, In: p(d, 'Ir') } }, ctx.fmt);
    return [];
  },
  forceClosed: forceBreakerClosed,
  model3d: 'motor-breaker',
  simplifications: ['simpl.overload_thermal'],
};

/* ---------------- Relé térmico ---------------- */

interface ThermalRT extends OverloadRT {}

export const thermalRelay: DeviceDef<ThermalRT> = {
  type: 'thermalRelay',
  category: 'protection',
  domain: [...IND],
  level: 'beginner',
  prefix: 'F',
  size: { w: 200, h: 100 },
  terminals: [
    ...poles3(100),
    { id: '95', x: 140, y: 0, kind: 'any', label: '95' },
    { id: '96', x: 140, y: 100, kind: 'any', label: '96' },
    { id: '97', x: 180, y: 0, kind: 'any', label: '97' },
    { id: '98', x: 180, y: 100, kind: 'any', label: '98' },
  ],
  params: [num('Ir', 8, 'A', 0.1, 100, 0.1), sel('cls', [10, 20], 10, undefined, true), sel('resetMode', ['manual', 'auto'], 'manual', undefined, true, true)],
  initialState: () => ({ tripped: false }),
  conducts: (d) => [
    ...POLES.map(([a, b]) => ({ a, b, closed: true })),
    { a: '95', b: '96', closed: !d.state.tripped },
    { a: '97', b: '98', closed: !!d.state.tripped },
  ],
  protection: { inputs: ['1', '3', '5'], outputs: ['2', '4', '6'], ratedCurrent: (d) => p(d, 'Ir') },
  stamp(d, b) {
    // Elementos bimetálicos: resistência pequena em cada pólo.
    POLES.forEach(([x, y], k) => b.R(b.node(x), b.node(y), 0.005, 'p' + k));
    b.sw(b.node('95'), b.node('96'), !d.state.tripped, 'nc');
    b.sw(b.node('97'), b.node('98'), !!d.state.tripped, 'no');
  },
  logic(d, ctx, rt) {
    const I = poleCurrents(ctx.sol, d);
    const Ir = p(d, 'Ir');
    if (d.state.tripped) {
      overloadHeat(ctx, rt, I, Ir, ps(d, 'cls'));
      if (ps(d, 'resetMode') === 'auto' && (rt.heat ?? 0) < 0.6) {
        d.state.tripped = false;
        return true;
      }
      return false;
    }
    if (overloadHeat(ctx, rt, I, Ir, ps(d, 'cls'))) {
      const max = Math.max(...I);
      Object.assign(d.state, { tripped: true, tripCurrent: max, tripUnbalanced: !!rt.unbalanced });
      ctx.emit({ code: 'motor_overload', severity: 'error', values: { device: d.name, current: ctx.fmt(max, 'A'), rated: ctx.fmt(Ir, 'A'), ratio: ctx.fmt(max / Ir, '') } });
      return true;
    }
    return false;
  },
  measure: (d, sol, rt) => {
    const I = poleCurrents(sol, d);
    const max = Math.max(...I);
    return [
      ms('meas.state', d.state.tripped ? 'tripped_thermal' : 'in_service'),
      m('meas.currentL1', I[0]!, 'A'),
      m('meas.currentL2', I[1]!, 'A'),
      m('meas.currentL3', I[2]!, 'A'),
      m('meas.loadRatio', (100 * max) / p(d, 'Ir'), '%'),
      m('meas.thermal', 100 * (rt.heat ?? 0), '%'),
      m('meas.tripTime', overloadTripTime(max / p(d, 'Ir'), ps(d, 'cls')), 's', true),
    ];
  },
  actions: (d) => (d.state.tripped ? [{ id: 'reset' }] : [{ id: 'test', pro: true, manualOnly: true }]),
  operate(d, a, rt) {
    if (a === 'reset' && d.state.tripped) {
      // O bimetal tem de arrefecer antes de rearmar.
      if ((rt.heat ?? 0) > 0.9) return false;
      d.state.tripped = false;
      return true;
    }
    if (a === 'test' && !d.state.tripped) {
      Object.assign(d.state, { tripped: true, tripCurrent: 0, test: true });
      return true;
    }
    return false;
  },
  diagnose(d, ctx) {
    if (!d.state.tripped || d.state.test) return [];
    if (d.state.tripUnbalanced) {
      return [diag('OVERLOAD_PHASE_LOSS', 'error', [dev(d.id)], { device: d.name, motor: motorDownstream(ctx, d, ['2', '4', '6']), current: ctx.fmt(Number(d.state.tripCurrent ?? 0), 'A') }, d.id)];
    }
    return [overloadDiag(d, ctx, p(d, 'Ir'))];
  },
  model3d: 'thermal-relay',
  simplifications: ['simpl.overload_thermal'],
};

/* ---------------- Relé de falta e sequência de fases ---------------- */

/** Verifica as três fases: presença (> 80 % de Un) e sequência directa. */
export function phaseCheck(va: Complex, vb: Complex, vc: Complex, Un: number): 'ok' | 'phase_missing' | 'wrong_sequence' {
  const sub = (x: Complex, y: Complex) => cx(x.re - y.re, x.im - y.im);
  const ll = [cabs(sub(va, vb)), cabs(sub(vb, vc)), cabs(sub(vc, va))];
  if (Math.min(...ll) < 0.8 * Un) return 'phase_missing';
  const { v1, v2 } = sequences(va, vb, vc);
  return cabs(v2) > cabs(v1) ? 'wrong_sequence' : 'ok';
}

export const phaseMonitor: DeviceDef = {
  type: 'phaseMonitor',
  category: 'protection',
  domain: [...IND],
  level: 'pro',
  prefix: 'F',
  size: { w: 160, h: 100 },
  terminals: [
    ...top(['L1', 'L2', 'L3'], PX, ['L1', 'L2', 'L3']),
    ...bottom(['11', '12', '14'], [60, 100, 140], 100),
  ],
  params: [sel('Un', [400, 230, 480], 400, 'V')],
  initialState: () => ({ ok: false, check: 'phase_missing' }),
  conducts: (d) => [
    { a: '11', b: '14', closed: !!d.state.ok },
    { a: '11', b: '12', closed: !d.state.ok },
  ],
  stamp(d, b) {
    const n = b.internal('n');
    for (const t of ['L1', 'L2', 'L3']) b.R(b.node(t), n, 1e5, 'r' + t);
    b.sw(b.node('11'), b.node('14'), !!d.state.ok, 'no');
    b.sw(b.node('11'), b.node('12'), !d.state.ok, 'nc');
  },
  logic(d, ctx) {
    const s = phaseCheck(ctx.sol.v(d, 'L1').ac, ctx.sol.v(d, 'L2').ac, ctx.sol.v(d, 'L3').ac, p(d, 'Un'));
    if (s === d.state.check) return false;
    if (s !== 'ok' && d.state.check === 'ok') ctx.emit({ code: 'phase_fault', severity: 'warning', values: { device: d.name } });
    d.state.check = s;
    d.state.ok = s === 'ok';
    return true;
  },
  measure: (d, sol) => [
    ms('meas.state', String(d.state.check ?? 'phase_missing')),
    m('meas.lineVoltage', rms(sol.vv(d, 'L1', 'L2')), 'V'),
  ],
  model3d: 'din-relay',
};

/* ---------------- Resistências de aquecimento trifásicas ---------------- */

const LOAD3: TerminalDef[] = top(['L1', 'L2', 'L3', 'PE'], [20, 60, 100, 140], ['L1', 'L2', 'L3', 'PE']);

export const heater3ph: DeviceDef = {
  type: 'heater3ph',
  category: 'loads',
  domain: [...IND],
  level: 'beginner',
  prefix: 'E',
  size: { w: 160, h: 100 },
  terminals: LOAD3,
  params: [sel('P', [3, 4.5, 6, 9, 12, 18, 24], 6, 'kW'), sel('Vn', [400, 230], 400, 'V', true)],
  initialState: () => ({}),
  classI: true,
  load: { phase: 'L1', neutral: 'L2', phases: ['L1', 'L2', 'L3'], nominalVoltage: (d) => p(d, 'Vn'), working: (d, sol) => rms(sol.vv(d, 'L1', 'L2')) > 0.5 * p(d, 'Vn') },
  stamp(d, b) {
    // Três resistências em estrela (ponto comum interno): R = U² / P.
    const n = b.internal('n');
    const R = (p(d, 'Vn') ** 2) / (p(d, 'P') * 1000);
    ['L1', 'L2', 'L3'].forEach((t, k) => b.R(b.node(t), n, R, 'r' + k));
  },
  measure(d, sol) {
    const n = sol.vInternal(d, 'n');
    let P = 0;
    const I = ['L1', 'L2', 'L3'].map((t, k) => {
      const i = sol.i(d, 'r' + k);
      const v = sol.v(d, t);
      P += power({ ac: cx(v.ac.re - n.ac.re, v.ac.im - n.ac.im), dc: 0 }, i).P;
      return rms(i);
    });
    return [m('meas.lineVoltage', rms(sol.vv(d, 'L1', 'L2')), 'V'), m('meas.current', Math.max(...I), 'A'), m('meas.activePower', P, 'W')];
  },
  model3d: 'heater-3ph',
};

/* ---------------- Bateria de condensadores ---------------- */

export const capacitorBank: DeviceDef = {
  type: 'capacitorBank',
  category: 'loads',
  domain: [...IND],
  level: 'pro',
  prefix: 'C',
  size: { w: 160, h: 100 },
  terminals: LOAD3,
  params: [sel('Q', [2.5, 5, 7.5, 10, 12.5, 15, 20, 25, 30, 40, 50], 10, 'kvar'), sel('Vn', [400, 230], 400, 'V', true)],
  initialState: () => ({ on: true }),
  classI: true,
  stamp(d, b) {
    if (d.state.on === false) return;
    // Triângulo: cada condensador sob a tensão composta, Q/3 cada um.
    const C = (p(d, 'Q') * 1000) / (3 * b.omega * p(d, 'Vn') ** 2);
    const T = ['L1', 'L2', 'L3'];
    T.forEach((t, k) => {
      b.Z(b.node(t), b.node(T[(k + 1) % 3]!), { C }, 'c' + k);
      // Resistências de descarga (perdas desprezáveis).
      b.R(b.node(t), b.node(T[(k + 1) % 3]!), 1e6, 'rd' + k);
    });
  },
  measure(d, sol) {
    let Q = 0;
    const T = ['L1', 'L2', 'L3'];
    T.forEach((t, k) => (Q += power(sol.vv(d, t, T[(k + 1) % 3]!), sol.i(d, 'c' + k)).Q));
    // Corrente de linha em L1 = corrente do ramo L1-L2 menos a do ramo L3-L1.
    const a = sol.i(d, 'c0').ac;
    const c = sol.i(d, 'c2').ac;
    const I = cabs(cx(a.re - c.re, a.im - c.im));
    return [ms('meas.state', d.state.on === false ? 'off' : 'on'), m('meas.reactivePower', Q, 'var'), m('meas.current', I, 'A'), m('meas.lineVoltage', rms(sol.vv(d, 'L1', 'L2')), 'V')];
  },
  actions: (d) => [{ id: d.state.on === false ? 'switch_on' : 'switch_off' }],
  operate(d, a) {
    if (a === 'switch_on') d.state.on = true;
    else if (a === 'switch_off') d.state.on = false;
    else return false;
    return true;
  },
  model3d: 'capacitor-bank',
  simplifications: ['simpl.capacitor_ideal'],
};

/* ---------------- Analisador de rede ---------------- */

const AN_IN = ['1', '3', '5', '7'];
const AN_OUT = ['2', '4', '6', '8'];

export const powerAnalyzer: DeviceDef = {
  type: 'powerAnalyzer',
  category: 'measurement',
  domain: [...IND],
  level: 'pro',
  prefix: 'P',
  size: { w: 160, h: 100 },
  terminals: [
    ...top(AN_IN, [20, 60, 100, 140], ['L1', 'L2', 'L3', 'N'], ['L1', 'L2', 'L3', 'N']),
    ...bottom(AN_OUT, [20, 60, 100, 140], 100, ['L1', 'L2', 'L3', 'N'], ['L1', 'L2', 'L3', 'N']),
  ],
  params: [],
  initialState: () => ({}),
  conducts: () => AN_IN.map((a, k) => ({ a, b: AN_OUT[k]!, closed: true })),
  stamp(_d, b) {
    AN_IN.forEach((a, k) => b.R(b.node(a), b.node(AN_OUT[k]!), 1e-3, 's' + k));
  },
  measure(d, sol) {
    const rows: Measurement[] = [];
    let P = 0;
    let Q = 0;
    for (let k = 0; k < 3; k++) {
      const v = sol.vv(d, AN_IN[k]!, '7');
      const i = sol.i(d, 's' + k);
      const pw = power(v, i);
      P += pw.P;
      Q += pw.Q;
      rows.push(m(`meas.voltageL${k + 1}`, rms(v), 'V'), m(`meas.currentL${k + 1}`, rms(i), 'A'), m(`meas.powerFactorL${k + 1}`, pw.pf, ''));
    }
    const S = Math.hypot(P, Q);
    rows.push(m('meas.neutralCurrent', rms(sol.i(d, 's3')), 'A'), m('meas.activePower', P, 'W'), m('meas.reactivePower', Q, 'var'), m('meas.apparentPower', S, 'VA'), m('meas.powerFactor', S > 1e-9 ? P / S : 1, ''));
    return rows;
  },
  model3d: 'meter',
  simplifications: ['simpl.analyzer_fundamental'],
};

/* ---------------- Sequencímetro ---------------- */

export const phaseSequenceMeter: DeviceDef = {
  type: 'phaseSequenceMeter',
  category: 'measurement',
  domain: [...IND],
  level: 'beginner',
  prefix: 'P',
  size: { w: 120, h: 80 },
  terminals: top(['L1', 'L2', 'L3'], PX, ['L1', 'L2', 'L3']),
  params: [],
  initialState: () => ({}),
  stamp(_d, b) {
    const n = b.internal('n');
    for (const t of ['L1', 'L2', 'L3']) b.R(b.node(t), n, 1e6, 'r' + t);
  },
  measure(d, sol) {
    const va = sol.v(d, 'L1').ac;
    const vb = sol.v(d, 'L2').ac;
    const vc = sol.v(d, 'L3').ac;
    const lls = [rms(sol.vv(d, 'L1', 'L2')), rms(sol.vv(d, 'L2', 'L3')), rms(sol.vv(d, 'L3', 'L1'))];
    const max = Math.max(...lls);
    let s = 'no_power';
    if (max > 20) s = Math.min(...lls) < 0.8 * max ? 'phase_missing' : cabs(sequences(va, vb, vc).v2) > cabs(sequences(va, vb, vc).v1) ? 'sequence_inverse' : 'sequence_direct';
    return [ms('meas.state', s), m('meas.lineVoltage', max, 'V')];
  },
  model3d: 'meter',
};

/* ---------------- Falhas: falta de fase e inversão de fases ---------------- */

const toggleActive = (d: Device, a: string) => {
  if (a === 'activate') d.state.active = true;
  else if (a === 'deactivate') d.state.active = false;
  else return false;
  return true;
};
const activeActions = (d: Device) => [{ id: d.state.active ? 'deactivate' : 'activate' }];
const LOST: Record<string, number> = { L1: 0, L2: 1, L3: 2 };

export const phaseLoss: DeviceDef = {
  type: 'phaseLoss',
  category: 'faults',
  domain: [...IND],
  level: 'beginner',
  prefix: 'Z',
  size: { w: 120, h: 80 },
  terminals: poles3(80),
  params: [sel('phase', ['L1', 'L2', 'L3'], 'L3')],
  initialState: () => ({ active: false }),
  conducts: (d) => POLES.map(([a, b], k) => ({ a, b, closed: !(d.state.active && LOST[ps(d, 'phase')] === k) })),
  stamp(d, b) {
    POLES.forEach(([x, y], k) => b.sw(b.node(x), b.node(y), !(d.state.active && LOST[ps(d, 'phase')] === k), 'p' + k));
  },
  measure: (d) => [ms('meas.state', d.state.active ? 'active' : 'inactive')],
  actions: activeActions,
  operate: toggleActive,
  model3d: 'fault',
};

export const phaseReversal: DeviceDef = {
  type: 'phaseReversal',
  category: 'faults',
  domain: [...IND],
  level: 'pro',
  prefix: 'Z',
  size: { w: 120, h: 80 },
  terminals: poles3(80),
  params: [],
  initialState: () => ({ active: false }),
  conducts: (d) =>
    d.state.active
      ? [
          { a: '1', b: '2', closed: true },
          { a: '3', b: '6', closed: true },
          { a: '5', b: '4', closed: true },
        ]
      : POLES.map(([a, b]) => ({ a, b, closed: true })),
  stamp(d, b) {
    const pairs = d.state.active ? [['1', '2'], ['3', '6'], ['5', '4']] : POLES;
    pairs.forEach(([x, y], k) => b.R(b.node(x!), b.node(y!), 1e-3, 'p' + k));
  },
  measure: (d) => [ms('meas.state', d.state.active ? 'active' : 'inactive')],
  actions: activeActions,
  operate: toggleActive,
  model3d: 'fault',
};

export const power3 = [grid3ph, mcb3p, mcb4p, motorBreaker, thermalRelay, phaseMonitor, heater3ph, capacitorBank, powerAnalyzer, phaseSequenceMeter, phaseLoss, phaseReversal];

/* ---------------- Símbolos ---------------- */

const leads = (xs: number[], y0: number, y1: number): Prim[] => xs.map((x) => L(x, y0, x, y1));
const poleSet = (closed: boolean, h: number, o: Parameters<typeof pole>[4] = {}): Prim[] => PX.flatMap((x) => pole(x, 0, h, closed, o));
const link = (x0: number, x1: number, y: number) => L(x0, y, x1, y, 'sl dash');

grid3ph.symbol = (d, _l, n) => [
  ...leads([20, 60, 100, 140, 180], 66, 80),
  Ci(100, 30, 17, d.state.on === false ? 'sl off' : 'sl'),
  Pa('M88 30 q6 -10 12 0 t12 0'),
  Tx(100, 61, `3~ ${n(p(d, 'V'))} V · ${ps(d, 'earthing')}`),
];
mcb3p.symbol = (d, _l, n) => [...poleSet(!!d.state.closed, 100, { breaker: true }), link(14, 94, 50), Tx(112, 30, `${ps(d, 'curve')}${n(p(d, 'In'))}`, 'txt sm', 'end'), indicator(104, 44, d.state)];
mcb4p.symbol = (d, _l, n) => [...poleSet(!!d.state.closed, 100, { breaker: true }), ...pole(140, 0, 100, !!d.state.closed), link(14, 134, 50), Tx(80, 24, `${ps(d, 'curve')}${n(p(d, 'In'))}`), indicator(146, 60, d.state)];
motorBreaker.symbol = (d, _l, n) => [
  ...poleSet(!!d.state.closed, 100, { breaker: true }), link(14, 94, 50),
  Re(104, 40, 12, 20, 'sl'), Pa('M106 50 h3 l2 -5 l2 10 l2 -5 h1', 'sl thin'),
  Tx(60, 96, `${n(p(d, 'Ir'))} A`, 'txt xs'), indicator(104, 14, d.state),
];
thermalRelay.symbol = (d, _l, n) => [
  ...leads(PX, 0, 34), ...leads(PX, 66, 100),
  ...PX.map((x) => Pa(`M${x} 34 h6 v8 h-12 v8 h12 v8 h-6 v8`, 'sl')),
  link(26, 126, 50),
  ...pole(140, 0, 100, !d.state.tripped, { nc: true }), ...pole(180, 0, 100, !!d.state.tripped),
  Tx(100, 96, `${n(p(d, 'Ir'))} A`, 'txt xs'), ...(d.state.tripped ? [Re(150, 40, 10, 14, 'ind bad')] : []),
];
phaseMonitor.symbol = (d) => [
  ...leads(PX, 0, 24), Re(10, 24, 100, 34, 'sl fill'), Tx(60, 46, 'L1 L2 L3', 'txt xs'),
  L(60, 100, 60, 76), L(60, 76, d.state.ok ? 140 : 100, 64, 'sl on'), L(100, 100, 100, 70), L(140, 100, 140, 70),
  L(110, 41, 130, 41, 'sl dash'), L(130, 41, 130, 66, 'sl dash'),
  Re(118, 8, 10, 12, d.state.ok ? 'ind on' : 'ind bad'),
];
heater3ph.symbol = (d, _l, n) => [
  ...leads([20, 60, 100], 0, 30), L(140, 0, 140, 20, 'sl pe'),
  ...[20, 60, 100].map((x) => Re(x - 6, 30, 12, 34, 'sl fill')),
  L(20, 64, 20, 80), L(60, 64, 60, 80), L(100, 64, 100, 80), L(20, 80, 100, 80),
  Tx(130, 70, `${n(p(d, 'P'))} kW`, 'txt xs'),
];
capacitorBank.symbol = (d, _l, n) => [
  ...leads([20, 60, 100], 0, 30), L(140, 0, 140, 20, 'sl pe'),
  L(20, 30, 100, 30), L(20, 30, 20, 50), L(100, 30, 100, 50),
  L(10, 50, 30, 50, 'sl w3'), L(10, 56, 30, 56, 'sl w3'), L(90, 50, 110, 50, 'sl w3'), L(90, 56, 110, 56, 'sl w3'),
  L(20, 56, 20, 80), L(100, 56, 100, 80), L(20, 80, 100, 80),
  Tx(130, 70, `${n(p(d, 'Q'))} kvar`, 'txt xs'), ...(d.state.on === false ? [L(40, 40, 80, 70, 'sl off')] : []),
];
powerAnalyzer.symbol = () => [
  ...leads([20, 60, 100, 140], 0, 30), ...leads([20, 60, 100, 140], 70, 100),
  Re(8, 30, 144, 40, 'sl fill'), Tx(80, 48, 'P Q S cos φ', 'txt xs'), Tx(80, 62, 'L1 L2 L3', 'txt xs'),
];
phaseSequenceMeter.symbol = (_d, look) => [
  ...leads(PX, 0, 26), Ci(60, 50, 22, 'sl fill'),
  { t: 'rotor', cx: 60, cy: 50, spin: look.state === 'sequence_direct' || look.state === 'sequence_inverse' ? 0.5 : 0, dir: look.state === 'sequence_inverse' ? -1 : 1, items: [Pa('M60 34 l5 6 h-10 z', 'sl fill'), L(60, 40, 60, 58)] },
];
phaseLoss.symbol = (d) => [
  ...PX.flatMap((x, k) => (d.state.active && LOST[ps(d, 'phase')] === k ? [L(x, 0, x, 30), L(x, 50, x, 80), Pa(`M${x - 6} 34 l12 12 M${x + 6} 34 l-12 12`, 'sl bad')] : [L(x, 0, x, 80)])),
  Pa('M112 30 l-8 10 h6 l-8 12', 'sl bad'),
];
phaseReversal.symbol = (d) =>
  d.state.active
    ? [L(20, 0, 20, 80), L(60, 0, 60, 28), L(100, 0, 100, 28), L(60, 28, 100, 52, 'sl on'), L(100, 28, 60, 52, 'sl on'), L(60, 52, 60, 80), L(100, 52, 100, 80), Pa('M112 30 l-8 10 h6 l-8 12', 'sl bad')]
    : [...leads(PX, 0, 80), Pa('M112 30 l-8 10 h6 l-8 12', 'sl')];
