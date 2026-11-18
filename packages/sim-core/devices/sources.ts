/** Fontes: rede monofásica, bateria, painel fotovoltaico, transformador monofásico. */
import { power, rms } from '../solver/complex';
import { diag, dev } from '../diagnostics/types';
import { clamp, m, ms, num, p, ps, sel } from './common';
import type { DeviceDef, SourceRole } from './types';

/* ---------------- Rede monofásica ---------------- */

export const grid1ph: DeviceDef = {
  type: 'grid1ph',
  category: 'sources',
  domain: ['domestic'],
  level: 'beginner',
  prefix: 'G',
  size: { w: 120, h: 80 },
  terminals: [
    { id: 'L', x: 20, y: 80, kind: 'L', label: 'L' },
    { id: 'N', x: 60, y: 80, kind: 'N', label: 'N' },
    { id: 'PE', x: 100, y: 80, kind: 'PE', label: 'PE' },
  ],
  params: [
    num('V', 230, 'V', 100, 440, 1),
    sel('earthing', ['TT', 'TN-S'], 'TT', undefined, false, true),
    num('Zs', 0.15, 'Ω', 0.001, 5, 0.01, true),
    num('Rb', 2, 'Ω', 0.05, 100, 0.05, true),
  ],
  initialState: () => ({ on: true }),
  sourceRoles: (d): Record<string, SourceRole> =>
    ps(d, 'earthing') === 'TN-S' ? { L: 'phase', N: 'neutral', PE: 'pe' } : { L: 'phase', N: 'neutral' },
  stamp(d, b) {
    const li = b.internal('li');
    const n0 = b.internal('n0');
    const Zs = p(d, 'Zs');
    b.V(li, n0, { ac: d.state.on === false ? 0 : p(d, 'V'), phase: 0 }, 'v');
    b.R(li, b.node('L'), Zs, 'zl');
    b.R(n0, b.node('N'), Zs, 'zn');
    // Ligação do neutro à terra no posto de transformação (Rb).
    b.R(n0, b.ground, p(d, 'Rb'), 'rb');
    if (ps(d, 'earthing') === 'TN-S') b.R(n0, b.node('PE'), Zs, 'zpe');
  },
  measure(d, sol) {
    const v = sol.vv(d, 'L', 'N');
    const i = sol.i(d, 'zl');
    const pw = power(v, i);
    return [
      ms('meas.state', d.state.on === false ? 'no_power' : 'powered'),
      m('meas.voltage', rms(v), 'V'),
      m('meas.current', rms(i), 'A'),
      m('meas.activePower', pw.P, 'W'),
      m('meas.reactivePower', pw.Q, 'var', true),
      m('meas.apparentPower', pw.S, 'VA', true),
      m('meas.powerFactor', pw.pf, '', true),
      m('meas.prospectiveIcc', p(d, 'V') / (2 * p(d, 'Zs')), 'A', true),
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

/* ---------------- Bateria ---------------- */

interface BatteryRT {
  soc?: number;
}

const batteryEmf = (Vn: number, soc: number) => (soc > 0 ? Vn * (0.98 + 0.08 * soc) : 0);

export const battery: DeviceDef<BatteryRT> = {
  type: 'battery',
  category: 'sources',
  domain: ['domestic'],
  level: 'pro',
  prefix: 'G',
  size: { w: 80, h: 70 },
  terminals: [
    { id: 'P', x: 20, y: 0, kind: 'DC+', label: '+' },
    { id: 'M', x: 60, y: 0, kind: 'DC-', label: '−' },
  ],
  params: [
    sel('V', [12, 24, 48], 12, 'V'),
    num('Ah', 100, 'Ah', 1, 2000, 1),
    num('soc0', 100, '%', 0, 100, 1),
    num('Ri', 0.02, 'Ω', 0.001, 1, 0.001, true),
  ],
  initialState: () => ({ empty: false }),
  sourceRoles: () => ({ P: 'phase', M: 'neutral' }),
  stamp(d, b, rt) {
    const soc = rt.soc ?? p(d, 'soc0') / 100;
    const ip = b.internal('ip');
    b.V(ip, b.node('M'), { dc: batteryEmf(p(d, 'V'), soc) }, 'v');
    b.R(ip, b.node('P'), p(d, 'Ri'), 'ri');
  },
  logic(d, ctx, rt) {
    rt.soc ??= p(d, 'soc0') / 100;
    const I = ctx.sol.i(d, 'ri').dc;
    const was = rt.soc;
    rt.soc = clamp(rt.soc - (I * ctx.dt) / 3600 / p(d, 'Ah'), 0, 1);
    if (was > 0 && rt.soc <= 0) {
      d.state.empty = true;
      ctx.emit({ code: 'battery_empty', severity: 'warning', values: { device: d.name } });
      return true;
    }
    if (rt.soc > 0 && d.state.empty) d.state.empty = false;
    return false;
  },
  measure(d, sol, rt) {
    const v = sol.vv(d, 'P', 'M').dc;
    const I = sol.i(d, 'ri').dc;
    const soc = rt.soc ?? p(d, 'soc0') / 100;
    const rows = [
      m('meas.voltage', v, 'V'),
      ms('meas.mode', I >= 0 ? 'discharging' : 'charging'),
      m('meas.current', Math.abs(I), 'A'),
      m('meas.power', v * I, 'W'),
      m('meas.soc', soc * 100, '%'),
    ];
    if (I > 0.01) rows.push(m('meas.autonomy', (soc * p(d, 'Ah')) / I, 'h'));
    return rows;
  },
  diagnose: (d) => (d.state.empty ? [diag('BATTERY_EMPTY', 'warning', [dev(d.id)], { device: d.name }, d.id)] : []),
  model3d: 'battery',
  simplifications: ['simpl.battery_linear'],
};

/* ---------------- Painel fotovoltaico ---------------- */

export const solarPanel: DeviceDef = {
  type: 'solarPanel',
  category: 'sources',
  domain: ['domestic'],
  level: 'pro',
  prefix: 'G',
  size: { w: 100, h: 80 },
  terminals: [
    { id: 'P', x: 20, y: 80, kind: 'DC+', label: '+' },
    { id: 'M', x: 60, y: 80, kind: 'DC-', label: '−' },
  ],
  params: [num('Voc', 22, 'V', 5, 1000, 0.5), num('Isc', 6, 'A', 0.1, 20, 0.1), num('irr', 100, '%', 0, 100, 5)],
  initialState: () => ({}),
  sourceRoles: () => ({ P: 'phase', M: 'neutral' }),
  stamp(d, b) {
    const irr = p(d, 'irr') / 100;
    if (irr <= 0) return;
    const ip = b.internal('ip');
    b.V(ip, b.node('M'), { dc: p(d, 'Voc') * (0.88 + 0.12 * irr) }, 'v');
    b.R(ip, b.node('P'), p(d, 'Voc') / (p(d, 'Isc') * irr), 'ri');
  },
  measure(d, sol) {
    const v = sol.vv(d, 'P', 'M').dc;
    const I = sol.i(d, 'ri').dc;
    return [m('meas.voltage', v, 'V'), m('meas.current', I, 'A'), m('meas.power', v * I, 'W'), m('meas.irradiance', p(d, 'irr'), '%')];
  },
  model3d: 'solar-panel',
  simplifications: ['simpl.solar_linear'],
};

/* ---------------- Transformador monofásico ---------------- */

export const transformer1ph: DeviceDef = {
  type: 'transformer1ph',
  category: 'sources',
  domain: ['domestic'],
  level: 'beginner',
  prefix: 'T',
  size: { w: 100, h: 100 },
  terminals: [
    { id: 'P1', x: 20, y: 0, kind: 'any', label: '1' },
    { id: 'P2', x: 60, y: 0, kind: 'any', label: '2' },
    { id: 'S1', x: 20, y: 100, kind: 'any', label: '3' },
    { id: 'S2', x: 60, y: 100, kind: 'any', label: '4' },
  ],
  params: [sel('V1', [230, 400], 230, 'V'), sel('V2', [8, 12, 24, 48, 110, 230], 12, 'V'), num('S', 63, 'VA', 5, 100000, 5)],
  initialState: () => ({}),
  sourceRoles: () => ({ S1: 'phase', S2: 'neutral' }),
  stamp(d, b) {
    const V1 = p(d, 'V1');
    const V2 = p(d, 'V2');
    const S = p(d, 'S');
    const ip = b.internal('ip');
    const is = b.internal('is');
    // Tensão de curto-circuito de 5 %, metade em cada enrolamento; perdas no ferro de 2 %.
    b.R(b.node('P1'), ip, (0.025 * V1 * V1) / S, 'rp');
    b.X(ip, b.node('P2'), is, b.node('S2'), V1 / V2, 'x');
    b.R(is, b.node('S1'), (0.025 * V2 * V2) / S, 'rs');
    b.R(b.node('P1'), b.node('P2'), (V1 * V1) / (0.02 * S), 'rm');
  },
  measure(d, sol) {
    const v2 = sol.vv(d, 'S1', 'S2');
    const i2 = sol.i(d, 'rs');
    const p2 = power(v2, i2);
    return [
      m('meas.primaryVoltage', rms(sol.vv(d, 'P1', 'P2')), 'V'),
      m('meas.secondaryVoltage', rms(v2), 'V'),
      m('meas.primaryCurrent', rms(sol.i(d, 'rp')), 'A'),
      m('meas.secondaryCurrent', rms(i2), 'A'),
      m('meas.loadPercent', (100 * p2.S) / p(d, 'S'), '%'),
    ];
  },
  model3d: 'transformer',
  simplifications: ['simpl.transformer_linear'],
};

export const sources = [grid1ph, battery, solarPanel, transformer1ph];
