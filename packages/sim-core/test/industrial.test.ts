/**
 * Critério de aceitação da Fase 4: o arranque directo, a inversão de marcha e o estrela-triângulo
 * funcionam, e as falhas de fase e de auto-retenção são explicadas.
 */
import { describe, expect, it } from 'vitest';
import { addDevice, addWire, allDiagnostics, createProject, motor3Rated, Simulator, whyNotWorking, type Device } from '../index';

const rig = () => {
  const P = createProject({ domain: 'industrial', level: 'pro' });
  const G = addDevice(P, 'grid3ph');
  const W = (a: Device, ta: string, b: Device, tb: string, section = 2.5) => addWire(P, a, ta, b, tb, { section, length: 2 });
  return { P, G, W };
};
const state = (sim: Simulator, d: Device, key = 'meas.state') => {
  const v = sim.measurements(d.id).find((x) => x.key === key)?.value;
  return typeof v === 'object' ? v.key.replace(/^state\./, '') : '';
};
const press = (sim: Simulator, d: Device, hold = 0.2) => {
  sim.operate(d.id, 'press', 'down');
  sim.run(hold);
  sim.operate(d.id, 'press', 'up');
};
const diagOf = (sim: Simulator, code: string) => allDiagnostics(sim).find((d) => d.code === code);

/** Arranque directo: Q1 disjuntor-motor, K1 contactor, F1 relé térmico, M1 motor; S0 paragem, S1 marcha. */
function dol(o: { hold?: boolean } = {}) {
  const { P, G, W } = rig();
  const Q = addDevice(P, 'motorBreaker', { params: { Ir: 8 } });
  const K = addDevice(P, 'contactor3p');
  const F = addDevice(P, 'thermalRelay', { params: { Ir: 7.8 } });
  const M = addDevice(P, 'motor3ph', { params: { Pm: 4, load: 80 } });
  const S0 = addDevice(P, 'buttonNC');
  const S1 = addDevice(P, 'buttonNO');
  ['L1', 'L2', 'L3'].forEach((l, k) => W(G, l, Q, ['1', '3', '5'][k]!));
  for (const [a, b] of [['2', '1'], ['4', '3'], ['6', '5']]) W(Q, a!, K, b!);
  for (const [a, b] of [['2', '1'], ['4', '3'], ['6', '5']]) W(K, a!, F, b!);
  ['U1', 'V1', 'W1'].forEach((t, k) => W(F, ['2', '4', '6'][k]!, M, t));
  W(G, 'PE', M, 'PE');
  W(Q, '2', F, '95', 1.5);
  W(F, '96', S0, '11', 1.5);
  W(S0, '12', S1, '13', 1.5);
  W(S1, '14', K, 'A1', 1.5);
  W(K, 'A2', G, 'N', 1.5);
  if (o.hold !== false) {
    W(S1, '13', K, '13', 1.5);
    W(S1, '14', K, '14', 1.5);
  }
  const sim = new Simulator(P);
  sim.step(0.05);
  return { P, G, Q, K, F, M, S0, S1, sim };
}

describe('arranque directo com auto-retenção', () => {
  it('marcha com S1, continua depois de largar e pára com S0', () => {
    const { sim, M, S0, S1, K } = dol();
    expect(allDiagnostics(sim).filter((d) => d.severity !== 'info')).toEqual([]);
    expect(whyNotWorking(sim, M.id)).toMatchObject({ code: 'COIL_OFF', values: { blocker: K.name } });
    press(sim, S1);
    sim.run(3);
    expect(state(sim, M)).toBe('running');
    expect(sim.measure(M.id, 'meas.speed')).toBeGreaterThan(1400);
    press(sim, S0);
    sim.run(6);
    expect(state(sim, M)).toBe('stopped');
  });

  it('a corrente de arranque é 6 a 8 · In e dura entre 0,3 e 2 s', () => {
    const { sim, M, S1 } = dol();
    press(sim, S1, 0.05);
    const In = motor3Rated(4, 0.88, 0.85);
    expect(sim.measure(M.id, 'meas.currentL1') / In).toBeGreaterThan(6);
    expect(sim.measure(M.id, 'meas.currentL1') / In).toBeLessThan(8);
    const t0 = sim.t;
    sim.run(5, 0.05, (s) => state(s, M) === 'running');
    expect(sim.t - t0).toBeGreaterThan(0.3);
    expect(sim.t - t0).toBeLessThan(2);
  });

  it('o arranque não acusa sobrecarga de cabo (a corrente de arranque é curta)', () => {
    const { sim, S1 } = dol();
    press(sim, S1, 0.05);
    sim.run(0.3);
    expect(diagOf(sim, 'CABLE_OVERLOAD')).toBeUndefined();
  });
});

describe('falha de auto-retenção explicada', () => {
  it('MOTOR_NO_HOLD: o motor pára ao largar S1 e a mensagem diz que contacto ligar', () => {
    const { sim, M, S1, K } = dol({ hold: false });
    press(sim, S1, 2);
    sim.run(0.5);
    expect(state(sim, M)).not.toBe('running');
    const d = diagOf(sim, 'MOTOR_NO_HOLD')!;
    expect(d.values).toMatchObject({ device: M.name, button: S1.name, contactor: K.name, contact: '13-14', a: '13', b: '14' });
    expect(d.targets.map((t) => t.id)).toEqual([K.id, S1.id]);
    // «Porque não funciona?» no motor dá a mesma explicação.
    expect(whyNotWorking(sim, M.id).code).toBe('MOTOR_NO_HOLD');
  });

  it('depois de ligar K1-13 e K1-14 a S1, a mensagem desaparece e a auto-retenção funciona', () => {
    const { sim, M, S1, K } = dol({ hold: false });
    press(sim, S1, 2);
    sim.run(0.5);
    addWire(sim.project, sim.device(S1.id)!, '13', sim.device(K.id)!, '13', { section: 1.5 });
    addWire(sim.project, sim.device(S1.id)!, '14', sim.device(K.id)!, '14', { section: 1.5 });
    sim.setProject(sim.project);
    expect(diagOf(sim, 'MOTOR_NO_HOLD')).toBeUndefined();
    press(sim, S1);
    sim.run(3);
    expect(state(sim, M)).toBe('running');
  });
});

describe('falha de fase explicada', () => {
  it('MOTOR_PHASE_LOSS: «Falta a fase L3 no terminal W1» e «Verifique o cabo de F1-6 para M1-W1»', () => {
    const { sim, M, S1, F, P } = dol();
    sim.project.wires.find((w) => w.b.device === M.id && w.b.terminal === 'W1')!.fault = { cut: true };
    sim.setProject(sim.project);
    press(sim, S1);
    sim.run(1);
    expect(state(sim, M)).toBe('phase_loss');
    expect(sim.measure(M.id, 'meas.speed')).toBe(0);
    const d = diagOf(sim, 'MOTOR_PHASE_LOSS')!;
    expect(d.values).toEqual({ device: M.name, terminal: 'W1', phase: 'L3', from: `${F.name}-6`, to: `${M.name}-W1` });
    expect(d.targets.some((t) => t.kind === 'wire')).toBe(true);
    expect(P.devices.length).toBe(7);
  });

  it('sem a fase, o relé térmico dispara e explica que foi por falta de fase', () => {
    const { sim, M, S1, F } = dol();
    sim.project.wires.find((w) => w.b.device === M.id && w.b.terminal === 'W1')!.fault = { cut: true };
    sim.setProject(sim.project);
    press(sim, S1);
    sim.run(60, 0.5, (s) => !!s.device(F.id)!.state.tripped);
    expect(sim.device(F.id)!.state.tripped).toBe(true);
    expect(diagOf(sim, 'OVERLOAD_PHASE_LOSS')?.values).toMatchObject({ device: F.name, motor: M.name });
    expect(whyNotWorking(sim, M.id).code).toBe('OVERLOAD_PHASE_LOSS');
  });

  it('com o motor em marcha, perder uma fase também é explicado', () => {
    const { sim, M, S1 } = dol();
    press(sim, S1);
    sim.run(3);
    sim.project.wires.find((w) => w.b.device === M.id && w.b.terminal === 'V1')!.fault = { cut: true };
    sim.setProject(sim.project);
    sim.run(1);
    expect(diagOf(sim, 'MOTOR_PHASE_LOSS')?.values).toMatchObject({ terminal: 'V1', phase: 'L2' });
  });
});

describe('inversão de marcha com encravamento', () => {
  function reversing() {
    const { P, G, W } = rig();
    const Q = addDevice(P, 'motorBreaker', { params: { Ir: 8 } });
    const K1 = addDevice(P, 'contactor3p');
    const K2 = addDevice(P, 'contactor3p');
    const F = addDevice(P, 'thermalRelay', { params: { Ir: 7.8 } });
    const M = addDevice(P, 'motor3ph', { params: { load: 60 } });
    const S0 = addDevice(P, 'buttonNC');
    const S1 = addDevice(P, 'buttonNO');
    const S2 = addDevice(P, 'buttonNO');
    ['L1', 'L2', 'L3'].forEach((l, k) => W(G, l, Q, ['1', '3', '5'][k]!));
    // K1 directo; K2 troca L1 com L3.
    W(Q, '2', K1, '1'); W(Q, '4', K1, '3'); W(Q, '6', K1, '5');
    W(Q, '2', K2, '5'); W(Q, '4', K2, '3'); W(Q, '6', K2, '1');
    for (const K of [K1, K2]) for (const [a, b] of [['2', '1'], ['4', '3'], ['6', '5']]) W(K, a!, F, b!);
    ['U1', 'V1', 'W1'].forEach((t, k) => W(F, ['2', '4', '6'][k]!, M, t));
    W(G, 'PE', M, 'PE');
    W(Q, '2', F, '95'); W(F, '96', S0, '11');
    // Marcha à direita: S1 com auto-retenção K1 13-14 e encravamento K2 21-22.
    W(S0, '12', S1, '13'); W(S1, '13', K1, '13'); W(S1, '14', K1, '14'); W(S1, '14', K2, '21'); W(K2, '22', K1, 'A1'); W(K1, 'A2', G, 'N');
    // Marcha à esquerda: S2 com auto-retenção K2 13-14 e encravamento K1 21-22.
    W(S0, '12', S2, '13'); W(S2, '13', K2, '13'); W(S2, '14', K2, '14'); W(S2, '14', K1, '21'); W(K1, '22', K2, 'A1'); W(K2, 'A2', G, 'N');
    const sim = new Simulator(P);
    sim.step(0.05);
    return { sim, M, K1, K2, S0, S1, S2 };
  }

  it('roda à direita com S1 e à esquerda com S2, depois de parar com S0', () => {
    const { sim, M, S0, S1, S2 } = reversing();
    press(sim, S1);
    sim.run(3);
    expect(state(sim, M)).toBe('running');
    expect(state(sim, M, 'meas.direction')).toBe('forward');
    press(sim, S0);
    sim.run(6);
    press(sim, S2);
    sim.run(3);
    expect(state(sim, M)).toBe('running');
    expect(state(sim, M, 'meas.direction')).toBe('reverse');
  });

  it('o encravamento impede K2 de fechar com K1 fechado (sem curto entre fases)', () => {
    const { sim, K1, K2, S1, S2, M } = reversing();
    press(sim, S1);
    sim.run(2);
    press(sim, S2);
    sim.run(0.5);
    expect(sim.device(K1.id)!.state.closed).toBe(true);
    expect(sim.device(K2.id)!.state.closed).toBe(false);
    expect(state(sim, M, 'meas.direction')).toBe('forward');
    expect(allDiagnostics(sim).filter((d) => d.severity === 'error')).toEqual([]);
  });
});

describe('arranque estrela-triângulo com contactores e temporizador', () => {
  function starDelta(t = 4) {
    const { P, G, W } = rig();
    const Q = addDevice(P, 'motorBreaker', { params: { Ir: 15 } });
    const KM1 = addDevice(P, 'contactor3p', { params: { In: 18 } });
    const KM2 = addDevice(P, 'contactor3p');
    const KM3 = addDevice(P, 'contactor3p');
    const KT = addDevice(P, 'timerOn', { params: { t } });
    const F = addDevice(P, 'thermalRelay', { params: { Ir: 8.5 } });
    const M = addDevice(P, 'motor3ph', { params: { Pm: 7.5, Vn: '400/690', connection: 'external', load: 60 } });
    const S0 = addDevice(P, 'buttonNC');
    const S1 = addDevice(P, 'buttonNO');
    ['L1', 'L2', 'L3'].forEach((l, k) => W(G, l, Q, ['1', '3', '5'][k]!));
    W(Q, '2', KM1, '1'); W(Q, '4', KM1, '3'); W(Q, '6', KM1, '5');
    W(KM1, '2', F, '1'); W(KM1, '4', F, '3'); W(KM1, '6', F, '5');
    W(F, '2', M, 'U1'); W(F, '4', M, 'V1'); W(F, '6', M, 'W1'); W(G, 'PE', M, 'PE');
    // KM2 (estrela) une W2, U2 e V2; KM3 (triângulo) liga W2, U2, V2 a L1, L2, L3.
    W(M, 'W2', KM2, '1'); W(M, 'U2', KM2, '3'); W(M, 'V2', KM2, '5'); W(KM2, '2', KM2, '4'); W(KM2, '4', KM2, '6');
    W(Q, '2', KM3, '1'); W(Q, '4', KM3, '3'); W(Q, '6', KM3, '5'); W(KM3, '2', M, 'W2'); W(KM3, '4', M, 'U2'); W(KM3, '6', M, 'V2');
    W(Q, '2', F, '95'); W(F, '96', S0, '11'); W(S0, '12', S1, '13'); W(S1, '13', KM1, '13'); W(S1, '14', KM1, '14');
    W(S1, '14', KM1, 'A1'); W(KM1, 'A2', G, 'N'); W(S1, '14', KT, 'A1'); W(KT, 'A2', G, 'N');
    W(S1, '14', KT, '15'); W(KT, '16', KM3, '21'); W(KM3, '22', KM2, 'A1'); W(KM2, 'A2', G, 'N');
    W(KT, '18', KM2, '21'); W(KM2, '22', KM3, 'A1'); W(KM3, 'A2', G, 'N');
    const sim = new Simulator(P);
    sim.step(0.05);
    return { sim, M, KM1, KM2, KM3, KT, S1 };
  }

  it('arranca em estrela, passa a triângulo ao fim de t e fica em marcha', () => {
    const { sim, M, KM1, KM2, KM3, S1 } = starDelta(4);
    press(sim, S1);
    sim.run(1);
    expect(sim.device(KM1.id)!.state.closed).toBe(true);
    expect(sim.device(KM2.id)!.state.closed).toBe(true);
    expect(sim.device(KM3.id)!.state.closed).toBe(false);
    sim.run(3.5);
    expect(sim.device(KM2.id)!.state.closed).toBe(false);
    expect(sim.device(KM3.id)!.state.closed).toBe(true);
    sim.run(2);
    expect(state(sim, M)).toBe('running');
    expect(sim.measure(M.id, 'meas.speed')).toBeGreaterThan(1450);
    expect(allDiagnostics(sim).filter((d) => d.severity !== 'info')).toEqual([]);
  });

  it('a corrente de arranque em estrela é cerca de 1/3 do arranque directo em triângulo', () => {
    const { sim, M, S1 } = starDelta(4);
    press(sim, S1, 0.05);
    const Istar = sim.measure(M.id, 'meas.currentL1');
    const { P, G, W } = rig();
    const M2 = addDevice(P, 'motor3ph', { params: { Pm: 7.5, Vn: '400/690', connection: 'delta', load: 60 } });
    ['L1', 'L2', 'L3'].forEach((l, k) => W(G, l, M2, ['U1', 'V1', 'W1'][k]!));
    const s2 = new Simulator(P);
    s2.step(0.02);
    expect(Istar / s2.measure(M2.id, 'meas.currentL1')).toBeCloseTo(1 / 3, 1);
  });
});
