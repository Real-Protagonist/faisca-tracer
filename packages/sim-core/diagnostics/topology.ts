/**
 * Análise do esquema sem simular. Cada «pino» é um conjunto de terminais curto-circuitados
 * dentro de um equipamento (ligador, barramento). Os cabos e os contactos são arestas.
 * A classe de cada pino (fase, neutro, terra) propaga-se a partir das fontes através dos
 * cabos e dos contactos, abertos ou fechados.
 */
import type { Registry } from '../devices/registry';
import type { SourceRole } from '../devices/types';
import type { Device, Project, Wire } from '../project/types';

export interface Edge {
  a: number;
  b: number;
  kind: 'wire' | 'contact';
  /** Id do cabo ou do equipamento. */
  id: string;
  /** Cabo inteiro ou contacto fechado. */
  closed: boolean;
}

export interface SourceSeed {
  device: Device;
  terminal: string;
  role: SourceRole;
  pin: number;
}

export interface Topology {
  pinOf: Map<string, number>;
  pinCount: number;
  edges: Edge[];
  adj: Edge[][];
  /** Cabos ligados a cada pino. */
  wiresAt: Wire[][];
  seeds: SourceSeed[];
  /** Terminais de fonte que chegam a cada pino: 'fonteId:terminal'. */
  reach: Set<string>[];
  roles: Set<SourceRole>[];
  pin(deviceId: string, terminal: string): number;
  /** O terminal tem algum cabo ligado (directamente ou pelo ligador). */
  wired(deviceId: string, terminal: string): boolean;
}

export function buildTopology(P: Project, registry: Registry): Topology {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    while (parent.has(k)) k = parent.get(k)!;
    return k;
  };
  for (const d of P.devices) {
    const def = registry.get(d.type);
    if (!def?.shorts) continue;
    for (const g of def.shorts(d))
      for (let i = 1; i < g.length; i++) {
        const ra = find(`${d.id}:${g[0]}`);
        const rb = find(`${d.id}:${g[i]}`);
        if (ra !== rb) parent.set(ra, rb);
      }
  }
  const pinOf = new Map<string, number>();
  const rootPin = new Map<string, number>();
  let n = 0;
  for (const d of P.devices) {
    const def = registry.get(d.type);
    if (!def) continue;
    for (const t of def.terminals) {
      const key = `${d.id}:${t.id}`;
      const r = find(key);
      let pin = rootPin.get(r);
      if (pin === undefined) {
        pin = n++;
        rootPin.set(r, pin);
      }
      pinOf.set(key, pin);
    }
  }
  const edges: Edge[] = [];
  const wiresAt: Wire[][] = Array.from({ length: n }, () => []);
  for (const w of P.wires) {
    const a = pinOf.get(`${w.a.device}:${w.a.terminal}`);
    const b = pinOf.get(`${w.b.device}:${w.b.terminal}`);
    if (a === undefined || b === undefined) continue;
    edges.push({ a, b, kind: 'wire', id: w.id, closed: !w.fault?.cut });
    wiresAt[a]!.push(w);
    if (b !== a) wiresAt[b]!.push(w);
  }
  const seeds: SourceSeed[] = [];
  for (const d of P.devices) {
    const def = registry.get(d.type);
    if (!def) continue;
    for (const c of def.conducts?.(d) ?? []) {
      const a = pinOf.get(`${d.id}:${c.a}`);
      const b = pinOf.get(`${d.id}:${c.b}`);
      if (a !== undefined && b !== undefined) edges.push({ a, b, kind: 'contact', id: d.id, closed: c.closed });
    }
    const roles = def.sourceRoles?.(d) ?? {};
    for (const [terminal, role] of Object.entries(roles)) {
      const pin = pinOf.get(`${d.id}:${terminal}`);
      if (pin !== undefined) seeds.push({ device: d, terminal, role, pin });
    }
  }
  const adj: Edge[][] = Array.from({ length: n }, () => []);
  for (const e of edges) {
    adj[e.a]!.push(e);
    if (e.b !== e.a) adj[e.b]!.push(e);
  }
  const reach: Set<string>[] = Array.from({ length: n }, () => new Set<string>());
  const roles: Set<SourceRole>[] = Array.from({ length: n }, () => new Set<SourceRole>());
  for (const s of seeds) {
    const tag = `${s.device.id}:${s.terminal}`;
    const q = [s.pin];
    reach[s.pin]!.add(tag);
    roles[s.pin]!.add(s.role);
    while (q.length) {
      const p = q.pop()!;
      for (const e of adj[p]!) {
        const o = e.a === p ? e.b : e.a;
        if (reach[o]!.has(tag)) continue;
        reach[o]!.add(tag);
        roles[o]!.add(s.role);
        q.push(o);
      }
    }
  }
  return {
    pinOf,
    pinCount: n,
    edges,
    adj,
    wiresAt,
    seeds,
    reach,
    roles,
    pin: (id, t) => pinOf.get(`${id}:${t}`) ?? -1,
    wired: (id, t) => {
      const p = pinOf.get(`${id}:${t}`);
      return p !== undefined && wiresAt[p]!.length > 0;
    },
  };
}

/**
 * Caminho entre dois pinos com o menor número de elementos abertos (BFS 0-1).
 * Devolve as arestas pela ordem de `from` para `to`, ou null se não houver ligação.
 */
export function findPath(topo: Topology, from: number, to: Set<number>, closedOnly = false, treatClosed?: (e: Edge) => boolean): Edge[] | null {
  if (from < 0) return null;
  const dist = new Array<number>(topo.pinCount).fill(Infinity);
  const prev = new Array<Edge | null>(topo.pinCount).fill(null);
  const dq: number[] = [from];
  dist[from] = 0;
  while (dq.length) {
    const p = dq.shift()!;
    if (to.has(p)) {
      const path: Edge[] = [];
      let c = p;
      while (c !== from) {
        const e = prev[c]!;
        path.push(e);
        c = e.a === c ? e.b : e.a;
      }
      return path.reverse();
    }
    for (const e of topo.adj[p]!) {
      if (closedOnly && !e.closed && !treatClosed?.(e)) continue;
      const o = e.a === p ? e.b : e.a;
      const w = e.closed ? 0 : 1;
      if (dist[p]! + w < dist[o]!) {
        dist[o] = dist[p]! + w;
        prev[o] = e;
        if (w === 0) dq.unshift(o);
        else dq.push(o);
      }
    }
  }
  return null;
}
