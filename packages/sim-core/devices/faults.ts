/** Falhas e ensaios: curto-circuito, defeito à terra, pessoa em contacto. */
import { rms } from '../solver/complex';
import { bodyZone, IEC_RULES } from '../checks/tables';
import { diag, dev, wire } from '../diagnostics/types';
import { m, ms, num, p, ps, sel } from './common';
import type { DeviceDef } from './types';

const toggleActive = (d: { state: Record<string, unknown> }, a: string) => {
  if (a === 'activate') d.state.active = true;
  else if (a === 'deactivate') d.state.active = false;
  else return false;
  return true;
};
const activeActions = (d: { state: Record<string, unknown> }) => [{ id: d.state.active ? 'deactivate' : 'activate' }];

export const shortCircuit: DeviceDef = {
  type: 'shortCircuit',
  category: 'faults',
  domain: ['domestic'],
  level: 'beginner',
  prefix: 'Z',
  size: { w: 80, h: 60 },
  terminals: [
    { id: '1', x: 20, y: 0, kind: 'any' },
    { id: '2', x: 60, y: 0, kind: 'any' },
  ],
  params: [num('Rf', 0.001, 'Ω', 0.001, 10, 0.001, true)],
  initialState: () => ({ active: false }),
  stamp(d, b) {
    if (d.state.active) b.R(b.node('1'), b.node('2'), p(d, 'Rf'), 'c');
  },
  measure: (d, sol) => [ms('meas.state', d.state.active ? 'active' : 'inactive'), m('meas.faultCurrent', rms(sol.i(d, 'c')), 'A')],
  actions: activeActions,
  operate: toggleActive,
  model3d: 'fault',
};

export const earthFault: DeviceDef = {
  type: 'earthFault',
  category: 'faults',
  domain: ['domestic'],
  level: 'beginner',
  prefix: 'Z',
  size: { w: 60, h: 70 },
  terminals: [{ id: 'A', x: 30, y: 0, kind: 'any' }],
  params: [sel('Rf', [0.1, 1, 10, 100, 1000, 10000], 1, 'Ω')],
  initialState: () => ({ active: false }),
  stamp(d, b) {
    if (d.state.active) b.R(b.node('A'), b.ground, p(d, 'Rf'), 'f');
  },
  leakage: (d, sol) => rms(sol.i(d, 'f')),
  measure: (d, sol) => [ms('meas.state', d.state.active ? 'active' : 'inactive'), m('meas.faultCurrent', rms(sol.i(d, 'f')), 'A')],
  actions: activeActions,
  operate: toggleActive,
  model3d: 'fault',
};

/** Resistência do contacto com o chão (Ω). */
export const FLOOR: Record<string, number> = { wet: 0, shoes: 1000, insulating: 100000 };

interface PersonRT {
  exposure?: number;
  warned?: boolean;
}

export const person: DeviceDef<PersonRT> = {
  type: 'person',
  category: 'faults',
  domain: ['domestic'],
  level: 'beginner',
  prefix: 'Z',
  size: { w: 60, h: 90 },
  terminals: [{ id: 'M', x: 30, y: 0, kind: 'any' }],
  params: [sel('floor', Object.keys(FLOOR), 'shoes', undefined, false, true), num('Rbody', 1000, 'Ω', 300, 5000, 50, true)],
  initialState: () => ({ active: true }),
  stamp(d, b) {
    if (d.state.active) b.R(b.node('M'), b.ground, p(d, 'Rbody') + (FLOOR[ps(d, 'floor')] ?? 1000), 'b');
  },
  leakage: (d, sol) => rms(sol.i(d, 'b')),
  logic(d, ctx, rt) {
    const I = rms(ctx.sol.i(d, 'b'));
    if (I > 0.0005) rt.exposure = (rt.exposure ?? 0) + ctx.dt;
    else rt.exposure = 0;
    if (I > IEC_RULES.dangerousBodyCurrent) {
      if (!rt.warned) {
        rt.warned = true;
        ctx.emit({ code: 'body_current', severity: 'error', values: { device: d.name, current: ctx.fmt(I, 'A') } });
      }
    } else rt.warned = false;
    return false;
  },
  measure(d, sol, rt) {
    const I = rms(sol.i(d, 'b'));
    return [
      ms('meas.touching', d.state.active ? 'yes' : 'no'),
      m('meas.bodyCurrent', I, 'A'),
      m('meas.touchVoltage', rms(sol.v(d, 'M')), 'V'),
      ms('meas.bodyZone', 'zone_' + bodyZone(I, rt.exposure ?? 0).replace('-', '')),
      m('meas.exposure', rt.exposure ?? 0, 's', true),
    ];
  },
  diagnose(d, ctx) {
    const I = rms(ctx.sol.i(d, 'b'));
    if (I <= IEC_RULES.dangerousBodyCurrent) return [];
    // Onde toca a pessoa: o equipamento ligado pelo cabo à mão.
    const w = ctx.project.wires.find((x) => (x.a.device === d.id && x.a.terminal === 'M') || (x.b.device === d.id && x.b.terminal === 'M'));
    const other = w ? (w.a.device === d.id ? w.b : w.a) : null;
    const touched = other ? ctx.project.devices.find((x) => x.id === other.device) : undefined;
    const targets = [dev(d.id)];
    if (w) targets.push(wire(w.id));
    if (touched) targets.push(dev(touched.id));
    const hasRcd30 = ctx.project.devices.some((x) => ['rcd2p', 'rcbo'].includes(x.type) && Number(x.params.IDn) <= 30);
    return [
      diag('BODY_CURRENT', 'error', targets, {
        device: d.name,
        current: ctx.fmt(I, 'A'),
        voltage: ctx.fmt(rms(ctx.sol.v(d, 'M')), 'V'),
        location: touched?.name ?? '—',
        rcd: hasRcd30 ? 'yes' : 'no',
      }, touched?.id ?? d.id),
    ];
  },
  actions: (d) => [{ id: d.state.active ? 'stop_touching' : 'touch' }],
  operate(d, a) {
    if (a === 'touch') d.state.active = true;
    else if (a === 'stop_touching') d.state.active = false;
    else return false;
    return true;
  },
  model3d: 'person',
  simplifications: ['simpl.body_model'],
};

export const faults = [shortCircuit, earthFault, person];
