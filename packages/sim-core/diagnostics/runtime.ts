/** Diagnóstico durante a simulação e o botão «Porque não funciona?». */
import { rms } from '../solver/complex';
import { ampacity, IEC_RULES, wireResistance } from '../checks/tables';
import type { Simulator } from '../simulator';
import type { Device } from '../project/types';
import { wireConducts } from '../project/wire';
import { diag, dev, wire, type Diagnostic } from './types';
import { buildTopology, findPath, type Edge, type Topology } from './topology';
import { assemblyDiagnostics } from './assembly';

/** Queda de tensão ao longo de um caminho de cabos: devolve o cabo com maior queda. */
function worstWire(sim: Simulator, path: Edge[]) {
  let best: { id: string; drop: number } | null = null;
  const view = sim.view();
  for (const e of path) {
    if (e.kind !== 'wire') continue;
    const w = sim.project.wires.find((x) => x.id === e.id);
    if (!w) continue;
    const drop = rms(view.iWire(w.id)) * wireResistance(w);
    if (!best || drop > best.drop) best = { id: w.id, drop };
  }
  return best ? sim.project.wires.find((x) => x.id === best!.id)! : null;
}

/** Fonte que alimenta uma carga: a primeira cuja fase chega ao terminal de fase. */
function feedingSource(topo: Topology, phasePin: number, neutralPin: number) {
  const reach = topo.reach[phasePin];
  if (!reach) return null;
  for (const s of topo.seeds) {
    if (s.role !== 'phase' || !reach.has(`${s.device.id}:${s.terminal}`)) continue;
    const n = topo.seeds.find((x) => x.device.id === s.device.id && x.role === 'neutral');
    if (n && topo.reach[neutralPin]?.has(`${n.device.id}:${n.terminal}`)) return { phase: s, neutral: n };
  }
  return null;
}

export function runtimeDiagnostics(sim: Simulator, topo: Topology = buildTopology(sim.project, sim.registry)): Diagnostic[] {
  const out: Diagnostic[] = [];
  const P = sim.project;
  const view = sim.view();
  const fmt = sim.fmt;
  const name = (id: string) => P.devices.find((d) => d.id === id)?.name ?? id;
  const ctx = { sol: view, project: P, fmt, registry: sim.registry, topo };

  for (const d of P.devices) {
    const def = sim.registry.get(d.type);
    if (!def) continue;
    if (def.diagnose) out.push(...def.diagnose(d, ctx, sim.rt(d)));
  }

  // Queda de tensão desde a origem da instalação.
  for (const x of loadDrops(sim, topo)) {
    const limit = x.lighting ? IEC_RULES.maxDropLighting : IEC_RULES.maxDropOther;
    if (x.drop <= limit) continue;
    const w = worstWire(sim, x.path);
    const targets = [dev(x.device.id), ...(w ? [wire(w.id)] : [])];
    out.push(
      diag('VOLTAGE_DROP', 'warning', targets, {
        device: x.device.name,
        drop: fmt(x.drop, '%'),
        limit: fmt(limit, '%'),
        section: w ? fmt(w.section, 'mm²') : '—',
        length: w ? fmt(w.length, 'm') : '—',
      }, w?.id ?? x.device.id),
    );
  }

  for (const w of P.wires) {
    if (!wireConducts(w)) continue;
    const I = rms(view.iWire(w.id));
    const iz = ampacity(w);
    // Sobrecarga mantida: a corrente actual e a equivalente térmica (60 s) acima de Iz.
    // Um arranque de motor (curto) ou uma carga que acabou de desligar não contam.
    const Ith = Math.min(I, sim.wireThermalCurrent(w.id));
    if (Ith > iz * 1.001) {
      out.push(
        diag('CABLE_OVERLOAD', 'warning', [wire(w.id)], {
          from: name(w.a.device),
          to: name(w.b.device),
          current: fmt(Ith, 'A'),
          section: fmt(w.section, 'mm²'),
          iz: fmt(iz, 'A'),
        }, w.id),
      );
    }
    const rc = w.fault?.contactResistance ?? 0;
    if (rc > 0 && I * I * rc > 5) {
      out.push(diag('LOOSE_CONNECTION', 'warning', [wire(w.id)], { from: name(w.a.device), to: name(w.b.device), power: fmt(I * I * rc, 'W') }, w.id));
    }
  }

  if (sim.unstable) {
    const ids = sim.unstableDevices;
    out.push(diag('CONTROL_UNSTABLE', 'error', ids.map(dev), { device: ids.length ? name(ids[0]!) : '—' }, ids[0]));
  }
  return out;
}

export interface LoadDrop {
  device: Device;
  /** Queda em % da tensão nominal da carga, desde a fonte. */
  drop: number;
  lighting: boolean;
  /** Caminho da fase e do neutro até à fonte (para apontar o cabo pior). */
  path: Edge[];
}

/** Queda de tensão de cada carga monofásica alimentada, desde a fonte que a alimenta. */
export function loadDrops(sim: Simulator, topo: Topology = buildTopology(sim.project, sim.registry)): LoadDrop[] {
  const view = sim.view();
  const out: LoadDrop[] = [];
  for (const d of sim.project.devices) {
    const def = sim.registry.get(d.type);
    if (!def?.load || def.load.phases) continue;
    const { phase, neutral } = def.load;
    const Vn = def.load.nominalVoltage(d);
    const V = rms(view.vv(d, phase, neutral));
    if (V < 0.5 * Vn) continue;
    const pPin = topo.pin(d.id, phase);
    const nPin = topo.pin(d.id, neutral);
    const src = feedingSource(topo, pPin, nPin);
    if (!src) continue;
    const Vsrc = rms(view.vv(src.phase.device, src.phase.terminal, src.neutral.terminal));
    const path = [...(findPath(topo, pPin, new Set([src.phase.pin]), true) ?? []), ...(findPath(topo, nPin, new Set([src.neutral.pin]), true) ?? [])];
    out.push({ device: d, drop: (100 * (Vsrc - V)) / Vn, lighting: !!def.load.lighting, path });
  }
  return out;
}

/** Todos os diagnósticos actuais (montagem + simulação), ordenados por gravidade. */
export function allDiagnostics(sim: Simulator): Diagnostic[] {
  const topo = buildTopology(sim.project, sim.registry);
  const order = { error: 0, warning: 1, info: 2 } as const;
  return [...assemblyDiagnostics(sim.project, sim.registry, sim.fmt, topo), ...runtimeDiagnostics(sim, topo)].sort(
    (a, b) => order[a.severity] - order[b.severity],
  );
}

/**
 * «Porque não funciona?»: percorre o caminho da carga até à fonte, pela fase e pelo neutro,
 * e aponta o primeiro elemento que corta o circuito ou a primeira ligação em falta.
 */
/** Respostas que não explicam uma causa concreta (ao seguir a bobina de um contactor). */
const GENERIC = new Set(['PATH_OPEN', 'COIL_OFF', 'LOAD_OK', 'LOAD_SWITCHED_OFF', 'NOT_A_LOAD']);

export function whyNotWorking(sim: Simulator, idOrName: string, depth = 0): Diagnostic {
  const d = sim.device(idOrName);
  if (!d) throw new Error(`Equipamento inexistente: ${idOrName}`);
  const def = sim.registry.require(d.type);
  if (!def.load) return diag('NOT_A_LOAD', 'info', [dev(d.id)], { device: d.name });
  const P = sim.project;
  const view = sim.view();
  const fmt = sim.fmt;
  const topo = buildTopology(P, sim.registry);
  const ctx = { sol: view, project: P, fmt, registry: sim.registry, topo };
  const { phase, neutral } = def.load;

  // O próprio equipamento avariado (lâmpada fundida…).
  const own = def.diagnose?.(d, ctx, sim.rt(d)) ?? [];
  if (own.length) return own[0]!;
  if (def.load.working?.(d, view, sim.rt(d))) return diag('LOAD_OK', 'info', [dev(d.id)], { device: d.name });

  const pPin = topo.pin(d.id, phase);
  const nPin = topo.pin(d.id, neutral);
  const phaseSeeds = topo.seeds.filter((s) => s.role === 'phase');
  const neutralSeeds = topo.seeds.filter((s) => s.role === 'neutral');

  const check = (pin: number, terminal: string, seeds: typeof phaseSeeds, missingCode: string): Diagnostic | null => {
    if (!topo.wired(d.id, terminal)) return diag(missingCode, 'error', [dev(d.id)], { device: d.name, terminal }, d.id);
    const path = findPath(topo, pin, new Set(seeds.map((s) => s.pin)));
    if (!path) return diag(missingCode, 'error', [dev(d.id)], { device: d.name, terminal }, d.id);
    // Percorrer da fonte para a carga e parar no primeiro elemento aberto.
    for (const e of [...path].reverse()) {
      if (e.closed) continue;
      if (e.kind === 'wire') {
        const w = P.wires.find((x) => x.id === e.id)!;
        const loose = w.fault?.cut ? undefined : w.detached?.[0];
        if (loose) {
          const end = w[loose];
          const at = `${P.devices.find((x) => x.id === end.device)?.name ?? end.device}-${end.terminal}`;
          return diag('WIRE_DETACHED', 'error', [wire(w.id), dev(d.id)], { device: d.name, from: P.devices.find((x) => x.id === w.a.device)?.name ?? '', to: P.devices.find((x) => x.id === w.b.device)?.name ?? '', terminal: at }, w.id);
        }
        return diag('WIRE_CUT', 'error', [wire(w.id), dev(d.id)], { device: d.name, from: P.devices.find((x) => x.id === w.a.device)?.name ?? '', to: P.devices.find((x) => x.id === w.b.device)?.name ?? '' }, w.id);
      }
      const blocker = P.devices.find((x) => x.id === e.id)!;
      const bdef = sim.registry.require(blocker.type);
      const bd = bdef.diagnose?.(blocker, ctx, sim.rt(blocker)) ?? [];
      if (bd.length) return { ...bd[0]!, targets: [...bd[0]!.targets, dev(d.id)] };
      // Contactor ou relé aberto: o problema está no circuito da bobina. Se lá houver uma causa
      // concreta (relé térmico disparado, fio cortado…), é essa a resposta.
      if (bdef.coilOperated && !blocker.state.coil) {
        if (depth < 3) {
          const inner = whyNotWorking(sim, blocker.id, depth + 1);
          if (!GENERIC.has(inner.code)) return { ...inner, targets: [...inner.targets, dev(d.id)] };
        }
        return diag('COIL_OFF', 'error', [dev(blocker.id), dev(d.id)], { device: d.name, blocker: blocker.name }, blocker.id);
      }
      return diag('PATH_OPEN', 'error', [dev(blocker.id), dev(d.id)], { device: d.name, blocker: blocker.name }, blocker.id);
    }
    return null;
  };

  // Carga trifásica: cada terminal de linha até uma fase.
  if (def.load.phases) {
    for (const t of def.load.phases) {
      const r = check(topo.pin(d.id, t), t, phaseSeeds, 'LOAD_NO_SUPPLY');
      if (r) return r;
    }
    const seed = phaseSeeds.find((s) => topo.reach[pPin]?.has(`${s.device.id}:${s.terminal}`));
    if (seed && (seed.device.state.on === false || seed.device.state.output === false)) {
      return diag('SOURCE_OFF', 'error', [dev(seed.device.id), dev(d.id)], { device: d.name, source: seed.device.name }, seed.device.id);
    }
    return diag('LOAD_SWITCHED_OFF', 'info', [dev(d.id)], { device: d.name }, d.id);
  }
  const ph = check(pPin, phase, phaseSeeds, 'LOAD_NO_SUPPLY');
  if (ph) return ph;
  const ne = check(nPin, neutral, neutralSeeds, 'LOAD_NO_RETURN');
  if (ne) return ne;

  // Caminho fechado: fonte desligada, aparelho desligado ou tensão insuficiente.
  const src = feedingSource(topo, pPin, nPin);
  if (src && src.phase.device.state.on === false) {
    return diag('SOURCE_OFF', 'error', [dev(src.phase.device.id), dev(d.id)], { device: d.name, source: src.phase.device.name }, src.phase.device.id);
  }
  const V = rms(view.vv(d, phase, neutral));
  // Com tensão mas sem consumo: interruptor próprio desligado ou nada ligado à tomada.
  if (d.state.on === false || V >= 0.85 * def.load.nominalVoltage(d)) {
    return diag('LOAD_SWITCHED_OFF', 'info', [dev(d.id)], { device: d.name }, d.id);
  }
  return diag('LOW_VOLTAGE', 'error', [dev(d.id)], { device: d.name, voltage: fmt(V, 'V'), nominal: fmt(def.load.nominalVoltage(d), 'V') }, d.id);
}

export type { Device };
