/** Distribuição: ligador, barramento, eléctrodo de terra. */
import { rms } from '../solver/complex';
import { m, num, p, ps, sel } from './common';
import type { DeviceDef } from './types';
import { Ci, L, Re, Tx } from './symbols';

export const junction: DeviceDef = {
  type: 'junction',
  category: 'distribution',
  domain: ['domestic'],
  level: 'beginner',
  prefix: 'X',
  size: { w: 40, h: 40 },
  terminals: [
    { id: 'a', x: 20, y: 0, kind: 'any' },
    { id: 'b', x: 20, y: 40, kind: 'any' },
    { id: 'c', x: 0, y: 20, kind: 'any' },
    { id: 'd', x: 40, y: 20, kind: 'any' },
  ],
  params: [],
  initialState: () => ({}),
  shorts: () => [['a', 'b', 'c', 'd']],
  model3d: 'junction',
};

const BUS_OUT = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];

export const busbar: DeviceDef = {
  type: 'busbar',
  category: 'distribution',
  domain: ['domestic'],
  level: 'beginner',
  prefix: 'X',
  size: { w: 160, h: 40 },
  terminals: [
    { id: 'E', x: 20, y: 0, kind: 'any' },
    ...BUS_OUT.map((id, i) => ({ id, x: 30 + 20 * i, y: 40, kind: 'any' as const })),
  ],
  params: [sel('bus', ['L', 'N', 'PE'], 'N', undefined, false, true)],
  initialState: () => ({}),
  shorts: () => [['E', ...BUS_OUT]],
  model3d: 'busbar',
};

export const earthElectrode: DeviceDef = {
  type: 'earthElectrode',
  category: 'distribution',
  domain: ['domestic'],
  level: 'beginner',
  prefix: 'E',
  size: { w: 60, h: 60 },
  terminals: [{ id: 'PE', x: 30, y: 0, kind: 'PE', label: 'PE' }],
  params: [num('Ra', 20, 'Ω', 0.5, 2000, 0.5)],
  initialState: () => ({}),
  sourceRoles: () => ({ PE: 'pe' }),
  stamp(d, b) {
    b.R(b.node('PE'), b.ground, p(d, 'Ra'), 'ra');
  },
  measure: (d, sol) => [
    m('meas.earthCurrent', rms(sol.i(d, 'ra')), 'A'),
    m('meas.earthVoltage', rms(sol.v(d, 'PE')), 'V'),
    m('meas.earthResistance', p(d, 'Ra'), 'Ω'),
  ],
  model3d: 'earth-rod',
};

export const distribution = [junction, busbar, earthElectrode];

/* ---------------- Símbolos ---------------- */

junction.symbol = () => [L(20, 0, 20, 40), L(0, 20, 40, 20), Re(10, 10, 20, 20, 'junction'), Ci(20, 20, 3, 'dot')];
busbar.symbol = (d) => [
  L(20, 0, 20, 14), ...[0, 1, 2, 3, 4, 5].map((i) => L(30 + 20 * i, 26, 30 + 20 * i, 40)),
  { t: 'rect', x: 10, y: 14, w: 140, h: 12, cls: `bus bus-${ps(d, 'bus')}`, rx: 2 },
  Tx(146, 10, ps(d, 'bus'), 'txt xs', 'end'),
];
earthElectrode.symbol = (d, _l, n) => [
  L(30, 0, 30, 22), L(14, 22, 46, 22, 'sl w3'), L(20, 29, 40, 29, 'sl w3'), L(26, 36, 34, 36, 'sl w3'),
  Tx(30, 54, `Ra ${n(p(d, 'Ra'))} Ω`, 'txt xs'),
];
