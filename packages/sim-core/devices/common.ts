/** Utilitários partilhados pelos módulos de equipamentos. */
import { cadd, cx, power, rms, type Quantity } from '../solver/complex';
import type { Device, ParamValue } from '../project/types';
import type { LogicContext, Measurement, ParamDef, SolutionView } from './types';

/* ---------- parâmetros ---------- */

export const num = (
  key: string,
  def: number,
  unit: string,
  min: number,
  max: number,
  step: number,
  pro = false,
): ParamDef => ({ key, kind: 'number', default: def, unit, min, max, step, pro });

export const sel = (
  key: string,
  options: readonly (number | string)[],
  def: number | string,
  unit?: string,
  pro = false,
  translatedOptions = false,
): ParamDef => ({ key, kind: 'select', options, default: def, unit, pro, translatedOptions });

export const p = (d: Device, key: string): number => Number(d.params[key]);
export const ps = (d: Device, key: string): string => String(d.params[key]);
export const st = <T = unknown>(d: Device, key: string): T => d.state[key] as T;

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Impedância série R + jωL que absorve P (W) com factor de potência PF a V (V). */
export function loadImpedance(P: number, PF: number, V: number, omega: number): { R: number; L: number } {
  const S = Math.max(P, 1e-6) / PF;
  const Zm = (V * V) / S;
  return { R: Zm * PF, L: (Zm * Math.sqrt(Math.max(0, 1 - PF * PF))) / omega };
}

/* ---------- medições ---------- */

export const m = (key: string, value: number, unit?: string, pro = false): Measurement => ({ key, value, unit, pro });
export const ms = (key: string, stateKey: string, values?: Record<string, string>, pro = false): Measurement => ({
  key,
  value: { key: 'state.' + stateKey, values },
  pro,
});

export interface LoadReading {
  V: number;
  I: number;
  P: number;
  Q: number;
  S: number;
  pf: number;
  rows: Measurement[];
}

/** Tensão, corrente e potências de uma carga entre dois terminais. */
export function loadReading(sol: SolutionView, d: Device, ta: string, tb: string, tag: string): LoadReading {
  const v = sol.vv(d, ta, tb);
  const i = sol.i(d, tag);
  const pw = power(v, i);
  const V = rms(v);
  const I = rms(i);
  return {
    V,
    I,
    ...pw,
    rows: [
      m('meas.voltage', V, 'V'),
      m('meas.current', I, 'A'),
      m('meas.activePower', pw.P, 'W'),
      m('meas.reactivePower', pw.Q, 'var', true),
      m('meas.apparentPower', pw.S, 'VA', true),
      m('meas.powerFactor', pw.pf, '', true),
    ],
  };
}

/** Soma fasorial das correntes de vários pólos (corrente residual). */
export function phasorSum(sol: SolutionView, d: Device, tags: string[]): number {
  let s = cx();
  for (const t of tags) s = cadd(s, sol.i(d, t).ac);
  return Math.hypot(s.re, s.im);
}

export const maxCurrent = (sol: SolutionView, d: Device, tags: string[]) =>
  Math.max(...tags.map((t) => rms(sol.i(d, t))));

/* ---------- disjuntor: térmico + magnético ---------- */

/** Múltiplo de In acima do qual o disparo magnético é garantido (IEC 60898). */
export const MAGNETIC_MULTIPLE: Record<string, number> = { B: 5, C: 10, D: 20 };
/** O térmico começa a aquecer acima de 1,13 · In (corrente convencional de não disparo). */
export const THERMAL_START = 1.13;
/**
 * Constante térmica (s). Tempo de disparo a frio: t = K / ((I/In)² − 1,13²).
 * 1,45 · In → 182 s (< 1 h, como exige a norma); 2,55 · In → 29 s (entre 1 e 60 s).
 */
export const MCB_THERMAL_K = 150;

export function mcbTripTime(ratio: number): number {
  const d = ratio * ratio - THERMAL_START * THERMAL_START;
  return d > 0 ? MCB_THERMAL_K / d : Infinity;
}

export interface BreakerRT {
  heat?: number;
}

/** Protecção contra sobreintensidades. Devolve true se disparou. */
export function breakerLogic(d: Device, ctx: LogicContext, rt: BreakerRT, I: number): boolean {
  const In = p(d, 'In');
  const dt = ctx.dt;
  const r0 = THERMAL_START * THERMAL_START;
  if (!d.state.closed) {
    rt.heat = Math.max(0, (rt.heat ?? 0) - (r0 * dt) / MCB_THERMAL_K);
    return false;
  }
  const ratio = I / In;
  const values = { device: d.name, current: ctx.fmt(I, 'A'), ratio: ctx.fmt(ratio, ''), rated: ctx.fmt(In, 'A') };
  if (ratio > (MAGNETIC_MULTIPLE[ps(d, 'curve')] ?? 10)) {
    d.state.closed = false;
    d.state.trip = 'magnetic';
    d.state.tripCurrent = I;
    ctx.emit({ code: 'mcb_magnetic_trip', severity: 'error', values });
    const icn = p(d, 'Icn') * 1000;
    if (Number.isFinite(icn) && I > icn) {
      d.state.icnExceeded = true;
      ctx.emit({ code: 'mcb_breaking_capacity', severity: 'error', values: { ...values, icn: ctx.fmt(icn / 1000, 'kA') } });
    }
    return true;
  }
  rt.heat = Math.max(0, (rt.heat ?? 0) + ((ratio * ratio - r0) * dt) / MCB_THERMAL_K);
  if (rt.heat >= 1) {
    rt.heat = 1;
    d.state.closed = false;
    d.state.trip = 'thermal';
    d.state.tripCurrent = I;
    ctx.emit({ code: 'mcb_thermal_trip', severity: 'error', values });
    return true;
  }
  return false;
}

/* ---------- fusível gG ---------- */

/** Curva tempo-corrente de pré-arco gG (valores médios indicativos, IEC 60269). */
const FUSE_MULT = [1.6, 2, 2.5, 3, 4, 5, 6, 8, 10, 15, 20];
const FUSE_TIME = [3600, 300, 60, 20, 5, 2, 1, 0.3, 0.1, 0.02, 0.008];

/** Corrente convencional de fusão por calibre: 2,1·In (< 4 A), 1,9·In (4–16 A), 1,6·In (≥ 16 A). */
export function fuseGate(In: number): number {
  return In < 4 ? 2.1 : In < 16 ? 1.9 : 1.6;
}

/** Tabela por calibre: pares [corrente (A), tempo (s)]. */
export function fuseTable(In: number): [number, number][] {
  const s = fuseGate(In) / 1.6;
  return FUSE_MULT.map((k, i) => [k * s * In, FUSE_TIME[i]!]);
}

/** Tempo de fusão (s) a corrente constante; Infinity abaixo da corrente convencional de fusão. */
export function fuseTime(I: number, In: number): number {
  const tab = fuseTable(In);
  if (I <= tab[0]![0]) return Infinity;
  for (let i = 1; i < tab.length; i++) {
    const [i1, t1] = tab[i - 1]!;
    const [i2, t2] = tab[i]!;
    if (I <= i2) {
      const f = Math.log(I / i1) / Math.log(i2 / i1);
      return Math.exp(Math.log(t1) + f * Math.log(t2 / t1));
    }
  }
  return tab[tab.length - 1]![1];
}

/* ---------- diferencial ---------- */

export interface RcdRT {
  rcdTime?: number;
  ires?: number;
  test?: number;
}

/** Tempo de disparo do diferencial: 40 ms a IΔn, 20 ms a partir de 5 · IΔn. */
export const rcdTripTime = (ires: number, idn: number) => (ires >= 5 * idn ? 0.02 : 0.04);

/** Corrente de ensaio do botão de teste: 1,5 · IΔn a 230 V. */
export const rcdTestResistance = (idnMilliamp: number) => 230 / ((1.5 * idnMilliamp) / 1000);

export function residualLogic(d: Device, ctx: LogicContext, rt: RcdRT, poleTags: string[]): boolean {
  if (rt.test && rt.test > 0) rt.test = Math.max(0, rt.test - ctx.dt);
  const ires = phasorSum(ctx.sol, d, poleTags);
  rt.ires = ires;
  const idn = p(d, 'IDn') / 1000;
  if (!d.state.closed || ires <= idn) {
    rt.rcdTime = 0;
    return false;
  }
  rt.rcdTime = (rt.rcdTime ?? 0) + ctx.dt;
  if (rt.rcdTime + 1e-9 < rcdTripTime(ires, idn)) return false;
  // Onde está a fuga? O equipamento com maior corrente para a terra.
  const leaks = ctx.leakages().sort((a, b) => b.current - a.current);
  d.state.closed = false;
  d.state.trip = 'residual';
  d.state.tripCurrent = ires;
  d.state.tripLocation = leaks[0]?.device.name ?? '';
  rt.rcdTime = 0;
  rt.test = 0;
  ctx.emit({
    code: 'rcd_trip',
    severity: 'error',
    values: { device: d.name, current: ctx.fmt(ires, 'A'), idn: ctx.fmt(idn, 'A'), location: String(d.state.tripLocation) },
  });
  return true;
}

/* ---------- estados e comandos ---------- */

/** Estado de um aparelho de corte com disparo. */
export function breakerStateKey(d: Device): string {
  if (d.state.trip) return 'tripped_' + String(d.state.trip);
  return d.state.closed ? 'closed' : 'open';
}

/** Ligar/desligar/rearmar um aparelho de corte. */
export function toggleBreaker(d: Device): boolean {
  if (d.state.closed) {
    d.state.closed = false;
    d.state.trip = null;
    return true;
  }
  d.state.closed = true;
  d.state.trip = null;
  d.state.icnExceeded = false;
  return true;
}

export const breakerActions = (d: Device) => [{ id: d.state.closed ? 'open' : d.state.trip ? 'reset' : 'close' }];

export function forceBreakerClosed(d: Device): void {
  d.state.closed = true;
  d.state.trip = null;
}

/** Função de sobretensão das lâmpadas: funde após 0,5 s a mais de 1,75 × a potência nominal. */
export function overvoltageBurn(d: Device, ctx: LogicContext, rt: { ov?: number }, V: number, Vn: number): boolean {
  if (d.state.burnt) return false;
  if ((V / Vn) ** 2 > 1.75) {
    rt.ov = (rt.ov ?? 0) + ctx.dt;
    if (rt.ov > 0.5) {
      d.state.burnt = true;
      d.state.burntVoltage = V;
      ctx.emit({ code: 'overvoltage_damage', severity: 'error', values: { device: d.name, voltage: ctx.fmt(V, 'V'), nominal: ctx.fmt(Vn, 'V') } });
      return true;
    }
  } else rt.ov = 0;
  return false;
}

export const isNum = (v: ParamValue | undefined): v is number => typeof v === 'number';
export type { Quantity };
