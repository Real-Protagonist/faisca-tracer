/** Exemplos e tours: actualizados, válidos, a funcionar e com todas as referências existentes. */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { allDiagnostics, defaultRegistry, DIAG_CODES, EVENT_CODES, parseProject, Simulator } from '../../sim-core/index';
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
        return [c.params.type];
      case 'wire':
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
      for (const s of tour.steps) {
        expect(PT[s.textKey], s.textKey).toBeTruthy();
        for (const m of s.mistakes ?? []) expect(DIAG_CODES).toContain(m);
        for (const c of conds(s.waitFor)) {
          for (const t of refsOf(c)) expect(types.has(t), `${s.id}: ${t}`).toBe(true);
          if (c.type === 'event') expect(EVENT_CODES).toContain(c.params.code);
        }
        for (const a of s.showMeAction ? acts(s.showMeAction) : []) {
          if (a.type === 'place' || a.type === 'operate' || a.type === 'probe') expect(types.has(a.params.type), s.id).toBe(true);
          if (a.type === 'wire') for (const r of [a.params.a, a.params.b]) expect(types.has(r.type), s.id).toBe(true);
        }
      }
    });

    it(`${tour.id}: 12 passos numerados de 1 a 12, todos os que esperam uma acção têm «Mostrar-me»`, () => {
      expect([...new Set(tour.steps.map((s) => s.step))]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      for (const s of tour.steps) if (s.waitFor.type !== 'next') expect(s.showMeAction, s.id).toBeDefined();
    });
  }
});
