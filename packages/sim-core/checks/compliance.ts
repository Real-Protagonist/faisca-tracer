/**
 * Verificação de conformidade: regras indicativas da IEC 60364, com os limites num ficheiro de
 * regras (um por país). Cada regra dá «passa», «falha» ou «não se aplica», com a lista dos
 * aparelhos ou cabos verificados e a referência da norma.
 *
 * O Faísca Tracer é didáctico: esta verificação não substitui o projecto nem a inspecção de uma instalação.
 */
import type { Simulator } from '../simulator';
import type { Device, Project, Wire, WireEnd } from '../project/types';
import type { Registry } from '../devices/registry';
import { assemblyDiagnostics } from '../diagnostics/assembly';
import { buildTopology, findPath, type Topology } from '../diagnostics/topology';
import { dev, wire, type DiagTarget } from '../diagnostics/types';
import { ampacity, IEC_RULES } from './tables';
import { loadDrops } from '../diagnostics/runtime';

export interface ComplianceRules {
  id: string;
  /** Nome mostrado (o ficheiro de regras é do formador ou do país: não se traduz). */
  name: string;
  maxDropLighting: number;
  maxDropOther: number;
  /** Sensibilidade máxima do diferencial dos circuitos de tomadas (mA). */
  maxIdnSockets: number;
  /** Tensão de contacto limite (V) no esquema TT: Ra × IΔn ≤ UL. */
  touchVoltage: number;
  /** Referência normativa de cada regra. */
  references: Record<string, string>;
}

export const COMPLIANCE_RULES = ['ib_in_iz', 'voltage_drop', 'rcd_sockets', 'tt_touch', 'pe', 'colors', 'switch_phase', 'breaking_capacity'] as const;
export type ComplianceRuleId = (typeof COMPLIANCE_RULES)[number];
/** Regras mostradas no nível Iniciante (verificação simplificada). */
export const BEGINNER_RULES: ComplianceRuleId[] = ['pe', 'colors', 'switch_phase', 'rcd_sockets'];

export const DEFAULT_RULES: ComplianceRules = {
  id: 'iec',
  name: 'IEC 60364 (indicativo)',
  maxDropLighting: IEC_RULES.maxDropLighting,
  maxDropOther: IEC_RULES.maxDropOther,
  maxIdnSockets: IEC_RULES.maxRcdSockets,
  touchVoltage: IEC_RULES.touchVoltageLimit,
  references: {
    ib_in_iz: 'IEC 60364-4-43, 433.1',
    voltage_drop: 'IEC 60364-5-52, anexo G',
    rcd_sockets: 'IEC 60364-4-41, 411.3.3',
    tt_touch: 'IEC 60364-4-41, 411.5.3',
    pe: 'IEC 60364-4-41, 411.3.1.1',
    colors: 'IEC 60445',
    switch_phase: 'IEC 60364-5-53',
    breaking_capacity: 'IEC 60364-4-43, 434.5.1',
  },
};

export type ComplianceStatus = 'pass' | 'fail' | 'na';

export interface ComplianceItem {
  ok: boolean;
  /** Valores já formatados para a mensagem `compliance.<regra>.item`. */
  values: Record<string, string>;
  targets: DiagTarget[];
}

export interface ComplianceResult {
  id: ComplianceRuleId;
  status: ComplianceStatus;
  reference: string;
  items: ComplianceItem[];
}

/** Valida um ficheiro de regras (JSON) e completa o que faltar com os valores IEC. */
export function parseRuleSet(text: string): ComplianceRules {
  const raw = JSON.parse(text);
  const n = (k: keyof ComplianceRules) => (typeof raw[k] === 'number' && raw[k] > 0 ? raw[k] : DEFAULT_RULES[k]);
  return {
    id: String(raw.id ?? 'custom'),
    name: String(raw.name ?? raw.id ?? 'custom'),
    maxDropLighting: n('maxDropLighting') as number,
    maxDropOther: n('maxDropOther') as number,
    maxIdnSockets: n('maxIdnSockets') as number,
    touchVoltage: n('touchVoltage') as number,
    references: { ...DEFAULT_RULES.references, ...(raw.references ?? {}) },
  };
}

/** Cabos a jusante de uma protecção, até à protecção seguinte. */
export function downstreamWires(P: Project, registry: Registry, topo: Topology, d: Device): Wire[] {
  const def = registry.require(d.type);
  if (!def.protection) return [];
  const out: Wire[] = [];
  const seen = new Set<string>();
  const stop = new Set(def.protection.inputs.map((t) => topo.pin(d.id, t)));
  const queue = def.protection.outputs.map((t) => topo.pin(d.id, t)).filter((p) => p >= 0);
  const visited = new Set<number>([...queue, ...stop]);
  while (queue.length) {
    const p = queue.shift()!;
    for (const e of topo.adj[p]!) {
      const o = e.a === p ? e.b : e.a;
      if (e.kind === 'contact') {
        const other = P.devices.find((x) => x.id === e.id);
        if (e.id === d.id || (other && registry.get(other.type)?.protection)) continue;
      } else if (!seen.has(e.id)) {
        seen.add(e.id);
        out.push(P.wires.find((x) => x.id === e.id)!);
      }
      if (!visited.has(o)) {
        visited.add(o);
        queue.push(o);
      }
    }
  }
  return out;
}

/** Maior corrente medida num aparelho (todas as medições «meas.current*»). */
function currentThrough(sim: Simulator, d: Device): number {
  const vals = sim.measurements(d.id).filter((m) => m.key.startsWith('meas.current') && typeof m.value === 'number').map((m) => m.value as number);
  return vals.length ? Math.max(...vals) : 0;
}

const result = (id: ComplianceRuleId, rules: ComplianceRules, items: ComplianceItem[]): ComplianceResult => ({
  id,
  reference: rules.references[id] ?? DEFAULT_RULES.references[id]!,
  items,
  status: !items.length ? 'na' : items.every((i) => i.ok) ? 'pass' : 'fail',
});

export function checkCompliance(sim: Simulator, rules: ComplianceRules = DEFAULT_RULES): ComplianceResult[] {
  const P = sim.project;
  const registry = sim.registry;
  const fmt = sim.fmt;
  const topo = buildTopology(P, registry);
  const assembly = assemblyDiagnostics(P, registry, fmt, topo);
  const name = (id: string) => P.devices.find((d) => d.id === id)?.name ?? id;
  const out: ComplianceResult[] = [];
  const protections = P.devices.filter((d) => registry.get(d.type)?.protection);

  // 1. Ib ≤ In ≤ Iz.
  out.push(
    result('ib_in_iz', rules, protections.flatMap((d) => {
      const In = registry.require(d.type).protection!.ratedCurrent(d);
      const ws = downstreamWires(P, registry, topo, d);
      if (!ws.length) return [];
      const iz = Math.min(...ws.map(ampacity));
      const ib = currentThrough(sim, d);
      return [{ ok: ib <= In * 1.001 && In <= iz * 1.001, values: { device: d.name, ib: fmt(ib, 'A'), in: fmt(In, 'A'), iz: fmt(iz, 'A') }, targets: [dev(d.id)] }];
    })),
  );

  // 2. Queda de tensão desde a origem.
  const drops = loadDrops(sim, topo);
  out.push(
    result('voltage_drop', rules, drops.map((x) => {
      const limit = x.lighting ? rules.maxDropLighting : rules.maxDropOther;
      return { ok: x.drop <= limit, values: { device: x.device.name, drop: fmt(x.drop, '%'), limit: fmt(limit, '%') }, targets: [dev(x.device.id)] };
    })),
  );

  // 3. Tomadas protegidas por diferencial de alta sensibilidade.
  const phaseSeeds = new Set(topo.seeds.filter((s) => s.role === 'phase').map((s) => s.pin));
  out.push(
    result('rcd_sockets', rules, P.devices.filter((d) => d.type === 'socket').map((d) => {
      const path = findPath(topo, topo.pin(d.id, 'L'), phaseSeeds) ?? [];
      const rcd = path.map((e) => (e.kind === 'contact' ? P.devices.find((x) => x.id === e.id) : undefined)).find((x) => x && x.params.IDn !== undefined);
      const idn = rcd ? Number(rcd.params.IDn) : NaN;
      return { ok: !!rcd && idn <= rules.maxIdnSockets, values: { device: d.name, rcd: rcd?.name ?? '—', idn: rcd ? fmt(idn / 1000, 'A') : '—' }, targets: [dev(d.id), ...(rcd ? [dev(rcd.id)] : [])] };
    })),
  );

  // 4. Esquema TT: Ra × IΔn ≤ UL.
  // Só se aplica com massas a proteger (aparelhos de classe I).
  const tt = P.devices.some((d) => (d.type === 'grid1ph' || d.type === 'grid3ph' ? d.params.earthing === 'TT' : false)) && P.devices.some((d) => registry.get(d.type)?.classI);
  const electrodes = P.devices.filter((d) => d.type === 'earthElectrode');
  const rcds = P.devices.filter((d) => d.params.IDn !== undefined && registry.get(d.type)?.category === 'protection');
  const Ra = electrodes.length ? Math.max(...electrodes.map((e) => Number(e.params.Ra))) : NaN;
  out.push(
    result('tt_touch', rules, !tt ? [] : rcds.length ? rcds.map((r) => {
      const ul = Number.isFinite(Ra) ? (Ra * Number(r.params.IDn)) / 1000 : Infinity;
      return { ok: ul <= rules.touchVoltage, values: { device: r.name, ra: Number.isFinite(Ra) ? fmt(Ra, 'Ω') : '—', idn: fmt(Number(r.params.IDn) / 1000, 'A'), ul: Number.isFinite(ul) ? fmt(ul, 'V') : '—', limit: fmt(rules.touchVoltage, 'V') }, targets: [dev(r.id)] };
    }) : [{ ok: false, values: { device: '—', ra: Number.isFinite(Ra) ? fmt(Ra, 'Ω') : '—', idn: '—', ul: '—', limit: fmt(rules.touchVoltage, 'V') }, targets: [] }]),
  );

  // 5. Massas de classe I ligadas ao PE.
  const peMissing = new Set(assembly.filter((d) => d.code === 'PE_MISSING').flatMap((d) => d.targets.map((t) => t.id)));
  out.push(
    result('pe', rules, P.devices.filter((d) => registry.get(d.type)?.classI).map((d) => ({ ok: !peMissing.has(d.id), values: { device: d.name }, targets: [dev(d.id)] }))),
  );

  // 6. Cores dos condutores.
  const badColor = new Map(assembly.filter((d) => d.code === 'WIRE_COLOR').map((d) => [d.targets[0]!.id, d]));
  out.push(
    result('colors', rules, P.wires.map((w) => {
      const bad = badColor.get(w.id);
      return { ok: !bad, values: { from: name(w.a.device), to: name(w.b.device), actual: w.conductor, expected: bad?.values.expected ?? w.conductor }, targets: [wire(w.id)] };
    })),
  );

  // 7. Interruptores unipolares na fase.
  const onNeutral = new Set(assembly.filter((d) => d.code === 'SWITCH_ON_NEUTRAL').flatMap((d) => d.targets.map((t) => t.id)));
  out.push(
    result('switch_phase', rules, P.devices.filter((d) => registry.get(d.type)?.phaseOnlySwitch && P.wires.some((w) => w.a.device === d.id || w.b.device === d.id)).map((d) => ({ ok: !onNeutral.has(d.id), values: { device: d.name }, targets: [dev(d.id)] }))),
  );

  // 8. Poder de corte maior do que a corrente de curto-circuito presumida à saída.
  const neutralOf = (): WireEnd | 'earth' => {
    const s = topo.seeds.find((x) => x.role === 'neutral');
    return s ? { device: s.device.id, terminal: s.terminal } : 'earth';
  };
  out.push(
    result('breaking_capacity', rules, protections.filter((d) => d.params.Icn !== undefined).map((d) => {
      const def = registry.require(d.type);
      const outs = def.protection!.outputs;
      const kinds = outs.map((t) => def.terminals.find((x) => x.id === t)?.kind);
      const a: WireEnd = { device: d.id, terminal: outs[0]! };
      const ni = kinds.indexOf('N');
      const b: WireEnd | 'earth' = ni >= 0 ? { device: d.id, terminal: outs[ni]! } : outs.length >= 3 ? { device: d.id, terminal: outs[1]! } : neutralOf();
      const isc = sim.prospectiveCurrent(a, b);
      const icn = Number(d.params.Icn) * 1000;
      return { ok: isc <= icn, values: { device: d.name, isc: fmt(isc, 'A'), icn: fmt(icn, 'A') }, targets: [dev(d.id)] };
    })),
  );
  return out;
}

