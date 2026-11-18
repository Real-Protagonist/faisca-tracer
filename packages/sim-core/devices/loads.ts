/** Cargas domésticas: lâmpadas, tomada com aparelhos, aquecedor, campainha. */
import { rms } from '../solver/complex';
import { diag, dev, type Diagnostic } from '../diagnostics/types';
import { clamp, loadImpedance, loadReading, m, ms, num, overvoltageBurn, p, ps, sel } from './common';
import type { Device } from '../project/types';
import type { DeviceDef, TerminalDef } from './types';
import { Ci, glow, L, Pa, Re, Tx, type Prim } from './symbols';

const LN: TerminalDef[] = [
  { id: 'L', x: 20, y: 0, kind: 'L', label: 'L' },
  { id: 'N', x: 60, y: 0, kind: 'N', label: 'N' },
];
const LNPE: TerminalDef[] = [
  { id: 'L', x: 20, y: 0, kind: 'L', label: 'L' },
  { id: 'N', x: 40, y: 0, kind: 'N', label: 'N' },
  { id: 'PE', x: 60, y: 0, kind: 'PE', label: 'PE' },
];

interface BurnRT {
  ov?: number;
}

function wrongVoltage(d: Device, fmt: (v: number, u: string) => string, Vn: number): Diagnostic[] {
  if (!d.state.burnt) return [];
  return [
    diag('WRONG_VOLTAGE', 'error', [dev(d.id)], {
      device: d.name,
      voltage: fmt(Number(d.state.burntVoltage ?? 0), 'V'),
      nominal: fmt(Vn, 'V'),
    }, d.id),
  ];
}

const replaceAction = (d: Device) => (d.state.burnt ? [{ id: 'replace' }] : []);
const replaceOp = (d: Device, a: string) => {
  if (a !== 'replace' || !d.state.burnt) return false;
  d.state.burnt = false;
  return true;
};

/* ---------------- Lâmpada incandescente ---------------- */

export const lampIncandescent: DeviceDef<BurnRT> = {
  type: 'lampIncandescent',
  category: 'loads',
  domain: ['domestic'],
  level: 'beginner',
  prefix: 'H',
  size: { w: 80, h: 80 },
  terminals: LN,
  params: [sel('P', [5, 10, 21, 25, 40, 60, 75, 100, 150, 200], 60, 'W'), sel('Vn', [230, 24, 12], 230, 'V')],
  initialState: () => ({ burnt: false }),
  load: {
    phase: 'L',
    neutral: 'N',
    nominalVoltage: (d) => p(d, 'Vn'),
    lighting: true,
    working: (d, sol) => !d.state.burnt && rms(sol.vv(d, 'L', 'N')) > 0.25 * p(d, 'Vn'),
  },
  stamp(d, b) {
    const Vn = p(d, 'Vn');
    if (!d.state.burnt) b.R(b.node('L'), b.node('N'), (Vn * Vn) / p(d, 'P'), 'z');
  },
  logic: (d, ctx, rt) => overvoltageBurn(d, ctx, rt, rms(ctx.sol.vv(d, 'L', 'N')), p(d, 'Vn')),
  measure(d, sol) {
    const L = loadReading(sol, d, 'L', 'N', 'z');
    const b = d.state.burnt ? 0 : L.P / p(d, 'P');
    return [
      ms('meas.state', d.state.burnt ? 'burnt' : b > 0.06 ? 'lit' : 'unlit'),
      m('meas.brightness', 100 * Math.min(b, 2), '%'),
      ...L.rows.slice(0, 3),
    ];
  },
  actions: replaceAction,
  operate: replaceOp,
  diagnose: (d, ctx) => wrongVoltage(d, ctx.fmt, p(d, 'Vn')),
  model3d: 'lamp-bulb',
  simplifications: ['simpl.lamp_resistance'],
};

/* ---------------- Lâmpada LED ---------------- */

export const lampLed: DeviceDef<BurnRT> = {
  ...lampIncandescent,
  type: 'lampLed',
  params: [sel('P', [4, 7, 9, 12, 15, 20], 9, 'W'), sel('Vn', [230, 24, 12], 230, 'V')],
  load: {
    phase: 'L',
    neutral: 'N',
    nominalVoltage: (d) => p(d, 'Vn'),
    lighting: true,
    working: (d, sol) => !d.state.burnt && rms(sol.vv(d, 'L', 'N')) > 0.6 * p(d, 'Vn'),
  },
  measure(d, sol) {
    const L = loadReading(sol, d, 'L', 'N', 'z');
    // Driver electrónico: brilho constante a partir de ~70 % da tensão nominal.
    const b = d.state.burnt ? 0 : clamp((L.V / p(d, 'Vn') - 0.5) / 0.2, 0, 1);
    return [ms('meas.state', d.state.burnt ? 'burnt' : b > 0.05 ? 'lit' : 'unlit'), m('meas.brightness', 100 * b, '%'), ...L.rows.slice(0, 3)];
  },
  simplifications: ['simpl.led_resistive'],
};

/* ---------------- Lâmpada fluorescente ---------------- */

export const lampFluorescent: DeviceDef = {
  type: 'lampFluorescent',
  category: 'loads',
  domain: ['domestic'],
  level: 'pro',
  prefix: 'H',
  size: { w: 100, h: 70 },
  terminals: [
    { id: 'L', x: 20, y: 0, kind: 'L', label: 'L' },
    { id: 'N', x: 80, y: 0, kind: 'N', label: 'N' },
  ],
  params: [sel('P', [18, 36, 58], 36, 'W'), num('PF', 0.5, '', 0.3, 1, 0.01, true)],
  initialState: () => ({}),
  load: {
    phase: 'L',
    neutral: 'N',
    nominalVoltage: () => 230,
    lighting: true,
    working: (_d, sol) => rms(sol.vv(_d, 'L', 'N')) > 0.75 * 230,
  },
  stamp(d, b) {
    b.Z(b.node('L'), b.node('N'), loadImpedance(p(d, 'P'), p(d, 'PF'), 230, b.omega), 'z');
  },
  measure(d, sol) {
    const L = loadReading(sol, d, 'L', 'N', 'z');
    return [ms('meas.state', L.V > 0.75 * 230 ? 'lit' : 'unlit'), ...L.rows];
  },
  model3d: 'lamp-tube',
  simplifications: ['simpl.fluorescent_ballast'],
};

/* ---------------- Aparelhos e defeitos de isolamento ---------------- */

/** Aparelhos típicos ligados a uma tomada: [id, potência (W), factor de potência]. */
export const APPLIANCES: Record<string, [number, number]> = {
  none: [0, 1],
  charger: [20, 0.6],
  laptop: [65, 0.9],
  tv: [150, 0.95],
  fridge: [200, 0.7],
  iron: [1200, 1],
  microwave: [1300, 0.95],
  heater: [2000, 1],
  washer: [2200, 0.9],
  kettle: [2200, 1],
};

/** Defeito de isolamento entre a fase e a massa (Ω). */
export const DEFECTS: Record<string, number> = { none: 0, slight: 50000, leak: 5000, strong: 500, frank: 0.5 };

const defectR = (d: Device) => DEFECTS[ps(d, 'defect')] ?? 0;

/* ---------------- Tomada com terra ---------------- */

export const socket: DeviceDef = {
  type: 'socket',
  category: 'loads',
  domain: ['domestic'],
  level: 'beginner',
  prefix: 'X',
  size: { w: 80, h: 80 },
  terminals: LNPE,
  params: [
    sel('appliance', Object.keys(APPLIANCES), 'none', undefined, false, true),
    sel('defect', Object.keys(DEFECTS), 'none', undefined, false, true),
  ],
  initialState: () => ({ on: true }),
  classI: true,
  load: {
    phase: 'L',
    neutral: 'N',
    nominalVoltage: () => 230,
    working: (d, sol) => rms(sol.i(d, 'z')) > 1e-3,
  },
  stamp(d, b) {
    const [P, PF] = APPLIANCES[ps(d, 'appliance')] ?? [0, 1];
    if (P <= 0) return;
    if (d.state.on) b.Z(b.node('L'), b.node('N'), loadImpedance(P, PF, 230, b.omega), 'z');
    const rf = defectR(d);
    if (rf > 0) b.R(b.node('L'), b.node('PE'), rf, 'f');
  },
  leakage: (d, sol) => rms(sol.i(d, 'f')),
  measure(d, sol) {
    const L = loadReading(sol, d, 'L', 'N', 'z');
    return [
      ms('meas.appliance', 'appliance_' + ps(d, 'appliance')),
      ms('meas.applianceSwitch', d.state.on ? 'on' : 'off'),
      ...L.rows,
      m('meas.leakCurrent', rms(sol.i(d, 'f')), 'A'),
      m('meas.enclosureVoltage', rms(sol.v(d, 'PE')), 'V'),
    ];
  },
  actions: (d) => [{ id: d.state.on ? 'switch_off' : 'switch_on' }],
  operate(d, a) {
    if (a === 'switch_on') d.state.on = true;
    else if (a === 'switch_off') d.state.on = false;
    else return false;
    return true;
  },
  model3d: 'socket',
};

/* ---------------- Aquecedor ---------------- */

export const heater: DeviceDef = {
  type: 'heater',
  category: 'loads',
  domain: ['domestic'],
  level: 'beginner',
  prefix: 'E',
  size: { w: 80, h: 80 },
  terminals: LNPE,
  params: [
    sel('P', [500, 1000, 1500, 2000, 2500, 3000, 4500], 2000, 'W'),
    sel('defect', Object.keys(DEFECTS), 'none', undefined, false, true),
  ],
  initialState: () => ({ on: true }),
  classI: true,
  load: {
    phase: 'L',
    neutral: 'N',
    nominalVoltage: () => 230,
    working: (d, sol) => rms(sol.i(d, 'z')) > 1e-3,
  },
  stamp(d, b) {
    if (d.state.on) b.R(b.node('L'), b.node('N'), (230 * 230) / p(d, 'P'), 'z');
    const rf = defectR(d);
    if (rf > 0) b.R(b.node('L'), b.node('PE'), rf, 'f');
  },
  leakage: (d, sol) => rms(sol.i(d, 'f')),
  measure(d, sol) {
    const L = loadReading(sol, d, 'L', 'N', 'z');
    return [
      ms('meas.thermostat', d.state.on ? 'on' : 'off'),
      ...L.rows.slice(0, 3),
      m('meas.leakCurrent', rms(sol.i(d, 'f')), 'A'),
      m('meas.enclosureVoltage', rms(sol.v(d, 'PE')), 'V'),
    ];
  },
  actions: (d) => [{ id: d.state.on ? 'switch_off' : 'switch_on' }],
  operate: socket.operate,
  model3d: 'heater',
};

/* ---------------- Campainha ---------------- */

export const bell: DeviceDef<BurnRT> = {
  type: 'bell',
  category: 'loads',
  domain: ['domestic'],
  level: 'beginner',
  prefix: 'H',
  size: { w: 80, h: 70 },
  terminals: [
    { id: '1', x: 20, y: 0, kind: 'any', label: '1' },
    { id: '2', x: 60, y: 0, kind: 'any', label: '2' },
  ],
  params: [sel('Vn', [8, 12, 24, 230], 12, 'V')],
  initialState: () => ({ burnt: false }),
  load: {
    phase: '1',
    neutral: '2',
    nominalVoltage: (d) => p(d, 'Vn'),
    working: (d, sol) => !d.state.burnt && rms(sol.vv(d, '1', '2')) > 0.7 * p(d, 'Vn'),
  },
  stamp(d, b) {
    // 5 VA com FP 0,6 → 3 W.
    if (!d.state.burnt) b.Z(b.node('1'), b.node('2'), loadImpedance(3, 0.6, p(d, 'Vn'), b.omega), 'z');
  },
  logic: (d, ctx, rt) => overvoltageBurn(d, ctx, rt, rms(ctx.sol.vv(d, '1', '2')), p(d, 'Vn')),
  measure(d, sol) {
    const L = loadReading(sol, d, '1', '2', 'z');
    return [ms('meas.state', d.state.burnt ? 'burnt' : L.V > 0.7 * p(d, 'Vn') ? 'ringing' : 'silent'), ...L.rows.slice(0, 2)];
  },
  actions: replaceAction,
  operate: replaceOp,
  diagnose: (d, ctx) => wrongVoltage(d, ctx.fmt, p(d, 'Vn')),
  model3d: 'bell',
};

export const loads = [lampIncandescent, lampLed, lampFluorescent, socket, heater, bell];

/* ---------------- Símbolos ---------------- */

const bulb = (fill: string, burnt: boolean): Prim[] => [
  Pa('M20 0 V22 L25 34'), Pa('M60 0 V22 L55 34'),
  Ci(40, 46, 15, 'sl', burnt ? '#dddddd' : fill),
  L(29.4, 35.4, 50.6, 56.6, burnt ? 'sl off' : 'sl'), L(50.6, 35.4, 29.4, 56.6, burnt ? 'sl off' : 'sl'),
];
lampIncandescent.symbol = (d, look, n) => [...bulb(glow(look.num('brightness') / 100), !!d.state.burnt), Tx(40, 75, `${n(p(d, 'P'))} W`)];
lampLed.symbol = (d, look, n) => [
  ...bulb(`rgba(220,240,255,${(look.num('brightness') / 100).toFixed(2)})`, !!d.state.burnt),
  Pa('M34 54 L40 44 L46 54 Z', 'sl thin'), Tx(40, 75, `LED ${n(p(d, 'P'))} W`, 'txt xs'),
];
lampFluorescent.symbol = (d, look, n) => [
  L(20, 0, 20, 30), L(80, 0, 80, 30),
  Re(14, 30, 72, 14, 'sl', look.state === 'lit' ? 'rgba(235,245,255,1)' : '#f2f4f7'), L(14, 37, 86, 37, 'sl thin'),
  Tx(50, 60, `${n(p(d, 'P'))} W`),
];
socket.symbol = (d) => [
  L(20, 0, 20, 18), L(40, 0, 40, 18), L(60, 0, 60, 18),
  Ci(40, 40, 19, 'sl fill'), Ci(33, 40, 3, 'dot'), Ci(47, 40, 3, 'dot'), Re(37, 20, 6, 4, 'dot'), Re(37, 56, 6, 4, 'dot'),
  ...(ps(d, 'defect') !== 'none' ? [Pa('M64 30 l-6 9 h5 l-5 9', 'sl off w2')] : []),
  ...(ps(d, 'appliance') !== 'none' && d.state.on ? [Ci(66, 66, 5, 'sl on')] : []),
];
heater.symbol = (d, look, n) => {
  const b = Math.min(1, look.num('activePower') / p(d, 'P'));
  return [
    L(20, 0, 20, 24), L(40, 0, 40, 24), L(60, 0, 60, 24),
    Re(12, 24, 56, 30, 'sl', `rgba(255,90,40,${(0.55 * Math.max(0, b)).toFixed(2)})`),
    Pa('M18 39 l5 -7 l6 14 l6 -14 l6 14 l6 -14 l6 14 l5 -7'),
    ...(ps(d, 'defect') !== 'none' ? [Pa('M70 26 l-6 9 h5 l-5 9', 'sl off w2')] : []),
    Tx(40, 72, `${n(p(d, 'P'))} W`),
  ];
};
bell.symbol = (d, look, n) => {
  const ring = look.state === 'ringing';
  return [
    L(20, 0, 20, 44), L(60, 0, 60, 44), Pa('M20 44 H26'), Pa('M60 44 H54'),
    Pa('M26 44 A14 14 0 0 1 54 44 Z', ring ? 'sl ring' : d.state.burnt ? 'sl off' : 'sl'),
    ...(ring ? [Pa('M17 22 a14 14 0 0 1 6 -8 M63 22 a14 14 0 0 0 -6 -8', 'sl on')] : []),
    Tx(40, 62, `${n(p(d, 'Vn'))} V`),
  ];
};
