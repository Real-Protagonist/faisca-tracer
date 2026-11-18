/**
 * Análise Nodal Modificada (MNA) fasorial.
 * O nó 0 é a terra (referência). Cada elemento é estampado na matriz; as fontes de tensão
 * e os transformadores ideais acrescentam uma variável de corrente cada.
 * AC e DC são resolvidos em separado e somados por sobreposição.
 */
import { cdiv, cmul, cpolar, csub, cx, type Complex } from './complex';
import { SparseComplexSystem, type DenseMatrix } from './sparse';

/** Condutância mínima entre cada nó e a terra: evita matrizes singulares. */
export const GMIN = 1e-9;
/** Impedância mínima de um ramo (Ω). */
export const ZMIN = 1e-6;
/** Resistência DC de um enrolamento ideal (Ω). */
export const WINDING_DC_R = 1e-3;

/** Impedância série R + jωL + 1/(jωC). */
export interface ZElement {
  k: 'Z';
  a: number;
  b: number;
  R: number;
  /** Indutância (H). */
  L: number;
  /** Capacidade série (F); 0 = sem condensador. */
  C: number;
  tag?: string;
}

/** Fonte de tensão ideal entre a (+) e b (−). */
export interface VElement {
  k: 'V';
  a: number;
  b: number;
  /** Valor eficaz AC (V). */
  ac: number;
  /** Fase (graus). */
  phase: number;
  /** Tensão contínua (V). */
  dc: number;
  tag?: string;
}

/** Fonte de corrente ideal, de a para b através da fonte (sai em b). */
export interface IElement {
  k: 'I';
  a: number;
  b: number;
  ac: Complex;
  dc: number;
  tag?: string;
}

/** Transformador ideal: Vp = n·Vs ; Is = n·Ip (só em AC). */
export interface XElement {
  k: 'X';
  p1: number;
  p2: number;
  s1: number;
  s2: number;
  n: number;
  tag?: string;
}

export type Element = ZElement | VElement | IElement | XElement;

export interface Network {
  /** Número de nós, incluindo a terra (0). */
  nodeCount: number;
  elements: Element[];
  omega: number;
  /** Nome legível de cada nó (para a matriz de ensino). */
  nodeLabels: string[];
}

export interface PhaseSolution {
  omega: number;
  isAC: boolean;
  /** Tensões dos nós 1..n e correntes das variáveis extra. */
  xr: Float64Array;
  xi: Float64Array;
  admittance: Map<Element, Complex>;
  varIndex: Map<Element, number>;
  nodes: number;
  matrix?: DenseMatrix;
}

function solvePhase(net: Network, isAC: boolean, capture: boolean): PhaseSolution {
  const omega = isAC ? net.omega : 0;
  const n = net.nodeCount - 1;
  const vars: Element[] = [];
  for (const e of net.elements) if (e.k === 'V' || (e.k === 'X' && isAC)) vars.push(e);
  const N = n + vars.length;
  const sys = new SparseComplexSystem(N);
  const admittance = new Map<Element, Complex>();
  const stamp2 = (a: number, b: number, y: Complex) => {
    const ia = a - 1;
    const ib = b - 1;
    sys.add(ia, ia, y.re, y.im);
    sys.add(ib, ib, y.re, y.im);
    sys.add(ia, ib, -y.re, -y.im);
    sys.add(ib, ia, -y.re, -y.im);
  };

  for (const e of net.elements) {
    if (e.k === 'Z') {
      let y: Complex;
      if (isAC) {
        let zr = e.R;
        let zi = omega * e.L;
        if (e.C > 0) zi -= 1 / (omega * e.C);
        if (Math.abs(zr) < ZMIN && Math.abs(zi) < ZMIN) zr = ZMIN;
        y = cdiv(cx(1, 0), cx(zr, zi));
      } else {
        // Em DC: o condensador é aberto, a bobina é só a sua resistência.
        y = e.C > 0 ? cx(0, 0) : cx(1 / Math.max(e.R, ZMIN), 0);
      }
      admittance.set(e, y);
      if (e.a !== e.b) stamp2(e.a, e.b, y);
    } else if (e.k === 'X' && !isAC) {
      // Em DC não há indução: cada enrolamento é um condutor (a resistência está fora, em série).
      const y = cx(1 / WINDING_DC_R, 0);
      stamp2(e.p1, e.p2, y);
      stamp2(e.s1, e.s2, y);
    } else if (e.k === 'I') {
      const i = isAC ? e.ac : cx(e.dc, 0);
      sys.addRhs(e.a - 1, -i.re, -i.im);
      sys.addRhs(e.b - 1, i.re, i.im);
    }
  }

  const varIndex = new Map<Element, number>();
  vars.forEach((e, k) => {
    const r = n + k;
    varIndex.set(e, r);
    if (e.k === 'V') {
      sys.add(e.a - 1, r, 1);
      sys.add(r, e.a - 1, 1);
      sys.add(e.b - 1, r, -1);
      sys.add(r, e.b - 1, -1);
      const v = isAC ? cpolar(e.ac, e.phase) : cx(e.dc, 0);
      sys.addRhs(r, v.re, v.im);
    } else if (e.k === 'X') {
      const m = e.n;
      sys.add(e.p1 - 1, r, 1);
      sys.add(e.p2 - 1, r, -1);
      sys.add(e.s1 - 1, r, -m);
      sys.add(e.s2 - 1, r, m);
      sys.add(r, e.p1 - 1, 1);
      sys.add(r, e.p2 - 1, -1);
      sys.add(r, e.s1 - 1, -m);
      sys.add(r, e.s2 - 1, m);
    }
  });
  for (let i = 0; i < n; i++) sys.add(i, i, GMIN);
  const matrix = capture ? sys.toDense() : undefined;
  const x = sys.solve();
  return { omega, isAC, xr: x.re, xi: x.im, admittance, varIndex, nodes: n, matrix };
}

export interface NetworkSolution {
  ac: PhaseSolution | null;
  dc: PhaseSolution | null;
}

export function solveNetwork(net: Network, capture = false): NetworkSolution {
  const hasAC = net.elements.some(
    (e) => (e.k === 'V' && e.ac !== 0) || (e.k === 'I' && (e.ac.re !== 0 || e.ac.im !== 0)),
  );
  const hasDC = net.elements.some((e) => (e.k === 'V' && e.dc !== 0) || (e.k === 'I' && e.dc !== 0));
  return {
    ac: hasAC ? solvePhase(net, true, capture) : null,
    dc: hasDC ? solvePhase(net, false, capture) : null,
  };
}

export function nodeVoltage(s: PhaseSolution | null, node: number): Complex {
  if (!s || node <= 0) return cx(0, 0);
  return cx(s.xr[node - 1]!, s.xi[node - 1]!);
}

/** Corrente de a para b através do elemento. */
export function elementCurrent(s: PhaseSolution | null, e: Element): Complex {
  if (!s) return cx(0, 0);
  if (e.k === 'Z') {
    const y = s.admittance.get(e);
    if (!y) return cx(0, 0);
    return cmul(csub(nodeVoltage(s, e.a), nodeVoltage(s, e.b)), y);
  }
  if (e.k === 'I') return s.isAC ? e.ac : cx(e.dc, 0);
  const ix = s.varIndex.get(e);
  if (ix === undefined) return cx(0, 0);
  // A variável MNA é a corrente que entra no terminal + vinda do circuito.
  return cx(s.xr[ix]!, s.xi[ix]!);
}
