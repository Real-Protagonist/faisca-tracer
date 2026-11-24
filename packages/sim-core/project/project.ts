/** Criar e editar projectos; abrir e guardar `.faisca` com migrações entre versões. */
import { defaultRegistry, type Registry } from '../devices';
import type { TerminalKind } from '../devices/types';
import {
  PROJECT_VERSION,
  type Conductor,
  type Device,
  type Domain,
  type Frequency,
  type Lang,
  type Level,
  type ParamValue,
  type Project,
  type Wire,
} from './types';

export interface NewProjectOptions {
  domain?: Domain;
  level?: Level;
  lang?: Lang;
  frequency?: Frequency;
  name?: string;
}

export function createProject(o: NewProjectOptions = {}): Project {
  return {
    app: 'faisca',
    version: PROJECT_VERSION,
    domain: o.domain ?? 'domestic',
    level: o.level ?? 'beginner',
    lang: o.lang ?? 'pt',
    frequency: o.frequency ?? 50,
    devices: [],
    wires: [],
    name: o.name,
    seq: 1,
  };
}

const nextId = (P: Project, prefix: string) => {
  P.seq ??= 1;
  let id: string;
  do id = prefix + P.seq++;
  while (P.devices.some((d) => d.id === id) || P.wires.some((w) => w.id === id));
  return id;
};

/** Próxima designação IEC 81346 livre para o prefixo do tipo (Q1, Q2…). */
export function autoName(P: Project, type: string, registry: Registry = defaultRegistry): string {
  const pre = registry.require(type).prefix;
  const re = new RegExp('^' + pre + '(\\d+)$');
  let max = 0;
  for (const d of P.devices) {
    const m = re.exec(d.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return pre + (max + 1);
}

export interface AddOptions {
  x?: number;
  y?: number;
  rot?: number;
  name?: string;
  params?: Record<string, ParamValue>;
  state?: Record<string, unknown>;
}

export function addDevice(P: Project, type: string, o: AddOptions = {}, registry: Registry = defaultRegistry): Device {
  const def = registry.require(type);
  const d: Device = {
    id: nextId(P, 'd'),
    type,
    name: o.name ?? autoName(P, type, registry),
    x: o.x ?? 0,
    y: o.y ?? 0,
    rot: o.rot ?? 0,
    params: { ...registry.defaults(type), ...(o.params ?? {}) },
    state: { ...def.initialState(), ...(o.state ?? {}) },
  };
  P.devices.push(d);
  return d;
}

const KIND_TO_CONDUCTOR: Partial<Record<TerminalKind, Conductor>> = {
  PE: 'PE',
  N: 'N',
  'DC-': 'DC-',
  'DC+': 'DC+',
  L1: 'L1',
  L2: 'L2',
  L3: 'L3',
  L: 'L1',
  C: 'C',
};
const PRIORITY: TerminalKind[] = ['PE', 'N', 'DC-', 'DC+', 'L1', 'L2', 'L3', 'L', 'C'];

/**
 * Condutor (cor) sugerido pelos tipos dos dois terminais. Entre dois terminais de passagem
 * (disjuntor, contactor…), segue o circuito pelos cabos e pólos até um terminal com tipo:
 * a saída de um disjuntor ligado a L2 dá um cabo preto.
 */
export function autoConductor(P: Project, a: { device: string; terminal: string }, b: { device: string; terminal: string }, registry: Registry = defaultRegistry): Conductor {
  const kindOf = (e: { device: string; terminal: string }) => {
    const d = P.devices.find((x) => x.id === e.device);
    return d ? registry.get(d.type)?.terminals.find((t) => t.id === e.terminal)?.kind : undefined;
  };
  const kinds = [a, b].map(kindOf);
  for (const k of PRIORITY) if (kinds.includes(k)) return KIND_TO_CONDUCTOR[k]!;
  return traceConductor(P, a, registry) ?? traceConductor(P, b, registry) ?? 'L1';
}

/** Procura em largura, pelos cabos e pelas ligações internas, o terminal com tipo mais próximo. */
function traceConductor(P: Project, start: { device: string; terminal: string }, registry: Registry): Conductor | null {
  const key = (e: { device: string; terminal: string }) => `${e.device}:${e.terminal}`;
  const seen = new Set<string>([key(start)]);
  const queue = [start];
  while (queue.length && seen.size < 400) {
    const e = queue.shift()!;
    const d = P.devices.find((x) => x.id === e.device);
    const def = d && registry.get(d.type);
    if (!d || !def) continue;
    const kind = def.terminals.find((t) => t.id === e.terminal)?.kind;
    if (kind && kind !== 'any') return KIND_TO_CONDUCTOR[kind] ?? null;
    const next: { device: string; terminal: string }[] = [];
    for (const g of def.shorts?.(d) ?? []) if (g.includes(e.terminal)) for (const t of g) next.push({ device: d.id, terminal: t });
    for (const c of def.conducts?.(d) ?? []) {
      if (c.a === e.terminal) next.push({ device: d.id, terminal: c.b });
      if (c.b === e.terminal) next.push({ device: d.id, terminal: c.a });
    }
    for (const w of P.wires) {
      if (w.a.device === e.device && w.a.terminal === e.terminal) next.push(w.b);
      if (w.b.device === e.device && w.b.terminal === e.terminal) next.push(w.a);
    }
    for (const n of next) {
      if (seen.has(key(n))) continue;
      seen.add(key(n));
      queue.push(n);
    }
  }
  return null;
}

export { wireConducts } from './wire';

export interface WireOptions {
  conductor?: Conductor;
  section?: number;
  length?: number;
  material?: 'Cu' | 'Al';
}

export function addWire(
  P: Project,
  a: Device,
  ta: string,
  b: Device,
  tb: string,
  o: WireOptions = {},
  registry: Registry = defaultRegistry,
): Wire {
  for (const [d, t] of [[a, ta], [b, tb]] as const) {
    if (!registry.require(d.type).terminals.some((x) => x.id === t)) throw new Error(`Terminal inexistente ${d.name}:${t}`);
  }
  const ea = { device: a.id, terminal: ta };
  const eb = { device: b.id, terminal: tb };
  const w: Wire = {
    id: nextId(P, 'w'),
    a: ea,
    b: eb,
    conductor: o.conductor ?? autoConductor(P, ea, eb, registry),
    section: o.section ?? 1.5,
    length: o.length ?? 2,
    material: o.material ?? 'Cu',
  };
  P.wires.push(w);
  return w;
}

export const byName = (P: Project, name: string) => P.devices.find((d) => d.name === name);

/* ---------------- Ficheiros ---------------- */

/** Erro ao abrir um ficheiro; `key` é a chave de tradução da mensagem. */
export class ProjectFileError extends Error {
  constructor(
    readonly key: string,
    readonly detail = '',
  ) {
    super(`${key} ${detail}`.trim());
  }
}

export function serializeProject(P: Project): string {
  return JSON.stringify(P, null, 2);
}

/** Tipos do protótipo (versão 0) → tipos actuais. */
const LEGACY_TYPES: Record<string, string> = {
  rede1: 'grid1ph',
  bateria: 'battery',
  solar: 'solarPanel',
  trafo: 'transformer1ph',
  mcb1: 'mcb1p',
  mcb2: 'mcb1pn',
  fusivel: 'fuseGG',
  rcd2: 'rcd2p',
  rcbo: 'rcbo',
  seccionador: 'mainSwitch2p',
  int1: 'switch1',
  int2: 'switch2p',
  comut: 'stairSwitch',
  inversor: 'intermediateSwitch',
  bpno: 'pushButton',
  telerruptor: 'impulseRelay',
  lamp: 'lampIncandescent',
  led: 'lampLed',
  fluor: 'lampFluorescent',
  tomada: 'socket',
  aquecedor: 'heater',
  campainha: 'bell',
  motor1: 'motor1ph',
  voltimetro: 'voltmeter',
  amperimetro: 'ammeter',
  analisador: 'energyMeter1ph',
  borne: 'junction',
  barramento: 'busbar',
  terra: 'earthElectrode',
  curto: 'shortCircuit',
  defeito: 'earthFault',
  pessoa: 'person',
};
const LEGACY_PARAMS: Record<string, Record<string, string>> = {
  grid1ph: { esq: 'earthing' },
  mcb1p: { curva: 'curve' },
  mcb1pn: { curva: 'curve' },
  rcbo: { curva: 'curve' },
  motor1ph: { P: 'Pm' },
  socket: { app: 'appliance', def: 'defect' },
  person: { chao: 'floor', Rc: 'Rbody' },
};
const LEGACY_TERMINALS: Record<string, Record<string, string>> = {
  pushButton: { '13': '1', '14': '2' },
};
const LEGACY_VALUES: Record<string, Record<string, string>> = {
  appliance: { nenhum: 'none', carreg: 'charger', portatil: 'laptop', tv: 'tv', frigo: 'fridge', ferro: 'iron', micro: 'microwave', aquec: 'heater', maquina: 'washer', chaleira: 'kettle' },
  defect: { nenhum: 'none', '50000': 'slight', '5000': 'leak', '500': 'strong', '0.5': 'frank' },
  floor: { '0': 'wet', '1000': 'shoes', '100000': 'insulating' },
};
const LEGACY_COND: Record<string, Conductor> = { L1: 'L1', L2: 'L2', L3: 'L3', N: 'N', PE: 'PE', C: 'C', 'DC+': 'DC+', 'DC-': 'DC-' };

type Migration = (raw: any, registry: Registry) => any;

/** migrations[v] converte a versão v na versão v+1. */
const MIGRATIONS: Record<number, Migration> = {
  0: (raw, registry) => {
    const devices: Device[] = [];
    const skipped = new Set<string>();
    for (const d of raw.devices ?? []) {
      const type = LEGACY_TYPES[d.type];
      if (!type || !registry.get(type)) {
        skipped.add(d.id);
        continue;
      }
      const pmap = LEGACY_PARAMS[type] ?? {};
      const params: Record<string, ParamValue> = { ...registry.defaults(type) };
      for (const [k, v] of Object.entries(d.p ?? {})) {
        const key = pmap[k] ?? k;
        if (!(key in params)) continue;
        const vmap = LEGACY_VALUES[key];
        params[key] = vmap ? (vmap[String(v)] ?? params[key]!) : (v as ParamValue);
      }
      const def = registry.require(type);
      devices.push({ id: d.id, type, name: d.name, x: d.x ?? 0, y: d.y ?? 0, rot: d.rot ?? 0, params, state: { ...def.initialState(), ...(d.st ?? {}) } });
    }
    const term = (devId: string, t: string) => {
      const d = devices.find((x) => x.id === devId);
      return (d && LEGACY_TERMINALS[d.type]?.[t]) ?? t;
    };
    const wires: Wire[] = [];
    for (const w of raw.wires ?? []) {
      if (skipped.has(w.a.d) || skipped.has(w.b.d)) continue;
      wires.push({
        id: w.id,
        a: { device: w.a.d, terminal: term(w.a.d, w.a.t) },
        b: { device: w.b.d, terminal: term(w.b.d, w.b.t) },
        conductor: LEGACY_COND[w.cond] ?? 'L1',
        section: Number(w.S) || 1.5,
        length: Number(w.len) || 1,
        material: w.mat === 'Al' ? 'Al' : 'Cu',
      });
    }
    return {
      app: 'faisca',
      version: 1,
      domain: 'domestic',
      level: 'pro',
      lang: 'pt',
      frequency: raw.f === 60 ? 60 : 50,
      name: raw.name,
      seq: raw.seq ?? 1,
      devices,
      wires,
    };
  },
};

/** Lê um ficheiro `.faisca` de qualquer versão e devolve a versão actual. */
export function parseProject(json: string, registry: Registry = defaultRegistry): Project {
  let raw: any;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new ProjectFileError('file.error.not_faisca');
  }
  if (!raw || raw.app !== 'faisca') throw new ProjectFileError('file.error.not_faisca');
  // O protótipo usava `ver` em vez de `version`.
  let v: number = typeof raw.version === 'number' ? raw.version : 0;
  if (v > PROJECT_VERSION) throw new ProjectFileError('file.error.newer_version', String(v));
  while (v < PROJECT_VERSION) {
    const mig = MIGRATIONS[v];
    if (!mig) throw new ProjectFileError('file.error.no_migration', String(v));
    raw = mig(raw, registry);
    v++;
    raw.version = v;
  }
  validateProject(raw, registry);
  return raw as Project;
}

/** Verificação mínima de integridade. Lança erro com a primeira inconsistência. */
export function validateProject(P: Project, registry: Registry = defaultRegistry): void {
  const ids = new Set<string>();
  for (const d of P.devices) {
    if (ids.has(d.id)) throw new ProjectFileError('file.error.invalid', `id ${d.id}`);
    ids.add(d.id);
    if (!registry.get(d.type)) throw new ProjectFileError('file.error.unknown_device', d.type);
  }
  for (const w of P.wires) {
    for (const e of [w.a, w.b]) {
      const d = P.devices.find((x) => x.id === e.device);
      if (!d) throw new ProjectFileError('file.error.invalid', `wire ${w.id}`);
      if (!registry.require(d.type).terminals.some((t) => t.id === e.terminal)) throw new ProjectFileError('file.error.invalid', `wire ${w.id}:${e.terminal}`);
    }
  }
}
