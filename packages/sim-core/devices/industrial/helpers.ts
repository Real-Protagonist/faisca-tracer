/** Utilitários dos equipamentos industriais: componentes simétricas, térmico de motor, ligações. */
import { cadd, cmul, cpolar, cscale, type Complex } from '../../solver/complex';
import type { Device, Project, WireEnd } from '../../project/types';
import type { Registry } from '../registry';
import type { LogicContext } from '../types';
import { p } from '../common';

/** Operador a = 1∠120°. */
export const A1 = cpolar(1, 120);
export const A2 = cpolar(1, 240);

/** Componentes directa (V1) e inversa (V2) de três fasores pela ordem a, b, c. */
export function sequences(a: Complex, b: Complex, c: Complex): { v1: Complex; v2: Complex } {
  return {
    v1: cscale(cadd(a, cadd(cmul(A1, b), cmul(A2, c))), 1 / 3),
    v2: cscale(cadd(a, cadd(cmul(A2, b), cmul(A1, c))), 1 / 3),
  };
}

/* ---------- térmico de motor (relé térmico, disjuntor-motor) ---------- */

/** Abaixo de 1,05 · Ir não dispara; acima de 1,2 · Ir dispara em menos de 2 h (IEC 60947-4-1). */
export const OVERLOAD_START = 1.12;
/**
 * Constante térmica por classe (s): t = K / ((I/Ir)² − 1,12²) a frio.
 * Classe 10: 7,2 · Ir → 7,9 s (entre 4 e 10 s); classe 20: 7,2 · Ir → 15,8 s (entre 6 e 20 s).
 */
export const OVERLOAD_K: Record<string, number> = { '10': 400, '20': 800 };
/** Sensibilidade à falta de fase: com uma fase muito abaixo das outras, o térmico aquece 15 % mais depressa. */
export const PHASE_LOSS_FACTOR = 1.15;

export function overloadTripTime(ratio: number, cls: string | number): number {
  const d = ratio * ratio - OVERLOAD_START * OVERLOAD_START;
  return d > 0 ? (OVERLOAD_K[String(cls)] ?? 400) / d : Infinity;
}

export interface OverloadRT {
  heat?: number;
  /** Desequilíbrio detectado no último passo. */
  unbalanced?: boolean;
}

/**
 * Integra o aquecimento a partir das correntes das três fases. Devolve true quando chega a 100 %.
 * Não altera o estado do equipamento: quem chama decide o que abre.
 */
export function overloadHeat(ctx: LogicContext, rt: OverloadRT, currents: number[], Ir: number, cls: string | number): boolean {
  const max = Math.max(...currents);
  const min = Math.min(...currents);
  rt.unbalanced = max > 0.3 * Ir && min < 0.5 * max;
  const ratio = (max / Ir) * (rt.unbalanced ? PHASE_LOSS_FACTOR : 1);
  const K = OVERLOAD_K[String(cls)] ?? 400;
  rt.heat = Math.max(0, (rt.heat ?? 0) + ((ratio * ratio - OVERLOAD_START * OVERLOAD_START) * ctx.dt) / K);
  if (rt.heat >= 1) {
    rt.heat = 1;
    return true;
  }
  return false;
}

/* ---------- ligações ---------- */

/**
 * Procura, pelos cabos, ligadores e ligações internas (abertas ou fechadas), o primeiro
 * equipamento que satisfaz `pred`, a partir dos terminais dados.
 */
export function findConnected(P: Project, registry: Registry, starts: WireEnd[], pred: (d: Device) => boolean, exclude?: string): Device | null {
  const key = (e: WireEnd) => `${e.device}:${e.terminal}`;
  const seen = new Set(starts.map(key));
  const queue = [...starts];
  while (queue.length && seen.size < 2000) {
    const e = queue.shift()!;
    const d = P.devices.find((x) => x.id === e.device);
    const def = d && registry.get(d.type);
    if (!d || !def) continue;
    if (d.id !== exclude && pred(d)) return d;
    const next: WireEnd[] = [];
    for (const g of def.shorts?.(d) ?? []) if (g.includes(e.terminal)) for (const t of g) next.push({ device: d.id, terminal: t });
    for (const c of def.conducts?.(d) ?? []) {
      if (c.a === e.terminal) next.push({ device: d.id, terminal: c.b });
      if (c.b === e.terminal) next.push({ device: d.id, terminal: c.a });
    }
    for (const w of P.wires) {
      if (w.a.device === e.device && w.a.terminal === e.terminal) next.push(w.b);
      if (w.b.device === e.device && w.b.terminal === e.terminal) next.push(w.a);
    }
    for (const n of next) {
      if (seen.has(key(n))) continue;
      seen.add(key(n));
      queue.push(n);
    }
  }
  return null;
}

/** Grupos de terminais ligados só por cabos e ligadores (sem passar por contactos). */
export function wireGroups(P: Project, registry: Registry): (e: WireEnd) => string {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.has(r)) r = parent.get(r)!;
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const d of P.devices) for (const g of registry.get(d.type)?.shorts?.(d) ?? []) for (let i = 1; i < g.length; i++) union(`${d.id}:${g[0]}`, `${d.id}:${g[i]}`);
  for (const w of P.wires) if (!w.fault?.cut) union(`${w.a.device}:${w.a.terminal}`, `${w.b.device}:${w.b.terminal}`);
  return (e) => find(`${e.device}:${e.terminal}`);
}

/** Designação «Nome-terminal» usada nas mensagens («F1-6», «M1-W»). */
export const endName = (P: Project, e: WireEnd) => `${P.devices.find((d) => d.id === e.device)?.name ?? e.device}-${e.terminal}`;

/** Tensão nominal entre fases da fonte (V); 400 V por omissão. */
export const lineVoltageOf = (d: Device) => (Number.isFinite(p(d, 'V')) ? p(d, 'V') : 400);
