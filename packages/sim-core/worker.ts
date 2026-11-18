/**
 * Protocolo do Web Worker de simulação. `createWorkerHandler` é puro (sem `self`), para ser
 * testado em Node; o ficheiro de arranque do worker na aplicação só liga as mensagens.
 */
import { Simulator } from './simulator';
import { allDiagnostics, whyNotWorking, type Diagnostic } from './diagnostics';
import type { Measurement } from './devices/types';
import type { Device, Project } from './project/types';
import type { SimEvent } from './simulator';

export type WorkerRequest =
  | { type: 'load'; project: Project }
  | { type: 'step'; dt: number }
  | { type: 'operate'; device: string; action: string; phase?: 'down' | 'up' }
  | { type: 'whyNot'; device: string }
  | { type: 'reset' };

export interface WorkerSnapshot {
  type: 'snapshot';
  t: number;
  devices: Pick<Device, 'id' | 'state'>[];
  measurements: Record<string, Measurement[]>;
  diagnostics: Diagnostic[];
  events: SimEvent[];
  stats: Simulator['stats'];
}

export type WorkerResponse = WorkerSnapshot | { type: 'whyNot'; device: string; diagnostic: Diagnostic } | { type: 'error'; message: string };

export function createWorkerHandler(post: (m: WorkerResponse) => void) {
  let sim: Simulator | null = null;
  let project: Project | null = null;
  let lastSeq = 0;
  const snapshot = (): WorkerSnapshot => {
    const s = sim!;
    const events = s.events.filter((e) => e.seq > lastSeq);
    if (events.length) lastSeq = events[events.length - 1]!.seq;
    const measurements: Record<string, Measurement[]> = {};
    for (const d of s.project.devices) measurements[d.id] = s.measurements(d.id);
    return {
      type: 'snapshot',
      t: s.t,
      devices: s.project.devices.map((d) => ({ id: d.id, state: d.state })),
      measurements,
      diagnostics: allDiagnostics(s),
      events,
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
        case 'whyNot':
          if (!sim) return;
          post({ type: 'whyNot', device: msg.device, diagnostic: whyNotWorking(sim, msg.device) });
          break;
      }
    } catch (e) {
      post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };
}
