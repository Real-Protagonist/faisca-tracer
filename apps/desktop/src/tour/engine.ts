/** Motor do tour: avalia as condições dos passos (JSON) e executa «Mostrar-me». */
import { lookFrom, type Diagnostic, type Project, type WireEnd } from '@faisca/sim-core';
import type { Condition, ShowMe, TermRef, TourStep } from '@faisca/content';
import { connect, operate, placeDevice, setFlag, setProbes, ui, updateDevice, updateWire, type AppState } from '../store';

export interface TourContext {
  project: Project;
  snapshot: AppState['snapshot'];
  probes: AppState['probes'];
  tab: AppState['tab'];
  flags: string[];
  events: AppState['events'];
  /** Eventos anteriores ao início do passo não contam. */
  sinceSeq: number;
  /** O utilizador carregou em «Seguinte». */
  next: boolean;
}

const first = (P: Project, type: string) => P.devices.find((d) => d.type === type);

function hasWire(P: Project, a: WireEnd, b: WireEnd, conductor?: string) {
  return P.wires.some((w) => {
    const same = (x: WireEnd, y: WireEnd) => x.device === y.device && x.terminal === y.terminal;
    return ((same(w.a, a) && same(w.b, b)) || (same(w.a, b) && same(w.b, a))) && (!conductor || w.conductor === conductor);
  });
}

/** Cabo entre dois terminais (em qualquer sentido). */
function findWire(P: Project, a: WireEnd, b: WireEnd) {
  const same = (x: WireEnd, y: WireEnd) => x.device === y.device && x.terminal === y.terminal;
  return P.wires.find((w) => (same(w.a, a) && same(w.b, b)) || (same(w.a, b) && same(w.b, a)));
}

/** Terminais ligados por cabo a (device, terminal). */
const neighbours = (P: Project, e: WireEnd) =>
  P.wires.flatMap((w) => (w.a.device === e.device && w.a.terminal === e.terminal ? [w.b] : w.b.device === e.device && w.b.terminal === e.terminal ? [w.a] : []));

function chainOk(P: Project, chain: TermRef[]): boolean {
  // Começa no terminal do primeiro elemento e atravessa cada elemento intermédio entrando por um terminal e saindo por outro.
  const d0 = first(P, chain[0]!.type);
  if (!d0 || !chain[0]!.terminal) return false;
  let fronts: WireEnd[] = [{ device: d0.id, terminal: chain[0]!.terminal }];
  for (let i = 1; i < chain.length; i++) {
    const ref = chain[i]!;
    const last = i === chain.length - 1;
    const next: WireEnd[] = [];
    for (const f of fronts)
      for (const n of neighbours(P, f)) {
        const d = P.devices.find((x) => x.id === n.device);
        if (!d || d.type !== ref.type) continue;
        if (last) {
          if (!ref.terminal || n.terminal === ref.terminal) return true;
          continue;
        }
        // Sai pelos outros terminais do mesmo aparelho.
        for (const w of P.wires) for (const end of [w.a, w.b]) if (end.device === d.id && end.terminal !== n.terminal) next.push(end);
      }
    fronts = next;
  }
  return false;
}

export function evaluate(c: Condition, ctx: TourContext): boolean {
  const P = ctx.project;
  switch (c.type) {
    case 'next':
      return ctx.next;
    case 'deviceExists':
      return !!first(P, c.params.type);
    case 'wire': {
      const a = first(P, c.params.a.type);
      const b = first(P, c.params.b.type);
      return !!a && !!b && hasWire(P, { device: a.id, terminal: c.params.a.terminal! }, { device: b.id, terminal: c.params.b.terminal! }, c.params.conductor);
    }
    case 'chain':
      return chainOk(P, c.params.chain);
    case 'loadState': {
      const d = first(P, c.params.type);
      return !!d && lookFrom(ctx.snapshot?.measurements[d.id] ?? []).state === c.params.state;
    }
    case 'probe': {
      const d = first(P, c.params.type);
      const { red, black } = ctx.probes;
      const v = ctx.snapshot?.probe.voltage;
      if (!d || !red || !black || v == null) return false;
      const on = red.device === d.id && black.device === d.id && red.terminal !== black.terminal;
      return on && v >= c.params.min && v <= c.params.max;
    }
    case 'tab':
      return ctx.tab === c.params.tab;
    case 'event':
      return ctx.events.some((e) => e.seq > ctx.sinceSeq && e.code === c.params.code);
    case 'flag':
      return ctx.flags.includes(c.params.flag);
    case 'deviceState':
      return P.devices.filter((d) => d.type === c.params.type).every((d) => d.state[c.params.key] === c.params.value);
    case 'param': {
      const d = first(P, c.params.type);
      const v = Number(d?.params[c.params.key]);
      return !!d && v >= c.params.min && v <= c.params.max;
    }
    case 'diag':
      return (ctx.snapshot?.diagnostics ?? []).some((d) => d.code === c.params.code) === c.params.present;
    case 'wireCut': {
      const a = first(P, c.params.a.type);
      const b = first(P, c.params.b.type);
      const w = a && b && findWire(P, { device: a.id, terminal: c.params.a.terminal! }, { device: b.id, terminal: c.params.b.terminal! });
      return !!w && !!w.fault?.cut === c.params.cut;
    }
    case 'all':
      return c.params.conditions.every((x) => evaluate(x, ctx));
  }
}

/** Primeiro diagnóstico que o passo considera um erro do utilizador. */
export function mistake(step: TourStep, diagnostics: Diagnostic[]): Diagnostic | null {
  if (!step.mistakes?.length) return null;
  return diagnostics.find((d) => step.mistakes!.includes(d.code)) ?? null;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Faz o passo pelo utilizador. */
export async function showMe(a: ShowMe, getProject: () => Project): Promise<void> {
  const end = (r: TermRef): WireEnd | null => {
    const d = first(getProject(), r.type);
    return d && r.terminal ? { device: d.id, terminal: r.terminal } : null;
  };
  switch (a.type) {
    case 'place':
      if (!first(getProject(), a.params.type)) placeDevice(a.params.type, { x: a.params.x, y: a.params.y });
      break;
    case 'wire': {
      const x = end(a.params.a);
      const y = end(a.params.b);
      if (x && y) connect(x, y);
      break;
    }
    case 'operate': {
      const d = first(getProject(), a.params.type);
      if (d) operate(d.id, a.params.action);
      break;
    }
    case 'probe': {
      const d = first(getProject(), a.params.type);
      if (!d) break;
      ui.setTool('probe');
      setProbes({ red: { device: d.id, terminal: 'L' }, black: { device: d.id, terminal: 'N' } });
      break;
    }
    case 'tab':
      ui.setTab(a.params.tab);
      break;
    case 'flag':
      setFlag(a.params.flag);
      break;
    case 'press': {
      const d = first(getProject(), a.params.type);
      if (!d) break;
      operate(d.id, 'press', 'down');
      await wait(600);
      operate(d.id, 'press', 'up');
      break;
    }
    case 'param': {
      const d = first(getProject(), a.params.type);
      if (d) updateDevice(d.id, (x) => (x.params[a.params.key] = a.params.value));
      break;
    }
    case 'wireCut': {
      const x = end(a.params.a);
      const y = end(a.params.b);
      const w = x && y && findWire(getProject(), x, y);
      if (w) updateWire(w.id, (z) => (z.fault = { ...z.fault, cut: a.params.cut }));
      break;
    }
    case 'sequence':
      for (const x of a.params.actions) {
        await showMe(x, getProject);
        // Dá tempo ao simulador para responder antes da acção seguinte.
        await wait(250);
      }
      break;
  }
}
