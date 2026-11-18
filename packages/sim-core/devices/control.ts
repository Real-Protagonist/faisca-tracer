/** Comando doméstico: interruptores, comutadores, inversor, botão de pressão, telerruptor. */
import { rms } from '../solver/complex';
import { m, ms, p, sel } from './common';
import type { DeviceDef, TerminalDef } from './types';

const T2: TerminalDef[] = [
  { id: '1', x: 30, y: 0, kind: 'any', label: '1' },
  { id: '2', x: 30, y: 80, kind: 'any', label: '2' },
];

/* ---------------- Interruptor simples ---------------- */

export const switch1: DeviceDef = {
  type: 'switch1',
  category: 'control',
  domain: ['domestic'],
  level: 'beginner',
  prefix: 'S',
  size: { w: 60, h: 80 },
  terminals: T2,
  params: [],
  initialState: () => ({ on: false }),
  phaseOnlySwitch: true,
  conducts: (d) => [{ a: '1', b: '2', closed: !!d.state.on }],
  stamp(d, b) {
    b.sw(b.node('1'), b.node('2'), !!d.state.on, 'c');
  },
  measure: (d, sol) => [ms('meas.position', d.state.on ? 'on' : 'off'), m('meas.current', rms(sol.i(d, 'c')), 'A')],
  actions: (d) => [{ id: d.state.on ? 'switch_off' : 'switch_on' }],
  operate(d, a) {
    if (a === 'switch_on') d.state.on = true;
    else if (a === 'switch_off') d.state.on = false;
    else if (a === 'toggle') d.state.on = !d.state.on;
    else return false;
    return true;
  },
  model3d: 'wall-switch',
};

/* ---------------- Interruptor bipolar ---------------- */

export const switch2p: DeviceDef = {
  ...switch1,
  type: 'switch2p',
  level: 'pro',
  size: { w: 80, h: 80 },
  phaseOnlySwitch: false,
  terminals: [
    { id: '1', x: 20, y: 0, kind: 'L', label: '1' },
    { id: '3', x: 60, y: 0, kind: 'N', label: '3' },
    { id: '2', x: 20, y: 80, kind: 'L', label: '2' },
    { id: '4', x: 60, y: 80, kind: 'N', label: '4' },
  ],
  conducts: (d) => [
    { a: '1', b: '2', closed: !!d.state.on },
    { a: '3', b: '4', closed: !!d.state.on },
  ],
  stamp(d, b) {
    b.sw(b.node('1'), b.node('2'), !!d.state.on, 'c');
    b.sw(b.node('3'), b.node('4'), !!d.state.on, 'c2');
  },
};

/* ---------------- Comutador de escada ---------------- */

export const stairSwitch: DeviceDef = {
  type: 'stairSwitch',
  category: 'control',
  domain: ['domestic'],
  level: 'beginner',
  prefix: 'S',
  size: { w: 80, h: 80 },
  terminals: [
    { id: 'C', x: 40, y: 0, kind: 'any', label: 'C' },
    { id: '1', x: 20, y: 80, kind: 'any', label: '1' },
    { id: '2', x: 60, y: 80, kind: 'any', label: '2' },
  ],
  params: [],
  initialState: () => ({ pos: 1 }),
  phaseOnlySwitch: true,
  conducts: (d) => [
    { a: 'C', b: '1', closed: d.state.pos !== 2 },
    { a: 'C', b: '2', closed: d.state.pos === 2 },
  ],
  stamp(d, b) {
    b.R(b.node('C'), b.node(d.state.pos === 2 ? '2' : '1'), 1e-3, 'c');
  },
  measure: (d, sol) => [
    ms('meas.position', d.state.pos === 2 ? 'position_2' : 'position_1'),
    m('meas.current', rms(sol.i(d, 'c')), 'A'),
  ],
  actions: () => [{ id: 'toggle' }],
  operate(d, a) {
    if (a !== 'toggle') return false;
    d.state.pos = d.state.pos === 2 ? 1 : 2;
    return true;
  },
  model3d: 'wall-switch',
};

/* ---------------- Inversor de escada ---------------- */

export const intermediateSwitch: DeviceDef = {
  type: 'intermediateSwitch',
  category: 'control',
  domain: ['domestic'],
  level: 'beginner',
  prefix: 'S',
  size: { w: 80, h: 80 },
  terminals: [
    { id: 'A', x: 20, y: 0, kind: 'any', label: 'A' },
    { id: 'B', x: 60, y: 0, kind: 'any', label: 'B' },
    { id: 'C', x: 20, y: 80, kind: 'any', label: 'C' },
    { id: 'D', x: 60, y: 80, kind: 'any', label: 'D' },
  ],
  params: [],
  initialState: () => ({ crossed: false }),
  phaseOnlySwitch: true,
  conducts: (d) => {
    const x = !!d.state.crossed;
    return [
      { a: 'A', b: 'C', closed: !x },
      { a: 'B', b: 'D', closed: !x },
      { a: 'A', b: 'D', closed: x },
      { a: 'B', b: 'C', closed: x },
    ];
  },
  stamp(d, b) {
    const x = !!d.state.crossed;
    b.R(b.node('A'), b.node(x ? 'D' : 'C'), 1e-3, 'c1');
    b.R(b.node('B'), b.node(x ? 'C' : 'D'), 1e-3, 'c2');
  },
  measure: (d) => [ms('meas.position', d.state.crossed ? 'crossed' : 'direct')],
  actions: () => [{ id: 'toggle' }],
  operate(d, a) {
    if (a !== 'toggle') return false;
    d.state.crossed = !d.state.crossed;
    return true;
  },
  model3d: 'wall-switch',
};

/* ---------------- Botão de pressão (campainha) ---------------- */

export const pushButton: DeviceDef = {
  type: 'pushButton',
  category: 'control',
  domain: ['domestic'],
  level: 'beginner',
  prefix: 'S',
  size: { w: 60, h: 80 },
  terminals: T2,
  params: [],
  initialState: () => ({ pressed: false }),
  phaseOnlySwitch: true,
  conducts: (d) => [{ a: '1', b: '2', closed: !!d.state.pressed }],
  stamp(d, b) {
    b.sw(b.node('1'), b.node('2'), !!d.state.pressed, 'c');
  },
  measure: (d, sol) => [ms('meas.position', d.state.pressed ? 'pressed' : 'released'), m('meas.current', rms(sol.i(d, 'c')), 'A')],
  actions: () => [{ id: 'press', momentary: true }],
  operate(d, a, _rt, phase) {
    if (a !== 'press') return false;
    const down = phase !== 'up';
    if (d.state.pressed === down) return false;
    d.state.pressed = down;
    return true;
  },
  model3d: 'push-button',
};

/* ---------------- Telerruptor ---------------- */

interface ImpulseRT {
  prev?: boolean;
}

export const impulseRelay: DeviceDef<ImpulseRT> = {
  type: 'impulseRelay',
  category: 'control',
  domain: ['domestic'],
  level: 'pro',
  prefix: 'K',
  size: { w: 100, h: 100 },
  terminals: [
    { id: 'A1', x: 20, y: 0, kind: 'any', label: 'A1' },
    { id: '1', x: 70, y: 0, kind: 'any', label: '1' },
    { id: 'A2', x: 20, y: 100, kind: 'any', label: 'A2' },
    { id: '2', x: 70, y: 100, kind: 'any', label: '2' },
  ],
  params: [sel('Vc', [230, 24, 12, 8], 230, 'V')],
  initialState: () => ({ on: false }),
  phaseOnlySwitch: true,
  conducts: (d) => [{ a: '1', b: '2', closed: !!d.state.on }],
  load: { phase: 'A1', neutral: 'A2', nominalVoltage: (d) => p(d, 'Vc') },
  stamp(d, b) {
    const Vc = p(d, 'Vc');
    b.R(b.node('A1'), b.node('A2'), (Vc * Vc) / 4, 'coil');
    b.sw(b.node('1'), b.node('2'), !!d.state.on, 'c');
  },
  logic(d, ctx, rt) {
    const en = rms(ctx.sol.vv(d, 'A1', 'A2')) > 0.75 * p(d, 'Vc');
    let changed = false;
    if (en && !rt.prev) {
      d.state.on = !d.state.on;
      ctx.emit({ code: d.state.on ? 'impulse_on' : 'impulse_off', severity: 'info', values: { device: d.name } });
      changed = true;
    }
    rt.prev = en;
    return changed;
  },
  measure: (d, sol) => [
    ms('meas.contact', d.state.on ? 'closed' : 'open'),
    m('meas.coilVoltage', rms(sol.vv(d, 'A1', 'A2')), 'V'),
    m('meas.current', rms(sol.i(d, 'c')), 'A'),
  ],
  model3d: 'din-relay',
};

export const control = [switch1, switch2p, stairSwitch, intermediateSwitch, pushButton, impulseRelay];
