/**
 * Exercícios: enunciado, projecto inicial (aparelhos colocados, cabos em falta), objectivos
 * verificados pelo simulador, solução opcional e pontuação.
 *
 * Cada objectivo é uma regra declarativa sobre o estado depois de um cenário de comandos:
 * «H1 acesa com S1 ligado» = { given: [{ op: 'S1', action: 'switch_on' }], rule: { type: 'state', device: 'H1', is: 'lit' } }.
 * A verificação corre numa cópia do projecto, numa simulação própria: não mexe na do utilizador.
 * Os aparelhos são referidos pelo nome (H1, S1), que o exercício fixa no projecto inicial.
 */
import { Simulator } from '../simulator';
import { allDiagnostics } from '../diagnostics/runtime';
import { defaultRegistry, type Registry } from '../devices';
import { lookFrom } from '../devices/symbols';
import { parseProject, ProjectFileError } from '../project/project';
import type { Domain, Level, ParamValue, Project } from '../project/types';
import { checkCompliance, DEFAULT_RULES, type ComplianceRules } from '../checks/compliance';
import { sealOf } from './seal';

/** Texto traduzido (exercícios incluídos) ou escrito pelo formador (não se traduz). */
export type Text = { key: string } | { text: string };

export type Step =
  /** Comando de um aparelho (como no painel de propriedades). */
  | { op: string; action: string; phase?: 'down' | 'up' }
  /** Premir e largar um botão de pressão. */
  | { press: string; hold?: number }
  /** Deixar correr o tempo (s). */
  | { run: number }
  /** Mudar um parâmetro (por exemplo, o defeito de um aparelho). */
  | { set: string; param: string; value: ParamValue };

export type Rule =
  /** Medição de estado (por omissão `meas.state`) igual a um dos valores (sem o prefixo «state.»). */
  | { type: 'state'; device: string; key?: string; is: string | string[] }
  /** Medição numérica entre `min` e `max`. */
  | { type: 'measure'; device: string; key: string; min?: number; max?: number }
  /** Estado guardado do aparelho (`closed`, `trip`…). */
  | { type: 'deviceState'; device: string; key: string; value: unknown }
  /** Parâmetro do aparelho. */
  | { type: 'param'; device: string; key: string; min?: number; max?: number; equals?: ParamValue }
  /** A carga funciona (lâmpada acesa, motor em marcha…). */
  | { type: 'working'; device: string; value?: boolean }
  /** Nenhum diagnóstico com estes códigos (ou nenhum erro nem aviso, sem códigos). */
  | { type: 'noDiag'; codes?: string[] }
  | { type: 'diag'; code: string }
  /** Cada cenário, sozinho, troca o estado do aparelho; os dois juntos voltam ao início (comando de escada). */
  | { type: 'toggles'; device: string; key?: string; steps: Step[] }
  /** Uma regra da verificação de conformidade passa. */
  | { type: 'compliance'; rule: string }
  /**
   * Primeiro tem de se verificar `first`; depois dos passos `steps`, verifica-se `rule`.
   * Evita objectivos cumpridos sem fazer nada: «S0 pára M1» só conta se M1 tiver arrancado.
   */
  | { type: 'then'; first: Rule; steps: Step[]; rule: Rule }
  | { type: 'all'; rules: Rule[] }
  | { type: 'not'; rule: Rule };

export interface Objective {
  id: string;
  text: Text;
  given?: Step[];
  rule: Rule;
  points?: number;
}

export interface Exercise {
  id: string;
  domain: Domain;
  level: Level;
  title: Text;
  statement: Text;
  objectives: Objective[];
  initial: Project;
  solution?: Project;
}

export interface ObjectiveResult {
  id: string;
  ok: boolean;
  points: number;
}

export interface ExerciseResult {
  results: ObjectiveResult[];
  score: number;
  total: number;
  /** 0..100 */
  percent: number;
  done: boolean;
}

const nameOf = (sim: Simulator, n: string) => {
  const d = sim.device(n);
  if (!d) throw new MissingDevice(n);
  return d;
};

class MissingDevice extends Error {}

/** Aplica um cenário à simulação. */
export function applySteps(sim: Simulator, steps: Step[] = []) {
  for (const s of steps) {
    if ('op' in s) sim.operate(nameOf(sim, s.op).id, s.action, s.phase);
    else if ('press' in s) {
      const id = nameOf(sim, s.press).id;
      sim.operate(id, 'press', 'down');
      sim.run(s.hold ?? 0.3);
      sim.operate(id, 'press', 'up');
    } else if ('run' in s) sim.run(s.run);
    else if ('set' in s) {
      nameOf(sim, s.set).params[s.param] = s.value;
      sim.setProject(sim.project);
      sim.step(0.02);
    }
  }
}

const stateOf = (sim: Simulator, device: string, key = 'meas.state') => {
  const d = nameOf(sim, device);
  const m = sim.measurements(d.id).find((x) => x.key === key);
  return m && typeof m.value === 'object' ? m.value.key.replace(/^state\./, '') : '';
};

function evalRule(rule: Rule, sim: Simulator, fresh: () => Simulator, registry: Registry, rules: ComplianceRules): boolean {
  switch (rule.type) {
    case 'state': {
      const v = stateOf(sim, rule.device, rule.key);
      return Array.isArray(rule.is) ? rule.is.includes(v) : v === rule.is;
    }
    case 'measure': {
      const v = sim.measure(nameOf(sim, rule.device).id, rule.key);
      return Number.isFinite(v) && (rule.min === undefined || v >= rule.min) && (rule.max === undefined || v <= rule.max);
    }
    case 'deviceState':
      return nameOf(sim, rule.device).state[rule.key] === rule.value;
    case 'param': {
      const v = nameOf(sim, rule.device).params[rule.key];
      if (rule.equals !== undefined) return v === rule.equals;
      const n = Number(v);
      return (rule.min === undefined || n >= rule.min) && (rule.max === undefined || n <= rule.max);
    }
    case 'working': {
      const d = nameOf(sim, rule.device);
      const def = registry.require(d.type);
      const w = !!def.load?.working?.(d, sim.view(), sim.rt(d));
      return w === (rule.value ?? true);
    }
    case 'noDiag': {
      const ds = allDiagnostics(sim);
      return rule.codes ? !ds.some((d) => rule.codes!.includes(d.code)) : !ds.some((d) => d.severity !== 'info');
    }
    case 'diag':
      return allDiagnostics(sim).some((d) => d.code === rule.code);
    case 'toggles': {
      const base = stateOf(sim, rule.device, rule.key);
      const after = (steps: Step[]) => {
        const s = fresh();
        applySteps(s, steps);
        s.run(0.2);
        return stateOf(s, rule.device, rule.key);
      };
      if (rule.steps.some((st) => after([st]) === base)) return false;
      return after(rule.steps.slice(0, 2)) === base;
    }
    case 'compliance':
      return checkCompliance(sim, rules).find((r) => r.id === rule.rule)?.status === 'pass';
    case 'then':
      if (!evalRule(rule.first, sim, fresh, registry, rules)) return false;
      applySteps(sim, rule.steps);
      return evalRule(rule.rule, sim, fresh, registry, rules);
    case 'all':
      return rule.rules.every((r) => evalRule(r, sim, fresh, registry, rules));
    case 'not':
      return !evalRule(rule.rule, sim, fresh, registry, rules);
  }
}

/** Verifica um objectivo no projecto dado (numa simulação própria). */
export function checkObjective(o: Objective, P: Project, registry: Registry = defaultRegistry, rules: ComplianceRules = DEFAULT_RULES): boolean {
  const fresh = () => {
    const s = new Simulator(P, { registry });
    s.run(0.2);
    return s;
  };
  try {
    const sim = fresh();
    applySteps(sim, o.given);
    return evalRule(o.rule, sim, fresh, registry, rules);
  } catch (e) {
    if (e instanceof MissingDevice) return false;
    throw e;
  }
}

/** Verifica todos os objectivos e calcula a pontuação. */
export function checkExercise(ex: Exercise, P: Project, registry: Registry = defaultRegistry): ExerciseResult {
  const results = ex.objectives.map((o) => ({ id: o.id, ok: checkObjective(o, P, registry), points: o.points ?? 1 }));
  const total = results.reduce((s, r) => s + r.points, 0);
  const score = results.reduce((s, r) => s + (r.ok ? r.points : 0), 0);
  return { results, score, total, percent: total ? Math.round((100 * score) / total) : 0, done: score === total };
}

/** Estado visual de um aparelho (para testes e para o painel do exercício). */
export const lookOf = (sim: Simulator, name: string) => lookFrom(sim.measurements(nameOf(sim, name).id));

/* ---------------- ficheiro .faisca-ex ---------------- */

export const EXERCISE_FILE_VERSION = 1;

export interface ExerciseFile {
  app: 'faisca-ex';
  version: number;
  exercise: Exercise;
  /** SHA-256 do exercício com o sal da aplicação. */
  seal: string;
}

export function serializeExercise(ex: Exercise): string {
  const f: ExerciseFile = { app: 'faisca-ex', version: EXERCISE_FILE_VERSION, exercise: ex, seal: sealOf(ex) };
  return JSON.stringify(f, null, 2);
}

/** Lê um `.faisca-ex`; recusa ficheiros alterados fora do editor. */
export function parseExercise(text: string, registry: Registry = defaultRegistry): Exercise {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFileError('file.error.not_exercise');
  }
  if (!raw || raw.app !== 'faisca-ex' || !raw.exercise) throw new ProjectFileError('file.error.not_exercise');
  if (raw.version > EXERCISE_FILE_VERSION) throw new ProjectFileError('file.error.newer_version', String(raw.version));
  if (raw.seal !== sealOf(raw.exercise)) throw new ProjectFileError('file.error.tampered');
  const ex = raw.exercise as Exercise;
  // Os projectos passam pela mesma validação dos `.faisca`.
  ex.initial = parseProject(JSON.stringify(ex.initial), registry);
  if (ex.solution) ex.solution = parseProject(JSON.stringify(ex.solution), registry);
  return ex;
}

/** Projecto inicial a partir de uma solução: os mesmos aparelhos, sem os cabos indicados (todos, por omissão). */
export function initialFrom(solution: Project, keepWire: (w: Project['wires'][number]) => boolean = () => false): Project {
  const P = structuredClone(solution);
  P.wires = P.wires.filter(keepWire);
  return P;
}
