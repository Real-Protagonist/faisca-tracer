/**
 * Protocolo do Web Worker de simulação. `createWorkerHandler` é puro (sem `self`), para ser
 * testado em Node; o ficheiro de arranque do worker na aplicação só liga as mensagens.
 */
import { Simulator } from './simulator';
import { allDiagnostics, whyNotWorking, type Diagnostic } from './diagnostics';
import { buildNetwork } from './solver/network';
import { solveNetwork } from './solver/mna';
import { rms } from './solver/complex';
import type { Measurement } from './devices/types';
import type { Device, Project, WireEnd } from './project/types';
import type { SimEvent } from './simulator';

export interface Probes {
  red: WireEnd | null;
  black: WireEnd | null;
  /** Cabo abraçado pela pinça amperimétrica. */
  clamp: string | null;
}

export type WorkerRequest =
  | { type: 'load'; project: Project }
  | { type: 'step'; dt: number }
  | { type: 'operate'; device: string; action: string; phase?: 'down' | 'up' }
  | { type: 'whyNot'; device: string }
  | { type: 'probes'; probes: Probes }
  | { type: 'matrix' }
  | { type: 'reset' };

export interface WorkerSnapshot {
  type: 'snapshot';
  t: number;
  devices: Pick<Device, 'id' | 'state'>[];
  measurements: Record<string, Measurement[]>;
  /** Corrente eficaz em cada cabo, com sinal (+ de a para b). */
  wires: Record<string, number>;
  diagnostics: Diagnostic[];
  events: SimEvent[];
  probe: { voltage: number | null; ac: boolean; current: number | null };
  stats: Simulator['stats'];
}

export interface MatrixResult {
  type: 'matrix';
  labels: string[];
  /** Linhas da matriz [A | b] em AC (parte real e imaginária); null se não houver AC. */
  n: number;
  re: number[];
  im: number[];
  bre: number[];
  bim: number[];
}

export type WorkerResponse =
  | WorkerSnapshot
  | { type: 'whyNot'; device: string; diagnostic: Diagnostic }
  | MatrixResult
  | { type: 'error'; message: string };

export function createWorkerHandler(post: (m: WorkerResponse) => void) {
  let sim: Simulator | null = null;
  let project: Project | null = null;
  let lastSeq = 0;
  let probes: Probes = { red: null, black: null, clamp: null };
  const snapshot = (): WorkerSnapshot => {
    const s = sim!;
    const events = s.events.filter((e) => e.seq > lastSeq);
    if (events.length) lastSeq = events[events.length - 1]!.seq;
    const measurements: Record<string, Measurement[]> = {};
    for (const d of s.project.devices) measurements[d.id] = s.measurements(d.id);
    const view = s.view();
    const wires: Record<string, number> = {};
    for (const w of s.project.wires) {
      const q = view.iWire(w.id);
      const sign = (Math.abs(q.ac.re) >= Math.abs(q.dc) ? q.ac.re : q.dc) < 0 ? -1 : 1;
      wires[w.id] = sign * rms(q);
    }
    const has = (e: WireEnd | null) => !!e && s.project.devices.some((d) => d.id === e.device);
    const voltage = has(probes.red) && has(probes.black) ? s.voltage(probes.red!, probes.black!) : null;
    const current = probes.clamp && s.project.wires.some((w) => w.id === probes.clamp) ? rms(view.iWire(probes.clamp)) : null;
    return {
      type: 'snapshot',
      t: s.t,
      devices: s.project.devices.map((d) => ({ id: d.id, state: d.state })),
      measurements,
      wires,
      diagnostics: allDiagnostics(s),
      events,
      probe: { voltage, ac: view.hasAC, current },
      stats: s.stats,
    };
  };
  return (msg: WorkerRequest) => {
    try {
      switch (msg.type) {
        case 'load':
          project = msg.project;
          if (sim) sim.setProject(msg.project);
          else sim = new Simulator(msg.project);
          sim.step(0);
          post(snapshot());
          break;
        case 'reset':
          if (project) {
            sim = new Simulator(project);
            lastSeq = 0;
            sim.step(0);
            post(snapshot());
          }
          break;
        case 'step':
          if (!sim) return;
          sim.step(msg.dt);
          post(snapshot());
          break;
        case 'operate':
          if (!sim) return;
          sim.operate(msg.device, msg.action, msg.phase);
          post(snapshot());
          break;
        case 'probes':
          probes = msg.probes;
          if (sim) post(snapshot());
          break;
        case 'whyNot':
          if (!sim) return;
          post({ type: 'whyNot', device: msg.device, diagnostic: whyNotWorking(sim, msg.device) });
          break;
        case 'matrix': {
          if (!sim) return;
          const net = buildNetwork(sim.project, sim.registry, (d) => sim!.rt(d));
          const sol = solveNetwork(net, true);
          const m = sol.ac?.matrix ?? sol.dc?.matrix;
          if (!m) return;
          const labels = [...net.nodeLabels.slice(1)];
          while (labels.length < m.n) labels.push(`I${labels.length - net.nodeLabels.length + 2}`);
          post({ type: 'matrix', labels, n: m.n, re: [...m.re], im: [...m.im], bre: [...m.bre], bim: [...m.bim] });
          break;
        }
      }
    } catch (e) {
      post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };
}
