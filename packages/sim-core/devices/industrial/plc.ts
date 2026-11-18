/**
 * Autómato programável (PLC) com 8 entradas a 24 V DC, 8 saídas a relé e um programa em ladder.
 *
 * Cada degrau é uma série de colunas; cada coluna é um grupo de contactos em paralelo.
 * Exemplo de auto-retenção: [[I0, Q0], [/I1]] → Q0 = (I0 OU Q0) E NÃO I1.
 * O programa corre no mesmo ciclo que os relés: se uma saída muda, o circuito é resolvido outra vez.
 */
import { rms } from '../../solver/complex';
import { ms } from '../common';
import type { Device } from '../../project/types';
import type { DeviceDef, ParamDef, TerminalDef } from '../types';
import { L, Re, Tx, type Prim } from '../symbols';

export const PLC_INPUTS = 8;
export const PLC_OUTPUTS = 8;
export const PLC_MEMORY = 16;
export const PLC_TIMERS = 8;
export const PLC_COUNTERS = 8;

export interface LadderContact {
  /** Operando: I0–I7, Q0–Q7, M0–M15, T0–T7, C0–C7. */
  op: string;
  /** Contacto normalmente fechado (negado). */
  nc?: boolean;
}

export type CoilKind = 'out' | 'set' | 'reset' | 'ton' | 'tof' | 'ctu' | 'res';

export interface LadderCoil {
  kind: CoilKind;
  op: string;
  /** Tempo (s) dos temporizadores ou valor final dos contadores. */
  preset?: number;
}

export interface LadderRung {
  cols: LadderContact[][];
  coil: LadderCoil;
}

export interface LadderProgram {
  rungs: LadderRung[];
}

/** Programa inicial: marcha (I0) e paragem (I1) com auto-retenção em Q0. */
export const DEFAULT_PROGRAM: LadderProgram = {
  rungs: [{ cols: [[{ op: 'I0' }, { op: 'Q0' }], [{ op: 'I1', nc: true }]], coil: { kind: 'out', op: 'Q0' } }],
};

const LIMITS: Record<string, number> = { I: PLC_INPUTS, Q: PLC_OUTPUTS, M: PLC_MEMORY, T: PLC_TIMERS, C: PLC_COUNTERS };

/** Operando válido («I3», «T0»…). */
export function validOperand(op: string, kinds = 'IQMTC'): boolean {
  const mt = /^([IQMTC])(\d{1,2})$/.exec(op);
  return !!mt && kinds.includes(mt[1]!) && Number(mt[2]) < LIMITS[mt[1]!]!;
}

/** Operandos que cada tipo de bobina aceita. */
export const COIL_TARGETS: Record<CoilKind, string> = { out: 'QM', set: 'QM', reset: 'QM', ton: 'T', tof: 'T', ctu: 'C', res: 'TC' };

/** Lê o programa guardado no parâmetro `program`; ignora degraus inválidos. */
export function parseLadder(text: unknown): LadderProgram {
  let raw: any;
  try {
    raw = typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    return { rungs: [] };
  }
  const rungs: LadderRung[] = [];
  for (const r of Array.isArray(raw?.rungs) ? raw.rungs : []) {
    const coil = r?.coil;
    if (!coil || !(coil.kind in COIL_TARGETS) || !validOperand(String(coil.op), COIL_TARGETS[coil.kind as CoilKind])) continue;
    const cols: LadderContact[][] = [];
    for (const c of Array.isArray(r.cols) ? r.cols : []) {
      const col = (Array.isArray(c) ? c : []).filter((x: any) => validOperand(String(x?.op))).map((x: any) => ({ op: String(x.op), ...(x.nc ? { nc: true } : {}) }));
      if (col.length) cols.push(col);
    }
    const preset = Number(coil.preset);
    rungs.push({ cols, coil: { kind: coil.kind, op: String(coil.op), ...(Number.isFinite(preset) && preset > 0 ? { preset } : {}) } });
  }
  return { rungs };
}

export const serializeLadder = (prog: LadderProgram) => JSON.stringify(prog);

export interface PlcMemory {
  I: boolean[];
  Q: boolean[];
  M: boolean[];
  T: { acc: number; done: boolean }[];
  C: { count: number; done: boolean }[];
  /** Estado anterior de cada degrau (flancos dos contadores). */
  prev: boolean[];
}

export const newMemory = (): PlcMemory => ({
  I: Array(PLC_INPUTS).fill(false),
  Q: Array(PLC_OUTPUTS).fill(false),
  M: Array(PLC_MEMORY).fill(false),
  T: Array.from({ length: PLC_TIMERS }, () => ({ acc: 0, done: false })),
  C: Array.from({ length: PLC_COUNTERS }, () => ({ count: 0, done: false })),
  prev: [],
});

function read(mem: PlcMemory, op: string): boolean {
  const k = op[0]!;
  const n = Number(op.slice(1));
  if (k === 'I') return !!mem.I[n];
  if (k === 'Q') return !!mem.Q[n];
  if (k === 'M') return !!mem.M[n];
  if (k === 'T') return !!mem.T[n]?.done;
  return !!mem.C[n]?.done;
}

function write(mem: PlcMemory, op: string, v: boolean) {
  const n = Number(op.slice(1));
  if (op[0] === 'Q') mem.Q[n] = v;
  else if (op[0] === 'M') mem.M[n] = v;
}

/** Valor lógico do lado esquerdo de um degrau. */
export const rungPower = (mem: PlcMemory, r: LadderRung) => r.cols.every((col) => col.some((c) => read(mem, c.op) !== !!c.nc));

/** Um ciclo do programa: lê a imagem das entradas (já em `mem.I`) e actualiza saídas e memórias. */
export function scan(prog: LadderProgram, mem: PlcMemory, dt: number): void {
  prog.rungs.forEach((r, i) => {
    const on = rungPower(mem, r);
    const { kind, op } = r.coil;
    const n = Number(op.slice(1));
    const preset = r.coil.preset ?? 1;
    if (kind === 'out') write(mem, op, on);
    else if (kind === 'set') {
      if (on) write(mem, op, true);
    } else if (kind === 'reset') {
      if (on) write(mem, op, false);
    } else if (kind === 'ton') {
      const T = mem.T[n]!;
      if (on) {
        T.acc = Math.min(preset, T.acc + dt);
        T.done = T.acc + 1e-9 >= preset;
      } else Object.assign(T, { acc: 0, done: false });
    } else if (kind === 'tof') {
      const T = mem.T[n]!;
      if (on) Object.assign(T, { acc: 0, done: true });
      else if (T.done) {
        T.acc += dt;
        if (T.acc + 1e-9 >= preset) T.done = false;
      }
    } else if (kind === 'ctu') {
      const C = mem.C[n]!;
      if (on && !mem.prev[i]) C.count++;
      C.done = C.count >= preset;
    } else if (kind === 'res' && on) {
      if (op[0] === 'T') Object.assign(mem.T[n]!, { acc: 0, done: false });
      else Object.assign(mem.C[n]!, { count: 0, done: false });
    }
    mem.prev[i] = on;
  });
}

const bits = (xs: boolean[]) =>
  xs
    .map((b) => (b ? '1' : '0'))
    .join('')
    .replace(/(.{4})(?=.)/g, '$1 ');

/* ---------------- Equipamento ---------------- */

interface PlcRT {
  mem?: PlcMemory;
  powered?: boolean;
  prog?: { text: string; p: LadderProgram };
}

const IN_IDS = Array.from({ length: PLC_INPUTS }, (_, k) => 'I' + k);
const OUT_IDS = Array.from({ length: PLC_OUTPUTS }, (_, k) => 'Q' + k);
/** Saídas a relé: Q0–Q3 com o comum 1L, Q4–Q7 com o comum 2L. */
const common = (k: number) => (k < 4 ? '1L' : '2L');

const programParam: ParamDef = { key: 'program', kind: 'text', default: serializeLadder(DEFAULT_PROGRAM), hidden: true };

function program(d: Device, rt: PlcRT): LadderProgram {
  const text = String(d.params.program ?? '');
  if (rt.prog?.text !== text) rt.prog = { text, p: parseLadder(text) };
  return rt.prog.p;
}

const bit = (mask: unknown, k: number) => ((Number(mask) || 0) >> k) % 2 === 1;
const qBit = (d: Device, k: number) => bit(d.state.q, k);

export const plc: DeviceDef<PlcRT> = {
  type: 'plc',
  category: 'control',
  domain: ['industrial'],
  level: 'pro',
  prefix: 'A',
  size: { w: 300, h: 140 },
  terminals: [
    { id: 'L', x: 20, y: 0, kind: 'L', label: 'L' },
    { id: 'N', x: 40, y: 0, kind: 'N', label: 'N' },
    { id: 'L+', x: 80, y: 0, kind: 'DC+', label: 'L+' },
    { id: 'M', x: 100, y: 0, kind: 'DC-', label: 'M' },
    ...IN_IDS.map((id, k): TerminalDef => ({ id, x: 140 + 20 * k, y: 0, kind: 'any', label: String(k) })),
    { id: '1L', x: 20, y: 140, kind: 'any', label: '1L' },
    ...OUT_IDS.slice(0, 4).map((id, k): TerminalDef => ({ id, x: 40 + 20 * k, y: 140, kind: 'any', label: String(k) })),
    { id: '2L', x: 140, y: 140, kind: 'any', label: '2L' },
    ...OUT_IDS.slice(4).map((id, k): TerminalDef => ({ id, x: 160 + 20 * k, y: 140, kind: 'any', label: String(k + 4) })),
  ],
  params: [programParam],
  initialState: () => ({ mode: 'run', q: 0, i: 0 }),
  editor: 'ladder',
  load: { phase: 'L', neutral: 'N', nominalVoltage: () => 230, working: (d, _s, rt: PlcRT) => !!rt.powered && d.state.mode === 'run' },
  conducts: (d) => OUT_IDS.map((id, k) => ({ a: common(k), b: id, closed: qBit(d, k) })),
  stamp(d, b, rt) {
    b.R(b.node('L'), b.node('N'), (230 * 230) / 10, 'psu');
    if (rt.powered) {
      const ip = b.internal('aux');
      b.V(ip, b.node('M'), { dc: 24 }, 'v24');
      b.R(ip, b.node('L+'), 0.2, 'r24');
    }
    for (const id of IN_IDS) b.R(b.node(id), b.node('M'), 4800, 'in' + id);
    OUT_IDS.forEach((id, k) => b.sw(b.node(common(k)), b.node(id), qBit(d, k), 'q' + k));
  },
  logic(d, ctx, rt) {
    const mem = (rt.mem ??= newMemory());
    const powered = rms(ctx.sol.vv(d, 'L', 'N')) > 0.8 * 230;
    let changed = powered !== !!rt.powered;
    rt.powered = powered;
    IN_IDS.forEach((id, k) => (mem.I[k] = powered && rms(ctx.sol.vv(d, id, 'M')) > 15));
    // Imagem das entradas para os LED do símbolo (não muda o circuito).
    d.state.i = mem.I.reduce((s, b, k) => s + (b ? 1 << k : 0), 0);
    if (powered && d.state.mode === 'run') scan(program(d, rt), mem, ctx.dt);
    else mem.Q.fill(false);
    const q = mem.Q.reduce((s, b, k) => s + (b ? 1 << k : 0), 0);
    if (q !== (Number(d.state.q) || 0)) {
      d.state.q = q;
      changed = true;
    }
    return changed;
  },
  measure(d, _sol, rt) {
    const mem = rt.mem ?? newMemory();
    const state = !rt.powered ? 'no_power' : d.state.mode === 'run' ? 'plc_run' : 'plc_stop';
    return [
      ms('meas.state', state),
      ms('meas.inputs', 'bits', { bits: bits(mem.I) }),
      ms('meas.outputs', 'bits', { bits: bits(OUT_IDS.map((_, k) => qBit(d, k))) }),
      ms('meas.memory', 'bits', { bits: bits(mem.M) }, true),
      ms('meas.timers', 'bits', { bits: bits(mem.T.map((t) => t.done)) }, true),
      ms('meas.counters', 'bits', { bits: mem.C.map((c) => c.count).join(' ') }, true),
    ];
  },
  actions: (d) => [{ id: d.state.mode === 'run' ? 'plc_stop' : 'plc_run' }],
  operate(d, a, rt) {
    if (a === 'plc_run') d.state.mode = 'run';
    else if (a === 'plc_stop') {
      d.state.mode = 'stop';
      if (rt.mem) rt.mem = newMemory();
    } else return false;
    return true;
  },
  model3d: 'plc',
  simplifications: ['simpl.plc_scan'],
};

/* ---------------- Símbolo ---------------- */

plc.symbol = (d) => {
  const prims: Prim[] = [
    ...[20, 40, 80, 100, ...IN_IDS.map((_, k) => 140 + 20 * k)].map((x) => L(x, 0, x, 22)),
    ...[20, 40, 60, 80, 100, 140, 160, 180, 200, 220].map((x) => L(x, 118, x, 140)),
    Re(6, 22, 288, 96, 'sl fill'),
    Tx(60, 60, 'PLC', 'txt big'), Tx(60, 78, d.state.mode === 'run' ? 'RUN' : 'STOP', d.state.mode === 'run' ? 'txt xs on' : 'txt xs'),
    Tx(210, 40, 'I0 … I7', 'txt xs'), Tx(120, 108, 'Q0 … Q7', 'txt xs'),
  ];
  IN_IDS.forEach((_, k) => prims.push(Re(136 + 20 * k, 26, 8, 6, bit(d.state.i, k) ? 'ind on' : 'ind off')));
  OUT_IDS.forEach((_, k) => prims.push(Re((k < 4 ? 36 : 156) + 20 * (k % 4), 108, 8, 6, qBit(d, k) ? 'ind on' : 'ind off')));
  return prims;
};

export const plcDevices = [plc];
