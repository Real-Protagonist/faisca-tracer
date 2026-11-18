/** Números complexos e grandezas eléctricas (fasor AC em valor eficaz + componente DC). */

export interface Complex {
  re: number;
  im: number;
}

export const cx = (re = 0, im = 0): Complex => ({ re, im });
export const cadd = (a: Complex, b: Complex): Complex => cx(a.re + b.re, a.im + b.im);
export const csub = (a: Complex, b: Complex): Complex => cx(a.re - b.re, a.im - b.im);
export const cmul = (a: Complex, b: Complex): Complex =>
  cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
export const cdiv = (a: Complex, b: Complex): Complex => {
  const d = b.re * b.re + b.im * b.im || 1e-300;
  return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
export const cabs = (a: Complex): number => Math.hypot(a.re, a.im);
/** Argumento em graus. */
export const carg = (a: Complex): number => (Math.atan2(a.im, a.re) * 180) / Math.PI;
/** Fasor a partir de módulo e ângulo em graus. */
export const cpolar = (mag: number, deg: number): Complex =>
  cx(mag * Math.cos((deg * Math.PI) / 180), mag * Math.sin((deg * Math.PI) / 180));
export const cconj = (a: Complex): Complex => cx(a.re, -a.im);
export const cscale = (a: Complex, k: number): Complex => cx(a.re * k, a.im * k);

/** Grandeza num ponto: fasor AC (valor eficaz) e valor DC, somados por sobreposição. */
export interface Quantity {
  ac: Complex;
  dc: number;
}

export const q0 = (): Quantity => ({ ac: cx(), dc: 0 });
export const qadd = (a: Quantity, b: Quantity): Quantity => ({ ac: cadd(a.ac, b.ac), dc: a.dc + b.dc });
export const qsub = (a: Quantity, b: Quantity): Quantity => ({ ac: csub(a.ac, b.ac), dc: a.dc - b.dc });
/** Valor eficaz total: √(|Vac|² + Vdc²). */
export const rms = (q: Quantity): number => Math.sqrt(cabs(q.ac) ** 2 + q.dc * q.dc);

export interface Power {
  /** Potência activa (W). */
  P: number;
  /** Potência reactiva (var), positiva = indutiva. */
  Q: number;
  /** Potência aparente (VA). */
  S: number;
  /** Factor de potência (0..1). */
  pf: number;
}

/** Potências a partir da tensão e da corrente no mesmo elemento (convenção receptor). */
export function power(v: Quantity, i: Quantity): Power {
  const s = cmul(v.ac, cconj(i.ac));
  const P = s.re + v.dc * i.dc;
  const Q = s.im;
  const S = rms(v) * rms(i);
  return { P, Q, S, pf: S > 1e-9 ? Math.max(-1, Math.min(1, P / S)) : 1 };
}
