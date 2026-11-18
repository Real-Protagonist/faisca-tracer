/** Diagnóstico durante a simulação e o botão «Porque não funciona?». */
import { rms } from '../solver/complex';
import { ampacity, IEC_RULES, wireResistance } from '../checks/tables';
import type { Simulator } from '../simulator';
import type { Device } from '../project/types';
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
    if (s.role !== 'phase' || !reach.has(`${s.device.id}:phase`)) continue;
    const n = topo.seeds.find((x) => x.device.id === s.device.id && x.role === 'neutral');
    if (n && topo.reach[neutralPin]?.has(`${s.device.id}:neutral`)) return { phase: s, neutral: n };
  }
  return null;
}

export function runtimeDiagnostics(sim: Simulator, topo: Topology = buildTopology(sim.project, sim.registry)): Diagnostic[] {
  const out: Diagnostic[] = [];
  const P = sim.project;
  const view = sim.view();
  const fmt = sim.fmt;
  const name = (id: string) => P.devices.find((d) => d.id === id)?.name ?? id;
  const ctx = { sol: view, project: P, fmt };

  for (const d of P.devices) {
    const def = sim.registry.get(d.type);
    if (!def) continue;
    if (def.diagnose) out.push(...def.diagnose(d, ctx, sim.rt(d)));

    // Queda de tensão desde a origem da instalação.
    if (def.load) {
      const { phase, neutral } = def.load;
      const Vn = def.load.nominalVoltage(d);
      const V = rms(view.vv(d, phase, neutral));
      if (V < 0.5 * Vn) continue;
      const pPin = topo.pin(d.id, phase);
      const nPin = topo.pin(d.id, neutral);
      const src = feedingSource(topo, pPin, nPin);
      if (!src) continue;
      const Vsrc = rms(view.vv(src.phase.device, src.phase.terminal, src.neutral.terminal));
      const drop = (100 * (Vsrc - V)) / Vn;
      const limit = def.load.lighting ? IEC_RULES.maxDropLighting : IEC_RULES.maxDropOther;
      if (drop > limit) {
        const path = [
          ...(findPath(topo, pPin, new Set([src.phase.pin]), true) ?? []),
          ...(findPath(topo, nPin, new Set([src.neutral.pin]), true) ?? []),
        ];
        const w = worstWire(sim, path);
        const targets = [dev(d.id), ...(w ? [wire(w.id)] : [])];
        out.push(
          diag('VOLTAGE_DROP', 'warning', targets, {
            device: d.name,
            drop: fmt(drop, '%'),
            limit: fmt(limit, '%'),
            section: w ? fmt(w.section, 'mm²') : '—',
            length: w ? fmt(w.length, 'm') : '—',
          }, w?.id ?? d.id),
        );
      }
    }
  }

  for (const w of P.wires) {
    if (w.fault?.cut) continue;
    const I = rms(view.iWire(w.id));
    const iz = ampacity(w);
    if (I > iz * 1.001) {
      out.push(
        diag('CABLE_OVERLOAD', 'warning', [wire(w.id)], {
          from: name(w.a.device),
          to: name(w.b.device),
          current: fmt(I, 'A'),
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

  if (sim.unstable) out.push(diag('CONTROL_UNSTABLE', 'error', [], {}));
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
export function whyNotWorking(sim: Simulator, idOrName: string): Diagnostic {
  const d = sim.device(idOrName);
  if (!d) throw new Error(`Equipamento inexistente: ${idOrName}`);
  const def = sim.registry.require(d.type);
  if (!def.load) return diag('NOT_A_LOAD', 'info', [dev(d.id)], { device: d.name });
  const P = sim.project;
  const view = sim.view();
  const fmt = sim.fmt;
  const ctx = { sol: view, project: P, fmt };
  const { phase, neutral } = def.load;

  // O próprio equipamento avariado (lâmpada fundida…).
  const own = def.diagnose?.(d, ctx, sim.rt(d)) ?? [];
  if (own.length) return own[0]!;
  if (def.load.working?.(d, view, sim.rt(d))) return diag('LOAD_OK', 'info', [dev(d.id)], { device: d.name });

  const topo = buildTopology(P, sim.registry);
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
        return diag('WIRE_CUT', 'error', [wire(w.id), dev(d.id)], { device: d.name, from: P.devices.find((x) => x.id === w.a.device)?.name ?? '', to: P.devices.find((x) => x.id === w.b.device)?.name ?? '' }, w.id);
      }
      const blocker = P.devices.find((x) => x.id === e.id)!;
      const bdef = sim.registry.require(blocker.type);
      const bd = bdef.diagnose?.(blocker, ctx, sim.rt(blocker)) ?? [];
      if (bd.length) return { ...bd[0]!, targets: [...bd[0]!.targets, dev(d.id)] };
      return diag('PATH_OPEN', 'error', [dev(blocker.id), dev(d.id)], { device: d.name, blocker: blocker.name }, blocker.id);
    }
    return null;
  };

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
