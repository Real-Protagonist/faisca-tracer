/** Cada código de diagnóstico aparece no cenário descrito no prompt, com os valores certos. */
import { describe, expect, it } from 'vitest';
import {
  addDevice,
  addWire,
  allDiagnostics,
  assemblyDiagnostics,
  createProject,
  createRegistry,
  DIAG_CODES,
  formatter,
  rms,
  Simulator,
  whyNotWorking,
  type DeviceDef,
  type Diagnostic,
  type Project,
} from '../index';

const find = (ds: Diagnostic[], code: string) => ds.find((d) => d.code === code);
const codes = (ds: Diagnostic[]) => ds.map((d) => d.code);

/** Instalação doméstica correcta: TN-S, diferencial 30 mA, disjuntor, interruptor na fase, PE ligado. */
function goodInstallation() {
  const P = createProject();
  const G = addDevice(P, 'grid1ph', { params: { earthing: 'TN-S' } });
  const Q1 = addDevice(P, 'rcd2p');
  const Q2 = addDevice(P, 'mcb1pn', { params: { In: 10 } });
  const Q3 = addDevice(P, 'mcb1pn', { params: { In: 16 } });
  const S1 = addDevice(P, 'switch1', { state: { on: true } });
  const H1 = addDevice(P, 'lampIncandescent');
  const X1 = addDevice(P, 'socket', { params: { appliance: 'tv' } });
  const PE = addDevice(P, 'busbar', { params: { bus: 'PE' } });
  addWire(P, G, 'L', Q1, '1', { section: 6 });
  addWire(P, G, 'N', Q1, '3', { section: 6 });
  addWire(P, G, 'PE', PE, 'E', { section: 6 });
  for (const Q of [Q2, Q3]) {
    addWire(P, Q1, '2', Q, '1', { section: 6 });
    addWire(P, Q1, '4', Q, '3', { section: 6 });
  }
  addWire(P, Q2, '2', S1, '1');
  addWire(P, S1, '2', H1, 'L');
  addWire(P, Q2, '4', H1, 'N');
  addWire(P, Q3, '2', X1, 'L', { section: 2.5 });
  addWire(P, Q3, '4', X1, 'N', { section: 2.5 });
  addWire(P, PE, 'S1', X1, 'PE', { section: 2.5 });
  return { P, G, Q1, Q2, Q3, S1, H1, X1, PE };
}

/** Rede → disjuntor Q → lâmpada H, com cabos curtos. */
function lampCircuit(o: { protection?: string; name?: string } = {}) {
  const P = createProject();
  const G = addDevice(P, 'grid1ph', { params: { earthing: 'TN-S' } });
  const Q = addDevice(P, o.protection ?? 'mcb1pn', { name: o.name });
  const H = addDevice(P, 'lampIncandescent');
  addWire(P, G, 'L', Q, '1');
  addWire(P, G, 'N', Q, '3');
  return { P, G, Q, H };
}

describe('instalação correcta', () => {
  it('não tem nenhum diagnóstico (sem falsos positivos)', () => {
    const { P } = goodInstallation();
    const sim = new Simulator(P);
    sim.run(1);
    expect(allDiagnostics(sim)).toEqual([]);
    expect(whyNotWorking(sim, 'H1').code).toBe('LOAD_OK');
    expect(whyNotWorking(sim, 'X1').code).toBe('LOAD_OK');
  });

  it('cada diagnóstico respeita o contrato', () => {
    const { P, H1 } = goodInstallation();
    P.wires = P.wires.filter((w) => !(w.b.device === H1.id && w.b.terminal === 'N'));
    const sim = new Simulator(P);
    sim.step(0.02);
    for (const d of allDiagnostics(sim)) {
      expect(DIAG_CODES).toContain(d.code);
      expect(['error', 'warning', 'info']).toContain(d.severity);
      const k = 'diag.' + d.code.toLowerCase();
      expect(d).toMatchObject({ titleKey: k + '.title', causeKey: k + '.cause', hintKey: k + '.hint', learnKey: k + '.learn' });
      for (const v of Object.values(d.values)) expect(typeof v).toBe('string');
      for (const t of d.targets) expect(['device', 'wire']).toContain(t.kind);
    }
  });
});

describe('tabela de erros do prompt (área doméstica)', () => {
  it('LOAD_NO_RETURN: o terminal N de H1 não está ligado', () => {
    const { P, Q, H } = lampCircuit();
    addWire(P, Q, '2', H, 'L');
    const sim = new Simulator(P);
    sim.step(0.02);
    const d = find(allDiagnostics(sim), 'LOAD_NO_RETURN')!;
    expect(d).toMatchObject({ severity: 'error', values: { device: 'H1', terminal: 'N' }, fix: { action: 'select', id: H.id } });
    expect(d.targets).toContainEqual({ kind: 'device', id: H.id });
    expect(whyNotWorking(sim, 'H1').code).toBe('LOAD_NO_RETURN');
  });

  it('PATH_OPEN: o disjuntor Q2 está desligado e corta a fase', () => {
    const P = createProject();
    const G = addDevice(P, 'grid1ph');
    const Q1 = addDevice(P, 'mainSwitch2p');
    const Q2 = addDevice(P, 'mcb1pn', { state: { closed: false } });
    const H1 = addDevice(P, 'lampIncandescent');
    addWire(P, G, 'L', Q1, '1');
    addWire(P, G, 'N', Q1, '3');
    addWire(P, Q1, '2', Q2, '1');
    addWire(P, Q1, '4', Q2, '3');
    addWire(P, Q2, '2', H1, 'L');
    addWire(P, Q2, '4', H1, 'N');
    const sim = new Simulator(P);
    sim.step(0.02);
    const d = whyNotWorking(sim, 'H1');
    expect(d).toMatchObject({ code: 'PATH_OPEN', values: { device: 'H1', blocker: 'Q2' }, fix: { id: Q2.id } });
    sim.operate('Q2', 'close');
    expect(whyNotWorking(sim, 'H1').code).toBe('LOAD_OK');
  });

  it('SWITCH_ON_NEUTRAL: o interruptor S1 está no neutro', () => {
    const { P, Q, H } = lampCircuit();
    const S = addDevice(P, 'switch1', { state: { on: true } });
    addWire(P, Q, '2', H, 'L');
    addWire(P, H, 'N', S, '1', { conductor: 'N' });
    addWire(P, S, '2', Q, '4', { conductor: 'N' });
    const sim = new Simulator(P);
    sim.step(0.02);
    const ds = allDiagnostics(sim);
    expect(find(ds, 'SWITCH_ON_NEUTRAL')?.values.device).toBe('S1');
    // A lâmpada funciona, mas o casquilho fica com tensão com S1 desligado.
    expect(rms(sim.view().v(sim.device('H1')!, 'L'))).toBeGreaterThan(200);
    sim.operate('S1', 'switch_off');
    expect(rms(sim.view().v(sim.device('H1')!, 'L'))).toBeGreaterThan(200);
  });

  it('MCB_MAGNETIC_TRIP: passaram 771 A no Q2 de 10 A', () => {
    const P = createProject();
    const len = 0.1;
    const Rw = (0.0225 * len) / 1.5;
    const Zs = (230 / 771 - 4 * Rw - 2e-3 - 1e-3) / 2;
    const G = addDevice(P, 'grid1ph', { params: { Zs, earthing: 'TN-S' } });
    addDevice(P, 'mainSwitch2p');
    const Q2 = addDevice(P, 'mcb1pn', { params: { In: 10, curve: 'C', Icn: 6 } });
    const CC = addDevice(P, 'shortCircuit', { state: { active: true } });
    addWire(P, G, 'L', Q2, '1', { length: len });
    addWire(P, G, 'N', Q2, '3', { length: len });
    addWire(P, Q2, '2', CC, '1', { length: len });
    addWire(P, Q2, '4', CC, '2', { length: len });
    const sim = new Simulator(P);
    sim.step(0.02);
    const d = find(allDiagnostics(sim), 'MCB_MAGNETIC_TRIP')!;
    expect(d.values).toMatchObject({ device: 'Q2', current: '771 A', ratio: '77,1' });
    expect(sim.events.find((e) => e.code === 'mcb_magnetic_trip')?.deviceId).toBe(Q2.id);
  });

  it('CABLE_UNPROTECTED: Q4 é de 25 A e o cabo de 2,5 mm² para E1 só aguenta 24 A', () => {
    const { P, G } = lampCircuit({ name: 'Q4' });
    const Q4 = P.devices.find((d) => d.name === 'Q4')!;
    Q4.params.In = 25;
    P.devices = P.devices.filter((d) => d.type !== 'lampIncandescent');
    const E1 = addDevice(P, 'heater');
    addWire(P, Q4, '2', E1, 'L', { section: 2.5 });
    addWire(P, Q4, '4', E1, 'N', { section: 2.5 });
    addWire(P, G, 'PE', E1, 'PE', { section: 2.5 });
    const d = find(assemblyDiagnostics(P, createRegistry(), formatter('pt')), 'CABLE_UNPROTECTED')!;
    expect(d.values).toMatchObject({ device: 'Q4', to: 'E1', rated: '25 A', section: '2,5 mm²', iz: '24 A', nextSection: '4 mm²', lowerRating: '20 A' });
  });

  it('PE_MISSING: a carcaça do aquecedor E1 não tem terra', () => {
    const { P, Q } = lampCircuit();
    P.devices = P.devices.filter((d) => d.type !== 'lampIncandescent');
    const E1 = addDevice(P, 'heater');
    addWire(P, Q, '2', E1, 'L', { section: 2.5 });
    addWire(P, Q, '4', E1, 'N', { section: 2.5 });
    const ds = assemblyDiagnostics(P, createRegistry(), formatter('pt'));
    expect(find(ds, 'PE_MISSING')).toMatchObject({ severity: 'warning', values: { device: 'E1' } });
    // Num TT o PE da rede não existe: é preciso um eléctrodo.
    const P2 = structuredClone(P);
    P2.devices.find((d) => d.type === 'grid1ph')!.params.earthing = 'TT';
    addWire(P2, P2.devices.find((d) => d.type === 'grid1ph')!, 'PE', P2.devices.find((d) => d.name === 'E1')!, 'PE');
    expect(find(assemblyDiagnostics(P2, createRegistry(), formatter('pt')), 'PE_MISSING')).toBeDefined();
  });

  it('WRONG_VOLTAGE: a lâmpada H3 fundiu por estar ligada a uma tensão acima da sua', () => {
    const P = createProject();
    const G = addDevice(P, 'grid1ph');
    const Q = addDevice(P, 'mcb1pn', { params: { In: 16 } });
    const H = addDevice(P, 'lampIncandescent', { name: 'H3', params: { Vn: 24, P: 21 } });
    addWire(P, G, 'L', Q, '1');
    addWire(P, G, 'N', Q, '3');
    addWire(P, Q, '2', H, 'L');
    addWire(P, Q, '4', H, 'N');
    const sim = new Simulator(P);
    sim.run(1);
    expect(find(allDiagnostics(sim), 'WRONG_VOLTAGE')?.values).toMatchObject({ device: 'H3', nominal: '24 V' });
    expect(sim.events.some((e) => e.code === 'overvoltage_damage')).toBe(true);
  });

  it('VOLTAGE_DROP: lâmpadas a 100 m por cabo de 1,5 mm² (limite de 3 % na iluminação)', () => {
    const P = createProject();
    const G = addDevice(P, 'grid1ph', { params: { Zs: 0.05 } });
    const Q = addDevice(P, 'mcb1pn');
    const H4 = addDevice(P, 'lampIncandescent', { name: 'H4', params: { P: 200 } });
    const H5 = addDevice(P, 'lampIncandescent', { name: 'H5', params: { P: 200 } });
    const H6 = addDevice(P, 'lampIncandescent', { name: 'H6', params: { P: 200 } });
    const J = addDevice(P, 'junction');
    const JN = addDevice(P, 'junction');
    addWire(P, G, 'L', Q, '1', { length: 1 });
    addWire(P, G, 'N', Q, '3', { length: 1 });
    addWire(P, Q, '2', J, 'a', { length: 100 });
    addWire(P, Q, '4', JN, 'a', { length: 100 });
    for (const [H, t] of [[H4, 'b'], [H5, 'c'], [H6, 'd']] as const) {
      addWire(P, J, t, H, 'L', { length: 0.5 });
      addWire(P, JN, t, H, 'N', { length: 0.5 });
    }
    const sim = new Simulator(P);
    sim.step(0.02);
    const d = allDiagnostics(sim).find((x) => x.code === 'VOLTAGE_DROP' && x.values.device === 'H4')!;
    expect(d.values).toMatchObject({ section: '1,5 mm²', length: '100 m', limit: '3 %' });
    const Vsrc = sim.measure('G1', 'meas.voltage');
    const drop = (100 * (Vsrc - sim.measure('H4', 'meas.voltage'))) / 230;
    expect(d.values.drop).toBe(formatter('pt')(drop, '%'));
    expect(drop).toBeGreaterThan(3);
  });

  it('BODY_CURRENT: 65 mA numa pessoa a tocar na carcaça de X1 com defeito, sem diferencial', () => {
    const P = createProject();
    const G = addDevice(P, 'grid1ph', { params: { earthing: 'TT', Rb: 2 } });
    const Q = addDevice(P, 'mcb1pn');
    const X1 = addDevice(P, 'socket', { params: { appliance: 'iron', defect: 'frank' } });
    const Z = addDevice(P, 'person', { params: { floor: 'shoes', Rbody: 1000 } });
    addWire(P, G, 'L', Q, '1');
    addWire(P, G, 'N', Q, '3');
    addWire(P, Q, '2', X1, 'L');
    addWire(P, Q, '4', X1, 'N');
    addWire(P, Z, 'M', X1, 'PE');
    // Calçado escolhido para dar ≈ 65 mA: R = 230 / 0,065 − 1000 − 2 (Rb).
    Z.params.floor = 'shoes';
    const sim = new Simulator(P);
    sim.device(Z.id)!.params.Rbody = 230 / 0.065 - 1000 - 2;
    sim.run(0.5);
    const d = find(allDiagnostics(sim), 'BODY_CURRENT')!;
    expect(d.values).toMatchObject({ device: Z.name, location: 'X1', rcd: 'no' });
    expect(d.values.current).toMatch(/^6[45],\d mA$/);
    expect(d.fix?.id).toBe(X1.id);
  });

  it('CONTROL_UNSTABLE: um contacto NF alimenta a própria bobina', () => {
    // Equipamento de teste registado à parte: prova que acrescentar um equipamento não mexe no solver.
    const relay: DeviceDef = {
      type: 'testRelayNC',
      category: 'control',
      domain: ['industrial'],
      level: 'pro',
      prefix: 'K',
      size: { w: 80, h: 80 },
      terminals: [
        { id: 'A1', x: 0, y: 0, kind: 'any' },
        { id: 'A2', x: 0, y: 80, kind: 'any' },
        { id: '21', x: 40, y: 0, kind: 'any' },
        { id: '22', x: 40, y: 80, kind: 'any' },
      ],
      params: [],
      initialState: () => ({ on: false }),
      conducts: (d) => [{ a: '21', b: '22', closed: !d.state.on }],
      stamp(d, b) {
        b.R(b.node('A1'), b.node('A2'), 230 * 230 / 5, 'coil');
        b.sw(b.node('21'), b.node('22'), !d.state.on, 'nc');
      },
      logic(d, ctx) {
        const on = rms(ctx.sol.vv(d, 'A1', 'A2')) > 0.75 * 230;
        if (on === d.state.on) return false;
        d.state.on = on;
        return true;
      },
    };
    const registry = createRegistry().register(relay);
    const P = createProject({ domain: 'industrial' });
    const G = addDevice(P, 'grid1ph', {}, registry);
    const K = addDevice(P, 'testRelayNC', {}, registry);
    addWire(P, G, 'L', K, '21', {}, registry);
    addWire(P, K, '22', K, 'A1', {}, registry);
    addWire(P, K, 'A2', G, 'N', {}, registry);
    const sim = new Simulator(P, { registry });
    sim.step(0.02);
    expect(sim.unstable).toBe(true);
    expect(sim.stats.iterations).toBe(12);
    expect(find(allDiagnostics(sim), 'CONTROL_UNSTABLE')?.severity).toBe('error');
    expect(sim.events.filter((e) => e.code === 'control_unstable')).toHaveLength(1);
  });
});

describe('outros diagnósticos de montagem', () => {
  it('SOURCE_SHORT: fase ligada ao neutro sem carga', () => {
    const { P, Q } = lampCircuit();
    addWire(P, Q, '2', Q, '4');
    expect(find(assemblyDiagnostics(P, createRegistry(), formatter('pt')), 'SOURCE_SHORT')?.values.device).toBe('G1');
    // Depois de o disjuntor disparar por causa do curto, o aviso continua.
    const sim = new Simulator(P);
    sim.step(0.02);
    expect(sim.device('Q1')!.state.trip).toBe('magnetic');
    expect(find(allDiagnostics(sim), 'SOURCE_SHORT')).toBeDefined();
  });

  it('SOURCE_SHORT: um interruptor aberto entre fase e neutro não é um curto (ainda)', () => {
    const { P, Q } = lampCircuit();
    const S = addDevice(P, 'switch1');
    addWire(P, Q, '2', S, '1');
    addWire(P, S, '2', Q, '4');
    expect(find(assemblyDiagnostics(P, createRegistry(), formatter('pt')), 'SOURCE_SHORT')).toBeUndefined();
  });

  it('TERMINAL_UNCONNECTED: lâmpada com o neutro ligado mas a fase livre', () => {
    const { P, Q, H } = lampCircuit();
    addWire(P, Q, '4', H, 'N');
    const ds = assemblyDiagnostics(P, createRegistry(), formatter('pt'));
    expect(find(ds, 'TERMINAL_UNCONNECTED')?.values).toEqual({ device: 'H1', terminal: 'L' });
  });

  it('WIRE_COLOR: neutro feito com cabo castanho', () => {
    const { P, Q, H } = lampCircuit();
    addWire(P, Q, '2', H, 'L');
    const w = addWire(P, Q, '4', H, 'N', { conductor: 'L1' });
    const d = find(assemblyDiagnostics(P, createRegistry(), formatter('pt')), 'WIRE_COLOR')!;
    expect(d.values).toMatchObject({ expected: 'N', actual: 'L1' });
    expect(d.targets).toEqual([{ kind: 'wire', id: w.id }]);
  });
});

describe('outros diagnósticos em simulação', () => {
  function heaters(n: number, In: number, section: number) {
    const P = createProject();
    const G = addDevice(P, 'grid1ph', { params: { earthing: 'TN-S' } });
    const Q = addDevice(P, 'mcb1pn', { params: { In } });
    addWire(P, G, 'L', Q, '1', { section: 10 });
    addWire(P, G, 'N', Q, '3', { section: 10 });
    const J = addDevice(P, 'junction');
    const JN = addDevice(P, 'junction');
    addWire(P, Q, '2', J, 'a', { section });
    addWire(P, Q, '4', JN, 'a', { section });
    for (const t of ['b', 'c', 'd'].slice(0, n)) {
      const E = addDevice(P, 'heater');
      addWire(P, J, t, E, 'L', { section: 2.5 });
      addWire(P, JN, t, E, 'N', { section: 2.5 });
      addWire(P, G, 'PE', E, 'PE', { section: 2.5 });
    }
    return P;
  }

  it('CABLE_OVERLOAD: 3 aquecedores (26 A) num cabo de 2,5 mm² (24 A)', () => {
    const sim = new Simulator(heaters(3, 32, 2.5));
    sim.step(0.02);
    const ds = allDiagnostics(sim);
    expect(find(ds, 'CABLE_OVERLOAD')?.values.iz).toBe('24 A');
    expect(find(ds, 'CABLE_UNPROTECTED')).toBeDefined();
  });

  it('FUSE_BLOWN: curto franco num fusível de 16 A', () => {
    const P = createProject();
    const G = addDevice(P, 'grid1ph');
    const F = addDevice(P, 'fuseGG', { params: { In: 16 } });
    const CC = addDevice(P, 'shortCircuit', { state: { active: true } });
    addWire(P, G, 'L', F, '1');
    addWire(P, F, '2', CC, '1');
    addWire(P, G, 'N', CC, '2');
    const sim = new Simulator(P);
    sim.step(0.02);
    expect(find(allDiagnostics(sim), 'FUSE_BLOWN')?.values.device).toBe('F1');
    expect(sim.device(F.id)!.state.blown).toBe(true);
    sim.operate('F1', 'replace');
    expect(sim.device(F.id)!.state.blown).toBe(false);
    sim.step(0.02); // o curto continua: funde outra vez assim que o tempo avança
    expect(sim.device(F.id)!.state.blown).toBe(true);
  });

  it('BATTERY_EMPTY: bateria de 1 Ah a 1 % alimenta uma lâmpada de 21 W', () => {
    const P = createProject();
    const B = addDevice(P, 'battery', { params: { Ah: 1, soc0: 1 } });
    const H = addDevice(P, 'lampIncandescent', { params: { Vn: 12, P: 21 } });
    addWire(P, B, 'P', H, 'L');
    addWire(P, B, 'M', H, 'N');
    const sim = new Simulator(P, { maxStep: 1 });
    sim.run(60, 1);
    expect(find(allDiagnostics(sim), 'BATTERY_EMPTY')?.values.device).toBe('G1');
    expect(sim.measure('H1', 'meas.current')).toBeLessThan(1e-3);
  });
});

describe('«Porque não funciona?»', () => {
  function circuit() {
    const { P, Q, H } = lampCircuit();
    const a = addWire(P, Q, '2', H, 'L');
    addWire(P, Q, '4', H, 'N');
    return { P, Q, H, a };
  }

  it('LOAD_NO_SUPPLY: a fase não chega a H1', () => {
    const { P, Q, H } = lampCircuit();
    addWire(P, Q, '4', H, 'N');
    const sim = new Simulator(P);
    expect(whyNotWorking(sim, 'H1')).toMatchObject({ code: 'LOAD_NO_SUPPLY', values: { terminal: 'L' } });
  });

  it('WIRE_CUT: o cabo de Q1 para H1 está cortado', () => {
    const { P, a } = circuit();
    a.fault = { cut: true };
    const sim = new Simulator(P);
    sim.step(0.02);
    expect(whyNotWorking(sim, 'H1')).toMatchObject({ code: 'WIRE_CUT', values: { from: 'Q1', to: 'H1' }, fix: { id: a.id } });
  });

  it('SOURCE_OFF: falha de energia na rede', () => {
    const { P } = circuit();
    const sim = new Simulator(P);
    sim.operate('G1', 'power_off');
    expect(whyNotWorking(sim, 'H1')).toMatchObject({ code: 'SOURCE_OFF', values: { source: 'G1' } });
  });

  it('protecção disparada: devolve o diagnóstico do disparo', () => {
    const { P, Q } = circuit();
    Q.state = { closed: false, trip: 'thermal', tripCurrent: 19 };
    Q.params.In = 16;
    const sim = new Simulator(P);
    expect(whyNotWorking(sim, 'H1').code).toBe('MCB_THERMAL_TRIP');
  });

  it('LOAD_SWITCHED_OFF: termóstato do aquecedor desligado', () => {
    const { P, Q } = lampCircuit();
    const E = addDevice(P, 'heater', { state: { on: false } });
    addWire(P, Q, '2', E, 'L');
    addWire(P, Q, '4', E, 'N');
    const sim = new Simulator(P);
    sim.step(0.02);
    expect(whyNotWorking(sim, E.id).code).toBe('LOAD_SWITCHED_OFF');
  });

  it('LOAD_SWITCHED_OFF: tomada com tensão mas sem aparelho ligado', () => {
    const { P, Q } = lampCircuit();
    const X = addDevice(P, 'socket');
    addWire(P, Q, '2', X, 'L');
    addWire(P, Q, '4', X, 'N');
    const sim = new Simulator(P);
    sim.step(0.02);
    expect(whyNotWorking(sim, X.id).code).toBe('LOAD_SWITCHED_OFF');
  });

  it('LOW_VOLTAGE: lâmpada de 230 V no secundário de 24 V', () => {
    const { P, Q } = lampCircuit();
    const T = addDevice(P, 'transformer1ph', { params: { V2: 24 } });
    const H = P.devices.find((d) => d.type === 'lampIncandescent')!;
    addWire(P, Q, '2', T, 'P1');
    addWire(P, Q, '4', T, 'P2');
    addWire(P, T, 'S1', H, 'L');
    addWire(P, T, 'S2', H, 'N');
    const sim = new Simulator(P);
    sim.step(0.02);
    expect(whyNotWorking(sim, 'H1')).toMatchObject({ code: 'LOW_VOLTAGE', values: { nominal: '230 V' } });
  });

  it('NOT_A_LOAD: pedido sobre um disjuntor', () => {
    const { P } = circuit();
    expect(whyNotWorking(new Simulator(P), 'Q1').code).toBe('NOT_A_LOAD');
  });

  it('comando de escada com os comutadores desencontrados aponta o comutador aberto', () => {
    const { P, Q, H } = lampCircuit();
    const S1 = addDevice(P, 'stairSwitch', { state: { pos: 1 } });
    const S2 = addDevice(P, 'stairSwitch', { state: { pos: 2 } });
    addWire(P, Q, '2', S1, 'C');
    addWire(P, S1, '1', S2, '1');
    addWire(P, S1, '2', S2, '2');
    addWire(P, S2, 'C', H, 'L');
    addWire(P, Q, '4', H, 'N');
    const sim = new Simulator(P);
    sim.step(0.02);
    const d = whyNotWorking(sim, 'H1');
    expect(d.code).toBe('PATH_OPEN');
    expect(['S1', 'S2']).toContain(d.values.blocker);
  });
});

export type { Project };
