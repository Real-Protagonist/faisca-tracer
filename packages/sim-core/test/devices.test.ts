/**
 * Cada equipamento tem três casos: comportamento normal, limite e falha.
 * Um teste garante que nenhum equipamento da biblioteca fica sem casos.
 */
import { describe, expect, it } from 'vitest';
import { addDevice, addWire, createProject, defaultRegistry, lookFrom, rms, Simulator, type Device } from '../index';

type Case = () => void;
interface Cases {
  normal: Case;
  limit: Case;
  fault: Case;
}

/** Rede (TN-S) → disjuntor 1P+N C16 → equipamento entre `tL` e `tN`. */
function fed(type: string, o: { params?: Record<string, any>; state?: Record<string, unknown>; tL?: string; tN?: string | null; V?: number; pe?: boolean; In?: number } = {}) {
  const P = createProject();
  const G = addDevice(P, 'grid1ph', { params: { earthing: 'TN-S', V: o.V ?? 230, Zs: 0.05 } });
  const Q = addDevice(P, 'mcb1pn', { params: { In: o.In ?? 16 } });
  const D = addDevice(P, type, { params: o.params, state: o.state });
  addWire(P, G, 'L', Q, '1', { section: 4, length: 1 });
  addWire(P, G, 'N', Q, '3', { section: 4, length: 1 });
  addWire(P, Q, '2', D, o.tL ?? 'L', { section: 2.5, length: 1 });
  if (o.tN !== null) addWire(P, Q, '4', D, o.tN ?? 'N', { section: 2.5, length: 1 });
  if (o.pe) addWire(P, G, 'PE', D, 'PE', { section: 2.5, length: 1 });
  const sim = new Simulator(P);
  sim.step(0.02);
  return { P, G, Q, D, sim };
}

/** Protecção ou contacto em série entre o disjuntor e uma carga. */
function inSeries(type: string, tIn: string, tOut: string, o: { params?: Record<string, any>; state?: Record<string, unknown>; load?: string; loadParams?: Record<string, any>; nIn?: string; nOut?: string } = {}) {
  const P = createProject();
  const G = addDevice(P, 'grid1ph', { params: { earthing: 'TN-S', Zs: 0.05 } });
  const D = addDevice(P, type, { params: o.params, state: o.state });
  const H = addDevice(P, o.load ?? 'lampIncandescent', { params: o.loadParams });
  addWire(P, G, 'L', D, tIn, { section: 2.5, length: 1 });
  addWire(P, D, tOut, H, 'L', { section: 2.5, length: 1 });
  if (o.nIn && o.nOut) {
    addWire(P, G, 'N', D, o.nIn, { section: 2.5, length: 1 });
    addWire(P, D, o.nOut, H, 'N', { section: 2.5, length: 1 });
  } else addWire(P, G, 'N', H, 'N', { section: 2.5, length: 1 });
  const sim = new Simulator(P);
  sim.step(0.02);
  return { P, G, D, H, sim };
}

/** Curto franco a jusante de um aparelho. */
function shortAfter(type: string, tIn: string, tOut: string, nIn?: string, nOut?: string, params?: Record<string, any>) {
  const P = createProject();
  const G = addDevice(P, 'grid1ph', { params: { earthing: 'TN-S', Zs: 0.15 } });
  const D = addDevice(P, type, { params });
  const CC = addDevice(P, 'shortCircuit', { state: { active: true } });
  addWire(P, G, 'L', D, tIn);
  addWire(P, D, tOut, CC, '1');
  if (nIn && nOut) {
    addWire(P, G, 'N', D, nIn);
    addWire(P, D, nOut, CC, '2');
  } else addWire(P, G, 'N', CC, '2');
  const sim = new Simulator(P);
  sim.step(0.02);
  return { P, D, sim };
}

const I = (sim: Simulator, d: Device | string) => sim.measure(typeof d === 'string' ? d : d.id, 'meas.current');
const st = (sim: Simulator, d: Device) => sim.device(d.id)!.state;

const CASES: Record<string, Cases> = {
  grid1ph: {
    normal: () => {
      const { sim, G } = fed('lampIncandescent');
      expect(sim.measure(G.id, 'meas.voltage')).toBeGreaterThan(229.9);
    },
    limit: () => {
      const { sim, G } = fed('lampIncandescent');
      expect(sim.measure(G.id, 'meas.prospectiveIcc')).toBeCloseTo(230 / 0.1, 6);
    },
    fault: () => {
      const { sim, D } = fed('lampIncandescent');
      sim.operate('G1', 'power_off');
      expect(I(sim, D)).toBeLessThan(1e-6);
    },
  },
  battery: {
    normal: () => {
      const P = createProject();
      const B = addDevice(P, 'battery');
      const V = addDevice(P, 'voltmeter');
      addWire(P, B, 'P', V, 'A');
      addWire(P, B, 'M', V, 'B');
      const sim = new Simulator(P);
      expect(sim.measure(V.id, 'meas.reading')).toBeCloseTo(12.72, 4);
    },
    limit: () => {
      const P = createProject();
      const B = addDevice(P, 'battery', { params: { soc0: 0 } });
      const H = addDevice(P, 'lampIncandescent', { params: { Vn: 12, P: 21 } });
      addWire(P, B, 'P', H, 'L');
      addWire(P, B, 'M', H, 'N');
      expect(I(new Simulator(P), H)).toBeLessThan(1e-6);
    },
    fault: () => {
      const P = createProject();
      const B = addDevice(P, 'battery', { params: { Ri: 0.02 } });
      const CC = addDevice(P, 'shortCircuit', { state: { active: true } });
      addWire(P, B, 'P', CC, '1', { section: 16, length: 0.5 });
      addWire(P, B, 'M', CC, '2', { section: 16, length: 0.5 });
      const sim = new Simulator(P);
      expect(sim.measure(B.id, 'meas.current')).toBeGreaterThan(400);
    },
  },
  solarPanel: {
    normal: () => {
      const P = createProject();
      const S = addDevice(P, 'solarPanel');
      const H = addDevice(P, 'lampIncandescent', { params: { Vn: 12, P: 21 } });
      addWire(P, S, 'P', H, 'L');
      addWire(P, S, 'M', H, 'N');
      expect(new Simulator(P).measure(S.id, 'meas.power')).toBeGreaterThan(10);
    },
    limit: () => {
      const P = createProject();
      const S = addDevice(P, 'solarPanel', { params: { irr: 0 } });
      const H = addDevice(P, 'lampIncandescent', { params: { Vn: 12, P: 21 } });
      addWire(P, S, 'P', H, 'L');
      addWire(P, S, 'M', H, 'N');
      expect(I(new Simulator(P), H)).toBeLessThan(1e-6);
    },
    fault: () => {
      const P = createProject();
      const S = addDevice(P, 'solarPanel', { params: { Isc: 6 } });
      const CC = addDevice(P, 'shortCircuit', { state: { active: true } });
      addWire(P, S, 'P', CC, '1');
      addWire(P, S, 'M', CC, '2');
      const I = new Simulator(P).measure(S.id, 'meas.current');
      expect(I).toBeGreaterThan(5.8); // Isc menos a queda nos cabos
      expect(I).toBeLessThan(6);
    },
  },
  transformer1ph: {
    normal: () => {
      const { sim, D } = fed('transformer1ph', { tL: 'P1', tN: 'P2', params: { V2: 24 } });
      expect(sim.measure(D.id, 'meas.secondaryVoltage')).toBeCloseTo(24, 1);
    },
    limit: () => {
      const { P, D } = fed('transformer1ph', { tL: 'P1', tN: 'P2', params: { V2: 24, S: 100 } });
      const H = addDevice(P, 'lampIncandescent', { params: { Vn: 24, P: 100 } });
      addWire(P, D, 'S1', H, 'L', { section: 2.5, length: 0.5 });
      addWire(P, D, 'S2', H, 'N', { section: 2.5, length: 0.5 });
      const sim = new Simulator(P);
      expect(sim.measure(D.id, 'meas.loadPercent')).toBeGreaterThan(85);
      expect(sim.measure(D.id, 'meas.loadPercent')).toBeLessThan(100);
    },
    fault: () => {
      const { P, D } = fed('transformer1ph', { tL: 'P1', tN: 'P2', params: { V2: 24, S: 100 } });
      const CC = addDevice(P, 'shortCircuit', { state: { active: true } });
      addWire(P, D, 'S1', CC, '1');
      addWire(P, D, 'S2', CC, '2');
      const sim = new Simulator(P);
      // Com uk = 5 %, a corrente de curto no secundário é ~20 × a nominal.
      expect(sim.measure(D.id, 'meas.secondaryCurrent')).toBeGreaterThan(10 * (100 / 24));
    },
  },
  mcb1p: {
    normal: () => {
      const { sim, D, H } = inSeries('mcb1p', '1', '2', { params: { In: 10 } });
      sim.run(5);
      expect(st(sim, D).closed).toBe(true);
      expect(I(sim, H)).toBeGreaterThan(0.25);
    },
    limit: () => {
      const { sim, D } = inSeries('mcb1p', '1', '2', { params: { In: 10 }, load: 'heater', loadParams: { P: 2500 } });
      sim.run(60);
      expect(st(sim, D).closed).toBe(true); // 10,9 A = 1,09 · In < 1,13 · In
      expect(sim.measure(D.id, 'meas.thermal')).toBe(0);
    },
    fault: () => {
      const { sim, D } = shortAfter('mcb1p', '1', '2');
      expect(st(sim, D).trip).toBe('magnetic');
    },
  },
  mcb1pn: {
    normal: () => {
      const { sim, D, H } = inSeries('mcb1pn', '1', '2', { nIn: '3', nOut: '4' });
      expect(st(sim, D).closed).toBe(true);
      expect(I(sim, H)).toBeGreaterThan(0.25);
    },
    limit: () => {
      const { sim, D, H } = inSeries('mcb1pn', '1', '2', { nIn: '3', nOut: '4' });
      sim.operate(D.id, 'open');
      // Corta também o neutro: a lâmpada fica isolada dos dois lados.
      expect(rms(sim.view().v(sim.device(H.id)!, 'N'))).toBeLessThan(1);
      expect(rms(sim.view().v(sim.device(H.id)!, 'L'))).toBeLessThan(1);
    },
    fault: () => {
      const { sim, D } = shortAfter('mcb1pn', '1', '2', '3', '4');
      expect(st(sim, D).trip).toBe('magnetic');
    },
  },
  fuseGG: {
    normal: () => {
      const { sim, D } = inSeries('fuseGG', '1', '2', { params: { In: 16 }, load: 'heater', loadParams: { P: 3000 } });
      sim.run(30);
      expect(st(sim, D).blown).toBe(false);
    },
    limit: () => {
      const { sim, D } = inSeries('fuseGG', '1', '2', { params: { In: 16 }, load: 'heater', loadParams: { P: 4500 } });
      sim.run(30);
      expect(st(sim, D).blown).toBe(false); // 19,6 A < 1,6 · In
    },
    fault: () => {
      const { sim, D } = shortAfter('fuseGG', '1', '2');
      expect(st(sim, D).blown).toBe(true);
    },
  },
  rcd2p: {
    normal: () => {
      const { sim, D } = inSeries('rcd2p', '1', '2', { nIn: '3', nOut: '4', load: 'heater' });
      sim.run(1);
      expect(sim.measure(D.id, 'meas.residualCurrent')).toBeLessThan(1e-6);
      expect(st(sim, D).closed).toBe(true);
    },
    limit: () => {
      const { P, D, sim: s0 } = inSeries('rcd2p', '1', '2', { nIn: '3', nOut: '4' });
      void s0;
      const F = addDevice(P, 'earthFault', { params: { Rf: 230 / 0.029 }, state: { active: true } });
      addWire(P, D, '2', F, 'A');
      const sim = new Simulator(P);
      sim.run(2);
      expect(st(sim, D).closed).toBe(true); // 29 mA < IΔn
    },
    fault: () => {
      const { P, D } = inSeries('rcd2p', '1', '2', { nIn: '3', nOut: '4' });
      const F = addDevice(P, 'earthFault', { params: { Rf: 1000 }, state: { active: true } });
      addWire(P, D, '2', F, 'A');
      const sim = new Simulator(P);
      sim.run(0.1);
      expect(st(sim, D).trip).toBe('residual');
    },
  },
  rcbo: {
    normal: () => {
      const { sim, D } = inSeries('rcbo', '1', '2', { nIn: '3', nOut: '4', load: 'heater' });
      sim.run(1);
      expect(st(sim, D).closed).toBe(true);
    },
    limit: () => {
      const { sim, D } = shortAfter('rcbo', '1', '2', '3', '4', { In: 16 });
      expect(st(sim, D).trip).toBe('magnetic');
    },
    fault: () => {
      const { P, D } = inSeries('rcbo', '1', '2', { nIn: '3', nOut: '4' });
      const F = addDevice(P, 'earthFault', { params: { Rf: 1000 }, state: { active: true } });
      addWire(P, D, '2', F, 'A');
      const sim = new Simulator(P);
      sim.run(0.1);
      expect(st(sim, D).trip).toBe('residual');
    },
  },
  mainSwitch2p: {
    normal: () => {
      const { sim, H } = inSeries('mainSwitch2p', '1', '2', { nIn: '3', nOut: '4' });
      expect(I(sim, H)).toBeGreaterThan(0.25);
    },
    limit: () => {
      const { sim, D, H } = inSeries('mainSwitch2p', '1', '2', { nIn: '3', nOut: '4' });
      sim.operate(D.id, 'open');
      expect(I(sim, H)).toBeLessThan(1e-6);
    },
    fault: () => {
      // Não é uma protecção: com um curto a jusante não dispara.
      const { sim, D } = shortAfter('mainSwitch2p', '1', '2', '3', '4');
      expect(st(sim, D).closed).toBe(true);
      expect(sim.measure(D.id, 'meas.current')).toBeGreaterThan(500);
    },
  },
  switch1: {
    normal: () => {
      const { sim, D, H } = inSeries('switch1', '1', '2');
      expect(I(sim, H)).toBeLessThan(1e-6);
      sim.operate(D.id, 'switch_on');
      expect(I(sim, H)).toBeGreaterThan(0.25);
    },
    limit: () => {
      const { sim, D, H } = inSeries('switch1', '1', '2', { state: { on: true } });
      sim.operate(D.id, 'toggle');
      expect(I(sim, H)).toBeLessThan(1e-6);
    },
    fault: () => {
      const { sim, D } = inSeries('switch1', '1', '2');
      expect(sim.operate(D.id, 'unknown')).toBe(false);
    },
  },
  switch2p: {
    normal: () => {
      const { sim, D, H } = inSeries('switch2p', '1', '2', { nIn: '3', nOut: '4' });
      sim.operate(D.id, 'switch_on');
      expect(I(sim, H)).toBeGreaterThan(0.25);
    },
    limit: () => {
      const { sim, H } = inSeries('switch2p', '1', '2', { nIn: '3', nOut: '4' });
      expect(rms(sim.view().v(sim.device(H.id)!, 'L'))).toBeLessThan(1);
    },
    fault: () => {
      const { sim, D } = inSeries('switch2p', '1', '2', { nIn: '3', nOut: '4' });
      expect(sim.operate(D.id, 'press')).toBe(false);
    },
  },
  stairSwitch: {
    normal: () => {
      const { sim, H } = inSeries('stairSwitch', 'C', '1');
      expect(I(sim, H)).toBeGreaterThan(0.25);
    },
    limit: () => {
      const { sim, D, H } = inSeries('stairSwitch', 'C', '1');
      sim.operate(D.id, 'toggle');
      expect(I(sim, H)).toBeLessThan(1e-6);
    },
    fault: () => {
      const { sim, D } = inSeries('stairSwitch', 'C', '2');
      expect(I(sim, 'H1')).toBeLessThan(1e-6);
      sim.operate(D.id, 'toggle');
      expect(I(sim, 'H1')).toBeGreaterThan(0.25);
    },
  },
  intermediateSwitch: {
    normal: () => {
      const { sim, H } = inSeries('intermediateSwitch', 'A', 'C');
      expect(I(sim, H)).toBeGreaterThan(0.25);
    },
    limit: () => {
      const { sim, D, H } = inSeries('intermediateSwitch', 'A', 'C');
      sim.operate(D.id, 'toggle');
      expect(I(sim, H)).toBeLessThan(1e-6);
    },
    fault: () => {
      const { sim, D, H } = inSeries('intermediateSwitch', 'A', 'D');
      expect(I(sim, H)).toBeLessThan(1e-6);
      sim.operate(D.id, 'toggle');
      expect(I(sim, H)).toBeGreaterThan(0.25);
    },
  },
  pushButton: {
    normal: () => {
      const { sim, D, H } = inSeries('pushButton', '1', '2');
      sim.operate(D.id, 'press', 'down');
      expect(I(sim, H)).toBeGreaterThan(0.25);
    },
    limit: () => {
      const { sim, D, H } = inSeries('pushButton', '1', '2');
      sim.operate(D.id, 'press', 'down');
      sim.operate(D.id, 'press', 'up');
      expect(I(sim, H)).toBeLessThan(1e-6);
    },
    fault: () => {
      const { sim, D } = inSeries('pushButton', '1', '2');
      expect(sim.operate(D.id, 'press', 'up')).toBe(false);
    },
  },
  impulseRelay: {
    normal: () => {
      const { sim, D } = fed('impulseRelay', { tL: 'A1', tN: 'A2' });
      expect(st(sim, D).on).toBe(true); // a primeira energização é um impulso
      sim.step(1);
      expect(st(sim, D).on).toBe(true); // bobina mantida: sem novo impulso
    },
    limit: () => {
      const { sim, D } = fed('impulseRelay', { tL: 'A1', tN: 'A2', V: 0.7 * 230 });
      expect(st(sim, D).on).toBe(false); // abaixo de 0,75 · Uc não actua
    },
    fault: () => {
      const { sim, D } = fed('impulseRelay', { tL: 'A1', tN: 'A2' });
      sim.operate('G1', 'power_off');
      sim.operate('G1', 'power_on');
      expect(st(sim, D).on).toBe(false);
    },
  },
  lampIncandescent: {
    normal: () => {
      const { sim, D } = fed('lampIncandescent');
      expect(sim.measure(D.id, 'meas.brightness')).toBeGreaterThan(99);
    },
    limit: () => {
      const { sim, D } = fed('lampIncandescent', { V: 115 });
      expect(sim.measure(D.id, 'meas.brightness')).toBeCloseTo(25, 0); // P ∝ U²
    },
    fault: () => {
      const { sim, D } = fed('lampIncandescent', { params: { Vn: 24, P: 21 } });
      sim.run(1);
      expect(st(sim, D).burnt).toBe(true);
    },
  },
  lampLed: {
    normal: () => {
      const { sim, D } = fed('lampLed');
      expect(sim.measure(D.id, 'meas.brightness')).toBe(100);
    },
    limit: () => {
      const { sim, D } = fed('lampLed', { V: 0.6 * 230 });
      expect(sim.measure(D.id, 'meas.brightness')).toBeCloseTo(50, 0);
    },
    fault: () => {
      const { sim, D } = fed('lampLed', { params: { Vn: 12, P: 9 } });
      sim.run(1);
      expect(st(sim, D).burnt).toBe(true);
    },
  },
  lampFluorescent: {
    normal: () => {
      const { sim, D } = fed('lampFluorescent');
      expect(sim.measurements(D.id)[0]!.value).toEqual({ key: 'state.lit', values: undefined });
    },
    limit: () => {
      const { sim, D } = fed('lampFluorescent', { V: 0.7 * 230 });
      expect(sim.measurements(D.id)[0]!.value).toEqual({ key: 'state.unlit', values: undefined });
    },
    fault: () => {
      const { sim, D } = fed('lampFluorescent', { params: { PF: 0.5 } });
      expect(sim.measure(D.id, 'meas.reactivePower')).toBeGreaterThan(50);
    },
  },
  socket: {
    normal: () => {
      const { sim, D } = fed('socket', { params: { appliance: 'iron' }, pe: true });
      expect(sim.measure(D.id, 'meas.activePower')).toBeGreaterThan(1150);
    },
    limit: () => {
      const { sim, D } = fed('socket', { pe: true });
      expect(I(sim, D)).toBeLessThan(1e-6);
    },
    fault: () => {
      const { sim, D } = fed('socket', { params: { appliance: 'iron', defect: 'leak' }, pe: true });
      expect(sim.measure(D.id, 'meas.leakCurrent')).toBeCloseTo(230 / 5000, 3);
    },
  },
  heater: {
    normal: () => {
      const { sim, D } = fed('heater', { pe: true });
      expect(I(sim, D)).toBeCloseTo(2000 / 230, 1);
    },
    limit: () => {
      const { sim, D } = fed('heater', { pe: true });
      sim.operate(D.id, 'switch_off');
      expect(I(sim, D)).toBeLessThan(1e-6);
    },
    fault: () => {
      const { sim, Q } = fed('heater', { params: { defect: 'frank' }, pe: true });
      expect(st(sim, Q).trip).toBe('magnetic'); // TN-S: o defeito franco é um curto fase-PE
    },
  },
  bell: {
    normal: () => {
      const { sim, D } = fed('bell', { tL: '1', tN: '2', params: { Vn: 230 } });
      expect(sim.measurements(D.id)[0]!.value).toEqual({ key: 'state.ringing', values: undefined });
    },
    limit: () => {
      const { sim, D } = fed('bell', { tL: '1', tN: '2', params: { Vn: 230 }, V: 0.65 * 230 });
      expect(sim.measurements(D.id)[0]!.value).toEqual({ key: 'state.silent', values: undefined });
    },
    fault: () => {
      const { sim, D } = fed('bell', { tL: '1', tN: '2', params: { Vn: 12 } });
      sim.run(1);
      expect(st(sim, D).burnt).toBe(true);
    },
  },
  motor1ph: {
    normal: () => {
      const { sim, D } = fed('motor1ph', { pe: true });
      sim.run(2);
      expect(sim.measure(D.id, 'meas.speed')).toBe(1450);
    },
    limit: () => {
      const { sim, D } = fed('motor1ph', { pe: true });
      expect(I(sim, D) / sim.measure(D.id, 'meas.ratedCurrent')).toBeGreaterThan(5.5); // arranque
    },
    fault: () => {
      const { sim, D } = fed('motor1ph', { pe: true, V: 150 });
      sim.run(3);
      expect(sim.measurements(D.id)[0]!.value).toEqual({ key: 'state.starting', values: undefined }); // rotor bloqueado
    },
  },
  voltmeter: {
    normal: () => {
      const { sim, D } = fed('voltmeter', { tL: 'A', tN: 'B' });
      expect(sim.measure(D.id, 'meas.reading')).toBeCloseTo(230, 0);
    },
    limit: () => {
      const { sim, D } = fed('voltmeter', { tL: 'A', tN: 'B' });
      expect(sim.measure(D.id, 'meas.dcComponent')).toBeCloseTo(0, 9);
    },
    fault: () => {
      const { sim, Q } = fed('voltmeter', { tL: 'A', tN: 'B' });
      expect(st(sim, Q).closed).toBe(true); // 10 MΩ: não carrega o circuito
    },
  },
  ammeter: {
    normal: () => {
      const { sim, D, H } = inSeries('ammeter', 'A', 'B');
      expect(sim.measure(D.id, 'meas.reading')).toBeCloseTo(I(sim, H), 5); // GMIN
    },
    limit: () => {
      const { sim, D } = inSeries('ammeter', 'A', 'B', { load: 'heater', loadParams: { P: 500 } });
      expect(sim.measure(D.id, 'meas.reading')).toBeCloseTo(500 / 230, 2);
    },
    fault: () => {
      // Amperímetro ligado em paralelo (erro clássico): é um curto-circuito.
      const { sim, Q } = fed('ammeter', { tL: 'A', tN: 'B' });
      expect(st(sim, Q).trip).toBe('magnetic');
    },
  },
  energyMeter1ph: {
    normal: () => {
      const P = createProject();
      const G = addDevice(P, 'grid1ph', { params: { Zs: 0.01 } });
      const M = addDevice(P, 'energyMeter1ph');
      const E = addDevice(P, 'heater', { params: { P: 2000 } });
      addWire(P, G, 'L', M, 'Li');
      addWire(P, G, 'N', M, 'Ni');
      addWire(P, M, 'Lo', E, 'L');
      addWire(P, M, 'No', E, 'N');
      const sim = new Simulator(P, { maxStep: 1 });
      sim.run(36, 1);
      expect(sim.measure(M.id, 'meas.energy')).toBeCloseTo(0.02, 3);
    },
    limit: () => {
      const P = createProject();
      const M = addDevice(P, 'energyMeter1ph');
      const sim = new Simulator(P);
      sim.operate(M.id, 'reset_energy');
      expect(sim.measure(M.id, 'meas.energy')).toBe(0);
    },
    fault: () => {
      const P = createProject();
      const M = addDevice(P, 'energyMeter1ph');
      expect(new Simulator(P).measure(M.id, 'meas.powerFactor')).toBe(1);
    },
  },
  junction: {
    normal: () => {
      const { sim, H } = inSeries('junction', 'a', 'b');
      expect(I(sim, H)).toBeGreaterThan(0.25);
    },
    limit: () => {
      const { P, D, sim: s0 } = inSeries('junction', 'a', 'b');
      void s0;
      const H2 = addDevice(P, 'lampIncandescent');
      addWire(P, D, 'c', H2, 'L');
      addWire(P, P.devices[0]!, 'N', H2, 'N');
      const sim = new Simulator(P);
      expect(I(sim, H2)).toBeCloseTo(I(sim, 'H1'), 4);
    },
    fault: () => {
      const { P, D } = inSeries('junction', 'a', 'b');
      expect(defaultRegistry.require('junction').shorts!(D)[0]).toEqual(['a', 'b', 'c', 'd']);
      expect(P.devices.length).toBe(3);
    },
  },
  busbar: {
    normal: () => {
      const { sim, H } = inSeries('busbar', 'E', 'S1');
      expect(I(sim, H)).toBeGreaterThan(0.25);
    },
    limit: () => {
      const { sim, H } = inSeries('busbar', 'S1', 'S6');
      expect(I(sim, H)).toBeGreaterThan(0.25);
    },
    fault: () => {
      const { sim, H } = inSeries('busbar', 'E', 'S3');
      expect(rms(sim.view().v(sim.device('X1')!, 'S5'))).toBeCloseTo(rms(sim.view().v(sim.device(H.id)!, 'L')), 2);
    },
  },
  earthElectrode: {
    normal: () => {
      const P = createProject();
      const E = addDevice(P, 'earthElectrode', { params: { Ra: 20 } });
      expect(new Simulator(P).measure(E.id, 'meas.earthCurrent')).toBe(0);
    },
    limit: () => {
      const { P, D } = fed('heater', { params: { defect: 'strong' } });
      P.devices.find((d) => d.type === 'grid1ph')!.params.earthing = 'TT';
      const Ea = addDevice(P, 'earthElectrode', { params: { Ra: 20 } });
      addWire(P, D, 'PE', Ea, 'PE');
      const sim = new Simulator(P);
      expect(sim.measure(Ea.id, 'meas.earthVoltage')).toBeCloseTo(sim.measure(Ea.id, 'meas.earthCurrent') * 20, 6);
    },
    fault: () => {
      const { P, D } = fed('heater', { params: { defect: 'frank' } });
      P.devices.find((d) => d.type === 'grid1ph')!.params.earthing = 'TT';
      const Ea = addDevice(P, 'earthElectrode', { params: { Ra: 200 } });
      addWire(P, D, 'PE', Ea, 'PE');
      // Em TT, sem diferencial, o defeito franco não faz disparar o disjuntor: ≈ 1 A.
      const sim = new Simulator(P);
      sim.run(2);
      expect(sim.device('Q1')!.state.closed).toBe(true);
      expect(sim.measure(Ea.id, 'meas.earthVoltage')).toBeGreaterThan(50);
    },
  },
  shortCircuit: {
    normal: () => {
      const { sim, D } = fed('shortCircuit', { tL: '1', tN: '2' });
      expect(sim.measure(D.id, 'meas.faultCurrent')).toBe(0);
    },
    limit: () => {
      const { sim, D } = fed('shortCircuit', { tL: '1', tN: '2', params: { Rf: 10 } });
      sim.operate(D.id, 'activate');
      expect(sim.measure(D.id, 'meas.faultCurrent')).toBeGreaterThan(20);
    },
    fault: () => {
      const { sim, D, Q } = fed('shortCircuit', { tL: '1', tN: '2' });
      sim.operate(D.id, 'activate');
      expect(st(sim, Q).trip).toBe('magnetic');
    },
  },
  earthFault: {
    normal: () => {
      const { sim, D } = fed('earthFault', { tL: 'A', tN: null });
      expect(sim.measure(D.id, 'meas.faultCurrent')).toBe(0);
    },
    limit: () => {
      const { sim, D } = fed('earthFault', { tL: 'A', tN: null, params: { Rf: 10000 } });
      sim.operate(D.id, 'activate');
      expect(sim.measure(D.id, 'meas.faultCurrent')).toBeLessThan(0.03);
    },
    fault: () => {
      const { sim, D } = fed('earthFault', { tL: 'A', tN: null, params: { Rf: 1 } });
      sim.operate(D.id, 'activate');
      expect(sim.measure(D.id, 'meas.faultCurrent')).toBeGreaterThan(5);
    },
  },
  person: {
    normal: () => {
      const { sim, D } = fed('person', { tL: 'M', tN: null, state: { active: false } });
      expect(sim.measure(D.id, 'meas.bodyCurrent')).toBe(0);
    },
    limit: () => {
      const { sim, D } = fed('person', { tL: 'M', tN: null, params: { floor: 'insulating' } });
      expect(sim.measure(D.id, 'meas.bodyCurrent')).toBeLessThan(0.003);
    },
    fault: () => {
      const { sim, D } = fed('person', { tL: 'M', tN: null, params: { floor: 'wet' } });
      sim.run(1);
      expect(sim.measure(D.id, 'meas.bodyCurrent')).toBeGreaterThan(0.2);
      expect(sim.events.some((e) => e.code === 'body_current')).toBe(true);
    },
  },
  frame: {
    normal: () => {
      const P = createProject();
      const F = addDevice(P, 'frame', { params: { title: 'Quadro de entrada' } });
      expect(defaultRegistry.require('frame').symbol!(F, lookFrom([]), String)).toContainEqual(expect.objectContaining({ t: 'text', text: 'Quadro de entrada' }));
    },
    limit: () => {
      const P = createProject();
      const F = addDevice(P, 'frame', { params: { W: 100, H: 80 } });
      expect(defaultRegistry.require('frame').symbol!(F, lookFrom([]), String)[0]).toMatchObject({ w: 100, h: 80 });
    },
    fault: () => {
      // Sem efeito eléctrico: não entra na rede.
      const { P } = fed('lampIncandescent');
      const before = new Simulator(P).step(0.02).net.nodeCount;
      addDevice(P, 'frame');
      expect(new Simulator(P).step(0.02).net.nodeCount).toBe(before);
    },
  },
  note: {
    normal: () => {
      const P = createProject();
      const N = addDevice(P, 'note', { params: { text: 'Ligue primeiro o disjuntor' } });
      expect(defaultRegistry.require('note').symbol!(N, lookFrom([]), String).some((x) => x.t === 'text')).toBe(true);
    },
    limit: () => {
      const P = createProject();
      const N = addDevice(P, 'note', { params: { text: 'palavra '.repeat(100) } });
      expect(defaultRegistry.require('note').symbol!(N, lookFrom([]), String).filter((x) => x.t === 'text').length).toBe(5);
    },
    fault: () => {
      const P = createProject();
      const N = addDevice(P, 'note', { params: { text: '' } });
      expect(defaultRegistry.require('note').symbol!(N, lookFrom([]), String).filter((x) => x.t === 'text')).toEqual([]);
    },
  },
};

describe('símbolos 2D', () => {
  it('todos os equipamentos têm símbolo com coordenadas válidas, no estado inicial e depois de simular', () => {
    const nums = (o: unknown): number[] => (typeof o === 'number' ? [o] : o && typeof o === 'object' ? Object.values(o).flatMap(nums) : []);
    for (const def of defaultRegistry.all()) {
      const { sim, D } = def.terminals.length ? fed(def.type, { tL: def.terminals[0]!.id, tN: def.terminals[1]?.id ?? null }) : { sim: new Simulator(createProject()), D: addDevice(createProject(), def.type) };
      const d = sim.device(D.id) ?? D;
      expect(def.symbol, def.type).toBeDefined();
      const prims = def.symbol!(d, lookFrom(sim.measurements(d.id)), (v) => String(v));
      expect(prims.length, def.type).toBeGreaterThan(0);
      for (const v of nums(prims)) expect(Number.isFinite(v), def.type).toBe(true);
    }
  });
});

describe('casos por equipamento', () => {
  it('todos os equipamentos da biblioteca têm casos normal, limite e falha', () => {
    expect(Object.keys(CASES).sort()).toEqual(defaultRegistry.all().map((d) => d.type).sort());
  });
  for (const [type, c] of Object.entries(CASES)) {
    describe(type, () => {
      it('normal', c.normal);
      it('limite', c.limit);
      it('falha', c.fault);
    });
  }
});
