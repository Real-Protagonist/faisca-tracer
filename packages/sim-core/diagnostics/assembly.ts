/** Diagnóstico ao montar (análise do esquema, sem simular). */
import { ampacity, MCB_RATINGS, SECTIONS } from '../checks/tables';
import type { Registry } from '../devices/registry';
import type { Project } from '../project/types';
import { diag, dev, wire, type Diagnostic } from './types';
import { buildTopology, findPath, type Topology } from './topology';

type Fmt = (v: number, unit: string) => string;

export function assemblyDiagnostics(P: Project, registry: Registry, fmt: Fmt, topo: Topology = buildTopology(P, registry)): Diagnostic[] {
  const out: Diagnostic[] = [];
  const name = (id: string) => P.devices.find((d) => d.id === id)?.name ?? id;

  // Fonte em curto: a fase chega ao neutro da mesma fonte só por cabos e contactos fechados.
  for (const s of topo.seeds) {
    if (s.role !== 'phase') continue;
    const neutral = topo.seeds.find((x) => x.device.id === s.device.id && x.role === 'neutral');
    if (!neutral) continue;
    // As protecções contam como fechadas: abrem precisamente por causa do curto.
    const protective = (e: { kind: string; id: string }) => {
      if (e.kind !== 'contact') return false;
      const d = P.devices.find((x) => x.id === e.id);
      return !!d && !!registry.get(d.type)?.forceClosed;
    };
    const path = findPath(topo, s.pin, new Set([neutral.pin]), true, protective);
    if (path) {
      const wires = path.filter((e) => e.kind === 'wire').map((e) => wire(e.id));
      out.push(diag('SOURCE_SHORT', 'error', [dev(s.device.id), ...wires], { device: s.device.name }, s.device.id));
    }
  }

  for (const d of P.devices) {
    const def = registry.get(d.type);
    if (!def) continue;

    // Cargas: terminais livres e caminho de retorno.
    if (def.load) {
      const { phase, neutral } = def.load;
      const pPin = topo.pin(d.id, phase);
      const nPin = topo.pin(d.id, neutral);
      const pWired = topo.wired(d.id, phase);
      const nWired = topo.wired(d.id, neutral);
      const phaseOk = pPin >= 0 && topo.roles[pPin]!.has('phase');
      const neutralOk = nPin >= 0 && topo.roles[nPin]!.has('neutral');
      if (phaseOk && !neutralOk) {
        out.push(diag('LOAD_NO_RETURN', 'error', [dev(d.id)], { device: d.name, terminal: neutral }, d.id));
      } else {
        if (!pWired) out.push(diag('TERMINAL_UNCONNECTED', 'warning', [dev(d.id)], { device: d.name, terminal: phase }, d.id));
        if (!nWired) out.push(diag('TERMINAL_UNCONNECTED', 'warning', [dev(d.id)], { device: d.name, terminal: neutral }, d.id));
      }
    }

    // Interruptor unipolar no neutro.
    if (def.phaseOnlySwitch && def.conducts) {
      const pins = new Set<number>();
      for (const c of def.conducts(d)) {
        pins.add(topo.pin(d.id, c.a));
        pins.add(topo.pin(d.id, c.b));
      }
      const roles = [...pins].filter((p) => p >= 0).map((p) => topo.roles[p]!);
      if (roles.some((r) => r.has('neutral')) && !roles.some((r) => r.has('phase'))) {
        out.push(diag('SWITCH_ON_NEUTRAL', 'warning', [dev(d.id)], { device: d.name }, d.id));
      }
    }

    // Massa de classe I sem terra.
    if (def.classI) {
      const pin = topo.pin(d.id, 'PE');
      if (pin < 0 || !topo.roles[pin]!.has('pe')) out.push(diag('PE_MISSING', 'warning', [dev(d.id)], { device: d.name }, d.id));
    }

    // Cabos a jusante de cada protecção: In ≤ Iz.
    if (def.protection) {
      const In = def.protection.ratedCurrent(d);
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
            // Outra protecção a jusante protege o seu próprio troço.
            if (e.id === d.id || (other && registry.get(other.type)?.protection)) continue;
          } else if (!seen.has(e.id)) {
            seen.add(e.id);
            const w = P.wires.find((x) => x.id === e.id)!;
            const iz = ampacity(w);
            if (In > iz) {
              const next = SECTIONS.find((s) => ampacity({ ...w, section: s }) >= In) ?? SECTIONS[SECTIONS.length - 1]!;
              const lower = [...MCB_RATINGS].reverse().find((r) => r <= iz) ?? MCB_RATINGS[0];
              out.push(
                diag('CABLE_UNPROTECTED', 'warning', [dev(d.id), wire(w.id)], {
                  device: d.name,
                  from: name(w.a.device),
                  to: name(w.b.device),
                  rated: fmt(In, 'A'),
                  section: fmt(w.section, 'mm²'),
                  iz: fmt(iz, 'A'),
                  nextSection: fmt(next, 'mm²'),
                  lowerRating: fmt(lower, 'A'),
                }, w.id),
              );
            }
          }
          if (!visited.has(o)) {
            visited.add(o);
            queue.push(o);
          }
        }
      }
    }
  }

  // Cor do condutor de acordo com a classe do circuito.
  for (const w of P.wires) {
    if (w.conductor === 'C' || w.conductor === 'DC+' || w.conductor === 'DC-') continue;
    const pa = topo.pin(w.a.device, w.a.terminal);
    const pb = topo.pin(w.b.device, w.b.terminal);
    if (pa < 0 || pb < 0) continue;
    const roles = topo.roles[pa]!;
    if (roles.size !== 1) continue;
    const role = [...roles][0]!;
    const isPhase = w.conductor === 'L1' || w.conductor === 'L2' || w.conductor === 'L3';
    let expected: string | null = null;
    if (role === 'pe' && w.conductor !== 'PE') expected = 'PE';
    else if (role === 'neutral' && w.conductor !== 'N') expected = 'N';
    else if (role === 'phase' && !isPhase) expected = 'L1';
    if (expected) {
      out.push(diag('WIRE_COLOR', 'warning', [wire(w.id)], { from: name(w.a.device), to: name(w.b.device), expected, actual: w.conductor }, w.id));
    }
  }
  return out;
}
