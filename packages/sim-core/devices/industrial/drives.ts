/**
 * Accionamentos: arrancador estrela-triângulo integrado, arrancador suave e variador de frequência.
 *
 * O variador usa um modelo V/f simplificado: a saída é uma fonte trifásica de tensão
 * proporcional à frequência; a frequência chega ao motor como fracção da frequência da rede.
 * A entrada é uma carga resistiva que absorve a potência de saída mais as perdas, com os
 * harmónicos típicos de um rectificador de 6 impulsos indicados nas medições.
 */
import { cabs, csub, power, rms } from '../../solver/complex';
import { diag, dev } from '../../diagnostics/types';
import { m, ms, num, p, sel } from '../common';
import type { Device } from '../../project/types';
import type { DeviceDef, SolutionView, TerminalDef } from '../types';
import { L, Pa, Re, Tx, type Prim } from '../symbols';
import { DROP_OUT, PICK_UP } from './command';

const IND = ['industrial'] as const;
const SQ3 = Math.sqrt(3);

const t = (id: string, x: number, y: number, label = id, kind: TerminalDef['kind'] = 'any'): TerminalDef => ({ id, x, y, kind, label });
const coilEnergized = (sol: SolutionView, d: Device, was: boolean) => {
  const V = rms(sol.vv(d, 'A1', 'A2'));
  return was ? V >= DROP_OUT * p(d, 'Uc') : V >= PICK_UP * p(d, 'Uc');
};

/* ---------------- Arrancador estrela-triângulo ---------------- */

interface StageRT {
  t?: number;
}

const SD_MAIN = [
  ['1', 'U1'],
  ['3', 'V1'],
  ['5', 'W1'],
] as const;
const SD_DELTA = [
  ['1', 'W2'],
  ['3', 'U2'],
  ['5', 'V2'],
] as const;

export const starDeltaStarter: DeviceDef<StageRT> = {
  type: 'starDeltaStarter',
  category: 'motors',
  domain: [...IND],
  level: 'pro',
  prefix: 'K',
  size: { w: 280, h: 120 },
  terminals: [
    t('A1', 20, 0), t('1', 60, 0), t('3', 100, 0), t('5', 140, 0),
    t('A2', 20, 120), t('U1', 60, 120), t('V1', 100, 120), t('W1', 140, 120), t('W2', 180, 120), t('U2', 220, 120), t('V2', 260, 120),
  ],
  params: [num('t', 5, 's', 0.5, 60, 0.5), sel('Uc', [24, 230], 230, 'V')],
  initialState: () => ({ stage: 'off' }),
  coilOperated: true,
  load: { phase: 'A1', neutral: 'A2', nominalVoltage: (d) => p(d, 'Uc'), working: (d) => d.state.stage !== 'off' },
  conducts: (d) => {
    const on = d.state.stage !== 'off';
    return [
      ...SD_MAIN.map(([a, b]) => ({ a, b, closed: on })),
      { a: 'W2', b: 'U2', closed: d.state.stage === 'star' },
      { a: 'U2', b: 'V2', closed: d.state.stage === 'star' },
      ...SD_DELTA.map(([a, b]) => ({ a, b, closed: d.state.stage === 'delta' })),
    ];
  },
  stamp(d, b) {
    const on = d.state.stage !== 'off';
    b.R(b.node('A1'), b.node('A2'), (p(d, 'Uc') ** 2) / 10, 'coil');
    SD_MAIN.forEach(([x, y], k) => b.sw(b.node(x), b.node(y), on, 'm' + k));
    b.sw(b.node('W2'), b.node('U2'), d.state.stage === 'star', 's0');
    b.sw(b.node('U2'), b.node('V2'), d.state.stage === 'star', 's1');
    SD_DELTA.forEach(([x, y], k) => b.sw(b.node(x), b.node(y), d.state.stage === 'delta', 'd' + k));
  },
  logic(d, ctx, rt) {
    const coil = coilEnergized(ctx.sol, d, d.state.stage !== 'off');
    if (!coil) {
      if (d.state.stage === 'off') return false;
      d.state.stage = 'off';
      return true;
    }
    if (d.state.stage === 'off') {
      d.state.stage = 'star';
      rt.t = 0;
      return true;
    }
    if (d.state.stage === 'star') {
      rt.t = (rt.t ?? 0) + ctx.dt;
      if (rt.t + 1e-9 >= p(d, 't')) {
        d.state.stage = 'delta';
        ctx.emit({ code: 'star_delta_switch', severity: 'info', values: { device: d.name } });
        return true;
      }
    }
    return false;
  },
  measure: (d, sol, rt) => [
    ms('meas.state', `stage_${String(d.state.stage)}`),
    m('meas.elapsed', d.state.stage === 'star' ? rt.t ?? 0 : 0, 's'),
    m('meas.current', Math.max(...SD_MAIN.map((_, k) => rms(sol.i(d, 'm' + k)))), 'A'),
    m('meas.coilVoltage', rms(sol.vv(d, 'A1', 'A2')), 'V'),
  ],
  model3d: 'starter',
  simplifications: ['simpl.star_delta_no_gap'],
};

/* ---------------- Arrancador suave ---------------- */

const SS_POLES = [
  ['1', '2'],
  ['3', '4'],
  ['5', '6'],
] as const;

export const softStarter: DeviceDef<StageRT> = {
  type: 'softStarter',
  category: 'motors',
  domain: [...IND],
  level: 'pro',
  prefix: 'K',
  size: { w: 160, h: 120 },
  terminals: [t('A1', 20, 0), t('1', 60, 0), t('3', 100, 0), t('5', 140, 0), t('A2', 20, 120), t('2', 60, 120), t('4', 100, 120), t('6', 140, 120)],
  params: [num('tRamp', 10, 's', 1, 60, 1), num('U0', 40, '%', 20, 80, 5), sel('Uc', [24, 230], 230, 'V')],
  initialState: () => ({ stage: 'off' }),
  coilOperated: true,
  load: { phase: 'A1', neutral: 'A2', nominalVoltage: (d) => p(d, 'Uc'), working: (d) => d.state.stage !== 'off' },
  conducts: (d) => SS_POLES.map(([a, b]) => ({ a, b, closed: d.state.stage !== 'off' })),
  stamp(d, b, rt) {
    b.R(b.node('A1'), b.node('A2'), (p(d, 'Uc') ** 2) / 5, 'coil');
    if (d.state.stage === 'bypass') {
      SS_POLES.forEach(([x, y], k) => b.sw(b.node(x), b.node(y), true, 'p' + k));
    } else if (d.state.stage === 'ramp') {
      // Tensão de saída reduzida: transformador ideal por fase com relação 1/k.
      const k = rampFactor(d, rt);
      const ni = b.internal('ni');
      const no = b.internal('no');
      b.R(ni, b.ground, 1e6, 'gi');
      b.R(no, b.ground, 1e6, 'go');
      SS_POLES.forEach(([x, y], i) => {
        const pi = b.internal('pi' + i);
        b.R(b.node(x), pi, 1e-3, 'p' + i);
        b.X(pi, ni, b.node(y), no, 1 / k, 'x' + i);
      });
    }
  },
  logic(d, ctx, rt) {
    const coil = coilEnergized(ctx.sol, d, d.state.stage !== 'off');
    if (!coil) {
      if (d.state.stage === 'off') return false;
      d.state.stage = 'off';
      return true;
    }
    if (d.state.stage === 'off') {
      d.state.stage = 'ramp';
      rt.t = 0;
      return true;
    }
    if (d.state.stage === 'ramp') {
      rt.t = (rt.t ?? 0) + ctx.dt;
      if (rt.t >= p(d, 'tRamp')) {
        d.state.stage = 'bypass';
        ctx.emit({ code: 'soft_start_done', severity: 'info', values: { device: d.name } });
        return true;
      }
    }
    return false;
  },
  measure: (d, sol, rt) => [
    ms('meas.state', `stage_${String(d.state.stage)}`),
    m('meas.outputVoltage', d.state.stage === 'off' ? 0 : 100 * (d.state.stage === 'bypass' ? 1 : rampFactor(d, rt)), '%'),
    m('meas.current', Math.max(...SS_POLES.map((_, k) => rms(sol.i(d, 'p' + k)))), 'A'),
  ],
  model3d: 'starter',
  simplifications: ['simpl.soft_starter'],
};

const rampFactor = (d: Device, rt: StageRT) => {
  const u0 = p(d, 'U0') / 100;
  return Math.min(1, u0 + ((1 - u0) * (rt.t ?? 0)) / p(d, 'tRamp'));
};

/* ---------------- Variador de frequência ---------------- */

interface VfdRT {
  /** Frequência de saída (Hz). */
  f?: number;
  dirOut?: 1 | -1;
  fault?: string | null;
  pOut?: number;
  di1?: boolean;
  di2?: boolean;
  fGrid?: number;
}

/** Harmónicos de corrente de um rectificador de 6 impulsos com indutância no barramento DC (fracção de I1). */
export const VFD_HARMONICS: Record<number, number> = { 5: 0.35, 7: 0.2, 11: 0.09, 13: 0.07 };
export const VFD_THD = Math.sqrt(Object.values(VFD_HARMONICS).reduce((s, x) => s + x * x, 0));
const VFD_ETA = 0.97;
const VFD_IN = 400;
const OUT = ['U', 'V', 'W'] as const;
const IN = ['L1', 'L2', 'L3'] as const;

const vfdKf = (rt: VfdRT) => (rt.f ?? 0) / (rt.fGrid ?? 50);
const outputOn = (rt: VfdRT) => !rt.fault && (rt.f ?? 0) > 0.05;

export const vfd: DeviceDef<VfdRT> = {
  type: 'vfd',
  category: 'motors',
  domain: [...IND],
  level: 'pro',
  prefix: 'T',
  size: { w: 240, h: 140 },
  terminals: [
    t('L1', 20, 0, 'L1', 'L1'), t('L2', 60, 0, 'L2', 'L2'), t('L3', 100, 0, 'L3', 'L3'), t('PE', 140, 0, 'PE', 'PE'),
    t('U', 20, 140), t('V', 60, 140), t('W', 100, 140),
    t('24V', 160, 140, '+24'), t('DI1', 180, 140), t('DI2', 200, 140), t('COM', 220, 140),
  ],
  params: [num('fTarget', 50, 'Hz', 0, 60, 1), num('tAcc', 5, 's', 0.5, 60, 0.5), num('tDec', 5, 's', 0.5, 60, 0.5)],
  initialState: () => ({ run: false, rev: false, output: false }),
  classI: true,
  load: { phase: 'L1', neutral: 'L2', phases: [...IN], nominalVoltage: () => VFD_IN, working: (_d, _s, rt: VfdRT) => outputOn(rt) },
  sourceRoles: () => ({ U: 'phase', V: 'phase', W: 'phase' }),
  outputFrequency: (_d, rt) => (outputOn(rt) ? { terminals: [...OUT], factor: Math.max(vfdKf(rt), 0.02) } : null),
  stamp(d, b, rt) {
    // Entrada: carga em estrela que absorve a potência de saída mais as perdas.
    const ni = b.internal('ni');
    b.R(ni, b.ground, 1e6, 'gi');
    const Pin = Math.max(30, (rt.pOut ?? 0) / VFD_ETA);
    const Rin = (VFD_IN / SQ3) ** 2 / (Pin / 3);
    IN.forEach((x, k) => b.R(b.node(x), ni, Rin, 'in' + k));
    // Fonte auxiliar de 24 V para as entradas digitais e entradas com 4,8 kΩ.
    if (!rt.fault) {
      const ip = b.internal('aux');
      b.V(ip, b.node('COM'), { dc: 24 }, 'v24');
      b.R(ip, b.node('24V'), 0.5, 'r24');
    }
    b.R(b.node('DI1'), b.node('COM'), 4800, 'di1');
    b.R(b.node('DI2'), b.node('COM'), 4800, 'di2');
    if (!outputOn(rt)) return;
    const kf = vfdKf(rt);
    const no = b.internal('no');
    b.R(no, b.ground, 1e6, 'go');
    const Vph = (VFD_IN / SQ3) * Math.min(1, kf);
    const dir = rt.dirOut ?? 1;
    OUT.forEach((x, k) => {
      const o = b.internal('o' + k);
      b.V(o, no, { ac: Vph, phase: [0, -120 * dir, 120 * dir][k] }, 'v' + k);
      b.R(o, b.node(x), 0.05, 'ro' + k);
    });
  },
  logic(d, ctx, rt) {
    rt.fGrid = ctx.project.frequency;
    const sol = ctx.sol;
    const v = IN.map((x) => sol.v(d, x).ac);
    const llMin = Math.min(cabs(csub(v[0]!, v[1]!)), cabs(csub(v[1]!, v[2]!)), cabs(csub(v[2]!, v[0]!)));
    let changed = false;
    const powered = llMin >= 0.7 * VFD_IN;
    if (!powered && !rt.fault && ((rt.f ?? 0) > 0 || d.state.run)) {
      rt.fault = 'undervoltage';
      rt.f = 0;
      d.state.run = false;
      ctx.emit({ code: 'vfd_fault', severity: 'error', values: { device: d.name, voltage: ctx.fmt(llMin, 'V') } });
      return true;
    }
    rt.di1 = sol.vv(d, 'DI1', 'COM').dc > 15;
    rt.di2 = sol.vv(d, 'DI2', 'COM').dc > 15;
    const run = !rt.fault && powered && (!!d.state.run || rt.di1 || rt.di2);
    const want: 1 | -1 = rt.di2 ? -1 : rt.di1 ? 1 : d.state.rev ? -1 : 1;
    const f0 = rt.f ?? 0;
    const fb = rt.fGrid;
    let target = run ? p(d, 'fTarget') : 0;
    // Mudar de sentido: desacelerar até parar e arrancar ao contrário.
    if (f0 > 0 && want !== (rt.dirOut ?? 1)) target = 0;
    if (f0 === 0) rt.dirOut = want;
    if (ctx.dt > 0) {
      const up = (fb / p(d, 'tAcc')) * ctx.dt;
      const dn = (fb / p(d, 'tDec')) * ctx.dt;
      rt.f = target > f0 ? Math.min(target, f0 + up) : Math.max(target, f0 - dn);
      if (rt.f < 1e-6) rt.f = 0;
      // Potência de saída do passo, para a carga equivalente à entrada.
      rt.pOut = outputOn(rt) ? outputPower(sol, d) : 0;
    }
    if ((f0 > 0.05) !== ((rt.f ?? 0) > 0.05)) changed = true;
    d.state.output = outputOn(rt);
    return changed;
  },
  measure(d, sol, rt) {
    const I1 = Math.max(...IN.map((_, k) => rms(sol.i(d, 'in' + k))));
    const Iout = Math.max(...OUT.map((_, k) => rms(sol.i(d, 'ro' + k))));
    const f = rt.f ?? 0;
    const target = d.state.run || rt.di1 || rt.di2 ? p(d, 'fTarget') : 0;
    const state = rt.fault ? 'fault' : f < 0.05 ? 'stopped' : Math.abs(f - target) < 0.05 ? 'running' : f < target ? 'accelerating' : 'decelerating';
    return [
      ms('meas.state', state),
      ms('meas.direction', f < 0.05 ? 'none' : (rt.dirOut ?? 1) > 0 ? 'forward' : 'reverse'),
      m('meas.frequency', f, 'Hz'),
      m('meas.outputVoltage', outputOn(rt) ? VFD_IN * Math.min(1, vfdKf(rt)) : 0, 'V'),
      m('meas.outputCurrent', Iout, 'A'),
      m('meas.inputCurrent', I1 * Math.sqrt(1 + VFD_THD ** 2), 'A'),
      m('meas.activePower', (rt.pOut ?? 0) / VFD_ETA, 'W', true),
      m('meas.thdI', 100 * VFD_THD, '%', true),
      m('meas.h5', 100 * VFD_HARMONICS[5]!, '%', true),
      m('meas.h7', 100 * VFD_HARMONICS[7]!, '%', true),
    ];
  },
  actions: (d) => [
    ...(d.state.run ? [{ id: 'stop' }] : [{ id: 'run_fwd' }, { id: 'run_rev' }]),
    { id: 'reset_fault' },
  ],
  operate(d, a, rt) {
    if (a === 'run_fwd') Object.assign(d.state, { run: true, rev: false });
    else if (a === 'run_rev') Object.assign(d.state, { run: true, rev: true });
    else if (a === 'stop') d.state.run = false;
    else if (a === 'reset_fault' && rt.fault) rt.fault = null;
    else return false;
    return true;
  },
  diagnose: (d, ctx, rt) => (rt.fault ? [diag('VFD_UNDERVOLTAGE', 'error', [dev(d.id)], { device: d.name }, d.id)] : []),
  model3d: 'vfd',
  simplifications: ['simpl.vfd_vf'],
};

function outputPower(sol: SolutionView, d: Device): number {
  const no = sol.vInternal(d, 'no');
  let P = 0;
  OUT.forEach((_, k) => {
    const vo = sol.vInternal(d, 'o' + k);
    P += power({ ac: csub(vo.ac, no.ac), dc: 0 }, sol.i(d, 'ro' + k)).P;
  });
  return Math.max(0, P);
}

export const drives = [starDeltaStarter, softStarter, vfd];

/* ---------------- Símbolos ---------------- */

const box = (x: number, y: number, w: number, h: number, on: boolean): Prim => Re(x, y, w, h, on ? 'sl fill on' : 'sl fill');

starDeltaStarter.symbol = (d, _l, n) => {
  const st = String(d.state.stage);
  return [
    L(20, 0, 20, 30), L(20, 90, 20, 120), ...[60, 100, 140].map((x) => L(x, 0, x, 30)), ...[60, 100, 140, 180, 220, 260].map((x) => L(x, 90, x, 120)),
    box(6, 30, 268, 60, st !== 'off'),
    Tx(100, 58, 'Y', st === 'star' ? 'txt big on' : 'txt big'), Tx(170, 58, 'Δ', st === 'delta' ? 'txt big on' : 'txt big'),
    Tx(140, 80, `${n(p(d, 't'))} s`, 'txt xs'),
  ];
};
softStarter.symbol = (d) => [
  L(20, 0, 20, 30), L(20, 90, 20, 120), ...[60, 100, 140].flatMap((x) => [L(x, 0, x, 30), L(x, 90, x, 120)]),
  box(6, 30, 148, 60, d.state.stage !== 'off'),
  Pa('M40 76 L80 44 L120 44', 'sl'), Tx(100, 84, d.state.stage === 'bypass' ? '100 %' : '↗', 'txt xs'),
];
vfd.symbol = (d, look, n) => [
  ...[20, 60, 100].map((x) => L(x, 0, x, 30)), L(140, 0, 140, 30, 'sl pe'),
  ...[20, 60, 100, 160, 180, 200, 220].map((x) => L(x, 110, x, 140)),
  box(6, 30, 228, 80, look.num('frequency') > 0.05),
  L(6, 110, 234, 30, 'sl thin'), Tx(60, 58, '3~', 'txt sm'), Tx(180, 98, '3~ f', 'txt sm'),
  Tx(160, 58, `${n(Math.round(look.num('frequency') * 10) / 10)} Hz`, 'txt sm'),
  ...(d.state.run ? [Re(214, 36, 10, 10, 'ind on')] : []),
];
