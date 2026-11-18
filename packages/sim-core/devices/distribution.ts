/** Distribuição: ligador, barramento, eléctrodo de terra. */
import { rms } from '../solver/complex';
import { m, num, p, sel } from './common';
import type { DeviceDef } from './types';

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
