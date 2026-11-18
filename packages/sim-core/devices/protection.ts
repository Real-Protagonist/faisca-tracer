/** Protecção: disjuntores, fusível gG, diferencial, disjuntor diferencial, interruptor geral. */
import { rms } from '../solver/complex';
import { diag, dev, type Diagnostic } from '../diagnostics/types';
import { FUSE_RATINGS, MCB_RATINGS } from '../checks/tables';
import {
  breakerActions,
  breakerLogic,
  breakerStateKey,
  forceBreakerClosed,
  fuseTime,
  m,
  mcbTripTime,
  ms,
  p,
  ps,
  rcdTestResistance,
  residualLogic,
  sel,
  toggleBreaker,
  type BreakerRT,
  type RcdRT,
} from './common';

import type { ActionDef, DeviceDef, Measurement, TerminalDef } from './types';
import { indicator, L, Pa, pole, Tx } from './symbols';

const mcbParams = () => [
  sel('In', MCB_RATINGS, 10, 'A'),
  sel('curve', ['B', 'C', 'D'], 'C', undefined, false, true),
  sel('Icn', [3, 4.5, 6, 10, 15, 25], 6, 'kA', true),
];

const TOP_BOTTOM_1P: TerminalDef[] = [
  { id: '1', x: 30, y: 0, kind: 'any', label: '1' },
  { id: '2', x: 30, y: 100, kind: 'any', label: '2' },
];
const TOP_BOTTOM_2P: TerminalDef[] = [
  { id: '1', x: 20, y: 0, kind: 'L', label: '1' },
  { id: '3', x: 60, y: 0, kind: 'N', label: 'N' },
  { id: '2', x: 20, y: 100, kind: 'L', label: '2' },
  { id: '4', x: 60, y: 100, kind: 'N', label: 'N' },
];

/** Diagnósticos de um aparelho com disparo (disjuntor, diferencial). */
export function tripDiagnostics(d: { id: string; name: string; state: Record<string, unknown>; params: Record<string, unknown> }, fmt: (v: number, u: string) => string): Diagnostic[] {
  const out: Diagnostic[] = [];
  const I = Number(d.state.tripCurrent ?? 0);
  const In = Number(d.params.In);
  const base = { device: d.name, current: fmt(I, 'A'), rated: fmt(In, 'A'), ratio: fmt(I / In, '') };
  if (d.state.trip === 'magnetic') {
    out.push(diag('MCB_MAGNETIC_TRIP', 'error', [dev(d.id)], base, d.id));
    if (d.state.icnExceeded)
      out.push(diag('MCB_BREAKING_CAPACITY', 'error', [dev(d.id)], { ...base, icn: fmt(Number(d.params.Icn), 'kA') }, d.id));
  } else if (d.state.trip === 'thermal') {
    out.push(diag('MCB_THERMAL_TRIP', 'error', [dev(d.id)], base, d.id));
  } else if (d.state.trip === 'residual') {
    out.push(
      diag(
        'RCD_TRIP',
        'error',
        [dev(d.id)],
        { device: d.name, current: fmt(I, 'A'), idn: fmt(Number(d.params.IDn) / 1000, 'A'), location: String(d.state.tripLocation || '—') },
        d.id,
      ),
    );
  }
  return out;
}

const breakerMeasure = (d: { state: Record<string, unknown>; params: Record<string, unknown> }, I: number, rt: BreakerRT): Measurement[] => {
  const In = Number(d.params.In);
  return [
    ms('meas.state', breakerStateKey(d as never)),
    m('meas.current', I, 'A'),
    m('meas.loadRatio', (100 * I) / In, '%'),
    m('meas.thermal', 100 * (rt.heat ?? 0), '%'),
    m('meas.tripTime', mcbTripTime(I / In), 's', true),
  ];
};

/* ---------------- Disjuntor 1P ---------------- */

export const mcb1p: DeviceDef<BreakerRT> = {
  type: 'mcb1p',
  category: 'protection',
  domain: ['domestic'],
  level: 'beginner',
  prefix: 'Q',
  size: { w: 60, h: 100 },
  terminals: TOP_BOTTOM_1P,
  params: mcbParams(),
  initialState: () => ({ closed: true, trip: null }),
  conducts: (d) => [{ a: '1', b: '2', closed: !!d.state.closed }],
  protection: { inputs: ['1'], outputs: ['2'], ratedCurrent: (d) => p(d, 'In') },
  stamp(d, b) {
    b.sw(b.node('1'), b.node('2'), !!d.state.closed, 'p1');
  },
  logic: (d, ctx, rt) => breakerLogic(d, ctx, rt, rms(ctx.sol.i(d, 'p1'))),
  measure: (d, sol, rt) => breakerMeasure(d, rms(sol.i(d, 'p1')), rt),
  actions: breakerActions,
  operate: (d, a) => (['open', 'close', 'reset'].includes(a) ? toggleBreaker(d) : false),
  diagnose: (d, ctx) => tripDiagnostics(d, ctx.fmt),
  forceClosed: forceBreakerClosed,
  model3d: 'din-1p',
  simplifications: ['simpl.mcb_thermal'],
};

/* ---------------- Disjuntor 1P+N ---------------- */

export const mcb1pn: DeviceDef<BreakerRT> = {
  ...mcb1p,
  type: 'mcb1pn',
  size: { w: 80, h: 100 },
  terminals: TOP_BOTTOM_2P,
  conducts: (d) => [
    { a: '1', b: '2', closed: !!d.state.closed },
    { a: '3', b: '4', closed: !!d.state.closed },
  ],
  protection: { inputs: ['1', '3'], outputs: ['2', '4'], ratedCurrent: (d) => p(d, 'In') },
  stamp(d, b) {
    b.sw(b.node('1'), b.node('2'), !!d.state.closed, 'p1');
    b.sw(b.node('3'), b.node('4'), !!d.state.closed, 'p3');
  },
  model3d: 'din-2p',
};

/* ---------------- Fusível gG ---------------- */

interface FuseRT {
  damage?: number;
}

export const fuseGG: DeviceDef<FuseRT> = {
  type: 'fuseGG',
  category: 'protection',
  domain: ['domestic'],
  level: 'pro',
  prefix: 'F',
  size: { w: 60, h: 100 },
  terminals: TOP_BOTTOM_1P,
  params: [sel('In', FUSE_RATINGS, 16, 'A'), sel('Icn', [50, 80, 100], 100, 'kA', true)],
  initialState: () => ({ blown: false }),
  conducts: (d) => [{ a: '1', b: '2', closed: !d.state.blown }],
  protection: { inputs: ['1'], outputs: ['2'], ratedCurrent: (d) => p(d, 'In') },
  stamp(d, b) {
    if (!d.state.blown) b.R(b.node('1'), b.node('2'), 0.003, 'p1');
  },
  logic(d, ctx, rt) {
    if (d.state.blown) return false;
    const I = rms(ctx.sol.i(d, 'p1'));
    const t = fuseTime(I, p(d, 'In'));
    if (Number.isFinite(t)) rt.damage = (rt.damage ?? 0) + ctx.dt / t;
    else rt.damage = Math.max(0, (rt.damage ?? 0) - ctx.dt / 300);
    if (rt.damage >= 1) {
      d.state.blown = true;
      d.state.blowCurrent = I;
      rt.damage = 0;
      ctx.emit({
        code: 'fuse_blown',
        severity: 'error',
        values: { device: d.name, current: ctx.fmt(I, 'A'), ratio: ctx.fmt(I / p(d, 'In'), ''), rated: ctx.fmt(p(d, 'In'), 'A') },
      });
      return true;
    }
    return false;
  },
  measure(d, sol, rt) {
    const I = rms(sol.i(d, 'p1'));
    return [
      ms('meas.state', d.state.blown ? 'blown' : 'in_service'),
      m('meas.current', I, 'A'),
      m('meas.loadRatio', (100 * I) / p(d, 'In'), '%'),
      m('meas.thermal', 100 * Math.min(1, rt.damage ?? 0), '%'),
    ];
  },
  actions: (d) => (d.state.blown ? [{ id: 'replace' }] : []),
  operate(d, a, rt) {
    if (a !== 'replace' || !d.state.blown) return false;
    d.state.blown = false;
    rt.damage = 0;
    return true;
  },
  diagnose: (d, ctx) => {
    if (!d.state.blown) return [];
    const I = Number(d.state.blowCurrent ?? 0);
    return [
      diag('FUSE_BLOWN', 'error', [dev(d.id)], { device: d.name, current: ctx.fmt(I, 'A'), rated: ctx.fmt(p(d, 'In'), 'A'), ratio: ctx.fmt(I / p(d, 'In'), '') }, d.id),
    ];
  },
  forceClosed: (d) => {
    d.state.blown = false;
  },
  model3d: 'fuse-holder',
  simplifications: ['simpl.fuse_table'],
};

/* ---------------- Interruptor diferencial 2P ---------------- */

const rcdParams = () => [
  sel('IDn', [10, 30, 100, 300, 500], 30, 'mA'),
  sel('In', [25, 40, 63, 80], 40, 'A', true),
  sel('rcdType', ['AC', 'A'], 'A', undefined, true),
];

const rcdActions = (d: { state: Record<string, unknown> }): ActionDef[] => [
  { id: d.state.closed ? 'open' : d.state.trip ? 'reset' : 'close' },
  { id: 'test' },
];

function rcdOperate(d: Parameters<typeof toggleBreaker>[0], a: string, rt: RcdRT): boolean {
  if (a === 'test') {
    if (!d.state.closed) return false;
    rt.test = 0.3;
    return true;
  }
  return ['open', 'close', 'reset'].includes(a) ? toggleBreaker(d) : false;
}

export const rcd2p: DeviceDef<RcdRT> = {
  type: 'rcd2p',
  category: 'protection',
  domain: ['domestic'],
  level: 'beginner',
  prefix: 'Q',
  size: { w: 80, h: 100 },
  terminals: TOP_BOTTOM_2P,
  params: rcdParams(),
  initialState: () => ({ closed: true, trip: null }),
  conducts: (d) => [
    { a: '1', b: '2', closed: !!d.state.closed },
    { a: '3', b: '4', closed: !!d.state.closed },
  ],
  stamp(d, b, rt) {
    b.sw(b.node('1'), b.node('2'), !!d.state.closed, 'p1');
    b.sw(b.node('3'), b.node('4'), !!d.state.closed, 'p3');
    // Botão de teste: resistência da saída de fase para o neutro de entrada (fora do toro).
    if (d.state.closed && (rt.test ?? 0) > 0) b.R(b.node('2'), b.node('3'), rcdTestResistance(p(d, 'IDn')), 'test');
  },
  logic: (d, ctx, rt) => residualLogic(d, ctx, rt, ['p1', 'p3']),
  measure: (d, sol, rt) => [
    ms('meas.state', breakerStateKey(d)),
    m('meas.current', rms(sol.i(d, 'p1')), 'A'),
    m('meas.residualCurrent', rt.ires ?? 0, 'A'),
    m('meas.sensitivity', p(d, 'IDn') / 1000, 'A'),
  ],
  actions: rcdActions,
  operate: rcdOperate,
  diagnose: (d, ctx) => tripDiagnostics(d, ctx.fmt),
  forceClosed: forceBreakerClosed,
  model3d: 'din-2p',
  simplifications: ['simpl.rcd_type'],
};

/* ---------------- Disjuntor diferencial ---------------- */

export const rcbo: DeviceDef<RcdRT & BreakerRT> = {
  ...(rcd2p as DeviceDef<RcdRT & BreakerRT>),
  type: 'rcbo',
  level: 'pro',
  params: [...mcbParams(), sel('IDn', [10, 30, 100, 300], 30, 'mA')],
  protection: { inputs: ['1', '3'], outputs: ['2', '4'], ratedCurrent: (d) => p(d, 'In') },
  logic(d, ctx, rt) {
    if (breakerLogic(d, ctx, rt, rms(ctx.sol.i(d, 'p1')))) return true;
    return residualLogic(d, ctx, rt, ['p1', 'p3']);
  },
  measure: (d, sol, rt) => [
    ...breakerMeasure(d, rms(sol.i(d, 'p1')), rt),
    m('meas.residualCurrent', rt.ires ?? 0, 'A'),
    m('meas.sensitivity', p(d, 'IDn') / 1000, 'A'),
  ],
  simplifications: ['simpl.mcb_thermal', 'simpl.rcd_type'],
};

/* ---------------- Interruptor geral 2P ---------------- */

export const mainSwitch2p: DeviceDef = {
  type: 'mainSwitch2p',
  category: 'protection',
  domain: ['domestic'],
  level: 'beginner',
  prefix: 'Q',
  size: { w: 80, h: 100 },
  terminals: TOP_BOTTOM_2P,
  params: [sel('In', [25, 40, 63, 100], 40, 'A')],
  initialState: () => ({ closed: true }),
  conducts: (d) => [
    { a: '1', b: '2', closed: !!d.state.closed },
    { a: '3', b: '4', closed: !!d.state.closed },
  ],
  stamp(d, b) {
    b.sw(b.node('1'), b.node('2'), !!d.state.closed, 'p1');
    b.sw(b.node('3'), b.node('4'), !!d.state.closed, 'p3');
  },
  measure: (d, sol) => [
    ms('meas.state', d.state.closed ? 'closed' : 'open'),
    m('meas.current', rms(sol.i(d, 'p1')), 'A'),
    m('meas.loadRatio', (100 * rms(sol.i(d, 'p1'))) / p(d, 'In'), '%'),
  ],
  actions: (d) => [{ id: d.state.closed ? 'open' : 'close' }],
  operate: (d, a) => {
    if (a === 'open') d.state.closed = false;
    else if (a === 'close') d.state.closed = true;
    else return false;
    return true;
  },
  forceClosed: (d) => {
    d.state.closed = true;
  },
  model3d: 'din-2p',
};

export const protection = [mcb1p, mcb1pn, fuseGG, rcd2p, rcbo, mainSwitch2p];


/* ---------------- Símbolos ---------------- */

const cl = (d: { state: Record<string, unknown> }) => !!d.state.closed;
const rcdRing = (cx: number, rx: number) => ({ t: 'ellipse' as const, cx, cy: 78, rx, ry: 6, cls: 'sl' });

mcb1p.symbol = (d, _l, n) => [...pole(30, 0, 100, cl(d), { breaker: true }), Tx(46, 56, `${ps(d, 'curve')}${n(p(d, 'In'))}`, 'txt sm', 'start'), indicator(44, 14, d.state)];
mcb1pn.symbol = (d, _l, n) => [
  ...pole(20, 0, 100, cl(d), { breaker: true }), ...pole(60, 0, 100, cl(d)),
  L(14, 50, 54, 50, 'sl dash'), Tx(40, 30, `${ps(d, 'curve')}${n(p(d, 'In'))}`), indicator(68, 44, d.state),
];
fuseGG.symbol = (d, _l, n) => [...pole(30, 0, 100, !d.state.blown, { fuse: true }), Tx(44, 56, `${n(p(d, 'In'))} A`, 'txt sm', 'start')];
rcd2p.symbol = (d, _l, n) => [
  ...pole(20, 0, 100, cl(d)), ...pole(60, 0, 100, cl(d)), L(14, 50, 54, 50, 'sl dash'), rcdRing(40, 27),
  Tx(40, 24, `IΔ ${n(p(d, 'IDn'))} mA`), indicator(68, 44, d.state),
];
rcbo.symbol = (d, _l, n) => [
  ...pole(20, 0, 100, cl(d), { breaker: true }), ...pole(60, 0, 100, cl(d)), L(14, 50, 54, 50, 'sl dash'), rcdRing(40, 27),
  Tx(40, 20, `${ps(d, 'curve')}${n(p(d, 'In'))}`), Tx(40, 31, `${n(p(d, 'IDn'))} mA`, 'txt xs'), indicator(68, 44, d.state),
];
mainSwitch2p.symbol = (d, _l, n) => [
  ...pole(20, 0, 100, cl(d)), ...pole(60, 0, 100, cl(d)), L(14, 50, 54, 50, 'sl dash'),
  Pa('M14 36 h6'), Tx(40, 24, `${n(p(d, 'In'))} A`),
];
