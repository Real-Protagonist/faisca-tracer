/** Exercícios, selo dos `.faisca-ex`, verificação de conformidade e lista de material. */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  addDevice,
  addWire,
  billOfMaterials,
  checkCompliance,
  checkExercise,
  checkObjective,
  createProject,
  defaultRegistry,
  DEFAULT_RULES,
  parseExercise,
  parseRuleSet,
  ProjectFileError,
  serializeExercise,
  sha256,
  Simulator,
  type Exercise,
  type Project,
} from '../index';

/** Ponto de luz completo (solução) e o mesmo sem cabos (inicial). */
function lightPoint(): { solution: Project; initial: Project } {
  const P = createProject();
  const G = addDevice(P, 'grid1ph', { name: 'G1' });
  const Q = addDevice(P, 'mcb1pn', { name: 'Q1', params: { In: 10 } });
  const S = addDevice(P, 'switch1', { name: 'S1' });
  const H = addDevice(P, 'lampIncandescent', { name: 'H1' });
  addWire(P, G, 'L', Q, '1');
  addWire(P, G, 'N', Q, '3');
  addWire(P, Q, '2', S, '1');
  addWire(P, S, '2', H, 'L');
  addWire(P, Q, '4', H, 'N');
  const initial = structuredClone(P);
  initial.wires = [];
  return { solution: P, initial };
}

function exercise(): Exercise {
  const { solution, initial } = lightPoint();
  return {
    id: 't',
    domain: 'domestic',
    level: 'beginner',
    title: { text: 'Ponto de luz' },
    statement: { text: 'Monte o ponto de luz.' },
    objectives: [
      { id: 'lit', text: { text: 'H1 acende' }, given: [{ op: 'S1', action: 'switch_on' }], rule: { type: 'state', device: 'H1', is: 'lit' } },
      { id: 'off', text: { text: 'H1 apagada' }, rule: { type: 'working', device: 'H1', value: false } },
      { id: 'clean', text: { text: 'Sem problemas' }, rule: { type: 'noDiag' }, points: 2 },
    ],
    initial,
    solution,
  };
}

describe('selo SHA-256', () => {
  it('vectores de teste da norma FIPS 180-4', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
    for (const s of ['Faísca Tracer ⚡ instalação', 'ç'.repeat(77), JSON.stringify({ a: [1, 2, 'três'] }), 'x'.repeat(55), 'y'.repeat(64)])
      expect(sha256(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
  });

  it('um .faisca-ex reabre igual; qualquer alteração à mão é recusada', () => {
    const ex = exercise();
    const text = serializeExercise(ex);
    const back = parseExercise(text);
    expect(back.objectives).toEqual(ex.objectives);
    expect(back.solution).toEqual(ex.solution);
    // O aluno tenta afrouxar um objectivo.
    const raw = JSON.parse(text);
    raw.exercise.objectives[0].rule.is = 'unlit';
    expect(() => parseExercise(JSON.stringify(raw))).toThrow(ProjectFileError);
    try {
      parseExercise(JSON.stringify(raw));
    } catch (e) {
      expect((e as ProjectFileError).key).toBe('file.error.tampered');
    }
    expect(() => parseExercise('{"app":"faisca"}')).toThrow('file.error.not_exercise');
  });
});

describe('verificação dos objectivos', () => {
  it('o projecto inicial não cumpre; a solução cumpre tudo (pontuação com pesos)', () => {
    const ex = exercise();
    const ini = checkExercise(ex, ex.initial);
    expect(ini.results.find((r) => r.id === 'lit')!.ok).toBe(false);
    expect(ini.done).toBe(false);
    const sol = checkExercise(ex, ex.solution!);
    expect(sol).toMatchObject({ score: 4, total: 4, percent: 100, done: true });
  });

  it('a verificação não mexe no projecto do aluno', () => {
    const ex = exercise();
    const P = structuredClone(ex.solution!);
    checkExercise(ex, P);
    expect(P).toEqual(ex.solution);
  });

  it('aparelho apagado pelo aluno: o objectivo falha sem erro', () => {
    const ex = exercise();
    const P = structuredClone(ex.solution!);
    P.devices = P.devices.filter((d) => d.name !== 'H1');
    expect(checkObjective(ex.objectives[0]!, P)).toBe(false);
  });

  it('«toggles»: cada comutador muda a lâmpada (comando de escada)', () => {
    const P = createProject();
    const G = addDevice(P, 'grid1ph', { name: 'G1' });
    const S1 = addDevice(P, 'stairSwitch', { name: 'S1' });
    const S2 = addDevice(P, 'stairSwitch', { name: 'S2' });
    const H = addDevice(P, 'lampIncandescent', { name: 'H1' });
    addWire(P, G, 'L', S1, 'C');
    addWire(P, S1, '1', S2, '1');
    addWire(P, S1, '2', S2, '2');
    addWire(P, S2, 'C', H, 'L');
    addWire(P, G, 'N', H, 'N');
    const o = { id: 't', text: { text: '' }, rule: { type: 'toggles' as const, device: 'H1', steps: [{ op: 'S1', action: 'toggle' }, { op: 'S2', action: 'toggle' }] } };
    expect(checkObjective(o, P)).toBe(true);
    // Um só comutador ligado: S2 já não muda nada.
    const bad = structuredClone(P);
    bad.wires = bad.wires.filter((w) => !(w.a.terminal === '2' && w.b.terminal === '2'));
    bad.devices.find((d) => d.name === 'S2')!.state.pos = 1;
    expect(checkObjective(o, bad)).toBe(false);
  });
});

describe('verificação de conformidade', () => {
  it('ponto de luz correcto: as regras aplicáveis passam', () => {
    const sim = new Simulator(lightPoint().solution);
    sim.operate('S1', 'switch_on');
    sim.run(0.5);
    const r = Object.fromEntries(checkCompliance(sim).map((x) => [x.id, x.status]));
    expect(r).toMatchObject({ ib_in_iz: 'pass', voltage_drop: 'pass', colors: 'pass', switch_phase: 'pass', breaking_capacity: 'pass', rcd_sockets: 'na', tt_touch: 'na' });
  });

  it('In > Iz, tomada sem diferencial, Icn insuficiente e TT com Ra × IΔn > 50 V falham', () => {
    const P = createProject();
    const G = addDevice(P, 'grid1ph', { params: { earthing: 'TT', Zs: 0.005 } });
    const R = addDevice(P, 'rcd2p', { params: { IDn: 300 } });
    const Q = addDevice(P, 'mcb1pn', { params: { In: 32, Icn: 3 } });
    const X = addDevice(P, 'socket', { params: { appliance: 'kettle' } });
    const E = addDevice(P, 'earthElectrode', { params: { Ra: 500 } });
    addWire(P, G, 'L', Q, '1', { section: 10, length: 0.5 });
    addWire(P, G, 'N', Q, '3', { section: 10, length: 0.5 });
    addWire(P, Q, '2', X, 'L', { section: 2.5 });
    addWire(P, Q, '4', X, 'N', { section: 2.5 });
    addWire(P, X, 'PE', E, 'PE', { section: 2.5 });
    const sim = new Simulator(P);
    sim.run(0.3);
    const r = Object.fromEntries(checkCompliance(sim).map((x) => [x.id, x]));
    expect(r.ib_in_iz!.status).toBe('fail');
    expect(r.ib_in_iz!.items[0]!.values).toMatchObject({ in: '32 A', iz: '24 A' });
    expect(r.rcd_sockets!.status).toBe('fail');
    expect(r.breaking_capacity!.status).toBe('fail');
    expect(r.tt_touch!.status).toBe('fail');
    expect(r.tt_touch!.items[0]!.values.ul).toBe('150 V');
    expect(r.pe!.status).toBe('pass');
    expect(r.tt_touch!.reference).toBe(DEFAULT_RULES.references.tt_touch);
    // O RCD está no esquema mas não protege a tomada: a regra continua a falhar.
    expect(R.params.IDn).toBe(300);
  });

  it('ficheiro de regras: limites próprios, o resto dos valores IEC', () => {
    const rules = parseRuleSet('{"id":"x","name":"Regras X","maxDropOther":2,"references":{"pe":"Regra 5"}}');
    expect(rules).toMatchObject({ name: 'Regras X', maxDropOther: 2, maxDropLighting: 3, touchVoltage: 50 });
    expect(rules.references.pe).toBe('Regra 5');
    expect(rules.references.colors).toBe('IEC 60445');
  });
});

describe('lista de material', () => {
  it('agrupa aparelhos iguais e soma os metros de cabo por secção e cor', () => {
    const P = createProject();
    const G = addDevice(P, 'grid1ph');
    const Q1 = addDevice(P, 'mcb1pn', { params: { In: 10 } });
    const Q2 = addDevice(P, 'mcb1pn', { params: { In: 10 } });
    const Q3 = addDevice(P, 'mcb1pn', { params: { In: 16 } });
    addDevice(P, 'note');
    addWire(P, G, 'L', Q1, '1', { section: 2.5, length: 3 });
    addWire(P, G, 'L', Q2, '1', { section: 2.5, length: 4 });
    addWire(P, G, 'N', Q3, '3', { section: 1.5, length: 2 });
    const bom = billOfMaterials(P, defaultRegistry);
    const mcbs = bom.devices.filter((r) => r.type === 'mcb1pn');
    expect(mcbs.map((r) => [r.qty, r.names])).toEqual([[2, ['Q1', 'Q2']], [1, ['Q3']]]);
    expect(mcbs[0]!.spec.find((s) => s.key === 'In')).toMatchObject({ value: 10, unit: 'A' });
    expect(bom.devices.some((r) => r.type === 'note')).toBe(false);
    expect(bom.cables).toEqual([
      { conductor: 'N', section: 1.5, material: 'Cu', length: 2, count: 1 },
      { conductor: 'L1', section: 2.5, material: 'Cu', length: 7, count: 2 },
    ]);
  });
});
