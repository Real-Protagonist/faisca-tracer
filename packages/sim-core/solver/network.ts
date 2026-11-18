/** Constrói a rede MNA a partir do projecto e lê os resultados. */
import { cx, q0, qsub, type Quantity } from './complex';
import {
  elementCurrent,
  nodeVoltage,
  type Element,
  type Network,
  type NetworkSolution,
} from './mna';
import { CABLE_REACTANCE, wireResistance } from '../checks/tables';
import type { Device, Project } from '../project/types';
import type { Registry } from '../devices/registry';
import type { SolutionView, StampContext } from '../devices/types';

/** Resistência de um contacto fechado (Ω). */
export const CONTACT_R = 1e-3;

export interface BuiltNetwork extends Network {
  /** 'idEquipamento:terminal' → nó */
  termNode: Map<string, number>;
  /** 'idEquipamento:etiqueta' ou 'w:idCabo' → elemento */
  tags: Map<string, Element>;
  /** 'idEquipamento#nome' → nó interno */
  internals: Map<string, number>;
}

export interface ExtraStamp {
  node(deviceId: string, terminal: string): number;
  R(a: number, b: number, ohms: number, tag: string): void;
}

export function buildNetwork(
  project: Project,
  registry: Registry,
  runtimeOf: (d: Device) => object,
  extra?: (b: ExtraStamp) => void,
): BuiltNetwork {
  // 1. Terminais curto-circuitados internamente (ligadores) partilham o nó.
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
  for (const d of project.devices) {
    const def = registry.get(d.type);
    if (!def?.shorts) continue;
    for (const g of def.shorts(d)) for (let i = 1; i < g.length; i++) union(`${d.id}:${g[0]}`, `${d.id}:${g[i]}`);
  }

  const nodeOfRoot = new Map<string, number>();
  const nodeLabels: string[] = ['⏚'];
  let count = 1;
  const nodeFor = (key: string, label: string): number => {
    const r = find(key);
    let v = nodeOfRoot.get(r);
    if (v === undefined) {
      v = count++;
      nodeOfRoot.set(r, v);
      nodeLabels.push(label);
    }
    return v;
  };
  const termNode = new Map<string, number>();
  for (const d of project.devices) {
    const def = registry.get(d.type);
    if (!def) continue;
    for (const t of def.terminals) termNode.set(`${d.id}:${t.id}`, nodeFor(`${d.id}:${t.id}`, `${d.name}:${t.id}`));
  }

  const elements: Element[] = [];
  const tags = new Map<string, Element>();
  const internals = new Map<string, number>();
  const omega = 2 * Math.PI * project.frequency;
  let current: Device | null = null;
  const push = (e: Element, tag?: string) => {
    if (tag) {
      const full = `${current ? current.id : 'x'}:${tag}`;
      e.tag = full;
      tags.set(full, e);
    }
    elements.push(e);
  };

  const ctx: StampContext = {
    ground: 0,
    omega,
    frequency: project.frequency,
    level: project.level,
    node: (t) => {
      const n = termNode.get(`${current!.id}:${t}`);
      if (n === undefined) throw new Error(`Terminal desconhecido ${current!.type}:${t}`);
      return n;
    },
    internal: (name) => {
      const k = `${current!.id}#${name}`;
      let n = internals.get(k);
      if (n === undefined) {
        n = count++;
        nodeLabels.push(`${current!.name}#${name}`);
        internals.set(k, n);
      }
      return n;
    },
    R: (a, b, ohms, tag) => push({ k: 'Z', a, b, R: Math.max(ohms, 1e-6), L: 0, C: 0 }, tag),
    Z: (a, b, z, tag) => push({ k: 'Z', a, b, R: z.R ?? 0, L: z.L ?? 0, C: z.C ?? 0 }, tag),
    V: (a, b, v, tag) => push({ k: 'V', a, b, ac: v.ac ?? 0, phase: v.phase ?? 0, dc: v.dc ?? 0 }, tag),
    I: (a, b, i, tag) => {
      const ac = i.ac ? { re: i.ac * Math.cos(((i.phase ?? 0) * Math.PI) / 180), im: i.ac * Math.sin(((i.phase ?? 0) * Math.PI) / 180) } : cx();
      push({ k: 'I', a, b, ac, dc: i.dc ?? 0 }, tag);
    },
    X: (p1, p2, s1, s2, n, tag) => push({ k: 'X', p1, p2, s1, s2, n }, tag),
    sw: (a, b, closed, tag) => {
      if (closed) push({ k: 'Z', a, b, R: CONTACT_R, L: 0, C: 0 }, tag);
    },
  };

  for (const d of project.devices) {
    const def = registry.get(d.type);
    if (!def?.stamp) continue;
    current = d;
    def.stamp(d, ctx, runtimeOf(d));
  }
  current = null;

  // 2. Cabos: R = ρ·L/S (+ contacto solto), X = 0,08 mΩ/m no perfil Profissional.
  for (const w of project.wires) {
    if (w.fault?.cut) continue;
    const a = termNode.get(`${w.a.device}:${w.a.terminal}`);
    const b = termNode.get(`${w.b.device}:${w.b.terminal}`);
    if (a === undefined || b === undefined) continue;
    const R = Math.max(1e-4, wireResistance(w) + (w.fault?.contactResistance ?? 0));
    const L = project.level === 'pro' ? (CABLE_REACTANCE * w.length) / omega : 0;
    const e: Element = { k: 'Z', a, b, R, L, C: 0, tag: `w:${w.id}` };
    elements.push(e);
    tags.set(e.tag!, e);
  }

  if (extra) {
    current = { id: 'extra' } as Device;
    extra({
      node: (id, t) => termNode.get(`${id}:${t}`) ?? 0,
      R: (a, b, ohms, tag) => ctx.R(a, b, ohms, tag),
    });
    current = null;
  }

  return { nodeCount: count, elements, omega, nodeLabels, termNode, tags, internals };
}

export function makeView(net: BuiltNetwork, sol: NetworkSolution): SolutionView {
  const vn = (node: number): Quantity => ({
    ac: nodeVoltage(sol.ac, node),
    dc: sol.dc && node > 0 ? sol.dc.xr[node - 1]! : 0,
  });
  const vKey = (key: string): Quantity => {
    const n = net.termNode.get(key);
    return n === undefined ? q0() : vn(n);
  };
  const iEl = (e: Element | undefined): Quantity =>
    e ? { ac: elementCurrent(sol.ac, e), dc: elementCurrent(sol.dc, e).re } : q0();
  return {
    v: (d, t) => vKey(`${d.id}:${t}`),
    vv: (d, t1, t2) => qsub(vKey(`${d.id}:${t1}`), vKey(`${d.id}:${t2}`)),
    vAt: (id, t) => vKey(`${id}:${t}`),
    vInternal: (d, name) => {
      const n = net.internals.get(`${d.id}#${name}`);
      return n === undefined ? q0() : vn(n);
    },
    i: (d, tag) => iEl(net.tags.get(`${d.id}:${tag}`)),
    iWire: (id) => iEl(net.tags.get(`w:${id}`)),
    hasAC: !!sol.ac,
    hasDC: !!sol.dc,
  };
}
