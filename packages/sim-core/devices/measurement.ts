/** Medição: voltímetro, amperímetro, contador de energia monofásico. */
import { cabs, power, rms } from '../solver/complex';
import { m } from './common';
import type { DeviceDef, Measurement } from './types';
import type { Quantity } from '../solver/complex';
import { Ci, L, Pa, Tx } from './symbols';

/** Leitura de valor eficaz total, com as componentes AC e DC no perfil Profissional. */
const reading = (q: Quantity, unit: string): Measurement[] => [
  m('meas.reading', rms(q), unit),
  m('meas.acComponent', cabs(q.ac), unit, true),
  m('meas.dcComponent', q.dc, unit, true),
];

export const voltmeter: DeviceDef = {
  type: 'voltmeter',
  category: 'measurement',
  domain: ['domestic'],
  level: 'beginner',
  prefix: 'P',
  size: { w: 80, h: 70 },
  terminals: [
    { id: 'A', x: 20, y: 0, kind: 'any', label: '+' },
    { id: 'B', x: 60, y: 0, kind: 'any', label: '−' },
  ],
  params: [],
  initialState: () => ({}),
  stamp(_d, b) {
    // Resistência interna de 10 MΩ.
    b.R(b.node('A'), b.node('B'), 1e7, 'm');
  },
  measure: (d, sol) => reading(sol.vv(d, 'A', 'B'), 'V'),
  model3d: 'meter',
};

export const ammeter: DeviceDef = {
  type: 'ammeter',
  category: 'measurement',
  domain: ['domestic'],
  level: 'beginner',
  prefix: 'P',
  size: { w: 80, h: 60 },
  terminals: [
    { id: 'A', x: 0, y: 20, kind: 'any', label: '+' },
    { id: 'B', x: 80, y: 20, kind: 'any', label: '−' },
  ],
  params: [],
  initialState: () => ({}),
  conducts: () => [{ a: 'A', b: 'B', closed: true }],
  stamp(_d, b) {
    b.R(b.node('A'), b.node('B'), 1e-3, 'm');
  },
  measure: (d, sol) => reading(sol.i(d, 'm'), 'A'),
  model3d: 'meter',
};

interface MeterRT {
  wh?: number;
}

export const energyMeter1ph: DeviceDef<MeterRT> = {
  type: 'energyMeter1ph',
  category: 'measurement',
  domain: ['domestic'],
  level: 'pro',
  prefix: 'P',
  size: { w: 140, h: 90 },
  terminals: [
    { id: 'Li', x: 20, y: 0, kind: 'L', label: 'L' },
    { id: 'Ni', x: 60, y: 0, kind: 'N', label: 'N' },
    { id: 'Lo', x: 20, y: 90, kind: 'L', label: 'L' },
    { id: 'No', x: 60, y: 90, kind: 'N', label: 'N' },
  ],
  params: [],
  initialState: () => ({}),
  conducts: () => [
    { a: 'Li', b: 'Lo', closed: true },
    { a: 'Ni', b: 'No', closed: true },
  ],
  stamp(_d, b) {
    b.R(b.node('Li'), b.node('Lo'), 1e-3, 'i');
    b.R(b.node('Ni'), b.node('No'), 1e-3, 'n');
  },
  logic(d, ctx, rt) {
    const pw = power(ctx.sol.vv(d, 'Lo', 'No'), ctx.sol.i(d, 'i'));
    rt.wh = (rt.wh ?? 0) + (pw.P * ctx.dt) / 3600;
    return false;
  },
  measure(d, sol, rt) {
    const v = sol.vv(d, 'Lo', 'No');
    const i = sol.i(d, 'i');
    const pw = power(v, i);
    return [
      m('meas.voltage', rms(v), 'V'),
      m('meas.current', rms(i), 'A'),
      m('meas.activePower', pw.P, 'W'),
      m('meas.reactivePower', pw.Q, 'var'),
      m('meas.apparentPower', pw.S, 'VA'),
      m('meas.powerFactor', pw.pf, ''),
      m('meas.energy', (rt.wh ?? 0) / 1000, 'kWh'),
    ];
  },
  actions: () => [{ id: 'reset_energy' }],
  operate(_d, a, rt) {
    if (a !== 'reset_energy') return false;
    rt.wh = 0;
    return true;
  },
  model3d: 'energy-meter',
};

export const measurement = [voltmeter, ammeter, energyMeter1ph];

/* ---------------- Símbolos ---------------- */

voltmeter.symbol = () => [L(20, 0, 20, 14), L(60, 0, 60, 14), Pa('M20 14 H28 M60 14 H52'), Ci(40, 26, 13, 'sl fill'), Tx(40, 31, 'V', 'txt big')];
ammeter.symbol = () => [L(0, 20, 27, 20), Ci(40, 20, 13, 'sl fill'), Tx(40, 25, 'A', 'txt big'), L(53, 20, 80, 20)];
energyMeter1ph.symbol = () => [
  L(20, 0, 20, 90), L(60, 0, 60, 90), { t: 'rect', x: 10, y: 22, w: 120, h: 46, cls: 'sl fill', rx: 3 },
  Tx(95, 42, 'kWh', 'txt sm'), Ci(20, 45, 6, 'sl fill'), L(20, 45, 60, 45, 'sl thin'),
];
