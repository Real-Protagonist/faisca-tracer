/** Geometria do esquema: grelha, rotação, posição dos terminais e encaminhamento ortogonal dos cabos. */
import type { Device, DeviceDef, Project, Registry, Wire, WireEnd } from '@faisca/sim-core';

export const GRID = 20;
/** Escala do desenho para o comprimento estimado dos cabos. */
export const PX_PER_M = 40;
/** Saída do cabo antes da primeira curva (px). */
const STUB = 10;

export interface Pt {
  x: number;
  y: number;
}

// «|| 0» evita -0, que o JSON grava como 0 (o projecto reaberto seria diferente).
export const snap = (v: number) => Math.round(v / GRID) * GRID || 0;

export function sizeOf(def: DeviceDef, d: Device) {
  return def.sizeOf ? def.sizeOf(d) : def.size;
}

/** Roda um ponto local do símbolo (0..w, 0..h) em torno do centro. */
export function rotateLocal(p: Pt, w: number, h: number, rot: number): Pt {
  const cx = w / 2;
  const cy = h / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;
  switch (((rot % 360) + 360) % 360) {
    case 90:
      return { x: cx - dy, y: cy + dx };
    case 180:
      return { x: cx - dx, y: cy - dy };
    case 270:
      return { x: cx + dy, y: cy - dx };
    default:
      return p;
  }
}

export interface TerminalPos extends Pt {
  /** Direcção para fora do símbolo (vector unitário). */
  nx: number;
  ny: number;
}

export function terminalPos(registry: Registry, d: Device, terminal: string): TerminalPos | null {
  const def = registry.get(d.type);
  const t = def?.terminals.find((x) => x.id === terminal);
  if (!def || !t) return null;
  const { w, h } = sizeOf(def, d);
  // Normal: do lado do símbolo onde o terminal está.
  let nx = 0;
  let ny = 0;
  if (t.y <= 0) ny = -1;
  else if (t.y >= h) ny = 1;
  else if (t.x <= 0) nx = -1;
  else if (t.x >= w) nx = 1;
  else ny = t.y < h / 2 ? -1 : 1;
  const p = rotateLocal({ x: t.x, y: t.y }, w, h, d.rot);
  const n = rotateLocal({ x: w / 2 + nx, y: h / 2 + ny }, w, h, d.rot);
  return { x: d.x + p.x, y: d.y + p.y, nx: Math.round(n.x - w / 2), ny: Math.round(n.y - h / 2) };
}

export function endPos(registry: Registry, P: Project, e: WireEnd): TerminalPos | null {
  const d = P.devices.find((x) => x.id === e.device);
  return d ? terminalPos(registry, d, e.terminal) : null;
}

/** Caminho ortogonal entre dois pontos: uma curva, primeiro na direcção `first`. */
function elbow(a: Pt, b: Pt, first: 'h' | 'v'): Pt[] {
  if (a.x === b.x || a.y === b.y) return [b];
  return first === 'v' ? [{ x: a.x, y: b.y }, b] : [{ x: b.x, y: a.y }, b];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** O segmento ortogonal (a, b) atravessa o interior do rectângulo? */
function crosses(a: Pt, b: Pt, r: Rect): boolean {
  const m = 2;
  const x0 = r.x + m;
  const x1 = r.x + r.w - m;
  const y0 = r.y + m;
  const y1 = r.y + r.h - m;
  if (a.y === b.y) return a.y > y0 && a.y < y1 && Math.max(a.x, b.x) > x0 && Math.min(a.x, b.x) < x1;
  return a.x > x0 && a.x < x1 && Math.max(a.y, b.y) > y0 && Math.min(a.y, b.y) < y1;
}

/**
 * Rota automática entre as saídas a1 e b1: escolhe, entre várias rotas ortogonais (L, Z e U),
 * a mais curta que não atravessa os aparelhos das pontas e que sai e entra pelo lado do terminal.
 */
function autoRoute(a: TerminalPos, a1: Pt, b: TerminalPos, b1: Pt, boxes: Rect[]): Pt[] {
  const ys = [a1.y, b1.y, (a1.y + b1.y) / 2, Math.max(a1.y, b1.y) + 2 * STUB, Math.min(a1.y, b1.y) - 2 * STUB];
  const xs = [a1.x, b1.x, (a1.x + b1.x) / 2, Math.max(a1.x, b1.x) + 2 * STUB, Math.min(a1.x, b1.x) - 2 * STUB];
  for (const r of boxes) {
    ys.push(r.y - 2 * STUB, r.y + r.h + 2 * STUB);
    xs.push(r.x - 2 * STUB, r.x + r.w + 2 * STUB);
  }
  const cands: Pt[][] = [];
  for (const y of ys) cands.push([a1, { x: a1.x, y }, { x: b1.x, y }, b1]);
  for (const x of xs) cands.push([a1, { x, y: a1.y }, { x, y: b1.y }, b1]);
  let best = cands[0]!;
  let bestScore = Infinity;
  for (const c of cands) {
    const pts = dedupe(c);
    let score = polyLength(pts) + 8 * pts.length;
    for (let i = 1; i < pts.length; i++) for (const r of boxes) if (crosses(pts[i - 1]!, pts[i]!, r)) score += 2000;
    // Sair contra a direcção do terminal A, ou entrar em B pelo lado de dentro, custa caro.
    const p1 = pts[1];
    if (p1 && (p1.x - a1.x) * a.nx + (p1.y - a1.y) * a.ny < 0) score += 600;
    const pn = pts[pts.length - 2];
    if (pn && (b1.x - pn.x) * b.nx + (b1.y - pn.y) * b.ny > 0) score += 600;
    if (score < bestScore) {
      bestScore = score;
      best = pts;
    }
  }
  return best;
}

/**
 * Pontos do cabo: terminal A, saída, pontos de curva do utilizador, saída de B, terminal B.
 * Entre pontos consecutivos o caminho é ortogonal. Sem pontos do utilizador, a rota é
 * escolhida para não atravessar os aparelhos das pontas (`boxes`).
 */
export function routeWire(a: TerminalPos, b: TerminalPos, points: Pt[] = [], boxes: Rect[] = []): Pt[] {
  const a1 = { x: a.x + a.nx * STUB, y: a.y + a.ny * STUB };
  const b1 = { x: b.x + b.nx * STUB, y: b.y + b.ny * STUB };
  if (!points.length) return dedupe([{ x: a.x, y: a.y }, ...autoRoute(a, a1, b, b1, boxes), { x: b.x, y: b.y }]);
  const out: Pt[] = [{ x: a.x, y: a.y }, a1];
  let cur = a1;
  let dir: 'h' | 'v' = a.nx !== 0 ? 'h' : 'v';
  for (const p of [...points, b1]) {
    out.push(...elbow(cur, p, dir));
    dir = dir === 'h' ? 'v' : 'h';
    cur = p;
  }
  out.push({ x: b.x, y: b.y });
  return dedupe(out);
}

function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || q.x !== p.x || q.y !== p.y) out.push(p);
  }
  // Remove pontos colineares intermédios.
  const res: Pt[] = [];
  for (const p of out) {
    while (res.length >= 2) {
      const a = res[res.length - 2]!;
      const c = res[res.length - 1]!;
      if ((a.x === c.x && c.x === p.x) || (a.y === c.y && c.y === p.y)) res.pop();
      else break;
    }
    res.push(p);
  }
  return res;
}

export const polyLength = (pts: Pt[]) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i]!.x, p.y - pts[i]!.y), 0);

/** Comprimento estimado (m) a partir do desenho: 40 px = 1 m, arredondado a 0,5 m, mínimo 0,5 m. */
export const estimateLength = (pts: Pt[]) => Math.max(0.5, Math.round((polyLength(pts) / PX_PER_M) * 2) / 2);

export const toPath = (pts: Pt[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');

export function wirePoints(registry: Registry, P: Project, w: Wire): Pt[] | null {
  const a = endPos(registry, P, w.a);
  const b = endPos(registry, P, w.b);
  if (!a || !b) return null;
  const boxes = [w.a.device, w.b.device].map((id) => P.devices.find((d) => d.id === id)!).map((d) => bbox(registry, d));
  return routeWire(a, b, w.points, boxes);
}

/* ---------------- Separação de cabos sobrepostos ----------------
 * Dois cabos podem ter a mesma rota (por exemplo, fase e neutro entre os mesmos aparelhos) e
 * aparecer como um só. Depois do encaminhamento, os troços paralelos que se sobrepõem passam a
 * faixas lado a lado, como num caminho de cabos. Os troços junto aos terminais (as saídas, STUB)
 * ficam no sítio; o resto do cabo desloca-se e, se for preciso, faz um pequeno degrau logo a
 * seguir à saída. Só muda o desenho: o comprimento do cabo para o cálculo vem da rota original.
 */

/** Distância entre faixas (px); diminui em feixes grandes para não invadir a grelha vizinha. */
const LANE_MAX = 8;
const LANE_MIN = 4;
const LANE_SPAN = 36;
/** Sobreposição mínima (px) para dois troços contarem como sobrepostos. */
const OVERLAP = 1;

interface Seg {
  wire: string;
  /** Índice do troço na lista de pontos do cabo (troço i vai do ponto i ao i+1). */
  i: number;
  h: boolean;
  /** Coordenada da linha: y para troços horizontais, x para verticais. */
  c: number;
  lo: number;
  hi: number;
  /** Para onde segue o cabo em cada ponta do troço: -1 (para cima / esquerda), +1, ou 0. */
  dirLo: number;
  dirHi: number;
}

/** Junta-lhe as saídas como troços próprios, para o resto do primeiro e do último troço poder mexer. */
function splitStubs(pts: Pt[]): Pt[] {
  if (pts.length < 2) return pts;
  const out = pts.slice();
  const cut = (from: Pt, to: Pt): Pt | null => {
    const l = Math.hypot(to.x - from.x, to.y - from.y);
    if (l <= STUB + OVERLAP) return null;
    return { x: from.x + ((to.x - from.x) / l) * STUB, y: from.y + ((to.y - from.y) / l) * STUB };
  };
  const last = cut(out[out.length - 1]!, out[out.length - 2]!);
  if (last) out.splice(out.length - 1, 0, last);
  const first = cut(out[0]!, out[1]!);
  if (first) out.splice(1, 0, first);
  return out;
}

/** Cruzamentos que a ordem «s antes de t» (s acima / à esquerda de t) provoca nas pontas dos dois troços. */
function crossCost(s: Seg, t: Seg): number {
  let n = 0;
  const inside = (v: number, r: Seg) => v > r.lo + OVERLAP && v < r.hi - OVERLAP;
  // s segue para baixo/direita a partir de uma ponta dentro de t: atravessa a faixa de t.
  if (s.dirLo > 0 && inside(s.lo, t)) n++;
  if (s.dirHi > 0 && inside(s.hi, t)) n++;
  // t segue para cima/esquerda a partir de uma ponta dentro de s: atravessa a faixa de s.
  if (t.dirLo < 0 && inside(t.lo, s)) n++;
  if (t.dirHi < 0 && inside(t.hi, s)) n++;
  return n;
}

/**
 * Afasta os troços paralelos sobrepostos de cabos diferentes (ou do mesmo cabo). Recebe e devolve
 * as rotas por id de cabo; as pontas ficam nos terminais e os troços continuam ortogonais.
 */
export function separateWires(routes: Map<string, Pt[]>): Map<string, Pt[]> {
  const split = new Map<string, Pt[]>();
  const segs: Seg[] = [];
  /** Saídas dos terminais: não mexem, mas os outros cabos não devem passar por cima delas. */
  const stubs: Seg[] = [];
  for (const [id, raw] of routes) {
    const pts = splitStubs(raw);
    split.set(id, pts);
    const n = pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const h = a.y === b.y;
      if (!h && a.x !== b.x) continue; // não ortogonal (não acontece com o encaminhamento actual)
      const [p0, p1] = h ? (a.x <= b.x ? [a, b] : [b, a]) : a.y <= b.y ? [a, b] : [b, a];
      // Direcção do cabo antes de p0 e depois de p1, perpendicular ao troço.
      const nextOf = (p: Pt) => (p === a ? pts[i - 1] : pts[i + 2]);
      const dir = (p: Pt) => {
        const q = nextOf(p);
        if (!q) return 0;
        const d = h ? q.y - p.y : q.x - p.x;
        return d > 0 ? 1 : d < 0 ? -1 : 0;
      };
      const seg = { wire: id, i, h, c: h ? a.y : a.x, lo: h ? p0.x : p0.y, hi: h ? p1.x : p1.y, dirLo: dir(p0), dirHi: dir(p1) };
      (i === 0 || i === n - 1 ? stubs : segs).push(seg);
    }
  }

  // Grupos: mesma orientação e mesma linha.
  const key = (s: Seg) => `${s.h ? 'h' : 'v'}${Math.round(s.c * 100)}`;
  const groups = new Map<string, Seg[]>();
  for (const s of segs) {
    if (!groups.has(key(s))) groups.set(key(s), []);
    groups.get(key(s))!.push(s);
  }
  const fixedIn = new Map<string, Seg[]>();
  for (const s of stubs) {
    if (!fixedIn.has(key(s))) fixedIn.set(key(s), []);
    fixedIn.get(key(s))!.push(s);
  }
  const offset = new Map<string, number>(); // `${wire}#${i}` → deslocamento
  const overlaps = (s: Seg, t: Seg) => Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) > OVERLAP;
  for (const [gk, group] of groups) {
    group.sort((s, t) => s.lo - t.lo);
    // Componentes de troços que se sobrepõem (em cadeia).
    const comps: Seg[][] = [];
    let cur: Seg[] = [];
    let hi = -Infinity;
    for (const s of group) {
      if (cur.length && s.lo < hi - OVERLAP) cur.push(s);
      else {
        if (cur.length) comps.push(cur);
        cur = [s];
        hi = -Infinity;
      }
      hi = Math.max(hi, s.hi);
    }
    comps.push(cur);
    for (const comp of comps) {
      if (comp.length < 2) continue;
      // Ordem das faixas: a que provoca menos cruzamentos nas pontas (ordenação por inserção).
      const order: Seg[] = [];
      for (const s of comp) {
        let at = order.length;
        while (at > 0 && overlaps(order[at - 1]!, s) && crossCost(order[at - 1]!, s) > crossCost(s, order[at - 1]!)) at--;
        order.splice(at, 0, s);
      }
      // Faixas: cada troço fica na primeira livre entre os que se sobrepõem a ele.
      const lane = new Map<Seg, number>();
      for (const s of order) {
        const used = new Set<number>();
        for (const [t, l] of lane) if (overlaps(s, t)) used.add(l);
        let l = 0;
        while (used.has(l)) l++;
        lane.set(s, l);
      }
      const k = Math.max(...lane.values()) + 1;
      if (k < 2) continue;
      const gap = Math.max(LANE_MIN, Math.min(LANE_MAX, LANE_SPAN / (k - 1)));
      for (const [s, l] of lane) offset.set(`${s.wire}#${s.i}`, (l - (k - 1) / 2) * gap);
    }
    // Um troço que ficou em cima da saída de outro cabo afasta-se para o lado com menos cruzamentos.
    for (const s of group) {
      const o = offset.get(`${s.wire}#${s.i}`) ?? 0;
      if (Math.abs(o) >= LANE_MIN) continue;
      const f = (fixedIn.get(gk) ?? []).find((x) => x.wire !== s.wire && overlaps(s, x));
      if (f) offset.set(`${s.wire}#${s.i}`, crossCost(s, f) <= crossCost(f, s) ? -LANE_MAX : LANE_MAX);
    }
  }

  const out = new Map<string, Pt[]>();
  for (const [id, pts] of split) {
    const n = pts.length - 1;
    if (n < 3 || !segs.some((s) => s.wire === id && offset.has(`${id}#${s.i}`))) {
      out.set(id, routes.get(id)!);
      continue;
    }
    // Linha de cada troço depois do deslocamento.
    const lines = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const h = a.y === b.y;
      lines.push({ h, c: (h ? a.y : a.x) + (offset.get(`${id}#${i}`) ?? 0) });
    }
    const res: Pt[] = [pts[0]!];
    for (let i = 0; i < n - 1; i++) {
      const s = lines[i]!;
      const t = lines[i + 1]!;
      const p = pts[i + 1]!;
      if (s.h !== t.h) res.push(s.h ? { x: t.c, y: s.c } : { x: s.c, y: t.c });
      else if (s.h) res.push({ x: p.x, y: s.c }, { x: p.x, y: t.c });
      else res.push({ x: s.c, y: p.y }, { x: t.c, y: p.y });
    }
    res.push(pts[n]!);
    out.set(id, dedupe(res));
  }
  return out;
}

/** Rotas de todos os cabos do projecto, já com os troços sobrepostos afastados. */
export function layoutWires(registry: Registry, P: Project): Map<string, Pt[]> {
  const routes = new Map<string, Pt[]>();
  for (const w of P.wires) {
    const pts = wirePoints(registry, P, w);
    if (pts) routes.set(w.id, pts);
  }
  return separateWires(routes);
}

/** Caixa envolvente de um equipamento rodado. */
export function bbox(registry: Registry, d: Device) {
  const def = registry.require(d.type);
  const { w, h } = sizeOf(def, d);
  const swap = d.rot % 180 !== 0;
  const W = swap ? h : w;
  const H = swap ? w : h;
  return { x: d.x + (w - W) / 2, y: d.y + (h - H) / 2, w: W, h: H };
}

/** Ponto médio de uma polilinha (para a pega de curva). */
export function midPoint(pts: Pt[]): Pt {
  const half = polyLength(pts) / 2;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + l >= half) {
      const f = l ? (half - acc) / l : 0;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    acc += l;
  }
  return pts[0] ?? { x: 0, y: 0 };
}
