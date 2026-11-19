/** Exemplos e tours: actualizados, válidos, a funcionar e com todas as referências existentes. */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { allDiagnostics, checkExercise, defaultRegistry, DIAG_CODES, EVENT_CODES, parseExercise, parseProject, Simulator } from '../../sim-core/index';
import { buildExercises } from '../exercises';
import { buildExamples } from '../examples';
import pt from '../../i18n/pt.json';
import type { Condition, ShowMe, Tour } from '../tour-types';

const dir = join(__dirname, '../examples');
const flat = (o: object, p = '', out: Record<string, string> = {}): Record<string, string> => {
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string') out[p + k] = v;
    else flat(v as object, `${p}${k}.`, out);
  }
  return out;
};
const PT = flat(pt);

describe('exemplos', () => {
  const built = buildExamples();
  it('os ficheiros JSON estão actualizados (npx tsx scripts/build-content.ts)', () => {
    for (const { meta, project } of built) expect(JSON.parse(readFileSync(join(dir, meta.file), 'utf-8')), meta.id).toEqual(JSON.parse(JSON.stringify(project)));
    expect(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf-8'))).toEqual(built.map((b) => b.meta));
  });

  it('cada exemplo tem título e descrição traduzidos', () => {
    for (const { meta } of built) {
      expect(PT[`example.${meta.id}.title`], meta.id).toBeTruthy();
      expect(PT[`example.${meta.id}.desc`], meta.id).toBeTruthy();
    }
  });

  it('pelo menos dois por célula doméstica (Iniciante e Profissional)', () => {
    for (const level of ['beginner', 'pro']) expect(built.filter((b) => b.meta.domain === 'domestic' && b.meta.level === level).length).toBeGreaterThanOrEqual(2);
  });

  for (const f of readdirSync(dir).filter((x) => x.endsWith('.faisca'))) {
    it(`${f} abre e simula sem erros de montagem`, () => {
      const sim = new Simulator(parseProject(readFileSync(join(dir, f), 'utf-8')));
      sim.run(0.5);
      const unexpected = allDiagnostics(sim).filter((d) => d.severity !== 'info' && !['RCD_TRIP', 'BODY_CURRENT'].includes(d.code));
      expect(unexpected.map((d) => d.code)).toEqual([]);
    });
  }

  it('o ponto de luz acende ao ligar o interruptor', () => {
    const sim = new Simulator(built[0]!.project);
    sim.operate('S1', 'switch_on');
    sim.step(0.1);
    expect(sim.measure('H1', 'meas.current')).toBeGreaterThan(0.25);
  });

  it('pelo menos dois por célula industrial (Iniciante e Profissional)', () => {
    for (const level of ['beginner', 'pro']) expect(built.filter((b) => b.meta.domain === 'industrial' && b.meta.level === level).length).toBeGreaterThanOrEqual(2);
  });

  const ex = (id: string) => new Simulator(built.find((b) => b.meta.id === id)!.project);
  const stateOf = (sim: Simulator, name: string, key = 'meas.state') => {
    const v = sim.measurements(name).find((m) => m.key === key)?.value;
    return typeof v === 'object' ? v.key.replace(/^state\./, '') : '';
  };
  const press = (sim: Simulator, name: string) => {
    sim.operate(name, 'press', 'down');
    sim.run(0.2);
    sim.operate(name, 'press', 'up');
  };

  it('arranque directo: S1 põe M1 em marcha com o sinalizador verde; S0 pára', () => {
    const sim = ex('dol-start');
    press(sim, 'S1');
    sim.run(3);
    expect(stateOf(sim, 'M1')).toBe('running');
    expect(stateOf(sim, 'H1')).toBe('lit');
    expect(stateOf(sim, 'H2')).toBe('unlit');
    press(sim, 'S0');
    sim.run(6);
    expect(stateOf(sim, 'M1')).toBe('stopped');
  });

  it('inversão de marcha: S1 à direita; S0; S2 à esquerda', () => {
    const sim = ex('reversing');
    press(sim, 'S1');
    sim.run(3);
    expect(stateOf(sim, 'M1', 'meas.direction')).toBe('forward');
    press(sim, 'S0');
    sim.run(6);
    press(sim, 'S2');
    sim.run(3);
    expect(stateOf(sim, 'M1', 'meas.direction')).toBe('reverse');
  });

  it('estrela-triângulo: KM2 (estrela) e depois KM3 (triângulo) ao fim de 5 s', () => {
    const sim = ex('star-delta');
    press(sim, 'S1');
    sim.run(1);
    expect(sim.device('KM2')!.state.closed).toBe(true);
    sim.run(5);
    expect(sim.device('KM2')!.state.closed).toBe(false);
    expect(sim.device('KM3')!.state.closed).toBe(true);
    expect(stateOf(sim, 'M1')).toBe('running');
  });

  it('variador: posição 1 roda à direita a 50 Hz; posição 2 à esquerda', () => {
    const sim = ex('vfd-motor');
    sim.operate('S1', 'pos_1');
    sim.run(8);
    expect(sim.measure('T1', 'meas.frequency')).toBe(50);
    expect(stateOf(sim, 'M1', 'meas.direction')).toBe('forward');
    sim.operate('S1', 'pos_2');
    sim.run(14);
    expect(stateOf(sim, 'M1', 'meas.direction')).toBe('reverse');
  });

  it('bomba por PLC: nível alto liga a bomba e o sinalizador; S0 pára', () => {
    const sim = ex('plc-pump');
    sim.operate('B1', 'level_high');
    sim.run(3);
    expect(stateOf(sim, 'M1')).toBe('running');
    expect(stateOf(sim, 'H1')).toBe('lit');
    sim.operate('S0', 'press', 'down');
    sim.run(4);
    expect(stateOf(sim, 'M1')).not.toBe('running');
  });

  it('protecção TT: o diferencial elimina a fuga do ferro com defeito', () => {
    const sim = new Simulator(built.find((b) => b.meta.id === 'tt-protection')!.project);
    sim.run(0.3);
    expect(sim.device('Q1')!.state.trip).toBe('residual');
  });
});

describe('tours', () => {
  const tours = readdirSync(join(__dirname, '../tours')).map((f) => JSON.parse(readFileSync(join(__dirname, '../tours', f), 'utf-8')) as Tour);
  const types = new Set(defaultRegistry.all().map((d) => d.type));
  const conds = (c: Condition, out: Condition[] = []): Condition[] => {
    if (c.type === 'all') c.params.conditions.forEach((x) => conds(x, out));
    else out.push(c);
    return out;
  };
  const acts = (a: ShowMe, out: ShowMe[] = []): ShowMe[] => {
    if (a.type === 'sequence') a.params.actions.forEach((x) => acts(x, out));
    else out.push(a);
    return out;
  };
  const refsOf = (c: Condition): string[] => {
    switch (c.type) {
      case 'deviceExists':
      case 'loadState':
      case 'probe':
      case 'deviceState':
      case 'param':
        return [c.params.type];
      case 'wire':
      case 'wireCut':
        return [c.params.a.type, c.params.b.type];
      case 'chain':
        return c.params.chain.map((x) => x.type);
      default:
        return [];
    }
  };

  for (const tour of tours) {
    it(`${tour.id}: textos, equipamentos e códigos existem`, () => {
      expect(PT[tour.titleKey]).toBeTruthy();
      if (tour.doneTextKey) expect(PT[tour.doneTextKey]).toBeTruthy();
      for (const s of tour.steps) {
        expect(PT[s.textKey], s.textKey).toBeTruthy();
        for (const m of s.mistakes ?? []) expect(DIAG_CODES).toContain(m);
        for (const c of conds(s.waitFor)) {
          for (const t of refsOf(c)) expect(types.has(t), `${s.id}: ${t}`).toBe(true);
          if (c.type === 'event') expect(EVENT_CODES).toContain(c.params.code);
          if (c.type === 'diag') expect(DIAG_CODES).toContain(c.params.code);
        }
        for (const a of s.showMeAction ? acts(s.showMeAction) : []) {
          if (a.type === 'place' || a.type === 'operate' || a.type === 'probe' || a.type === 'press' || a.type === 'param') expect(types.has(a.params.type), s.id).toBe(true);
          if (a.type === 'wire' || a.type === 'wireCut') for (const r of [a.params.a, a.params.b]) expect(types.has(r.type), s.id).toBe(true);
        }
      }
    });

    const n = tour.domain === 'industrial' ? 10 : 12;
    it(`${tour.id}: ${n} passos numerados de 1 a ${n}, todos os que esperam uma acção têm «Mostrar-me»`, () => {
      expect([...new Set(tour.steps.map((s) => s.step))]).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      for (const s of tour.steps) if (s.waitFor.type !== 'next') expect(s.showMeAction, s.id).toBeDefined();
    });
  }
});

describe('exercícios', () => {
  const exDir = join(__dirname, '../exercises');
  const built = buildExercises();

  it('os ficheiros .faisca-ex estão actualizados e têm selo válido', () => {
    const index = JSON.parse(readFileSync(join(exDir, 'index.json'), 'utf-8'));
    expect(index.map((m: { id: string }) => m.id)).toEqual(built.map((e) => e.id));
    for (const ex of built) {
      const text = readFileSync(join(exDir, `${ex.id}.faisca-ex`), 'utf-8');
      expect(JSON.parse(text).exercise, ex.id).toEqual(JSON.parse(JSON.stringify(ex)));
      expect(() => parseExercise(text), ex.id).not.toThrow();
    }
  });

  it('cobre a tabela do prompt: 4 + 4 domésticos, 3 + 5 industriais', () => {
    const count = (d: string, l: string) => built.filter((e) => e.domain === d && e.level === l).length;
    expect([count('domestic', 'beginner'), count('domestic', 'pro'), count('industrial', 'beginner'), count('industrial', 'pro')]).toEqual([4, 4, 3, 5]);
  });

  for (const ex of built) {
    it(`${ex.id}: a solução cumpre todos os objectivos; o projecto inicial não`, () => {
      expect(checkExercise(ex, ex.solution!).results.filter((r) => !r.ok).map((r) => r.id)).toEqual([]);
      expect(checkExercise(ex, ex.initial).done).toBe(false);
      // O inicial tem os mesmos aparelhos (o aluno só liga cabos e ajusta parâmetros).
      const key = (P: typeof ex.initial) => P.devices.map((d) => `${d.id}|${d.type}|${d.name}`);
      expect(key(ex.initial)).toEqual(key(ex.solution!));
      expect(ex.initial.wires.length).toBeLessThanOrEqual(ex.solution!.wires.length);
    });
  }
});
