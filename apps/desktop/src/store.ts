/** Estado da aplicação. Sem DOM nem worker: a ponte de simulação é injectada (`setBridge`). */
import { create } from 'zustand';
import {
  addDevice,
  addWire,
  autoConductor,
  autoName,
  createProject,
  defaultRegistry,
  type ComplianceResult,
  type ComplianceRules,
  type Conductor,
  type Device,
  type Exercise,
  type ExerciseResult,
  type Diagnostic,
  type Lang,
  type Probes,
  type Project,
  type SimEvent,
  type Wire,
  type WireEnd,
  type WorkerSnapshot,
} from '@faisca/sim-core';
import { bbox, estimateLength, GRID, routeWire, snap, terminalPos, type Pt } from './editor/geometry';

export type Tool = 'select' | 'operate' | 'wire' | 'probe' | 'clamp' | 'delete';
export type DockTab = 'library' | 'events' | 'problems' | 'check' | 'exercise' | 'matrix';

export interface SimBridge {
  load(P: Project): void;
  step(dt: number): void;
  operate(device: string, action: string, phase?: 'down' | 'up'): void;
  whyNot(device: string): void;
  probes(p: Probes): void;
  matrix(): void;
  reset(): void;
  /** Verifica um exercício (num worker à parte, sem parar a simulação). */
  checkExercise(seq: number, exercise: Exercise, project: Project): void;
  compliance(rules?: ComplianceRules): void;
}

export interface ExerciseState {
  ex: Exercise;
  result: ExerciseResult | null;
  /** O utilizador abriu a solução (a pontuação fica marcada). */
  solutionShown: boolean;
  checking: boolean;
}

export interface Selection {
  devices: string[];
  wires: string[];
}

export interface AppState {
  project: Project;
  filePath: string | null;
  dirty: boolean;
  past: Project[];
  future: Project[];
  selection: Selection;
  tool: Tool;
  placing: string | null;
  wireStart: WireEnd | null;
  nextWire: { conductor: Conductor | 'auto'; section: number };
  probes: Probes;
  view: { x: number; y: number; zoom: number };
  tab: 'logic' | 'physical';
  dockTab: DockTab;
  lang: Lang;
  sim: { realtime: boolean; running: boolean; speed: number };
  snapshot: WorkerSnapshot | null;
  events: SimEvent[];
  whyNot: { device: string; diagnostic: Diagnostic } | null;
  matrix: { labels: string[]; n: number; re: number[]; im: number[]; bre: number[]; bim: number[] } | null;
  clipboard: { devices: Device[]; wires: Wire[] } | null;
  /** Projecto antes de um arrasto (para um único passo de desfazer). */
  dragBase: Project | null;
  /** Assistente de arranque aberto; `firstRun` inclui o ecrã do idioma. */
  wizard: { open: boolean; firstRun: boolean };
  /** Tour em curso: id e índice do passo. */
  tour: { id: string; index: number } | null;
  /** Acções da interface que o tour verifica (ex.: «howToFix»). */
  flags: string[];
  /** Cartões de erro fechados pelo utilizador (código + alvos). */
  dismissed: string[];
  /** Momento da última edição do esquema (ms), para não interromper quem está a montar. */
  lastEdit: number;
  /** Exercício em curso. */
  exercise: ExerciseState | null;
  /** Último resultado da verificação de conformidade e as regras usadas. */
  compliance: { results: ComplianceResult[] | null; rules: ComplianceRules | null; running: boolean };
}

const HISTORY_LIMIT = 1000;
let bridge: SimBridge | null = null;
export const setBridge = (b: SimBridge | null) => {
  bridge = b;
};

const clone = <T>(v: T): T => structuredClone(v);
const registry = defaultRegistry;

export const useApp = create<AppState>(() => ({
  project: createProject(),
  filePath: null,
  dirty: false,
  past: [],
  future: [],
  selection: { devices: [], wires: [] },
  tool: 'select',
  placing: null,
  wireStart: null,
  nextWire: { conductor: 'auto', section: 1.5 },
  probes: { red: null, black: null, clamp: null },
  view: { x: 0, y: 0, zoom: 1 },
  tab: 'logic',
  dockTab: 'library',
  lang: 'pt',
  sim: { realtime: true, running: true, speed: 1 },
  snapshot: null,
  events: [],
  whyNot: null,
  matrix: null,
  clipboard: null,
  dragBase: null,
  wizard: { open: false, firstRun: false },
  tour: null,
  flags: [],
  dismissed: [],
  lastEdit: 0,
  exercise: null,
  compliance: { results: null, rules: null, running: false },
}));

const get = () => useApp.getState();
const set = (p: Partial<AppState>) => useApp.setState(p);

/** Envia o projecto ao simulador, com o idioma das preferências. */
function sync(P: Project = get().project) {
  bridge?.load({ ...P, lang: get().lang });
}

/** Altera o projecto com um passo de desfazer. */
export function commit(mutate: (P: Project) => void) {
  const before = get().project;
  const P = clone(before);
  mutate(P);
  const past = [...get().past, before];
  if (past.length > HISTORY_LIMIT) past.shift();
  set({ project: P, past, future: [], dirty: true, lastEdit: Date.now() });
  sync(P);
}

export function undo() {
  const { past, future, project } = get();
  if (!past.length) return;
  const prev = past[past.length - 1]!;
  set({ project: prev, past: past.slice(0, -1), future: [project, ...future], dirty: true, selection: prune(prev, get().selection) });
  sync(prev);
}

export function redo() {
  const { past, future, project } = get();
  if (!future.length) return;
  const next = future[0]!;
  set({ project: next, past: [...past, project], future: future.slice(1), dirty: true, selection: prune(next, get().selection) });
  sync(next);
}

const prune = (P: Project, s: Selection): Selection => ({
  devices: s.devices.filter((id) => P.devices.some((d) => d.id === id)),
  wires: s.wires.filter((id) => P.wires.some((w) => w.id === id)),
});

/** Substitui o projecto inteiro (novo, abrir, recuperar). */
export function loadProject(P: Project, filePath: string | null = null, dirty = false) {
  set({ project: P, filePath, dirty, past: [], future: [], selection: { devices: [], wires: [] }, events: [], whyNot: null, matrix: null, probes: { red: null, black: null, clamp: null }, dismissed: [], snapshot: null, tab: 'logic', exercise: null, compliance: { ...get().compliance, results: null } });
  bridge?.reset();
  sync(P);
  bridge?.probes(get().probes);
}

export function setLang(lang: Lang) {
  set({ lang });
  sync();
}

/* ---------------- edição ---------------- */

/** Rede por omissão de cada área: doméstica 230 V TT, industrial TN-S. */
function domainDefaults(P: Project, type: string): Record<string, string> {
  if (type === 'grid1ph') return { earthing: P.domain === 'industrial' ? 'TN-S' : 'TT' };
  return {};
}

export function placeDevice(type: string, at: Pt): string {
  const def = registry.require(type);
  let id = '';
  commit((P) => {
    const { w, h } = def.size;
    const d = addDevice(P, type, { x: snap(at.x - w / 2), y: snap(at.y - h / 2), params: domainDefaults(P, type) }, registry);
    id = d.id;
  });
  set({ selection: { devices: [id], wires: [] } });
  return id;
}

export function connect(a: WireEnd, b: WireEnd): string | null {
  if (a.device === b.device && a.terminal === b.terminal) return null;
  const P0 = get().project;
  const exists = P0.wires.some(
    (w) => (w.a.device === a.device && w.a.terminal === a.terminal && w.b.device === b.device && w.b.terminal === b.terminal) ||
      (w.b.device === a.device && w.b.terminal === a.terminal && w.a.device === b.device && w.a.terminal === b.terminal),
  );
  if (exists) return null;
  const da = P0.devices.find((d) => d.id === a.device);
  const db = P0.devices.find((d) => d.id === b.device);
  if (!da || !db) return null;
  const pa = terminalPos(registry, da, a.terminal);
  const pb = terminalPos(registry, db, b.terminal);
  if (!pa || !pb) return null;
  const { conductor, section } = get().nextWire;
  let id = '';
  commit((P) => {
    const w = addWire(
      P,
      P.devices.find((d) => d.id === a.device)!,
      a.terminal,
      P.devices.find((d) => d.id === b.device)!,
      b.terminal,
      { conductor: conductor === 'auto' ? autoConductor(P, a, b, registry) : conductor, section, length: estimateLength(routeWire(pa, pb, [], [bbox(registry, da), bbox(registry, db)])) },
      registry,
    );
    id = w.id;
  });
  set({ wireStart: null });
  return id;
}

export function select(sel: Partial<Selection>, additive = false) {
  const cur = get().selection;
  if (!additive) {
    set({ selection: { devices: sel.devices ?? [], wires: sel.wires ?? [] }, whyNot: null });
    return;
  }
  const toggle = (list: string[], ids: string[] = []) => ids.reduce((acc, id) => (acc.includes(id) ? acc.filter((x) => x !== id) : [...acc, id]), list);
  set({ selection: { devices: toggle(cur.devices, sel.devices), wires: toggle(cur.wires, sel.wires) } });
}

export function deleteSelection() {
  const { devices, wires } = get().selection;
  if (!devices.length && !wires.length) return;
  commit((P) => {
    P.devices = P.devices.filter((d) => !devices.includes(d.id));
    P.wires = P.wires.filter((w) => !wires.includes(w.id) && !devices.includes(w.a.device) && !devices.includes(w.b.device));
  });
  set({ selection: { devices: [], wires: [] } });
}

export function deleteItem(kind: 'device' | 'wire', id: string) {
  set({ selection: kind === 'device' ? { devices: [id], wires: [] } : { devices: [], wires: [id] } });
  deleteSelection();
}

/** Começo de um arrasto: guarda o projecto para um único passo de desfazer. */
export function beginDrag() {
  set({ dragBase: get().project });
}

/** Move a selecção durante o arrasto, sem histórico. */
export function dragSelection(dx: number, dy: number) {
  const base = get().dragBase;
  if (!base) return;
  const ids = get().selection.devices;
  const P = clone(base);
  for (const d of P.devices) if (ids.includes(d.id)) {
    d.x = snap(d.x + dx);
    d.y = snap(d.y + dy);
  }
  for (const w of P.wires) if (w.points && ids.includes(w.a.device) && ids.includes(w.b.device)) w.points = w.points.map((p) => ({ x: snap(p.x + dx), y: snap(p.y + dy) }));
  set({ project: P });
}

/** Fim de um arrasto: um passo no histórico, se algo mudou. */
export function endDrag() {
  const base = get().dragBase;
  set({ dragBase: null });
  if (!base) return;
  const P = get().project;
  if (JSON.stringify(base.devices) === JSON.stringify(P.devices) && JSON.stringify(base.wires) === JSON.stringify(P.wires)) return;
  set({ past: [...get().past, base], future: [], dirty: true });
  sync(P);
}

/** Arrasta um ponto de curva (index −1 cria um ponto novo). Usa o projecto do início do arrasto. */
export function dragBend(wireId: string, index: number, pt: Pt) {
  const base = get().dragBase;
  if (!base) return;
  const P = clone(base);
  const w = P.wires.find((x) => x.id === wireId);
  if (!w) return;
  const pts = [...(w.points ?? [])];
  if (index < 0 || index >= pts.length) pts.push(pt);
  else pts[index] = pt;
  w.points = pts;
  set({ project: P });
}

export function removeBend(wireId: string, index: number) {
  if (index < 0) return;
  updateWire(wireId, (w) => {
    w.points = (w.points ?? []).filter((_, i) => i !== index);
    if (!w.points.length) delete w.points;
  });
}

export function rotateSelection() {
  const ids = get().selection.devices;
  if (!ids.length) return;
  commit((P) => {
    for (const d of P.devices) if (ids.includes(d.id)) d.rot = (d.rot + 90) % 360;
  });
}

export function updateDevice(id: string, f: (d: Device) => void) {
  commit((P) => {
    const d = P.devices.find((x) => x.id === id);
    if (d) f(d);
  });
}

export function updateWire(id: string, f: (w: Wire) => void) {
  commit((P) => {
    const w = P.wires.find((x) => x.id === id);
    if (w) f(w);
  });
}

/** Desliga uma ponta do cabo do borne (o cabo fica, solto, e deixa de conduzir). */
export function detachWireEnd(id: string, end: 'a' | 'b') {
  updateWire(id, (w) => {
    if (!w.detached?.includes(end)) w.detached = [...(w.detached ?? []), end].sort() as ('a' | 'b')[];
  });
}

/**
 * Liga uma ponta solta: ao borne de onde saiu ou a outro (`to`). Num borne novo, o percurso
 * desenhado e o comprimento estimado são refeitos. Devolve false se a ligação não for possível.
 */
export function attachWireEnd(id: string, end: 'a' | 'b', to?: WireEnd): boolean {
  const P0 = get().project;
  const w0 = P0.wires.find((x) => x.id === id);
  if (!w0) return false;
  const target = to ?? w0[end];
  const other = w0[end === 'a' ? 'b' : 'a'];
  if (target.device === other.device && target.terminal === other.terminal) return false;
  const dt = P0.devices.find((d) => d.id === target.device);
  const dOther = P0.devices.find((d) => d.id === other.device);
  if (!dt || !dOther || !registry.require(dt.type).terminals.some((t) => t.id === target.terminal)) return false;
  const moved = target.device !== w0[end].device || target.terminal !== w0[end].terminal;
  commit((P) => {
    const w = P.wires.find((x) => x.id === id)!;
    w.detached = w.detached?.filter((e) => e !== end);
    if (!w.detached?.length) delete w.detached;
    if (!moved) return;
    w[end] = { device: target.device, terminal: target.terminal };
    delete w.points;
    const pa = terminalPos(registry, P.devices.find((d) => d.id === w.a.device)!, w.a.terminal);
    const pb = terminalPos(registry, P.devices.find((d) => d.id === w.b.device)!, w.b.terminal);
    const boxes = [w.a.device, w.b.device].map((d) => bbox(registry, P.devices.find((x) => x.id === d)!));
    if (pa && pb) w.length = estimateLength(routeWire(pa, pb, [], boxes));
  });
  return true;
}

export function selectAll() {
  const P = get().project;
  set({ selection: { devices: P.devices.map((d) => d.id), wires: P.wires.map((w) => w.id) } });
}

export function copySelection() {
  const { devices } = get().selection;
  const P = get().project;
  const ds = P.devices.filter((d) => devices.includes(d.id));
  // Só os cabos com as duas pontas dentro da selecção.
  const ws = P.wires.filter((w) => devices.includes(w.a.device) && devices.includes(w.b.device));
  if (ds.length) set({ clipboard: clone({ devices: ds, wires: ws }) });
}

export function paste(offset = 2 * GRID) {
  const cb = get().clipboard;
  if (!cb) return;
  const newIds: string[] = [];
  const newWires: string[] = [];
  commit((P) => {
    const map = new Map<string, string>();
    for (const d of cb.devices) {
      const n = addDevice(P, d.type, { x: d.x + offset, y: d.y + offset, rot: d.rot, params: clone(d.params), state: clone(d.state), name: autoName(P, d.type, registry) }, registry);
      map.set(d.id, n.id);
      newIds.push(n.id);
    }
    for (const w of cb.wires) {
      const a = P.devices.find((d) => d.id === map.get(w.a.device))!;
      const b = P.devices.find((d) => d.id === map.get(w.b.device))!;
      const nw = addWire(P, a, w.a.terminal, b, w.b.terminal, { conductor: w.conductor, section: w.section, length: w.length, material: w.material }, registry);
      if (w.points) nw.points = w.points.map((p) => ({ x: p.x + offset, y: p.y + offset }));
      newWires.push(nw.id);
    }
  });
  set({ selection: { devices: newIds, wires: newWires } });
  // Colagens seguidas ficam em cascata.
  set({ clipboard: { devices: cb.devices.map((d) => ({ ...d, x: d.x + offset, y: d.y + offset })), wires: cb.wires.map((w) => ({ ...w, points: w.points?.map((p) => ({ x: p.x + offset, y: p.y + offset })) })) } });
}

export function align(edge: 'left' | 'top') {
  const ids = get().selection.devices;
  if (ids.length < 2) return;
  commit((P) => {
    const ds = P.devices.filter((d) => ids.includes(d.id));
    if (edge === 'left') {
      const x = Math.min(...ds.map((d) => bbox(registry, d).x));
      for (const d of ds) d.x += x - bbox(registry, d).x;
    } else {
      const y = Math.min(...ds.map((d) => bbox(registry, d).y));
      for (const d of ds) d.y += y - bbox(registry, d).y;
    }
  });
}

/** Agrupa a selecção num quadro: cria uma moldura à volta. */
export function groupInFrame() {
  const ids = get().selection.devices;
  const P0 = get().project;
  const ds = P0.devices.filter((d) => ids.includes(d.id) && d.type !== 'frame');
  if (!ds.length) return;
  const boxes = ds.map((d) => bbox(registry, d));
  const x = snap(Math.min(...boxes.map((b) => b.x)) - 2 * GRID);
  const y = snap(Math.min(...boxes.map((b) => b.y)) - 3 * GRID);
  const W = snap(Math.max(...boxes.map((b) => b.x + b.w)) + 2 * GRID - x);
  const H = snap(Math.max(...boxes.map((b) => b.y + b.h)) + 2 * GRID - y);
  commit((P) => {
    const f = addDevice(P, 'frame', { x, y, params: { W, H, title: '' } }, registry);
    // A moldura fica por trás dos aparelhos.
    P.devices = [f, ...P.devices.filter((d) => d.id !== f.id)];
  });
}

/* ---------------- simulação ---------------- */

export function operate(device: string, action: string, phase?: 'down' | 'up') {
  bridge?.operate(device, action, phase);
  set({ dirty: true });
}

export function stepOnce(dt = 0.1) {
  bridge?.step(dt);
}

export function setSim(p: Partial<AppState['sim']>) {
  set({ sim: { ...get().sim, ...p } });
}

export function resetSim() {
  bridge?.reset();
  sync();
  set({ events: [] });
}

export function askWhyNot(device: string) {
  bridge?.whyNot(device);
}

export function requestMatrix() {
  bridge?.matrix();
}

export function setProbes(p: Partial<Probes>) {
  const probes = { ...get().probes, ...p };
  set({ probes });
  bridge?.probes(probes);
}

/** Resultado do simulador: actualiza medições e o estado dos aparelhos sem tocar no histórico. */
export function applySnapshot(s: WorkerSnapshot) {
  const P = get().project;
  let changed = false;
  const devices = P.devices.map((d) => {
    const n = s.devices.find((x) => x.id === d.id);
    if (!n || JSON.stringify(n.state) === JSON.stringify(d.state)) return d;
    changed = true;
    return { ...d, state: n.state };
  });
  const events = s.events.length ? [...get().events, ...s.events].slice(-500) : get().events;
  set({ snapshot: s, events, ...(changed ? { project: { ...P, devices } } : {}) });
}

export function setWhyNot(r: AppState['whyNot']) {
  set({ whyNot: r });
}
export function setMatrix(m: AppState['matrix']) {
  set({ matrix: m });
}

export function setFlag(flag: string) {
  if (!get().flags.includes(flag)) set({ flags: [...get().flags, flag] });
}

export function dismissCard(key: string) {
  set({ dismissed: [...get().dismissed, key] });
}

/** Esquece os cartões fechados cuja falha já desapareceu (se voltar, o cartão volta). */
export function pruneDismissed(active: string[]) {
  const d = get().dismissed.filter((k) => active.includes(k));
  if (d.length !== get().dismissed.length) set({ dismissed: d });
}

export function openWizard(firstRun = false) {
  set({ wizard: { open: true, firstRun } });
}
export function closeWizard() {
  set({ wizard: { open: false, firstRun: false } });
}

export function setTour(tour: AppState['tour']) {
  set({ tour, ...(tour && tour.index === 0 ? { flags: [] } : {}) });
}

export const ui = {
  setTool: (tool: Tool) => set({ tool, placing: null, wireStart: null }),
  setPlacing: (placing: string | null) => set({ placing, tool: 'select', wireStart: null }),
  setWireStart: (wireStart: WireEnd | null) => set({ wireStart }),
  setNextWire: (p: Partial<AppState['nextWire']>) => set({ nextWire: { ...get().nextWire, ...p } }),
  setView: (p: Partial<AppState['view']>) => set({ view: { ...get().view, ...p } }),
  setTab: (tab: AppState['tab']) => set({ tab }),
  setDock: (dockTab: DockTab) => set({ dockTab }),
  markSaved: (filePath: string | null) => set({ dirty: false, filePath }),
};

export { registry };

/* ---------------- exercícios ---------------- */

let checkSeq = 0;

/** Abre um exercício: carrega o projecto inicial e mostra o separador «Exercício». */
export function openExercise(ex: Exercise) {
  loadProject(structuredClone(ex.initial));
  set({ exercise: { ex, result: null, solutionShown: false, checking: false }, dockTab: 'exercise' });
  checkExerciseNow();
}

export function closeExercise() {
  set({ exercise: null, dockTab: get().dockTab === 'exercise' ? 'library' : get().dockTab });
}

/** Pede a verificação dos objectivos com o projecto actual. */
export function checkExerciseNow() {
  const e = get().exercise;
  if (!e) return;
  set({ exercise: { ...e, checking: true } });
  bridge?.checkExercise(++checkSeq, e.ex, get().project);
}

export function setExerciseResult(seq: number, result: ExerciseResult) {
  const e = get().exercise;
  // Uma resposta antiga (o projecto já mudou) não conta.
  if (!e || seq !== checkSeq) return;
  set({ exercise: { ...e, result, checking: false } });
}

/** Mostra a solução: carrega-a no esquema (a pontuação fica marcada como «solução vista»). */
export function showSolution() {
  const e = get().exercise;
  if (!e?.ex.solution) return;
  loadProject(structuredClone(e.ex.solution));
  set({ exercise: { ...e, solutionShown: true, result: null }, dockTab: 'exercise' });
  checkExerciseNow();
}

/** Volta ao projecto inicial do exercício. */
export function restartExercise() {
  const e = get().exercise;
  if (!e) return;
  loadProject(structuredClone(e.ex.initial));
  set({ exercise: { ...e, result: null }, dockTab: 'exercise' });
  checkExerciseNow();
}

/* ---------------- conformidade ---------------- */

export function runCompliance(rules: ComplianceRules | null = get().compliance.rules) {
  set({ compliance: { ...get().compliance, rules, running: true } });
  bridge?.compliance(rules ?? undefined);
}

export function setComplianceResults(results: ComplianceResult[]) {
  set({ compliance: { ...get().compliance, results, running: false } });
}
