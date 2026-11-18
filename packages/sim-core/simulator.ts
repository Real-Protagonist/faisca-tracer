/**
 * Simulação no tempo. Em cada passo:
 *  1. resolver o circuito;
 *  2. correr a lógica de cada equipamento (protecções, bobinas, temporizadores, motores);
 *  3. se algum estado discreto mudou, resolver outra vez sem avançar o tempo
 *     (máximo 12 iterações; senão, «comando instável»);
 *  4. medições e diagnóstico (calculados a pedido sobre o último resultado).
 */
import { defaultRegistry, type Registry } from './devices';
import { buildNetwork, makeView, type BuiltNetwork, type ExtraStamp } from './solver/network';
import { solveNetwork, type NetworkSolution } from './solver/mna';
import { rms } from './solver/complex';
import { formatter } from './format';
import type { Device, Project, WireEnd } from './project/types';
import type { LogicContext, Measurement, OperateCause, SolutionView } from './devices/types';
import type { Severity } from './diagnostics/types';

export const MAX_ITERATIONS = 12;
/** Constante térmica dos cabos (s): a sobrecarga conta pela corrente eficaz equivalente, não pelo pico de arranque. */
export const CABLE_THERMAL_TAU = 60;

export interface SimEvent {
  seq: number;
  /** Tempo de simulação (s). */
  t: number;
  deviceId: string | null;
  /** Chave de tradução: `event.<code>`. */
  code: string;
  severity: Severity;
  values: Record<string, string>;
}

export interface SimOptions {
  registry?: Registry;
  /** Passo máximo (s). Passos maiores são subdivididos. Por omissão 0,05 s. */
  maxStep?: number;
  /** Guardar a matriz MNA (ensino, perfil Profissional). */
  captureMatrix?: boolean;
}

export interface SolveResult {
  net: BuiltNetwork;
  sol: NetworkSolution;
  view: SolutionView;
}

const now = (): number => (globalThis as { performance?: { now(): number } }).performance?.now() ?? Date.now();

export class Simulator {
  project: Project;
  readonly registry: Registry;
  t = 0;
  events: SimEvent[] = [];
  /** O comando não estabilizou no último passo. */
  unstable = false;
  /** Equipamentos que continuavam a mudar de estado quando o comando não estabilizou. */
  unstableDevices: string[] = [];
  /** Comando em execução (para a lógica saber o que provocou a mudança). */
  private cause: OperateCause | null = null;
  /** Duração do último passo (ms) e dimensão do sistema. */
  stats = { solveMs: 0, nodes: 0, elements: 0, iterations: 0 };
  last: SolveResult | null = null;
  private runtimes = new Map<string, object>();
  /** Quadrado da corrente térmica equivalente de cada cabo (A²). */
  private wireHeat = new Map<string, number>();
  private seq = 0;
  /** Eventos já emitidos no passo actual, por equipamento e código (evita repetições ao estabilizar). */
  private stepEvents = new Map<string, number>();
  private lastUnstableEvent = -Infinity;
  private readonly maxStep: number;
  private readonly capture: boolean;
  onEvent?: (e: SimEvent) => void;

  constructor(project: Project, o: SimOptions = {}) {
    this.project = structuredClone(project);
    this.registry = o.registry ?? defaultRegistry;
    this.maxStep = o.maxStep ?? 0.05;
    this.capture = !!o.captureMatrix;
  }

  /** Estado transitório de um equipamento (aquecimento térmico, temporizações…). */
  rt(d: Device | string): Record<string, any> {
    const id = typeof d === 'string' ? d : d.id;
    let r = this.runtimes.get(id);
    if (!r) {
      r = {};
      this.runtimes.set(id, r);
    }
    return r as Record<string, any>;
  }

  /** Corrente térmica equivalente de um cabo (A): média quadrática com constante de 60 s. */
  wireThermalCurrent(id: string): number {
    const h = this.wireHeat.get(id);
    return h === undefined ? rms(this.view().iWire(id)) : Math.sqrt(h);
  }

  device(idOrName: string): Device | undefined {
    return this.project.devices.find((d) => d.id === idOrName) ?? this.project.devices.find((d) => d.name === idOrName);
  }

  get fmt() {
    return formatter(this.project.lang);
  }

  /** Substitui o projecto (edição no editor), mantendo o estado transitório dos equipamentos que continuam. */
  setProject(P: Project): void {
    this.project = structuredClone(P);
    const ids = new Set(P.devices.map((d) => d.id));
    for (const id of [...this.runtimes.keys()]) if (!ids.has(id)) this.runtimes.delete(id);
    const wids = new Set(P.wires.map((w) => w.id));
    for (const id of [...this.wireHeat.keys()]) if (!wids.has(id)) this.wireHeat.delete(id);
    this.last = null;
  }

  solve(extra?: (b: ExtraStamp) => void): SolveResult {
    const net = buildNetwork(this.project, this.registry, (d) => this.rt(d), extra);
    const sol = solveNetwork(net, this.capture);
    return { net, sol, view: makeView(net, sol) };
  }

  /** Avança `dt` segundos (subdivididos em passos ≤ maxStep). */
  step(dt = 0.02): SolveResult {
    let left = dt;
    let r: SolveResult | null = null;
    do {
      const h = Math.min(left, this.maxStep);
      r = this.stepOnce(h);
      left -= h;
    } while (left > 1e-12);
    return r;
  }

  /** Corre durante `seconds` segundos. Pára mais cedo se `until` devolver true. */
  run(seconds: number, dt = this.maxStep, until?: (s: Simulator) => boolean): SolveResult {
    const end = this.t + seconds - 1e-12;
    let r = this.last ?? this.stepOnce(0);
    while (this.t < end) {
      r = this.step(Math.min(dt, end - this.t + 1e-12));
      if (until?.(this)) break;
    }
    return r;
  }

  private stepOnce(dt: number): SolveResult {
    const t0 = now();
    this.stepEvents.clear();
    let r!: SolveResult;
    let changed = false;
    let it = 0;
    let moving: Device[] = [];
    for (; it < MAX_ITERATIONS; it++) {
      r = this.solve();
      changed = false;
      moving = [];
      const ctx = this.logicContext(r.view, it === 0 ? dt : 0);
      for (const d of this.project.devices) {
        const def = this.registry.get(d.type);
        if (!def?.logic) continue;
        ctx.current = d;
        if (def.logic(d, ctx, this.rt(d))) {
          changed = true;
          moving.push(d);
        }
      }
      if (!changed) break;
    }
    if (changed) {
      // Não estabilizou: o último estado fica, sem nova solução coerente.
      r = this.solve();
      if (!this.unstable || this.t - this.lastUnstableEvent > 2) {
        this.lastUnstableEvent = this.t;
        const first = moving[0];
        this.pushEvent(first ?? null, { code: 'control_unstable', severity: 'error', values: { device: first?.name ?? '' } });
      }
    }
    this.unstable = changed;
    this.unstableDevices = changed ? moving.map((d) => d.id) : [];
    const k = 1 - Math.exp(-dt / CABLE_THERMAL_TAU);
    for (const w of this.project.wires) {
      const I2 = rms(r.view.iWire(w.id)) ** 2;
      const prev = this.wireHeat.get(w.id);
      this.wireHeat.set(w.id, prev === undefined ? I2 : prev + (I2 - prev) * k);
    }
    this.t += dt;
    this.last = r;
    this.stats = {
      solveMs: now() - t0,
      nodes: r.net.nodeCount,
      elements: r.net.elements.length,
      iterations: Math.min(it + 1, MAX_ITERATIONS),
    };
    return r;
  }

  private logicContext(sol: SolutionView, dt: number): LogicContext & { current: Device | null } {
    const self = this;
    const ctx = {
      sol,
      dt,
      t: this.t,
      project: this.project,
      current: null as Device | null,
      emit(e: { code: string; severity: Severity; values?: Record<string, string> }) {
        self.pushEvent(ctx.current, { ...e, values: e.values ?? {} });
      },
      fmt: this.fmt,
      device: (id: string) => self.project.devices.find((d) => d.id === id),
      leakages: () => self.leakages(sol),
      cause: this.cause,
    };
    return ctx;
  }

  private pushEvent(d: Device | null, e: { code: string; severity: Severity; values: Record<string, string> }) {
    const k = `${d?.id ?? ''}:${e.code}`;
    const n = (this.stepEvents.get(k) ?? 0) + 1;
    this.stepEvents.set(k, n);
    if (n > 2) return;
    const ev: SimEvent = { seq: ++this.seq, t: this.t, deviceId: d ? d.id : null, ...e };
    this.events.push(ev);
    if (this.events.length > 500) this.events.shift();
    this.onEvent?.(ev);
  }

  leakages(sol: SolutionView = this.view()): { device: Device; current: number }[] {
    const out: { device: Device; current: number }[] = [];
    for (const d of this.project.devices) {
      const def = this.registry.get(d.type);
      if (!def?.leakage) continue;
      const I = def.leakage(d, sol);
      if (I > 1e-6) out.push({ device: d, current: I });
    }
    return out;
  }

  /** Resultados do último passo (resolve agora se ainda não houver). */
  view(): SolutionView {
    if (!this.last) this.last = this.solve();
    return this.last.view;
  }

  measurements(idOrName: string): Measurement[] {
    const d = this.device(idOrName);
    if (!d) return [];
    const def = this.registry.get(d.type);
    if (!def?.measure) return [];
    return def.measure(d, this.view(), this.rt(d), { fmt: this.fmt });
  }

  /** Valor numérico de uma medição (para testes e exercícios). */
  measure(idOrName: string, key: string): number {
    const m = this.measurements(idOrName).find((x) => x.key === key);
    if (!m || typeof m.value !== 'number') return NaN;
    return m.value;
  }

  /** Executa um comando (ligar, rearmar, premir…) e estabiliza o circuito sem avançar o tempo. */
  operate(idOrName: string, action: string, phase?: 'down' | 'up'): boolean {
    const d = this.device(idOrName);
    if (!d) return false;
    const def = this.registry.get(d.type);
    if (!def?.operate) return false;
    const ok = def.operate(d, action, this.rt(d), phase);
    if (ok) {
      this.cause = { deviceId: d.id, action, phase };
      try {
        this.stepOnce(0);
      } finally {
        this.cause = null;
      }
    }
    return ok;
  }

  /** Tensão entre dois terminais quaisquer (pontas do multímetro). */
  voltage(a: WireEnd, b: WireEnd | 'earth'): number {
    const v = this.view();
    const va = v.vAt(a.device, a.terminal);
    if (b === 'earth') return rms(va);
    const vb = v.vAt(b.device, b.terminal);
    return rms({ ac: { re: va.ac.re - vb.ac.re, im: va.ac.im - vb.ac.im }, dc: va.dc - vb.dc });
  }

  /**
   * Corrente de curto-circuito presumida entre dois pontos (ou para a terra), com todas as
   * protecções fechadas e sem cargas alteradas. Não muda o estado da simulação.
   */
  prospectiveCurrent(a: WireEnd, b: WireEnd | 'earth', faultResistance = 1e-3): number {
    const saved = this.project.devices.map((d) => structuredClone(d.state));
    try {
      for (const d of this.project.devices) this.registry.get(d.type)?.forceClosed?.(d);
      const r = this.solve((x) => {
        const na = x.node(a.device, a.terminal);
        const nb = b === 'earth' ? 0 : x.node(b.device, b.terminal);
        x.R(na, nb, faultResistance, 'sc');
      });
      return rms(r.view.i({ id: 'extra' } as Device, 'sc'));
    } finally {
      this.project.devices.forEach((d, i) => (d.state = saved[i]!));
    }
  }

  /** Matriz MNA do último passo (requer `captureMatrix`). */
  matrix() {
    const s = this.last?.sol;
    return { ac: s?.ac?.matrix ?? null, dc: s?.dc?.matrix ?? null, labels: this.last?.net.nodeLabels ?? [] };
  }
}
