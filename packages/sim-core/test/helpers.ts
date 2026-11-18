import { expect } from 'vitest';
import { addDevice, addWire, createProject, Simulator, type Device, type Project } from '../index';

/** Resistividade do cobre a 70 °C (Ω·mm²/m). */
export const RHO_CU = 0.0225;
/** Resistência de um contacto fechado (Ω). */
export const C = 1e-3;
/** Resistência de um condutor: ρ·L/S. */
export const Rw = (len: number, S: number, rho = RHO_CU) => (rho * len) / S;

/** |real − esperado| / |esperado| < tol */
export function rel(actual: number, expected: number, tol = 1e-4) {
  const e = Math.abs(actual - expected) / Math.abs(expected);
  expect(e, `real ${actual} vs esperado ${expected}`).toBeLessThan(tol);
}

export interface Std {
  P: Project;
  G: Device;
  Q: Device;
  /** Resistência de cada cabo do circuito base. */
  rw: number;
}

/**
 * Circuito base: rede (Zs por condutor) → disjuntor 1P+N. Cabos: G.L–Q.1 e G.N–Q.3.
 * Comprimento `len` (m) e secção `S` (mm²) iguais em todos os cabos do circuito.
 */
export function base(o: { Zs?: number; earthing?: 'TT' | 'TN-S'; Rb?: number; len?: number; S?: number; mcb?: Record<string, number | string>; level?: 'beginner' | 'pro'; protection?: string } = {}): Std {
  const P = createProject({ level: o.level ?? 'beginner' });
  const G = addDevice(P, 'grid1ph', { params: { Zs: o.Zs ?? 0.15, earthing: o.earthing ?? 'TN-S', Rb: o.Rb ?? 2 } });
  const Q = addDevice(P, o.protection ?? 'mcb1pn', { params: o.mcb ?? {} });
  const len = o.len ?? 2;
  const S = o.S ?? 1.5;
  addWire(P, G, 'L', Q, '1', { length: len, section: S });
  if (Q.type !== 'fuseGG' && Q.type !== 'mcb1p') addWire(P, G, 'N', Q, '3', { length: len, section: S });
  return { P, G, Q, rw: Rw(len, S) };
}

/** Liga a saída do disjuntor (2/4) aos terminais de uma carga. */
export function feed(s: Std, load: Device, tL = 'L', tN = 'N', len = 2, S = 1.5) {
  addWire(s.P, s.Q, '2', load, tL, { length: len, section: S });
  addWire(s.P, s.Q, '4', load, tN, { length: len, section: S });
}

export const sim = (P: Project, maxStep = 0.05) => new Simulator(P, { maxStep });

/** Corre até `pred` ser verdade; devolve o tempo de simulação. */
export function runUntil(s: Simulator, pred: () => boolean, max: number, dt: number) {
  while (s.t < max && !pred()) s.step(dt);
  return s.t;
}
