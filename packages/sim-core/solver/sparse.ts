/**
 * Sistema linear complexo esparso A·x = b, resolvido por eliminação de Gauss esparsa
 * com escolha de pivô de Markowitz (coluna com menos elementos) e pivotagem parcial
 * com limiar (|a| ≥ 0,1 · máximo da coluna). Mantém o preenchimento baixo nos circuitos
 * eléctricos, que são quase em árvore.
 */

interface Entry {
  re: number;
  im: number;
}

const PIVOT_THRESHOLD = 0.1;
const TINY = 1e-300;

export interface DenseMatrix {
  n: number;
  re: Float64Array;
  im: Float64Array;
  bre: Float64Array;
  bim: Float64Array;
}

export class SparseComplexSystem {
  readonly n: number;
  private rows: Map<number, Entry>[];
  private bre: Float64Array;
  private bim: Float64Array;

  constructor(n: number) {
    this.n = n;
    this.rows = Array.from({ length: n }, () => new Map<number, Entry>());
    this.bre = new Float64Array(n);
    this.bim = new Float64Array(n);
  }

  add(r: number, c: number, re: number, im = 0): void {
    if (r < 0 || c < 0 || (re === 0 && im === 0)) return;
    const row = this.rows[r]!;
    const e = row.get(c);
    if (e) {
      e.re += re;
      e.im += im;
    } else row.set(c, { re, im });
  }

  addRhs(r: number, re: number, im = 0): void {
    if (r < 0) return;
    this.bre[r]! += re;
    this.bim[r]! += im;
  }

  /** Cópia densa (só para ensino: matriz MNA no perfil Profissional). */
  toDense(): DenseMatrix {
    const n = this.n;
    const re = new Float64Array(n * n);
    const im = new Float64Array(n * n);
    this.rows.forEach((row, r) => {
      for (const [c, e] of row) {
        re[r * n + c] = e.re;
        im[r * n + c] = e.im;
      }
    });
    return { n, re, im, bre: this.bre.slice(), bim: this.bim.slice() };
  }

  /** Resolve e destrói o sistema. Colunas singulares ficam a zero. */
  solve(): { re: Float64Array; im: Float64Array } {
    const n = this.n;
    const rows = this.rows;
    const bre = this.bre;
    const bim = this.bim;
    const colRows: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
    rows.forEach((row, r) => {
      for (const c of row.keys()) colRows[c]!.add(r);
    });
    const colDone = new Uint8Array(n);
    const pivRow = new Int32Array(n).fill(-1);
    const order: number[] = [];

    for (let step = 0; step < n; step++) {
      // 1. Coluna com menos elementos activos (Markowitz simplificado).
      let col = -1;
      let best = Infinity;
      for (let c = 0; c < n; c++) {
        if (colDone[c]) continue;
        const s = colRows[c]!.size;
        if (s > 0 && s < best) {
          best = s;
          col = c;
          if (s === 1) break;
        }
      }
      if (col < 0) break;

      // 2. Pivô: linha com |a| acima do limiar e com menos elementos.
      let maxMag = 0;
      for (const r of colRows[col]!) {
        const e = rows[r]!.get(col)!;
        const m = e.re * e.re + e.im * e.im;
        if (m > maxMag) maxMag = m;
      }
      colDone[col] = 1;
      if (maxMag < TINY) {
        for (const r of colRows[col]!) rows[r]!.delete(col);
        colRows[col]!.clear();
        continue;
      }
      const lim = maxMag * PIVOT_THRESHOLD * PIVOT_THRESHOLD;
      let p = -1;
      let pLen = Infinity;
      let pMag = 0;
      for (const r of colRows[col]!) {
        const e = rows[r]!.get(col)!;
        const m = e.re * e.re + e.im * e.im;
        if (m < lim) continue;
        const len = rows[r]!.size;
        if (len < pLen || (len === pLen && m > pMag)) {
          p = r;
          pLen = len;
          pMag = m;
        }
      }
      const prow = rows[p]!;
      const pe = prow.get(col)!;
      const den = pe.re * pe.re + pe.im * pe.im;

      // 3. Eliminar a coluna nas outras linhas activas.
      for (const r of colRows[col]!) {
        if (r === p) continue;
        const row = rows[r]!;
        const a = row.get(col)!;
        const fr = (a.re * pe.re + a.im * pe.im) / den;
        const fi = (a.im * pe.re - a.re * pe.im) / den;
        row.delete(col);
        for (const [j, e] of prow) {
          if (j === col) continue;
          const dr = fr * e.re - fi * e.im;
          const di = fr * e.im + fi * e.re;
          const t = row.get(j);
          if (t) {
            t.re -= dr;
            t.im -= di;
          } else {
            row.set(j, { re: -dr, im: -di });
            colRows[j]!.add(r);
          }
        }
        bre[r]! -= fr * bre[p]! - fi * bim[p]!;
        bim[r]! -= fr * bim[p]! + fi * bre[p]!;
      }
      for (const j of prow.keys()) if (j !== col) colRows[j]!.delete(p);
      colRows[col]!.clear();
      pivRow[col] = p;
      order.push(col);
    }

    // 4. Substituição inversa.
    const xr = new Float64Array(n);
    const xi = new Float64Array(n);
    for (let k = order.length - 1; k >= 0; k--) {
      const col = order[k]!;
      const p = pivRow[col]!;
      const prow = rows[p]!;
      let sr = bre[p]!;
      let si = bim[p]!;
      let dr = 0;
      let di = 0;
      for (const [j, e] of prow) {
        if (j === col) {
          dr = e.re;
          di = e.im;
          continue;
        }
        sr -= e.re * xr[j]! - e.im * xi[j]!;
        si -= e.re * xi[j]! + e.im * xr[j]!;
      }
      const den = dr * dr + di * di;
      if (den < TINY) continue;
      xr[col] = (sr * dr + si * di) / den;
      xi[col] = (si * dr - sr * di) / den;
    }
    return { re: xr, im: xi };
  }
}
