/**
 * Equipamentos industriais: cada um tem três casos (normal, limite e falha).
 * Um teste garante que nenhum equipamento industrial fica sem casos.
 */
import { describe, expect, it } from 'vitest';
import { addDevice, addWire, allDiagnostics, createProject, defaultRegistry, motor3Rated, Simulator, type Device, type Project } from '../index';

type Case = () => void;

function rig(o: { V?: number; level?: 'beginner' | 'pro' } = {}) {
  const P = createProject({ domain: 'industrial', level: o.level ?? 'pro' });
  const G = addDevice(P, 'grid3ph', { params: { V: o.V ?? 400 } });
  const W = (a: Device, ta: string, b: Device, tb: string, section = 2.5) => addWire(P, a, ta, b, tb, { section, length: 2 });
  return { P, G, W };
}
/** As três fases da rede para os terminais dados. */
const feed3 = (W: ReturnType<typeof rig>['W'], G: Device, D: Device, ts = ['1', '3', '5']) => ['L1', 'L2', 'L3'].forEach((l, k) => W(G, l, D, ts[k]!));
const out3 = (W: ReturnType<typeof rig>['W'], A: Device, B: Device, from = ['2', '4', '6'], to = ['U1', 'V1', 'W1']) => from.forEach((t, k) => W(A, t, B, to[k]!));
const state = (sim: Simulator, d: Device | string, key = 'meas.state') => {
  const v = sim.measurements(typeof d === 'string' ? d : d.id).find((x) => x.key === key)?.value;
  return typeof v === 'object' ? v.key.replace(/^state\./, '') : '';
};
const codes = (sim: Simulator) => allDiagnostics(sim).map((d) => d.code);
const st = (sim: Simulator, d: Device) => sim.device(d.id)!.state;

/** Motor de 4 kW alimentado directamente pela rede através de `between` (opcional). */
function motorRig(o: { load?: number; params?: Record<string, any>; through?: string; throughParams?: Record<string, any>; throughState?: Record<string, unknown> } = {}) {
  const { P, G, W } = rig();
  const M = addDevice(P, 'motor3ph', { params: { Pm: 4, load: o.load ?? 100, ...o.params } });
  let X: Device | null = null;
  if (o.through) {
    X = addDevice(P, o.through, { params: o.throughParams, state: o.throughState });
    feed3(W, G, X);
    out3(W, X, M);
  } else feed3(W, G, M, ['U1', 'V1', 'W1']);
  W(G, 'PE', M, 'PE');
  return { P, G, W, M, X: X!, sim: new Simulator(P) };
}

/** Lâmpada de 230 V entre L1 e N através de um contacto do equipamento. */
function lampVia(type: string, a: string, b: string, o: { params?: Record<string, any>; state?: Record<string, unknown> } = {}) {
  const { P, G, W } = rig();
  const D = addDevice(P, type, { params: o.params, state: o.state });
  const H = addDevice(P, 'lampIncandescent');
  W(G, 'L1', D, a);
  W(D, b, H, 'L');
  W(H, 'N', G, 'N');
  return { P, G, W, D, H, sim: new Simulator(P) };
}
const lit = (sim: Simulator, H: Device) => state(sim, H) === 'lit';

/** Bobina alimentada entre L1 e N (comando a 230 V) por um selector. */
function coilRig(type: string, o: { params?: Record<string, any>; V?: number } = {}) {
  const { P, G, W } = rig({ V: o.V });
  const K = addDevice(P, type, { params: o.params });
  const S = addDevice(P, 'selector012', { state: { pos: 1 } });
  W(G, 'L1', S, '13');
  W(S, '14', K, 'A1');
  W(K, 'A2', G, 'N');
  return { P, G, W, K, S, sim: new Simulator(P) };
}

/** Sensor PNP alimentado pelos 24 V do autómato, saída na entrada I0. */
function pnpRig(type: string, powered = true) {
  const { P, G, W } = rig();
  const A = addDevice(P, 'plc', { params: { program: JSON.stringify({ rungs: [{ cols: [[{ op: 'I0' }]], coil: { kind: 'out', op: 'Q0' } }] }) } });
  const B = addDevice(P, type);
  W(G, 'L1', A, 'L');
  W(G, 'N', A, 'N');
  if (powered) W(A, 'L+', B, 'BN');
  W(B, 'BU', A, 'M');
  W(B, 'BK', A, 'I0');
  return { P, A, B, sim: new Simulator(P) };
}

/** Sensor de contacto: lâmpada no NA (13-14) e outra no NF (21-22). */
function contactSensorCases(type: string, on: string, off: string): { normal: Case; limit: Case; fault: Case } {
  const build = () => {
    const { P, G, W } = rig();
    const B = addDevice(P, type);
    const H1 = addDevice(P, 'lampIncandescent');
    const H2 = addDevice(P, 'lampIncandescent');
    W(G, 'L1', B, '13'); W(B, '14', H1, 'L'); W(H1, 'N', G, 'N');
    W(G, 'L1', B, '21'); W(B, '22', H2, 'L'); W(H2, 'N', G, 'N');
    const sim = new Simulator(P);
    sim.step(0.05);
    return { sim, B, H1, H2 };
  };
  return {
    normal: () => {
      const { sim, B, H1, H2 } = build();
      sim.operate(B.id, on);
      expect(lit(sim, H1)).toBe(true);
      expect(lit(sim, H2)).toBe(false);
    },
    limit: () => {
      const { sim, B, H1, H2 } = build();
      expect(state(sim, B)).toBe(off);
      expect(lit(sim, H1)).toBe(false);
      expect(lit(sim, H2)).toBe(true);
    },
    fault: () => {
      const { sim, B, H1 } = build();
      sim.operate(B.id, on);
      sim.operate(B.id, off);
      expect(lit(sim, H1)).toBe(false);
    },
  };
}

/** PNP: detecta → a entrada do autómato liga e Q0 fecha. */
function pnpCases(type: string, on: string): { normal: Case; limit: Case; fault: Case } {
  return {
    normal: () => {
      const { sim, A, B } = pnpRig(type);
      sim.step(0.05);
      sim.operate(B.id, on);
      sim.step(0.05);
      expect(sim.measure(B.id, 'meas.supplyVoltage')).toBeCloseTo(24, 0);
      expect(st(sim, A).q).toBe(1);
    },
    limit: () => {
      const { sim, A } = pnpRig(type);
      sim.step(0.05);
      expect(st(sim, A).q).toBe(0);
    },
    fault: () => {
      // Sem alimentação (BN solto), a saída não liga mesmo a detectar.
      const { sim, A, B } = pnpRig(type, false);
      sim.step(0.05);
      sim.operate(B.id, on);
      sim.step(0.05);
      expect(state(sim, B, 'meas.output')).toBe('off');
      expect(st(sim, A).q).toBe(0);
    },
  };
}

const CASES: Record<string, { normal: Case; limit: Case; fault: Case }> = {
  grid3ph: {
    normal: () => {
      const { P, G } = rig();
      const sim = new Simulator(P);
      expect(sim.measure(G.id, 'meas.lineVoltage')).toBeCloseTo(400, 3);
      expect(sim.measure(G.id, 'meas.phaseVoltage')).toBeCloseTo(400 / Math.sqrt(3), 3);
    },
    limit: () => {
      const { P, G } = rig();
      expect(new Simulator(P).measure(G.id, 'meas.prospectiveIcc3')).toBeCloseTo(400 / (Math.sqrt(3) * 0.03), 6);
    },
    fault: () => {
      const { sim, M, G } = motorRig();
      sim.run(2);
      sim.operate(G.id, 'power_off');
      sim.step(0.05);
      expect(sim.measure(M.id, 'meas.currentL1')).toBeLessThan(1e-3);
    },
  },
  mcb3p: {
    normal: () => {
      const { P, G, W } = rig();
      const Q = addDevice(P, 'mcb3p', { params: { In: 16 } });
      const E = addDevice(P, 'heater3ph', { params: { P: 6 } });
      feed3(W, G, Q);
      out3(W, Q, E, ['2', '4', '6'], ['L1', 'L2', 'L3']);
      const sim = new Simulator(P);
      sim.run(5);
      expect(sim.measure(Q.id, 'meas.currentL1')).toBeCloseTo(6000 / (Math.sqrt(3) * 400), 1);
      expect(st(sim, Q).closed).toBe(true);
    },
    limit: () => {
      // 6 kW (8,7 A) num disjuntor de 6 A: 1,44 · In dispara pelo térmico em minutos, não de imediato.
      const { P, G, W } = rig();
      const Q = addDevice(P, 'mcb3p', { params: { In: 6 } });
      const E = addDevice(P, 'heater3ph', { params: { P: 6 } });
      feed3(W, G, Q);
      out3(W, Q, E, ['2', '4', '6'], ['L1', 'L2', 'L3']);
      const sim = new Simulator(P);
      sim.run(10);
      expect(st(sim, Q).closed).toBe(true);
      sim.run(400, 0.5, (s) => !s.device(Q.id)!.state.closed);
      expect(st(sim, Q).trip).toBe('thermal');
      expect(sim.t).toBeGreaterThan(100);
    },
    fault: () => {
      const { P, G, W } = rig();
      const Q = addDevice(P, 'mcb3p', { params: { In: 16 } });
      const Z = addDevice(P, 'shortCircuit', { state: { active: true } });
      feed3(W, G, Q);
      W(Q, '2', Z, '1');
      W(Q, '4', Z, '2');
      const sim = new Simulator(P);
      sim.step(0.02);
      expect(st(sim, Q).trip).toBe('magnetic');
      expect(codes(sim)).toContain('MCB_MAGNETIC_TRIP');
    },
  },
  mcb4p: {
    normal: () => {
      const { P, G, W } = rig();
      const Q = addDevice(P, 'mcb4p');
      const H = addDevice(P, 'lampIncandescent');
      feed3(W, G, Q);
      W(G, 'N', Q, '7');
      W(Q, '2', H, 'L');
      W(Q, '8', H, 'N');
      const sim = new Simulator(P);
      expect(lit(sim, H)).toBe(true);
    },
    limit: () => {
      const { P, G, W } = rig();
      const Q = addDevice(P, 'mcb4p', { state: { closed: false } });
      const H = addDevice(P, 'lampIncandescent');
      feed3(W, G, Q);
      W(G, 'N', Q, '7');
      W(Q, '2', H, 'L');
      W(Q, '8', H, 'N');
      expect(lit(new Simulator(P), H)).toBe(false);
    },
    fault: () => {
      const { P, G, W } = rig();
      const Q = addDevice(P, 'mcb4p', { params: { In: 10 } });
      const Z = addDevice(P, 'shortCircuit', { state: { active: true } });
      feed3(W, G, Q);
      W(G, 'N', Q, '7');
      W(Q, '6', Z, '1');
      W(Q, '8', Z, '2');
      const sim = new Simulator(P);
      sim.step(0.02);
      expect(st(sim, Q).trip).toBe('magnetic');
    },
  },
  motorBreaker: {
    normal: () => {
      const { sim, M, X } = motorRig({ through: 'motorBreaker', throughParams: { Ir: 8 } });
      sim.run(5);
      expect(state(sim, M)).toBe('running');
      expect(st(sim, X).closed).toBe(true);
    },
    limit: () => {
      // Ir = 5 A para um motor de 7,7 A: 1,55 · Ir → t = 400 / (1,55² − 1,12²) ≈ 350 s.
      // (Com Ir = 4 A, o magnético a 13 · Ir = 52 A dispararia logo no arranque de 54 A.)
      const { sim, X } = motorRig({ through: 'motorBreaker', throughParams: { Ir: 5 } });
      sim.run(600, 0.5, (s) => !s.device(X.id)!.state.closed);
      expect(st(sim, X).trip).toBe('thermal');
      expect(sim.t).toBeGreaterThan(250);
      expect(sim.t).toBeLessThan(450);
      expect(codes(sim)).toContain('MOTOR_OVERLOAD');
    },
    fault: () => {
      const { P, G, W } = rig();
      const Q = addDevice(P, 'motorBreaker', { params: { Ir: 8 } });
      const Z = addDevice(P, 'shortCircuit', { state: { active: true } });
      feed3(W, G, Q);
      W(Q, '2', Z, '1');
      W(Q, '4', Z, '2');
      const sim = new Simulator(P);
      sim.step(0.02);
      expect(st(sim, Q).trip).toBe('magnetic');
    },
  },
  thermalRelay: {
    normal: () => {
      const { sim, X } = motorRig({ through: 'thermalRelay', throughParams: { Ir: 8 }, load: 80 });
      sim.run(30);
      expect(st(sim, X).tripped).toBe(false);
      expect(sim.measure(X.id, 'meas.thermal')).toBeLessThan(100);
    },
    limit: () => {
      // 7,7 A com Ir = 5,1 A: 1,5 · Ir → t = 400 / (1,5² − 1,12²) ≈ 400 s (classe 10).
      const { sim, X } = motorRig({ through: 'thermalRelay', throughParams: { Ir: 5.15 } });
      sim.run(600, 0.5, (s) => !!s.device(X.id)!.state.tripped);
      expect(st(sim, X).tripped).toBe(true);
      expect(sim.t).toBeGreaterThan(300);
      expect(sim.t).toBeLessThan(500);
    },
    fault: () => {
      // Falta de fase: o motor parado não arranca, a corrente sobe e o relé dispara em segundos.
      const { sim, P, X } = motorRig({ through: 'thermalRelay', throughParams: { Ir: 8 } });
      P.wires.find((w) => w.b.terminal === 'W1')!.fault = { cut: true };
      sim.setProject(P);
      sim.run(60, 0.5, (s) => !!s.device(X.id)!.state.tripped);
      expect(st(sim, X).tripped).toBe(true);
      expect(sim.t).toBeLessThan(20);
      expect(codes(sim)).toContain('OVERLOAD_PHASE_LOSS');
    },
  },
  phaseMonitor: {
    normal: () => {
      const { P, G, W } = rig();
      const F = addDevice(P, 'phaseMonitor');
      feed3(W, G, F, ['L1', 'L2', 'L3']);
      const sim = new Simulator(P);
      sim.step(0.05);
      expect(st(sim, F).ok).toBe(true);
    },
    limit: () => {
      const { P, G, W } = rig();
      const Z = addDevice(P, 'phaseReversal', { state: { active: true } });
      const F = addDevice(P, 'phaseMonitor');
      feed3(W, G, Z);
      out3(W, Z, F, ['2', '4', '6'], ['L1', 'L2', 'L3']);
      const sim = new Simulator(P);
      sim.step(0.05);
      expect(st(sim, F).check).toBe('wrong_sequence');
    },
    fault: () => {
      const { P, G, W } = rig();
      const Z = addDevice(P, 'phaseLoss', { state: { active: true } });
      const F = addDevice(P, 'phaseMonitor');
      feed3(W, G, Z);
      out3(W, Z, F, ['2', '4', '6'], ['L1', 'L2', 'L3']);
      const sim = new Simulator(P);
      sim.step(0.05);
      expect(st(sim, F).check).toBe('phase_missing');
      expect(st(sim, F).ok).toBe(false);
    },
  },
  heater3ph: {
    normal: () => {
      const { P, G, W } = rig();
      const E = addDevice(P, 'heater3ph', { params: { P: 6 } });
      feed3(W, G, E, ['L1', 'L2', 'L3']);
      W(G, 'PE', E, 'PE');
      expect(new Simulator(P).measure(E.id, 'meas.activePower')).toBeCloseTo(6000, -2);
    },
    limit: () => {
      // Sem L3: duas resistências em série entre L1 e L2 → metade da potência.
      const { P, G, W } = rig();
      const E = addDevice(P, 'heater3ph', { params: { P: 6 } });
      W(G, 'L1', E, 'L1');
      W(G, 'L2', E, 'L2');
      const Pw = new Simulator(P).measure(E.id, 'meas.activePower');
      expect(Pw / 3000).toBeCloseTo(1, 1);
    },
    fault: () => {
      const { P, G, W } = rig();
      const E = addDevice(P, 'heater3ph');
      feed3(W, G, E, ['L1', 'L2', 'L3']);
      expect(codes(new Simulator(P))).toContain('PE_MISSING');
    },
  },
  capacitorBank: {
    normal: () => {
      const { P, G, W } = rig();
      const C = addDevice(P, 'capacitorBank', { params: { Q: 10 } });
      feed3(W, G, C, ['L1', 'L2', 'L3']);
      expect(new Simulator(P).measure(C.id, 'meas.reactivePower')).toBeCloseTo(-10000, -2);
    },
    limit: () => {
      const { P, G, W } = rig();
      const C = addDevice(P, 'capacitorBank', { state: { on: false } });
      feed3(W, G, C, ['L1', 'L2', 'L3']);
      expect(new Simulator(P).measure(C.id, 'meas.current')).toBeLessThan(1e-3);
    },
    fault: () => {
      // Correcção do factor de potência: o motor com a bateria pede menos corrente à rede.
      const run = (withC: boolean) => {
        const { sim, P, G, W } = motorRig({ load: 100 });
        if (withC) {
          const C = addDevice(P, 'capacitorBank', { params: { Q: 2.5 } });
          feed3(W, G, C, ['L1', 'L2', 'L3']);
          sim.setProject(P);
        }
        sim.run(5);
        return { I: sim.measure(G.id, 'meas.currentL1'), pf: sim.measure(G.id, 'meas.powerFactor') };
      };
      const a = run(false);
      const b = run(true);
      expect(b.pf).toBeGreaterThan(a.pf);
      expect(b.I).toBeLessThan(a.I);
    },
  },
  powerAnalyzer: {
    normal: () => {
      const { P, G, W } = rig();
      const A = addDevice(P, 'powerAnalyzer');
      const E = addDevice(P, 'heater3ph', { params: { P: 6 } });
      feed3(W, G, A, ['1', '3', '5']);
      W(G, 'N', A, '7');
      out3(W, A, E, ['2', '4', '6'], ['L1', 'L2', 'L3']);
      const sim = new Simulator(P);
      expect(sim.measure(A.id, 'meas.activePower')).toBeCloseTo(6000, -2);
      expect(sim.measure(A.id, 'meas.powerFactor')).toBeCloseTo(1, 3);
    },
    limit: () => {
      const { P, G, W } = rig();
      const A = addDevice(P, 'powerAnalyzer');
      const M = addDevice(P, 'motor3ph', { params: { load: 100 } });
      feed3(W, G, A, ['1', '3', '5']);
      W(G, 'N', A, '7');
      out3(W, A, M);
      const sim = new Simulator(P);
      sim.run(5);
      expect(sim.measure(A.id, 'meas.powerFactor')).toBeCloseTo(0.85, 1);
    },
    fault: () => {
      const { P, G, W } = rig();
      const A = addDevice(P, 'powerAnalyzer');
      const E = addDevice(P, 'heater3ph');
      feed3(W, G, A, ['1', '3', '5']);
      W(G, 'N', A, '7');
      W(A, '2', E, 'L1');
      W(A, '4', E, 'L2');
      expect(new Simulator(P).measure(A.id, 'meas.currentL3')).toBeLessThan(1e-3);
    },
  },
  phaseSequenceMeter: {
    normal: () => {
      const { P, G, W } = rig();
      const S = addDevice(P, 'phaseSequenceMeter');
      feed3(W, G, S, ['L1', 'L2', 'L3']);
      expect(state(new Simulator(P), S)).toBe('sequence_direct');
    },
    limit: () => {
      const { P, G, W } = rig();
      const S = addDevice(P, 'phaseSequenceMeter');
      W(G, 'L1', S, 'L1');
      W(G, 'L3', S, 'L2');
      W(G, 'L2', S, 'L3');
      expect(state(new Simulator(P), S)).toBe('sequence_inverse');
    },
    fault: () => {
      const { P, G, W } = rig();
      const S = addDevice(P, 'phaseSequenceMeter');
      W(G, 'L1', S, 'L1');
      W(G, 'L2', S, 'L2');
      expect(state(new Simulator(P), S)).toBe('phase_missing');
    },
  },
  phaseLoss: {
    normal: () => {
      const { sim, M } = motorRig({ through: 'phaseLoss' });
      sim.run(4);
      expect(state(sim, M)).toBe('running');
    },
    limit: () => {
      const { sim, M } = motorRig({ through: 'phaseLoss', throughParams: { phase: 'L1' }, throughState: { active: true } });
      sim.run(1);
      const d = allDiagnostics(sim).find((x) => x.code === 'MOTOR_PHASE_LOSS');
      expect(d?.values.terminal).toBe('U1');
      expect(state(sim, M)).toBe('phase_loss');
    },
    fault: () => {
      const { sim, X } = motorRig({ through: 'phaseLoss', throughState: { active: true } });
      sim.run(1);
      const d = allDiagnostics(sim).find((x) => x.code === 'MOTOR_PHASE_LOSS');
      expect(d?.values).toMatchObject({ phase: 'L3', terminal: 'W1', from: X.name });
    },
  },
  phaseReversal: {
    normal: () => {
      const { sim, M } = motorRig({ through: 'phaseReversal' });
      sim.run(4);
      expect(state(sim, M, 'meas.direction')).toBe('forward');
    },
    limit: () => {
      const { sim, M } = motorRig({ through: 'phaseReversal', throughState: { active: true } });
      sim.run(4);
      expect(state(sim, M, 'meas.direction')).toBe('reverse');
      expect(state(sim, M)).toBe('running');
    },
    fault: () => {
      // Inverter a sequência com o motor em marcha: trava em contracorrente e roda ao contrário.
      const { sim, M, X } = motorRig({ through: 'phaseReversal', load: 50 });
      sim.run(4);
      sim.operate(X.id, 'activate');
      sim.run(0.1);
      expect(sim.measure(M.id, 'meas.currentL1')).toBeGreaterThan(5 * motor3Rated(4, 0.88, 0.85));
      sim.run(8);
      expect(state(sim, M, 'meas.direction')).toBe('reverse');
    },
  },
  contactor3p: {
    normal: () => {
      const { sim, K } = coilRig('contactor3p');
      sim.step(0.05);
      expect(state(sim, K)).toBe('energized');
    },
    limit: () => {
      // Actua acima de 0,75 · Uc: com a rede a 0,74 · 400 V não actua; a 0,76 · 400 V actua.
      const below = coilRig('contactor3p', { V: 0.74 * 400 });
      below.sim.step(0.05);
      expect(state(below.sim, below.K)).toBe('deenergized');
      const above = coilRig('contactor3p', { V: 0.76 * 400 });
      above.sim.step(0.05);
      expect(state(above.sim, above.K)).toBe('energized');
    },
    fault: () => {
      const { sim, K } = coilRig('contactor3p', { params: { Uc: 24 } });
      sim.run(1);
      expect(state(sim, K)).toBe('coil_burnt');
      expect(allDiagnostics(sim).find((d) => d.code === 'COIL_VOLTAGE')?.values.rated).toBe('24 V');
    },
  },
  auxRelay: {
    normal: () => {
      const { P, G, W } = rig();
      const K = addDevice(P, 'auxRelay');
      const H = addDevice(P, 'lampIncandescent');
      W(G, 'L1', K, 'A1'); W(K, 'A2', G, 'N');
      W(G, 'L1', K, '23'); W(K, '24', H, 'L'); W(H, 'N', G, 'N');
      const sim = new Simulator(P);
      sim.step(0.05);
      expect(lit(sim, H)).toBe(true);
    },
    limit: () => {
      // Histerese: actua a 0,75 · Uc e só larga abaixo de 0,5 · Uc.
      const { sim, K, G } = coilRig('auxRelay');
      sim.step(0.05);
      sim.device(G.id)!.params.V = 0.6 * 400;
      sim.setProject(sim.project);
      sim.step(0.05);
      expect(state(sim, K)).toBe('energized');
      sim.device(G.id)!.params.V = 0.45 * 400;
      sim.setProject(sim.project);
      sim.step(0.05);
      expect(state(sim, K)).toBe('deenergized');
    },
    fault: () => {
      const { P, G, W } = rig();
      const K = addDevice(P, 'auxRelay');
      W(G, 'L1', K, '31'); W(K, '32', K, 'A1'); W(K, 'A2', G, 'N');
      const sim = new Simulator(P);
      sim.step(0.05);
      const d = allDiagnostics(sim).find((x) => x.code === 'CONTROL_UNSTABLE');
      expect(d?.values.device).toBe(K.name);
    },
  },
  timerOn: {
    normal: () => {
      const { P, sim, K } = coilRig('timerOn', { params: { t: 2 } });
      const H = addDevice(P, 'lampIncandescent');
      addWire(P, P.devices[0]!, 'L1', K, '15');
      addWire(P, K, '18', H, 'L');
      addWire(P, H, 'N', P.devices[0]!, 'N');
      sim.setProject(P);
      sim.run(1.9);
      expect(lit(sim, H)).toBe(false);
      sim.run(0.2);
      expect(lit(sim, H)).toBe(true);
    },
    limit: () => {
      const { sim, K } = coilRig('timerOn', { params: { t: 1 } });
      sim.run(0.95);
      expect(st(sim, K).out).toBe(false);
      expect(state(sim, K)).toBe('timing');
    },
    fault: () => {
      const { sim, K, S } = coilRig('timerOn', { params: { t: 1 } });
      sim.run(0.6);
      sim.operate(S.id, 'pos_0');
      sim.run(0.6);
      sim.operate(S.id, 'pos_1');
      sim.run(0.6);
      // A contagem recomeça: 0,6 s depois de voltar a ligar ainda não comutou.
      expect(st(sim, K).out).toBe(false);
    },
  },
  timerOff: {
    normal: () => {
      const { sim, K } = coilRig('timerOff', { params: { t: 2 } });
      sim.step(0.05);
      expect(st(sim, K).out).toBe(true);
    },
    limit: () => {
      const { sim, K, S } = coilRig('timerOff', { params: { t: 2 } });
      sim.step(0.05);
      sim.operate(S.id, 'pos_0');
      sim.run(1.9);
      expect(st(sim, K).out).toBe(true);
      sim.run(0.2);
      expect(st(sim, K).out).toBe(false);
    },
    fault: () => {
      const { P, G, W } = rig();
      const K = addDevice(P, 'timerOff');
      W(G, 'L1', K, 'A1');
      const sim = new Simulator(P);
      sim.run(1);
      expect(st(sim, K).out).toBe(false);
      expect(codes(sim)).toContain('LOAD_NO_RETURN');
    },
  },
  buttonNO: {
    normal: () => {
      const { sim, D, H } = lampVia('buttonNO', '13', '14');
      sim.operate(D.id, 'press', 'down');
      expect(lit(sim, H)).toBe(true);
    },
    limit: () => {
      const { sim, D, H } = lampVia('buttonNO', '13', '14');
      sim.operate(D.id, 'press', 'down');
      sim.operate(D.id, 'press', 'up');
      expect(lit(sim, H)).toBe(false);
    },
    fault: () => {
      const { sim, S1, M } = dol({ hold: false });
      sim.operate(S1.id, 'press', 'down');
      sim.run(3);
      sim.operate(S1.id, 'press', 'up');
      sim.run(0.5);
      expect(state(sim, M)).not.toBe('running');
      expect(codes(sim)).toContain('MOTOR_NO_HOLD');
    },
  },
  buttonNC: {
    normal: () => {
      const { sim, H } = lampVia('buttonNC', '11', '12');
      expect(lit(sim, H)).toBe(true);
    },
    limit: () => {
      const { sim, D, H } = lampVia('buttonNC', '11', '12');
      sim.operate(D.id, 'press', 'down');
      expect(lit(sim, H)).toBe(false);
    },
    fault: () => {
      // Botão no neutro.
      const { P, G, W } = rig();
      const S = addDevice(P, 'buttonNC');
      const H = addDevice(P, 'lampIncandescent');
      W(G, 'L1', H, 'L'); W(H, 'N', S, '11'); W(S, '12', G, 'N');
      expect(codes(new Simulator(P))).toContain('SWITCH_ON_NEUTRAL');
    },
  },
  emergencyStop: {
    normal: () => {
      const { sim, H } = lampVia('emergencyStop', '11', '12');
      expect(lit(sim, H)).toBe(true);
    },
    limit: () => {
      const { sim, D, H } = lampVia('emergencyStop', '11', '12');
      sim.operate(D.id, 'press_latch');
      sim.run(1);
      expect(lit(sim, H)).toBe(false);
      sim.operate(D.id, 'unlatch');
      expect(lit(sim, H)).toBe(true);
    },
    fault: () => {
      const { P, sim, S1, M, S0 } = dol();
      // Trocar a botoneira de paragem por uma emergência no mesmo sítio.
      S0.type = 'emergencyStop';
      sim.setProject(P);
      sim.operate(S1.id, 'press', 'down');
      sim.run(0.2);
      sim.operate(S1.id, 'press', 'up');
      sim.run(3);
      expect(state(sim, M)).toBe('running');
      sim.operate(S0.id, 'press_latch');
      sim.run(5);
      expect(state(sim, M)).not.toBe('running');
    },
  },
  selector012: {
    normal: () => {
      const { sim, H } = lampVia('selector012', '13', '14', { state: { pos: 1 } });
      expect(lit(sim, H)).toBe(true);
    },
    limit: () => {
      const { sim, H } = lampVia('selector012', '13', '14');
      expect(lit(sim, H)).toBe(false);
    },
    fault: () => {
      const { sim, D, H } = lampVia('selector012', '13', '14');
      sim.operate(D.id, 'pos_2');
      expect(lit(sim, H)).toBe(false);
      expect(st(sim, D).pos).toBe(2);
    },
  },
  pilotLight: {
    normal: () => {
      const { P, G, W } = rig();
      const H = addDevice(P, 'pilotLight');
      W(G, 'L1', H, 'X1'); W(H, 'X2', G, 'N');
      expect(state(new Simulator(P), H)).toBe('lit');
    },
    limit: () => {
      const { P, G, W } = rig();
      const H = addDevice(P, 'pilotLight', { params: { Vn: 24 } });
      W(G, 'L1', H, 'X1'); W(H, 'X2', G, 'N');
      const sim = new Simulator(P);
      sim.run(1);
      expect(state(sim, H)).toBe('burnt');
      expect(codes(sim)).toContain('WRONG_VOLTAGE');
    },
    fault: () => {
      const { P, G, W } = rig();
      const H = addDevice(P, 'pilotLight');
      W(G, 'L1', H, 'X1'); W(H, 'X2', G, 'L2');
      const ds = allDiagnostics(new Simulator(P));
      expect(ds.find((d) => d.code === 'LOAD_PHASE_PHASE')?.values).toMatchObject({ device: H.name, voltage: '400 V', nominal: '230 V' });
    },
  },
  limitSwitch: contactSensorCases('limitSwitch', 'actuated', 'released'),
  floatSwitch: contactSensorCases('floatSwitch', 'level_high', 'level_low'),
  pressureSwitch: contactSensorCases('pressureSwitch', 'pressure_high', 'pressure_low'),
  inductiveSensor: pnpCases('inductiveSensor', 'target_present'),
  photocell: pnpCases('photocell', 'beam_cut'),
  motor3ph: {
    normal: () => {
      // 4 kW, η 0,88, FP 0,85 a 400 V: In = 7,72 A.
      const { sim, M } = motorRig({ load: 100 });
      sim.run(5);
      expect(state(sim, M)).toBe('running');
      expect(sim.measure(M.id, 'meas.currentL1') / 7.72).toBeCloseTo(1, 1);
      expect(sim.measure(M.id, 'meas.powerFactor')).toBeCloseTo(0.85, 2);
    },
    limit: () => {
      // Motor 230/400 V ligado em triângulo numa rede de 400 V: os enrolamentos recebem 400 V e queimam.
      const { sim, M } = motorRig({ params: { connection: 'delta' } });
      sim.run(4);
      expect(state(sim, M)).toBe('burnt');
      expect(allDiagnostics(sim).find((d) => d.code === 'WRONG_VOLTAGE')?.values).toMatchObject({ device: M.name, nominal: '230 V' });
    },
    fault: () => {
      const { P, G, W } = rig();
      const M = addDevice(P, 'motor3ph', { state: { locked: true } });
      feed3(W, G, M, ['U1', 'V1', 'W1']);
      W(G, 'PE', M, 'PE');
      const sim = new Simulator(P);
      sim.run(8);
      expect(sim.measure(M.id, 'meas.speed')).toBe(0);
      expect(sim.measure(M.id, 'meas.currentL1')).toBeGreaterThan(6 * 7.72);
      expect(codes(sim)).toContain('MOTOR_STALLED');
    },
  },
  starDeltaStarter: {
    normal: () => {
      const { sim, KS } = sdRig(3);
      sim.run(1);
      expect(st(sim, KS).stage).toBe('star');
      sim.run(2.2);
      expect(st(sim, KS).stage).toBe('delta');
      expect(sim.events.some((e) => e.code === 'star_delta_switch')).toBe(true);
    },
    limit: () => {
      // Corrente de arranque em estrela ≈ 1/3 do arranque directo em triângulo.
      const { sim, M } = sdRig(3);
      sim.step(0.02);
      const Istar = sim.measure(M.id, 'meas.currentL1');
      const dolRig = motorRig({ params: { Pm: 7.5, Vn: '400/690', connection: 'delta', load: 60 } });
      dolRig.sim.step(0.02);
      const Idol = dolRig.sim.measure(dolRig.M.id, 'meas.currentL1');
      expect(Istar / Idol).toBeCloseTo(1 / 3, 1);
    },
    fault: () => {
      const { sim, KS, S } = sdRig(3);
      sim.operate(S.id, 'pos_0');
      sim.run(1);
      expect(st(sim, KS).stage).toBe('off');
    },
  },
  softStarter: {
    normal: () => {
      const { sim, X, M } = ssRig();
      sim.run(1);
      expect(st(sim, X).stage).toBe('ramp');
      sim.run(5);
      expect(st(sim, X).stage).toBe('bypass');
      expect(state(sim, M)).toBe('running');
    },
    limit: () => {
      const { sim, M } = ssRig();
      sim.step(0.02);
      const Iss = sim.measure(M.id, 'meas.currentL1');
      const d = motorRig();
      d.sim.step(0.02);
      expect(Iss).toBeLessThan(0.6 * d.sim.measure(d.M.id, 'meas.currentL1'));
    },
    fault: () => {
      const { sim, X, S } = ssRig();
      sim.operate(S.id, 'pos_0');
      sim.run(1);
      expect(st(sim, X).stage).toBe('off');
    },
  },
  vfd: {
    normal: () => {
      const { sim, U, M } = vfdRig();
      sim.operate(U.id, 'run_fwd');
      sim.run(8);
      expect(sim.measure(U.id, 'meas.frequency')).toBe(50);
      expect(state(sim, M)).toBe('running');
      expect(sim.measure(M.id, 'meas.speed')).toBeGreaterThan(1400);
      expect(sim.measure(U.id, 'meas.thdI')).toBeGreaterThan(30);
    },
    limit: () => {
      const { sim, U, M, P } = vfdRig();
      U.params.fTarget = 25;
      sim.setProject(P);
      sim.operate(U.id, 'run_fwd');
      sim.run(8);
      expect(sim.measure(M.id, 'meas.speed') / 750).toBeCloseTo(1, 1);
    },
    fault: () => {
      const { sim, U } = vfdRig();
      sim.operate(U.id, 'run_fwd');
      sim.run(3);
      sim.project.wires.find((w) => w.b.device === U.id && w.b.terminal === 'L3')!.fault = { cut: true };
      sim.setProject(sim.project);
      sim.run(0.5);
      expect(codes(sim)).toContain('VFD_UNDERVOLTAGE');
      expect(sim.measure(U.id, 'meas.frequency')).toBe(0);
    },
  },
  plc: {
    normal: () => {
      const { sim, S1, S0, M } = plcRig();
      sim.operate(S1.id, 'press', 'down');
      sim.run(0.2);
      sim.operate(S1.id, 'press', 'up');
      sim.run(3);
      expect(state(sim, M)).toBe('running');
      sim.operate(S0.id, 'press', 'down');
      sim.run(0.2);
      sim.operate(S0.id, 'press', 'up');
      sim.run(5);
      expect(state(sim, M)).not.toBe('running');
    },
    limit: () => {
      const { sim, A, S1 } = plcRig();
      sim.operate(A.id, 'plc_stop');
      sim.operate(S1.id, 'press', 'down');
      sim.run(0.5);
      expect(st(sim, A).q).toBe(0);
    },
    fault: () => {
      const { sim, A, S1, P } = plcRig();
      P.wires.find((w) => w.b.device === A.id && w.b.terminal === 'L')!.fault = { cut: true };
      sim.setProject(P);
      sim.operate(S1.id, 'press', 'down');
      sim.run(0.5);
      expect(state(sim, A)).toBe('no_power');
      expect(st(sim, A).q).toBe(0);
    },
  },
};

/** Arranque directo com disjuntor-motor, contactor, relé térmico e botoneiras. */
function dol(o: { hold?: boolean } = {}) {
  const { P, G, W } = rig();
  const Q = addDevice(P, 'motorBreaker', { params: { Ir: 8 } });
  const K = addDevice(P, 'contactor3p');
  const F = addDevice(P, 'thermalRelay', { params: { Ir: 7.8 } });
  const M = addDevice(P, 'motor3ph', { params: { Pm: 4, load: 80 } });
  const S0 = addDevice(P, 'buttonNC');
  const S1 = addDevice(P, 'buttonNO');
  feed3(W, G, Q);
  out3(W, Q, K, ['2', '4', '6'], ['1', '3', '5']);
  out3(W, K, F, ['2', '4', '6'], ['1', '3', '5']);
  out3(W, F, M);
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

function sdRig(t: number) {
  const { P, G, W } = rig();
  const KS = addDevice(P, 'starDeltaStarter', { params: { t } });
  const M = addDevice(P, 'motor3ph', { params: { Pm: 7.5, Vn: '400/690', connection: 'external', load: 60 } });
  const S = addDevice(P, 'selector012', { state: { pos: 1 } });
  feed3(W, G, KS);
  for (const x of ['U1', 'V1', 'W1', 'W2', 'U2', 'V2']) W(KS, x, M, x);
  W(G, 'L1', S, '13');
  W(S, '14', KS, 'A1');
  W(KS, 'A2', G, 'N');
  return { P, KS, M, S, sim: new Simulator(P) };
}

function ssRig() {
  const { P, G, W } = rig();
  const X = addDevice(P, 'softStarter', { params: { tRamp: 4, U0: 40 } });
  const M = addDevice(P, 'motor3ph', { params: { load: 60 } });
  const S = addDevice(P, 'selector012', { state: { pos: 1 } });
  feed3(W, G, X);
  out3(W, X, M);
  W(G, 'L1', S, '13');
  W(S, '14', X, 'A1');
  W(X, 'A2', G, 'N');
  return { P, X, M, S, sim: new Simulator(P) };
}

function vfdRig() {
  const { P, G, W } = rig();
  const U = addDevice(P, 'vfd', { params: { tAcc: 4 } });
  const M = addDevice(P, 'motor3ph', { params: { load: 60 } });
  feed3(W, G, U, ['L1', 'L2', 'L3']);
  out3(W, U, M, ['U', 'V', 'W']);
  const sim = new Simulator(P);
  sim.step(0.05);
  return { P, U, M, sim };
}

function plcRig() {
  const { P, G, W } = rig();
  const A = addDevice(P, 'plc');
  const K = addDevice(P, 'contactor3p');
  const M = addDevice(P, 'motor3ph', { params: { load: 60 } });
  const S1 = addDevice(P, 'buttonNO');
  const S0 = addDevice(P, 'buttonNO');
  W(G, 'L1', A, 'L');
  W(G, 'N', A, 'N');
  W(A, 'L+', S1, '13');
  W(S1, '14', A, 'I0');
  W(A, 'L+', S0, '13');
  W(S0, '14', A, 'I1');
  W(G, 'L1', A, '1L');
  W(A, 'Q0', K, 'A1');
  W(K, 'A2', G, 'N');
  feed3(W, G, K);
  out3(W, K, M);
  const sim = new Simulator(P);
  sim.step(0.05);
  return { P, A, K, M, S1, S0, sim };
}

describe('casos por equipamento industrial', () => {
  it('todos os equipamentos industriais têm casos normal, limite e falha', () => {
    const industrial = defaultRegistry.all().filter((d) => d.domain.includes('industrial') && !d.domain.includes('domestic'));
    expect(Object.keys(CASES).sort()).toEqual(industrial.map((d) => d.type).sort());
  });
  for (const [type, c] of Object.entries(CASES)) {
    describe(type, () => {
      it('normal', c.normal);
      it('limite', c.limit);
      it('falha', c.fault);
    });
  }
});


