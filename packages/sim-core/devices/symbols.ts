/**
 * Símbolos 2D (IEC 60617) descritos como dados, sem DOM. A interface desenha-os em SVG.
 * Os textos dos símbolos são só valores e marcações (C16, 30 mA, 230 V): nunca precisam de tradução.
 */
import type { Measurement } from './types';

/** Classes de estilo: sl (traço), on, off, thin, dash, w3, fill (fundo branco), coil, txt, sm, xs, big, bad. */
export type Prim =
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; cls?: string }
  | { t: 'circle'; cx: number; cy: number; r: number; cls?: string; fill?: string }
  | { t: 'rect'; x: number; y: number; w: number; h: number; cls?: string; fill?: string; rx?: number }
  | { t: 'ellipse'; cx: number; cy: number; rx: number; ry: number; cls?: string }
  | { t: 'path'; d: string; cls?: string; fill?: string }
  | { t: 'text'; x: number; y: number; text: string; cls?: string; anchor?: 'start' | 'middle' | 'end' }
  /** Grupo que roda continuamente à velocidade `spin` (0..1) em torno de (cx, cy): rotor dos motores. */
  | { t: 'rotor'; cx: number; cy: number; spin: number; dir: 1 | -1; items: Prim[] };

/** Estado visual: valores numéricos das medições e a chave do estado (sem o prefixo «state.»). */
export interface Look {
  num(key: string): number;
  state: string;
  /** Valor de uma medição de estado (sem o prefixo «state.»), por exemplo `str('direction')`. */
  str(key: string): string;
}

export function lookFrom(ms: Measurement[]): Look {
  const map = new Map<string, number>();
  const strs = new Map<string, string>();
  let state = '';
  for (const m of ms) {
    if (typeof m.value === 'number') map.set(m.key, m.value);
    else {
      const v = m.value.key.replace(/^state\./, '');
      strs.set(m.key, v);
      if (m.key === 'meas.state' || m.key === 'meas.position') state ||= v;
    }
  }
  const k = (x: string) => (x.startsWith('meas.') ? x : 'meas.' + x);
  return { num: (x) => map.get(k(x)) ?? 0, state, str: (x) => strs.get(k(x)) ?? '' };
}

export const L = (x1: number, y1: number, x2: number, y2: number, cls?: string): Prim => ({ t: 'line', x1, y1, x2, y2, cls });
export const Ci = (cx: number, cy: number, r: number, cls?: string, fill?: string): Prim => ({ t: 'circle', cx, cy, r, cls, fill });
export const Re = (x: number, y: number, w: number, h: number, cls?: string, fill?: string): Prim => ({ t: 'rect', x, y, w, h, cls, fill, rx: 2 });
export const Pa = (d: string, cls?: string, fill?: string): Prim => ({ t: 'path', d, cls, fill });
export const Tx = (x: number, y: number, text: string, cls = 'txt sm', anchor: 'start' | 'middle' | 'end' = 'middle'): Prim => ({ t: 'text', x, y, text, cls, anchor });

/** Pólo vertical de y0 a y1: contacto aberto ou fechado, com marcas opcionais. */
export function pole(x: number, y0: number, y1: number, closed: boolean, o: { nc?: boolean; breaker?: boolean; push?: boolean; fuse?: boolean } = {}): Prim[] {
  const a = y0 + (y1 - y0) * 0.36;
  const b = y0 + (y1 - y0) * 0.64;
  const mid = (a + b) / 2;
  const out: Prim[] = [L(x, y0, x, a), L(x, b, x, y1)];
  if (o.fuse) {
    out.push(Re(x - 6, a, 12, b - a, closed ? 'sl fill' : 'sl off fill'));
    out.push(closed ? L(x, a, x, b) : Pa(`M${x} ${a} l-3 ${(b - a) * 0.45} m6 0 l-3 ${(b - a) * 0.55}`, 'sl off'));
    return out;
  }
  out.push(closed ? L(x, b, x, a, 'sl on') : L(x, b, x - 11, a + 3, 'sl off'));
  if (o.nc) out.push(L(x, a, x - 10, a));
  if (o.breaker) out.push(L(x - 4, a - 4, x + 4, a + 4), L(x - 4, a + 4, x + 4, a - 4));
  if (o.push) out.push(L(x - 6, mid, x - 18, mid, 'sl dash'), L(x - 18, mid - 6, x - 18, mid + 6, 'sl w3'));
  return out;
}

/** Indicador de estado de um aparelho de corte (verde ligado, vermelho disparado, cinzento aberto). */
export const indicator = (x: number, y: number, state: Record<string, unknown>): Prim =>
  Re(x, y, 8, 12, state.trip ? 'ind bad' : state.closed ? 'ind on' : 'ind off');

/** Cor do filamento conforme o brilho (0..1). */
export function glow(b: number): string {
  const c = Math.max(0, Math.min(1, b));
  return `rgba(255,${Math.round(165 + 70 * c)},${Math.round(40 + 150 * Math.max(0, c - 0.55))},${(c * 0.95).toFixed(2)})`;
}

/** Formata um número no idioma do projecto (marcações do símbolo: «0,75 kW» / «0.75 kW»). */
export type NumFmt = (v: number) => string;
