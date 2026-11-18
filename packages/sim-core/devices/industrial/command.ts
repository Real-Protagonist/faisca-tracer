/**
 * Comando industrial: contactor 3P, contactor auxiliar, temporizadores TON e TOF, botoneiras NA e NF,
 * botão de emergência, selector 0-1-2, sinalizador luminoso e sensores (fim de curso, bóia,
 * pressostato, sensor indutivo, fotocélula).
 */
import { rms } from '../../solver/complex';
import { diag, dev, type Diagnostic } from '../../diagnostics/types';
import { loadImpedance, m, ms, num, overvoltageBurn, p, ps, sel } from '../common';
import type { Device } from '../../project/types';
import type { ActionDef, Conduction, DeviceDef, DiagnoseContext, LogicContext, TerminalDef } from '../types';
import { Ci, L, Pa, pole, Re, Tx, type Prim } from '../symbols';
import { findConnected, wireGroups } from './helpers';

const IND = ['industrial'] as const;
const COIL_VOLTAGES = [24, 48, 110, 230, 400];

/** Actua acima de 0,75 · Uc e larga abaixo de 0,5 · Uc (IEC 60947-4-1). */
export const PICK_UP = 0.75;
export const DROP_OUT = 0.5;
/** Acima de 1,3 · Uc durante 0,5 s, a bobina queima. */
const COIL_BURN = 1.3;
/** Abaixo de 0,75 · Uc durante 0,2 s: a bobina não actua (tensão errada). */
const UNDER_TIME = 0.2;

interface Contact {
  a: string;
  b: string;
  /** Contacto normalmente fechado. */
  nc?: boolean;
  /** Contacto principal (pólo de potência). */
  main?: boolean;
}

export interface CoilRT {
  over?: number;
  under?: number;
  /** Botão cuja libertação fez cair a bobina (falta de auto-retenção). */
  noHold?: string | null;
}

const coilV = (sol: LogicContext['sol'], d: Device) => rms(sol.vv(d, 'A1', 'A2'));

/** Bobina: actuação, queda, queima por sobretensão e falta de auto-retenção. Devolve true se mudou. */
export function coilLogic(d: Device, ctx: LogicContext, rt: CoilRT, Uc: number): boolean {
  const V = coilV(ctx.sol, d);
  const was = !!d.state.closed;
  if (d.state.coilBurnt) return false;
  if (V > COIL_BURN * Uc) {
    rt.over = (rt.over ?? 0) + ctx.dt;
    if (rt.over > 0.5) {
      Object.assign(d.state, { coilBurnt: true, burntVoltage: V, closed: false });
      ctx.emit({ code: 'coil_burnt', severity: 'error', values: { device: d.name, voltage: ctx.fmt(V, 'V'), rated: ctx.fmt(Uc, 'V') } });
      return true;
    }
  } else rt.over = 0;
  if (!was && V >= PICK_UP * Uc) {
    d.state.closed = true;
    rt.noHold = null;
    rt.under = 0;
    return true;
  }
  if (was && V < DROP_OUT * Uc) {
    d.state.closed = false;
    // Largar um botão de pressão fez cair a bobina: não há auto-retenção.
    if (ctx.cause?.phase === 'up' && ctx.cause.deviceId !== d.id) {
      rt.noHold = ctx.cause.deviceId;
      const btn = ctx.device(ctx.cause.deviceId);
      ctx.emit({ code: 'contactor_no_hold', severity: 'warning', values: { device: d.name, button: btn?.name ?? '' } });
    }
    return true;
  }
  if (!d.state.closed && V > 0.1 * Uc && V < PICK_UP * Uc) rt.under = (rt.under ?? 0) + ctx.dt;
  else rt.under = 0;
  return false;
}

/** Diagnósticos de uma bobina: tensão errada e falta de auto-retenção. */
export function coilDiagnostics(d: Device, ctx: DiagnoseContext, rt: CoilRT, Uc: number, holdContacts: Contact[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  const V = rms(ctx.sol.vv(d, 'A1', 'A2'));
  if (d.state.coilBurnt) {
    out.push(diag('COIL_VOLTAGE', 'error', [dev(d.id)], { device: d.name, rated: ctx.fmt(Uc, 'V'), voltage: ctx.fmt(Number(d.state.burntVoltage ?? V), 'V') }, d.id));
  } else if ((rt.under ?? 0) >= UNDER_TIME && !d.state.closed && V > 0.1 * Uc && V < PICK_UP * Uc) {
    out.push(diag('COIL_VOLTAGE', 'error', [dev(d.id)], { device: d.name, rated: ctx.fmt(Uc, 'V'), voltage: ctx.fmt(V, 'V') }, d.id));
  }
  if (rt.noHold && !d.state.closed) {
    const btn = ctx.project.devices.find((x) => x.id === rt.noHold);
    const bdef = btn && ctx.registry.get(btn.type);
    const bc = bdef?.conducts?.(btn!)[0];
    if (btn && bc) {
      const g = wireGroups(ctx.project, ctx.registry);
      const ga = g({ device: btn.id, terminal: bc.a });
      const gb = g({ device: btn.id, terminal: bc.b });
      const bridged = holdContacts.some((c) => {
        const x = g({ device: d.id, terminal: c.a });
        const y = g({ device: d.id, terminal: c.b });
        return (x === ga && y === gb) || (x === gb && y === ga);
      });
      if (!bridged) {
        const outputs = holdContacts.length && d.type === 'contactor3p' ? ['2', '4', '6'] : [];
        const M = outputs.length ? findConnected(ctx.project, ctx.registry, outputs.map((t) => ({ device: d.id, terminal: t })), (x) => ctx.registry.get(x.type)?.category === 'motors', d.id) : null;
        const hold = holdContacts[0]!;
        out.push(
          diag('MOTOR_NO_HOLD', 'warning', [dev(d.id), dev(btn.id)], {
            device: M?.name ?? d.name,
            button: btn.name,
            contactor: d.name,
            contact: `${hold.a}-${hold.b}`,
            a: hold.a,
            b: hold.b,
          }, d.id),
        );
      }
    }
  }
  return out;
}

const burntActions = (d: Device): ActionDef[] => (d.state.coilBurnt ? [{ id: 'replace' }] : []);
function replaceCoil(d: Device, a: string, rt: CoilRT) {
  if (a !== 'replace' || !d.state.coilBurnt) return false;
  Object.assign(d.state, { coilBurnt: false, burntVoltage: null });
  rt.over = 0;
  return true;
}
const coilState = (d: Device) => (d.state.coilBurnt ? 'coil_burnt' : d.state.closed ? 'energized' : 'deenergized');

/** Equipamento de bobina com contactos (contactor, contactor auxiliar). */
function coilDevice(o: {
  type: string;
  level: 'beginner' | 'pro';
  size: { w: number; h: number };
  contacts: Contact[];
  xs: number[];
  holdVA: number;
  extraParams?: DeviceDef['params'];
  model3d: string;
}): DeviceDef<CoilRT> {
  const h = o.size.h;
  const terminals: TerminalDef[] = [
    { id: 'A1', x: 20, y: 0, kind: 'any', label: 'A1' },
    { id: 'A2', x: 20, y: h, kind: 'any', label: 'A2' },
    ...o.contacts.flatMap((c, i) => [
      { id: c.a, x: o.xs[i]!, y: 0, kind: 'any' as const, label: c.a },
      { id: c.b, x: o.xs[i]!, y: h, kind: 'any' as const, label: c.b },
    ]),
  ];
  const holds = o.contacts.filter((c) => !c.nc && !c.main);
  const isClosed = (d: Device, c: Contact) => (c.nc ? !d.state.closed : !!d.state.closed);
  const def: DeviceDef<CoilRT> = {
    type: o.type,
    category: 'control',
    domain: [...IND],
    level: o.level,
    prefix: 'K',
    size: o.size,
    terminals,
    params: [sel('Uc', COIL_VOLTAGES, 230, 'V'), ...(o.extraParams ?? [])],
    initialState: () => ({ closed: false, coilBurnt: false }),
    coilOperated: true,
    conducts: (d): Conduction[] => o.contacts.map((c) => ({ a: c.a, b: c.b, closed: isClosed(d, c) })),
    load: { phase: 'A1', neutral: 'A2', nominalVoltage: (d) => p(d, 'Uc'), working: (d) => !!d.state.closed },
    stamp(d, b) {
      if (!d.state.coilBurnt) {
        const Uc = p(d, 'Uc');
        // Potência de manutenção da bobina com FP 0,3.
        b.Z(b.node('A1'), b.node('A2'), loadImpedance(o.holdVA * 0.3, 0.3, Uc, b.omega), 'coil');
      }
      o.contacts.forEach((c, i) => b.sw(b.node(c.a), b.node(c.b), isClosed(d, c), 'c' + i));
    },
    logic: (d, ctx, rt) => coilLogic(d, ctx, rt, p(d, 'Uc')),
    measure(d, sol) {
      const main = o.contacts.map((c, i) => (c.main ? rms(sol.i(d, 'c' + i)) : 0));
      return [
        ms('meas.state', coilState(d)),
        m('meas.coilVoltage', rms(sol.vv(d, 'A1', 'A2')), 'V'),
        ...(o.contacts.some((c) => c.main) ? [m('meas.current', Math.max(...main), 'A')] : []),
      ];
    },
    actions: burntActions,
    operate: (d, a, rt) => replaceCoil(d, a, rt),
    diagnose: (d, ctx, rt) => coilDiagnostics(d, ctx, rt, p(d, 'Uc'), holds),
    model3d: o.model3d,
    simplifications: ['simpl.contactor_threshold'],
  };
  return def;
}

/* ---------------- Contactor 3P com auxiliares 13-14 e 21-22 ---------------- */

export const contactor3p = coilDevice({
  type: 'contactor3p',
  level: 'beginner',
  size: { w: 240, h: 120 },
  contacts: [
    { a: '1', b: '2', main: true },
    { a: '3', b: '4', main: true },
    { a: '5', b: '6', main: true },
    { a: '13', b: '14' },
    { a: '21', b: '22', nc: true },
  ],
  xs: [60, 100, 140, 180, 220],
  holdVA: 8,
  extraParams: [sel('In', [9, 12, 18, 25, 32, 40, 50, 65, 80], 12, 'A')],
  model3d: 'contactor',
});

/* ---------------- Contactor auxiliar 2NA + 2NF ---------------- */

export const auxRelay = coilDevice({
  type: 'auxRelay',
  level: 'beginner',
  size: { w: 200, h: 100 },
  contacts: [
    { a: '13', b: '14' },
    { a: '23', b: '24' },
    { a: '31', b: '32', nc: true },
    { a: '41', b: '42', nc: true },
  ],
  xs: [60, 100, 140, 180],
  holdVA: 4,
  model3d: 'contactor',
});

/* ---------------- Temporizadores ---------------- */

interface TimerRT {
  elapsed?: number;
}

function timer(type: 'timerOn' | 'timerOff'): DeviceDef<TimerRT> {
  const onDelay = type === 'timerOn';
  return {
    type,
    category: 'control',
    domain: [...IND],
    level: 'beginner',
    prefix: 'K',
    size: { w: 140, h: 100 },
    terminals: [
      { id: 'A1', x: 20, y: 0, kind: 'any', label: 'A1' },
      { id: 'A2', x: 20, y: 100, kind: 'any', label: 'A2' },
      { id: '15', x: 80, y: 0, kind: 'any', label: '15' },
      { id: '16', x: 60, y: 100, kind: 'any', label: '16' },
      { id: '18', x: 100, y: 100, kind: 'any', label: '18' },
    ],
    params: [num('t', 5, 's', 0.1, 600, 0.1), sel('Uc', COIL_VOLTAGES, 230, 'V')],
    initialState: () => ({ coil: false, out: false }),
    coilOperated: true,
    conducts: (d) => [
      { a: '15', b: '18', closed: !!d.state.out },
      { a: '15', b: '16', closed: !d.state.out },
    ],
    load: { phase: 'A1', neutral: 'A2', nominalVoltage: (d) => p(d, 'Uc'), working: (d) => !!d.state.coil },
    stamp(d, b) {
      b.Z(b.node('A1'), b.node('A2'), loadImpedance(1, 0.5, p(d, 'Uc'), b.omega), 'coil');
      b.sw(b.node('15'), b.node('18'), !!d.state.out, 'no');
      b.sw(b.node('15'), b.node('16'), !d.state.out, 'nc');
    },
    logic(d, ctx, rt) {
      const V = rms(ctx.sol.vv(d, 'A1', 'A2'));
      const Uc = p(d, 'Uc');
      const coil = d.state.coil ? V >= DROP_OUT * Uc : V >= PICK_UP * Uc;
      const out0 = !!d.state.out;
      if (coil !== d.state.coil) rt.elapsed = 0;
      d.state.coil = coil;
      if (onDelay) {
        if (!coil) d.state.out = false;
        else if (!d.state.out) {
          rt.elapsed = (rt.elapsed ?? 0) + ctx.dt;
          if (rt.elapsed + 1e-9 >= p(d, 't')) d.state.out = true;
        }
      } else if (coil) d.state.out = true;
      else if (d.state.out) {
        rt.elapsed = (rt.elapsed ?? 0) + ctx.dt;
        if (rt.elapsed + 1e-9 >= p(d, 't')) d.state.out = false;
      }
      if (d.state.out !== out0) {
        ctx.emit({ code: 'timer_elapsed', severity: 'info', values: { device: d.name } });
        return true;
      }
      return false;
    },
    measure(d, sol, rt) {
      const timing = onDelay ? d.state.coil && !d.state.out : !d.state.coil && d.state.out;
      return [
        ms('meas.state', timing ? 'timing' : d.state.out ? 'contact_switched' : 'idle'),
        m('meas.elapsed', timing ? Math.min(rt.elapsed ?? 0, p(d, 't')) : 0, 's'),
        m('meas.coilVoltage', rms(sol.vv(d, 'A1', 'A2')), 'V'),
      ];
    },
    model3d: 'din-relay',
  };
}

export const timerOn = timer('timerOn');
export const timerOff = timer('timerOff');

/* ---------------- Botoneiras ---------------- */

function button(type: string, nc: boolean, ids: [string, string]): DeviceDef {
  return {
    type,
    category: 'control',
    domain: [...IND],
    level: 'beginner',
    prefix: 'S',
    size: { w: 60, h: 80 },
    terminals: [
      { id: ids[0], x: 40, y: 0, kind: 'any', label: ids[0] },
      { id: ids[1], x: 40, y: 80, kind: 'any', label: ids[1] },
    ],
    params: [],
    initialState: () => ({ pressed: false }),
    phaseOnlySwitch: true,
    conducts: (d) => [{ a: ids[0], b: ids[1], closed: nc ? !d.state.pressed : !!d.state.pressed }],
    stamp(d, b) {
      b.sw(b.node(ids[0]), b.node(ids[1]), nc ? !d.state.pressed : !!d.state.pressed, 'c');
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
    model3d: nc ? 'push-button-red' : 'push-button-green',
  };
}

export const buttonNO = button('buttonNO', false, ['13', '14']);
export const buttonNC = button('buttonNC', true, ['11', '12']);

/** Botão de emergência: NF, fica encravado até ser desbloqueado. */
export const emergencyStop: DeviceDef = {
  ...button('emergencyStop', true, ['11', '12']),
  size: { w: 80, h: 80 },
  actions: (d) => [{ id: d.state.pressed ? 'unlatch' : 'press_latch' }],
  operate(d, a) {
    if (a === 'press_latch') d.state.pressed = true;
    else if (a === 'unlatch') d.state.pressed = false;
    else return false;
    return true;
  },
  measure: (d) => [ms('meas.position', d.state.pressed ? 'latched' : 'released')],
  model3d: 'emergency-stop',
};

/* ---------------- Selector 0-1-2 ---------------- */

export const selector012: DeviceDef = {
  type: 'selector012',
  category: 'control',
  domain: [...IND],
  level: 'beginner',
  prefix: 'S',
  size: { w: 100, h: 80 },
  terminals: [
    { id: '13', x: 20, y: 0, kind: 'any', label: '13' },
    { id: '14', x: 20, y: 80, kind: 'any', label: '14' },
    { id: '23', x: 60, y: 0, kind: 'any', label: '23' },
    { id: '24', x: 60, y: 80, kind: 'any', label: '24' },
  ],
  params: [],
  initialState: () => ({ pos: 0 }),
  phaseOnlySwitch: true,
  conducts: (d) => [
    { a: '13', b: '14', closed: d.state.pos === 1 },
    { a: '23', b: '24', closed: d.state.pos === 2 },
  ],
  stamp(d, b) {
    b.sw(b.node('13'), b.node('14'), d.state.pos === 1, 'c1');
    b.sw(b.node('23'), b.node('24'), d.state.pos === 2, 'c2');
  },
  measure: (d) => [ms('meas.position', `position_${Number(d.state.pos ?? 0)}`)],
  actions: (d) => {
    const pos = Number(d.state.pos ?? 0);
    return [(pos + 1) % 3, (pos + 2) % 3].map((x) => ({ id: `pos_${x}` }));
  },
  operate(d, a) {
    const mt = /^pos_([012])$/.exec(a);
    if (!mt) return false;
    d.state.pos = Number(mt[1]);
    return true;
  },
  model3d: 'selector',
};

/* ---------------- Sinalizador luminoso ---------------- */

const PILOT_COLOR: Record<string, string> = { green: '#3fbf5f', red: '#e04848', orange: '#f39a2b', white: '#f4f4f4', blue: '#3d7ff0' };

export const pilotLight: DeviceDef<{ ov?: number }> = {
  type: 'pilotLight',
  category: 'loads',
  domain: [...IND],
  level: 'beginner',
  prefix: 'H',
  size: { w: 80, h: 70 },
  terminals: [
    { id: 'X1', x: 20, y: 0, kind: 'any', label: 'X1' },
    { id: 'X2', x: 60, y: 0, kind: 'any', label: 'X2' },
  ],
  params: [sel('color', ['green', 'red', 'orange', 'white', 'blue'], 'green', undefined, false, true), sel('Vn', [24, 230, 400], 230, 'V')],
  initialState: () => ({ burnt: false }),
  load: { phase: 'X1', neutral: 'X2', nominalVoltage: (d) => p(d, 'Vn'), lighting: true, working: (d, sol) => !d.state.burnt && rms(sol.vv(d, 'X1', 'X2')) > 0.6 * p(d, 'Vn') },
  stamp(d, b) {
    if (!d.state.burnt) b.R(b.node('X1'), b.node('X2'), (p(d, 'Vn') ** 2) / 1, 'z');
  },
  logic: (d, ctx, rt) => overvoltageBurn(d, ctx, rt, rms(ctx.sol.vv(d, 'X1', 'X2')), p(d, 'Vn')),
  measure(d, sol) {
    const V = rms(sol.vv(d, 'X1', 'X2'));
    const lit = !d.state.burnt && V > 0.6 * p(d, 'Vn');
    return [ms('meas.state', d.state.burnt ? 'burnt' : lit ? 'lit' : 'unlit'), m('meas.voltage', V, 'V')];
  },
  actions: (d) => (d.state.burnt ? [{ id: 'replace' }] : []),
  operate(d, a) {
    if (a !== 'replace' || !d.state.burnt) return false;
    d.state.burnt = false;
    return true;
  },
  diagnose: (d, ctx) =>
    d.state.burnt ? [diag('WRONG_VOLTAGE', 'error', [dev(d.id)], { device: d.name, voltage: ctx.fmt(Number(d.state.burntVoltage ?? 0), 'V'), nominal: ctx.fmt(p(d, 'Vn'), 'V') }, d.id)] : [],
  model3d: 'pilot-light',
};

/* ---------------- Sensores de contacto ---------------- */

function contactSensor(type: string, on: string, off: string, level: 'beginner' | 'pro', params: DeviceDef['params'] = []): DeviceDef {
  return {
    type,
    category: 'sensors',
    domain: [...IND],
    level,
    prefix: 'B',
    size: { w: 120, h: 80 },
    terminals: [
      { id: '13', x: 20, y: 0, kind: 'any', label: '13' },
      { id: '14', x: 20, y: 80, kind: 'any', label: '14' },
      { id: '21', x: 60, y: 0, kind: 'any', label: '21' },
      { id: '22', x: 60, y: 80, kind: 'any', label: '22' },
    ],
    params,
    initialState: () => ({ actuated: false }),
    conducts: (d) => [
      { a: '13', b: '14', closed: !!d.state.actuated },
      { a: '21', b: '22', closed: !d.state.actuated },
    ],
    stamp(d, b) {
      b.sw(b.node('13'), b.node('14'), !!d.state.actuated, 'no');
      b.sw(b.node('21'), b.node('22'), !d.state.actuated, 'nc');
    },
    measure: (d) => [ms('meas.state', d.state.actuated ? on : off)],
    actions: (d) => [{ id: d.state.actuated ? off : on }],
    operate(d, a) {
      if (a === on) d.state.actuated = true;
      else if (a === off) d.state.actuated = false;
      else return false;
      return true;
    },
    model3d: 'sensor',
  };
}

export const limitSwitch = contactSensor('limitSwitch', 'actuated', 'released', 'beginner');
export const floatSwitch = contactSensor('floatSwitch', 'level_high', 'level_low', 'beginner');
export const pressureSwitch = contactSensor('pressureSwitch', 'pressure_high', 'pressure_low', 'pro', [num('setpoint', 4, 'bar', 0.5, 16, 0.5)]);

/* ---------------- Sensores PNP de 3 fios ---------------- */

interface PnpRT {
  on?: boolean;
}

function pnpSensor(type: string, on: string, off: string): DeviceDef<PnpRT> {
  return {
    type,
    category: 'sensors',
    domain: [...IND],
    level: 'pro',
    prefix: 'B',
    size: { w: 120, h: 80 },
    terminals: [
      { id: 'BN', x: 20, y: 0, kind: 'DC+', label: 'BN +' },
      { id: 'BK', x: 60, y: 0, kind: 'any', label: 'BK' },
      { id: 'BU', x: 100, y: 0, kind: 'DC-', label: 'BU −' },
    ],
    params: [],
    initialState: () => ({ detected: false }),
    conducts: (d) => [{ a: 'BN', b: 'BK', closed: !!d.state.detected }],
    stamp(d, b, rt) {
      // Consumo próprio de 10 mA a 24 V; saída PNP: liga BK a BN quando detecta.
      b.R(b.node('BN'), b.node('BU'), 2400, 'self');
      if (rt.on) b.R(b.node('BN'), b.node('BK'), 1, 'out');
    },
    logic(d, ctx, rt) {
      const powered = ctx.sol.vv(d, 'BN', 'BU').dc > 10;
      const on = powered && !!d.state.detected;
      if (on === !!rt.on) return false;
      rt.on = on;
      return true;
    },
    measure: (d, sol, rt) => [ms('meas.state', d.state.detected ? on : off), ms('meas.output', rt.on ? 'on' : 'off'), m('meas.supplyVoltage', sol.vv(d, 'BN', 'BU').dc, 'V')],
    actions: (d) => [{ id: d.state.detected ? off : on }],
    operate(d, a) {
      if (a === on) d.state.detected = true;
      else if (a === off) d.state.detected = false;
      else return false;
      return true;
    },
    model3d: 'sensor',
    simplifications: ['simpl.pnp_sensor'],
  };
}

export const inductiveSensor = pnpSensor('inductiveSensor', 'target_present', 'target_absent');
export const photocell = pnpSensor('photocell', 'beam_cut', 'beam_clear');

export const command3 = [contactor3p, auxRelay, timerOn, timerOff, buttonNO, buttonNC, emergencyStop, selector012, pilotLight, limitSwitch, floatSwitch, pressureSwitch, inductiveSensor, photocell];

/* ---------------- Símbolos ---------------- */

const coilBox = (on: boolean, burnt: boolean, h: number, extra: Prim[] = []): Prim[] => [
  L(20, 0, 20, h / 2 - 12), L(20, h / 2 + 12, 20, h),
  Re(8, h / 2 - 12, 24, 24, burnt ? 'sl coil bad' : on ? 'sl coil on' : 'sl coil'),
  ...extra,
];
const contactCol = (x: number, h: number, closed: boolean, nc = false) => pole(x, 0, h, closed, { nc });

contactor3p.symbol = (d, _l, n) => {
  const on = !!d.state.closed;
  return [
    ...coilBox(on, !!d.state.coilBurnt, 120),
    ...[60, 100, 140].flatMap((x) => contactCol(x, 120, on)),
    ...contactCol(180, 120, on), ...contactCol(220, 120, !on, true),
    L(32, 60, 214, 60, 'sl dash'),
    Tx(100, 116, `${n(p(d, 'Uc'))} V~`, 'txt xs'),
  ];
};
auxRelay.symbol = (d, _l, n) => {
  const on = !!d.state.closed;
  return [
    ...coilBox(on, !!d.state.coilBurnt, 100),
    ...contactCol(60, 100, on), ...contactCol(100, 100, on), ...contactCol(140, 100, !on, true), ...contactCol(180, 100, !on, true),
    L(32, 50, 174, 50, 'sl dash'),
    Tx(110, 96, `${n(p(d, 'Uc'))} V~`, 'txt xs'),
  ];
};
const timerSymbol = (onDelay: boolean) => (d: Device, _l: unknown, n: (v: number) => string): Prim[] => {
  const coil = !!d.state.coil;
  const out = !!d.state.out;
  return [
    ...coilBox(coil, false, 100, [onDelay ? Re(8, 38, 8, 24, 'sl fill-dark') : Pa('M8 38 l8 12 l-8 12', 'sl')]),
    L(80, 0, 80, 30), Ci(80, 32, 2.5, 'dot'),
    L(80, 32, out ? 100 : 60, 62, 'sl on'),
    L(60, 66, 60, 100), L(100, 66, 100, 100), Ci(60, 64, 2, 'dot'), Ci(100, 64, 2, 'dot'),
    Pa(onDelay ? 'M86 44 a6 6 0 0 1 12 0' : 'M86 44 a6 6 0 0 0 12 0', 'sl thin'),
    Tx(120, 30, `${n(p(d, 't'))} s`, 'txt xs'),
  ];
};
timerOn.symbol = timerSymbol(true) as never;
timerOff.symbol = timerSymbol(false) as never;
const btnHead = (x: number, y: number, color: string): Prim => Ci(x, y, 6, 'sl', color);
buttonNO.symbol = (d) => [...pole(40, 0, 80, !!d.state.pressed, { push: true }), btnHead(16, 40, '#3fbf5f')];
buttonNC.symbol = (d) => [...pole(40, 0, 80, !d.state.pressed, { push: true, nc: true }), btnHead(16, 40, '#e04848')];
emergencyStop.symbol = (d) => [...pole(40, 0, 80, !d.state.pressed, { push: true, nc: true }), Pa('M6 40 a10 10 0 0 1 20 0 z', 'sl', '#e04848'), Re(4, 40, 24, 4, 'sl', '#f3c623')];
selector012.symbol = (d) => {
  const pos = Number(d.state.pos ?? 0);
  return [...pole(20, 0, 80, pos === 1), ...pole(60, 0, 80, pos === 2), L(8, 40, 54, 40, 'sl dash'), Ci(84, 30, 9, 'sl fill'), L(84, 30, 84 + [0, -7, 7][pos]!, 22, 'sl w3'), Tx(84, 56, '0 1 2', 'txt xs')];
};
pilotLight.symbol = (d, look) => {
  const lit = look.state === 'lit';
  const c = PILOT_COLOR[ps(d, 'color')] ?? '#3fbf5f';
  return [L(20, 0, 20, 24), L(60, 0, 60, 24), L(20, 24, 28, 30), L(60, 24, 52, 30), Ci(40, 42, 15, 'sl', lit ? c : '#ffffff'), L(30, 32, 50, 52), L(50, 32, 30, 52), ...(d.state.burnt ? [Tx(40, 68, '✕', 'txt bad')] : [])];
};
const sensorSymbol = (actuator: (on: boolean) => Prim[]) => (d: Device): Prim[] => {
  const on = !!d.state.actuated;
  return [...pole(20, 0, 80, on), ...pole(60, 0, 80, !on, { nc: true }), L(8, 40, 54, 40, 'sl dash'), ...actuator(on)];
};
limitSwitch.symbol = sensorSymbol((on) => [L(54, 40, 84, 40, 'sl dash'), Ci(92, on ? 34 : 40, 7, 'sl fill'), L(100, 52, 112, 52)]);
floatSwitch.symbol = sensorSymbol((on) => [L(54, 40, 80, 40, 'sl dash'), Re(82, on ? 22 : 46, 20, 12, 'sl', '#f39a2b'), Pa('M78 64 q6 -4 12 0 t12 0', 'sl thin')]);
pressureSwitch.symbol = sensorSymbol((on) => [L(54, 40, 80, 40, 'sl dash'), Pa('M80 30 v20 l8 -6 l8 6 v-20', 'sl'), Tx(100, 66, on ? 'P↑' : 'P↓', 'txt xs')]);
const pnpSymbol = (mark: Prim[]) => (d: Device, look: { state: string; num(k: string): number }): Prim[] => [
  L(20, 0, 20, 20), L(60, 0, 60, 20), L(100, 0, 100, 20),
  Re(10, 20, 100, 36, 'sl fill'), ...mark,
  Re(94, 26, 10, 10, d.state.detected ? 'ind on' : 'ind off'),
  Tx(60, 70, look.num('supplyVoltage') > 10 ? 'PNP' : 'PNP · 0 V', 'txt xs'),
];
inductiveSensor.symbol = pnpSymbol([Pa('M24 30 h20 M24 38 h20 M24 46 h20', 'sl thin'), Pa('M50 30 l8 8 l-8 8', 'sl')]) as never;
photocell.symbol = pnpSymbol([Ci(36, 38, 8, 'sl'), Pa('M48 34 l10 -6 M48 42 l10 6', 'sl thin')]) as never;
