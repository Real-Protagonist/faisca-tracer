/**
 * Motor trifásico de indução.
 *
 * Modelo eléctrico: em cada enrolamento, ramo de magnetização (jXm) em paralelo com o ramo do
 * rotor (R1 + R2/s + jXl), com R1 = R2. Os quatro parâmetros saem da placa: corrente e factor de
 * potência nominais, corrente de arranque k · In com FP 0,4. O escorregamento de cada passo vem da
 * velocidade do passo anterior.
 *
 * Modelo mecânico: binário pelas componentes simétricas das tensões dos enrolamentos,
 * T = T(V1, s) − T(V2, 2 − s). Com uma fase em falta, V1 = V2 e o motor parado não tem binário:
 * não arranca e a corrente fica alta. A sequência inversa faz rodar ao contrário.
 */
import { cabs, cadd, csub, cx, power, rms, type Complex } from '../../solver/complex';
import { diag, dev, wire, type Diagnostic } from '../../diagnostics/types';
import { findPath } from '../../diagnostics/topology';
import { m, ms, num, p, ps, sel } from '../common';
import type { Device } from '../../project/types';
import type { DeviceDef, DiagnoseContext, SolutionView } from '../types';
import { Ci, L, Tx, type Prim } from '../symbols';
import { endName, sequences } from './helpers';

const IND = ['industrial'] as const;
const SQ3 = Math.sqrt(3);
const LOCKED_PF = 0.4;

export interface MotorModel {
  /** Tensão nominal de cada enrolamento (V). */
  Vw: number;
  /** R1 = R2 (Ω), reactância de fugas e susceptância de magnetização à frequência nominal. */
  R: number;
  Xl: number;
  Bm: number;
  /** Escorregamento nominal. */
  sn: number;
  /** Binário nominal na escala do modelo (normaliza o binário a 1 na carga nominal). */
  Tref: number;
}

/** Parâmetros do circuito equivalente a partir da placa do motor. */
export function motorModel(Pkw: number, eta: number, pf: number, k: number, Vw: number): MotorModel {
  const Sw = (Pkw * 1000) / (eta * pf) / 3;
  const Zn = (Vw * Vw) / Sw;
  const Gn = pf / Zn;
  const Bn = Math.sqrt(1 - pf * pf) / Zn;
  const Glr = (k / Zn) * LOCKED_PF;
  const Blr = (k / Zn) * Math.sqrt(1 - LOCKED_PF ** 2);
  let Bm = 0;
  let R = 0;
  let Xl = 0;
  let A = 0;
  for (let it = 0; it < 8; it++) {
    // Ramo do rotor bloqueado = admitância de arranque menos a magnetização.
    const g = Glr;
    const b = Blr - Bm;
    const den = g * g + b * b;
    R = g / den / 2;
    Xl = b / den;
    const disc = Math.max(0, 1 - 4 * Gn * Gn * Xl * Xl);
    A = (1 + Math.sqrt(disc)) / (2 * Gn);
    Bm = Math.max(0, Bn - Xl / (A * A + Xl * Xl));
  }
  const sn = R / Math.max(A - R, 1e-9);
  const model = { Vw, R, Xl, Bm, sn, Tref: 1 };
  model.Tref = torqueAt(model, Vw, sn, 1);
  return model;
}

/** Binário (escala do modelo) para a tensão V do enrolamento, escorregamento s e frequência kf. */
export function torqueAt(M: MotorModel, V: number, s: number, kf: number): number {
  const ss = Math.abs(s) < 1e-4 ? (s < 0 ? -1e-4 : 1e-4) : s;
  const r = M.R / ss;
  return (V * V * r) / ((M.R + r) ** 2 + (M.Xl * kf) ** 2) / Math.max(kf, 1e-3);
}

/** Corrente nominal: I = P / (√3 · U · η · cos φ). */
export const motor3Rated = (Pkw: number, eta: number, pf: number, U = 400) => (Pkw * 1000) / (SQ3 * U * eta * pf);

/** Constante de arranque mecânica (s) por inércia: tempo para acelerar até ao sincronismo com o binário nominal. */
export const MOTOR_H: Record<string, number> = { low: 0.8, medium: 2, high: 5 };
/** Fracção do binário de carga que não depende da velocidade (atrito). */
const LOAD_STATIC = 0.3;
/** Constante térmica dos enrolamentos (s): aquece com (I/In)² − 1. */
const MOTOR_THERMAL = 1000;

const WINDINGS = [
  ['U1', 'U2'],
  ['V1', 'V2'],
  ['W1', 'W2'],
] as const;
const LINE = ['U1', 'V1', 'W1'] as const;

type Connection = 'star' | 'delta' | 'external';

/** Ligação na placa de bornes: barretes em estrela ou em triângulo. */
export function boardShorts(conn: Connection): string[][] {
  if (conn === 'star') return [['U2', 'V2', 'W2']];
  if (conn === 'delta') return [['U1', 'W2'], ['V1', 'U2'], ['W1', 'V2']];
  return [];
}

/** Tensão nominal de cada enrolamento: a menor das duas tensões da placa. */
const windingVoltage = (d: Device) => (ps(d, 'Vn') === '400/690' ? 400 : 230);
/** Tensão nominal entre fases para a ligação escolhida. */
export function motorLineVoltage(d: Device): number {
  const Vw = windingVoltage(d);
  return ps(d, 'connection') === 'star' ? Vw * SQ3 : Vw;
}

const modelOf = (d: Device) => motorModel(p(d, 'Pm'), p(d, 'eta'), p(d, 'PF'), p(d, 'kStart'), windingVoltage(d));

export interface Motor3RT {
  /** Velocidade em fracção da velocidade de sincronismo à frequência da rede (com sinal). */
  speed?: number;
  dir?: 1 | -1;
  /** Tempo com tensão (s). */
  tOn?: number;
  torque?: number;
  heat?: number;
  ov?: number;
  missing?: string | null;
  phase?: 'stopped' | 'starting' | 'running' | 'stalled' | 'stopping';
  kf?: number;
  fGrid?: number;
  model?: { key: string; m: MotorModel };
}

function cachedModel(d: Device, rt: Motor3RT): MotorModel {
  const key = [p(d, 'Pm'), p(d, 'eta'), p(d, 'PF'), p(d, 'kStart'), ps(d, 'Vn')].join('|');
  if (rt.model?.key !== key) rt.model = { key, m: modelOf(d) };
  return rt.model.m;
}

const windingPhasors = (sol: SolutionView, d: Device): Complex[] => WINDINGS.map(([a, b]) => sol.vv(d, a, b).ac);

/** Correntes de linha nos terminais U1, V1, W1 (soma das correntes dos enrolamentos em cada nó). */
function lineCurrents(sol: SolutionView, d: Device): number[] {
  const conn = ps(d, 'connection') as Connection;
  const groups = boardShorts(conn);
  const same = (x: string, y: string) => x === y || groups.some((g) => g.includes(x) && g.includes(y));
  const Iw = WINDINGS.map((_, k) => cadd(sol.i(d, 'r' + k).ac, sol.i(d, 'm' + k).ac));
  return LINE.map((t) => {
    let s = cx();
    WINDINGS.forEach(([a, b], k) => {
      if (same(t, a)) s = cadd(s, Iw[k]!);
      if (same(t, b)) s = csub(s, Iw[k]!);
    });
    return cabs(s);
  });
}

/** Terminal de linha sem tensão (falta de fase), ou null. */
function missingTerminal(sol: SolutionView, d: Device): string | null {
  const v = LINE.map((t) => sol.v(d, t).ac);
  const ll = [cabs(csub(v[0]!, v[1]!)), cabs(csub(v[1]!, v[2]!)), cabs(csub(v[2]!, v[0]!))];
  const max = Math.max(...ll);
  if (max < 0.3 * motorLineVoltage(d)) return null;
  // U1 está em UV e WU; V1 em UV e VW; W1 em VW e WU.
  const pairs: [number, number][] = [[0, 2], [0, 1], [1, 2]];
  for (let i = 0; i < 3; i++) {
    const [a, b] = pairs[i]!;
    if (ll[a]! < 0.65 * max && ll[b]! < 0.65 * max) return LINE[i]!;
  }
  return null;
}

export const motor3ph: DeviceDef<Motor3RT> = {
  type: 'motor3ph',
  category: 'motors',
  domain: [...IND],
  level: 'beginner',
  prefix: 'M',
  size: { w: 160, h: 140 },
  terminals: [
    { id: 'U1', x: 20, y: 0, kind: 'L1', label: 'U1' },
    { id: 'V1', x: 60, y: 0, kind: 'L2', label: 'V1' },
    { id: 'W1', x: 100, y: 0, kind: 'L3', label: 'W1' },
    { id: 'PE', x: 140, y: 0, kind: 'PE', label: 'PE' },
    { id: 'W2', x: 20, y: 140, kind: 'any', label: 'W2' },
    { id: 'U2', x: 60, y: 140, kind: 'any', label: 'U2' },
    { id: 'V2', x: 100, y: 140, kind: 'any', label: 'V2' },
  ],
  params: [
    sel('Pm', [0.37, 0.55, 0.75, 1.1, 1.5, 2.2, 3, 4, 5.5, 7.5, 11, 15, 18.5, 22, 30, 37, 45, 55], 4, 'kW'),
    sel('Vn', ['230/400', '400/690'], '230/400', 'V'),
    sel('connection', ['star', 'delta', 'external'], 'star', undefined, false, true),
    num('load', 80, '%', 0, 200, 5),
    sel('inertia', ['low', 'medium', 'high'], 'medium', undefined, true, true),
    sel('poles', [2, 4, 6], 4, undefined, true),
    num('PF', 0.85, '', 0.5, 0.95, 0.01, true),
    num('eta', 0.88, '', 0.5, 0.98, 0.01, true),
    num('kStart', 7, '', 4, 9, 0.5, true),
  ],
  initialState: () => ({ locked: false, burnt: false }),
  classI: true,
  shorts: (d) => boardShorts(ps(d, 'connection') as Connection),
  load: {
    phase: 'U1',
    neutral: 'V1',
    phases: [...LINE],
    nominalVoltage: motorLineVoltage,
    working: (_d, _sol, rt: Motor3RT) => rt.phase === 'running',
  },
  stamp(d, b, rt) {
    if (d.state.burnt) return;
    const M = cachedModel(d, rt);
    const kf = Math.max(b.freq('U1'), 0.02);
    const speed = rt.speed ?? 0;
    const dir = rt.dir ?? 1;
    const s = Math.min(2, Math.max(1e-3, (kf - dir * speed) / kf));
    WINDINGS.forEach(([a, c], k) => {
      b.Z(b.node(a), b.node(c), { R: M.R + M.R / s, L: (M.Xl * kf) / b.omega }, 'r' + k);
      if (M.Bm > 0) b.Z(b.node(a), b.node(c), { R: 0, L: kf / (M.Bm * b.omega) }, 'm' + k);
      else b.R(b.node(a), b.node(c), 1e7, 'm' + k);
    });
  },
  logic(d, ctx, rt) {
    rt.fGrid = ctx.project.frequency;
    if (d.state.burnt) {
      rt.speed = decay(rt.speed ?? 0, ctx.dt);
      rt.phase = 'stopped';
      return false;
    }
    const M = cachedModel(d, rt);
    const kf = Math.max(ctx.sol.freq(d, 'U1'), 0.02);
    rt.kf = kf;
    const vw = windingPhasors(ctx.sol, d);
    const { v1, v2 } = sequences(vw[0]!, vw[1]!, vw[2]!);
    const V1 = cabs(v1);
    const V2 = cabs(v2);
    const energized = V1 + V2 > 0.2 * M.Vw * kf;
    rt.missing = energized ? missingTerminal(ctx.sol, d) : null;
    let speed = rt.speed ?? 0;
    if (V1 > 1.2 * V2 + 1) rt.dir = 1;
    else if (V2 > 1.2 * V1 + 1) rt.dir = -1;
    else if (Math.abs(speed) > 0.05) rt.dir = speed > 0 ? 1 : -1;
    rt.dir ??= 1;

    const L = p(d, 'load') / 100;
    const wn = 1 - M.sn;
    const loadT = (w: number) => L * (LOAD_STATIC + (1 - LOAD_STATIC) * (w / wn) ** 2);
    const motorT = (w: number) => (torqueAt(M, V1, (kf - w) / kf, kf) - torqueAt(M, V2, (kf + w) / kf, kf)) / M.Tref;
    const H = MOTOR_H[ps(d, 'inertia')] ?? 0.4;
    if (ctx.dt > 0) {
      if (d.state.locked) speed = 0;
      else {
        const n = Math.max(1, Math.ceil(ctx.dt / 0.005));
        const h = ctx.dt / n;
        for (let i = 0; i < n; i++) {
          const Tm = motorT(speed);
          const sgn = Math.abs(speed) > 1e-4 ? Math.sign(speed) : Math.sign(Tm);
          if (Math.abs(speed) <= 1e-4 && Math.abs(Tm) <= loadT(0)) {
            speed = 0;
            continue;
          }
          const f = (w: number) => (motorT(w) - sgn * loadT(w)) / H;
          const f0 = f(speed);
          const df = (f(speed + 1e-4) - f(speed - 1e-4)) / 2e-4;
          const next = df < 0 ? speed + (h * f0) / (1 - h * df) : speed + h * f0;
          // A carga trava o motor: não passa por zero para o sentido contrário sem binário.
          speed = Math.sign(next) !== Math.sign(speed) && speed !== 0 && Math.abs(motorT(0)) <= loadT(0) ? 0 : next;
        }
      }
      rt.speed = speed;
      rt.torque = motorT(speed);
      rt.tOn = energized ? (rt.tOn ?? 0) + ctx.dt : 0;

      // Aquecimento dos enrolamentos.
      const In = motor3Rated(p(d, 'Pm'), p(d, 'eta'), p(d, 'PF'), motorLineVoltage(d));
      const I = Math.max(...lineCurrents(ctx.sol, d));
      rt.heat = Math.max(0, (rt.heat ?? 0) + (((I / In) ** 2 - 1) * ctx.dt) / MOTOR_THERMAL);
      const Vmax = Math.max(...vw.map(cabs));
      rt.ov = Vmax > 1.3 * M.Vw * Math.max(kf, 1) ? (rt.ov ?? 0) + ctx.dt : 0;
      if (rt.ov > 2 || rt.heat >= 1) {
        const over = rt.ov > 2;
        Object.assign(d.state, { burnt: true, burntCause: over ? 'voltage' : 'heat', burntVoltage: Vmax });
        ctx.emit({ code: 'motor_burnt', severity: 'error', values: { device: d.name } });
        return true;
      }
    }

    // Estado para as mensagens e para o símbolo: calculado no início do passo; nas resoluções
    // seguintes do mesmo passo só se actualiza a perda de tensão (um contactor que abriu).
    if (ctx.dt <= 0 && rt.phase) {
      if (!energized && rt.phase !== 'stopped') rt.phase = Math.abs(speed) < 0.01 ? 'stopped' : 'stopping';
      return false;
    }
    const prev = rt.phase ?? 'stopped';
    const tStart = 2 * (MOTOR_H[ps(d, 'inertia')] ?? 2) + 1;
    let ph: Motor3RT['phase'];
    if (!energized) ph = Math.abs(speed) < 0.01 ? 'stopped' : 'stopping';
    else if (Math.abs(speed) >= 0.85 * kf * wn) ph = 'running';
    else if ((rt.tOn ?? 0) > tStart && Math.abs(speed) < 0.5 * kf) ph = 'stalled';
    else ph = 'starting';
    if (!energized && Math.abs(speed) < 0.01) ph = 'stopped';
    rt.phase = ph;
    if (ph !== prev) {
      if (ph === 'running') ctx.emit({ code: 'motor_running', severity: 'info', values: { device: d.name } });
      if (ph === 'stalled') ctx.emit({ code: rt.missing ? 'motor_phase_loss' : 'motor_stalled', severity: 'warning', values: { device: d.name, voltage: ctx.fmt(V1 * SQ3, 'V') } });
    }
    return false;
  },
  measure(d, sol, rt) {
    const M = rt.model?.m ?? modelOf(d);
    const I = lineCurrents(sol, d);
    let pw = { P: 0, Q: 0 };
    WINDINGS.forEach(([a, b], k) => {
      const i = { ac: cadd(sol.i(d, 'r' + k).ac, sol.i(d, 'm' + k).ac), dc: 0 };
      const x = power(sol.vv(d, a, b), i);
      pw = { P: pw.P + x.P, Q: pw.Q + x.Q };
    });
    const S = Math.hypot(pw.P, pw.Q);
    const sync = (120 * (rt.fGrid ?? 50)) / p(d, 'poles');
    const speed = rt.speed ?? 0;
    const kf = rt.kf ?? 1;
    const state = d.state.burnt ? 'burnt' : rt.missing ? 'phase_loss' : (rt.phase ?? 'stopped');
    return [
      ms('meas.state', state),
      ms('meas.direction', Math.abs(speed) < 0.01 ? 'none' : speed > 0 ? 'forward' : 'reverse'),
      m('meas.speed', Math.abs(speed) * sync, 'rpm'),
      m('meas.lineVoltage', rms(sol.vv(d, 'U1', 'V1')), 'V'),
      m('meas.currentL1', I[0]!, 'A'),
      m('meas.currentL2', I[1]!, 'A'),
      m('meas.currentL3', I[2]!, 'A'),
      m('meas.activePower', pw.P, 'W'),
      m('meas.powerFactor', S > 1e-9 ? pw.P / S : 1, '', true),
      m('meas.torque', 100 * (rt.torque ?? 0), '%', true),
      m('meas.slip', 100 * (kf > 0.02 ? Math.max(0, (kf - Math.abs(speed)) / kf) : 0), '%', true),
      m('meas.frequency', kf * (rt.fGrid ?? 50), 'Hz', true),
      m('meas.ratedCurrent', motor3Rated(p(d, 'Pm'), p(d, 'eta'), p(d, 'PF'), motorLineVoltage(d)), 'A', true),
      m('meas.thermal', 100 * Math.min(1, rt.heat ?? 0), '%', true),
      m('meas.ratedSlip', 100 * M.sn, '%', true),
    ];
  },
  actions: (d) => [
    ...(d.state.burnt ? [{ id: 'replace' }] : []),
    { id: d.state.locked ? 'free_rotor' : 'lock_rotor', manualOnly: true },
  ],
  operate(d, a, rt) {
    if (a === 'replace' && d.state.burnt) {
      Object.assign(d.state, { burnt: false, burntCause: null });
      rt.heat = 0;
      rt.ov = 0;
    } else if (a === 'lock_rotor') d.state.locked = true;
    else if (a === 'free_rotor') d.state.locked = false;
    else return false;
    return true;
  },
  diagnose: (d, ctx, rt) => motorDiagnostics(d, ctx, rt),
  model3d: 'motor-3ph',
  simplifications: ['simpl.motor3_equivalent', 'simpl.motor3_sequence'],
};

const decay = (w: number, dt: number) => (Math.abs(w) < 0.01 ? 0 : w * Math.exp(-dt / 2));

function motorDiagnostics(d: Device, ctx: DiagnoseContext, rt: Motor3RT): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (d.state.burnt) {
    if (d.state.burntCause === 'voltage') {
      out.push(diag('WRONG_VOLTAGE', 'error', [dev(d.id)], { device: d.name, voltage: ctx.fmt(Number(d.state.burntVoltage ?? 0), 'V'), nominal: ctx.fmt(windingVoltage(d), 'V') }, d.id));
    } else {
      out.push(diag('MOTOR_OVERHEATED', 'error', [dev(d.id)], { device: d.name, rated: ctx.fmt(motor3Rated(p(d, 'Pm'), p(d, 'eta'), p(d, 'PF'), motorLineVoltage(d)), 'A') }, d.id));
    }
    return out;
  }
  if (rt.missing) out.push(phaseLossDiag(d, ctx, rt.missing));
  else if (rt.phase === 'stalled') out.push(diag('MOTOR_STALLED', 'error', [dev(d.id)], { device: d.name, load: ctx.fmt(p(d, 'load'), '%') }, d.id));
  return out;
}

/** «Falta a fase L3 no terminal W1»: procura o primeiro elemento aberto entre a fonte e o terminal. */
function phaseLossDiag(d: Device, ctx: DiagnoseContext, terminal: string): Diagnostic {
  const { topo, project: P } = ctx;
  const start = topo.pin(d.id, terminal);
  const phaseSeeds = topo.seeds.filter((s) => s.role === 'phase');
  const path = findPath(topo, start, new Set(phaseSeeds.map((s) => s.pin)));
  const values: Record<string, string> = { device: d.name, terminal, phase: '—', from: '—', to: endName(P, { device: d.id, terminal }) };
  const targets = [dev(d.id)];
  let fix = d.id;
  if (path) {
    const pins = [start];
    for (const e of path) pins.push(e.a === pins[pins.length - 1] ? e.b : e.a);
    const seed = phaseSeeds.find((s) => s.pin === pins[pins.length - 1]);
    if (seed) values.phase = seed.terminal;
    // O primeiro elemento aberto a partir da fonte; senão, o cabo que chega ao motor.
    let k = -1;
    for (let i = path.length - 1; i >= 0; i--) if (!path[i]!.closed) {
      k = i;
      break;
    }
    if (k < 0) k = path.findIndex((e) => e.kind === 'wire');
    const e = k >= 0 ? path[k]! : null;
    if (e?.kind === 'wire') {
      const w = P.wires.find((x) => x.id === e.id)!;
      const srcPin = pins[k + 1];
      const [src, dst] = topo.pin(w.a.device, w.a.terminal) === srcPin ? [w.a, w.b] : [w.b, w.a];
      values.from = endName(P, src);
      values.to = endName(P, dst);
      targets.push(wire(w.id));
      fix = w.id;
    } else if (e) {
      const blocker = P.devices.find((x) => x.id === e.id);
      if (blocker) {
        values.from = blocker.name;
        targets.push(dev(blocker.id));
        fix = blocker.id;
      }
    }
  }
  return diag('MOTOR_PHASE_LOSS', 'error', targets, values, fix);
}

/* ---------------- Símbolo ---------------- */

motor3ph.symbol = (d, look, n) => {
  const conn = ps(d, 'connection');
  const dir = look.str('direction') === 'reverse' ? -1 : 1;
  const prims: Prim[] = [
    L(20, 0, 20, 30), L(60, 0, 60, 30), L(100, 0, 100, 30), L(140, 0, 140, 56, 'sl pe'), L(20, 30, 46, 46), L(100, 30, 74, 46),
    Ci(60, 70, 26, d.state.burnt ? 'sl bad fill' : 'sl fill'),
    Tx(60, 74, 'M', 'txt big'), Tx(60, 88, '3~', 'txt xs'),
    { t: 'rotor', cx: 60, cy: 70, spin: Math.min(1, look.num('speed') / 1500), dir: dir as 1 | -1, items: [0, 120, 240].map((a) => {
      const s = Math.sin((a * Math.PI) / 180), c = Math.cos((a * Math.PI) / 180);
      return L(60 + s * 26, 70 - c * 26, 60 + s * 33, 70 - c * 33, 'sl rot');
    }) },
    Tx(150, 136, `${n(p(d, 'Pm'))} kW`, 'txt xs', 'end'),
    Tx(150, 100, conn === 'star' ? 'Y' : conn === 'delta' ? 'Δ' : 'Y/Δ', 'txt sm', 'end'),
  ];
  if (conn === 'external') prims.push(L(20, 140, 20, 110), L(60, 140, 60, 96), L(100, 140, 100, 110), L(20, 110, 44, 90), L(100, 110, 76, 90));
  if (d.state.locked) prims.push(L(40, 50, 80, 90, 'sl bad'), L(80, 50, 40, 90, 'sl bad'));
  return prims;
};

