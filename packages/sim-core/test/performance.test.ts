/** Meta da Fase 1: um passo com 300 nós resolve em menos de 5 ms. */
import { describe, expect, it } from 'vitest';
import { addDevice, addWire, createProject, Simulator, type Project } from '../index';

/** Instalação com `circuits` circuitos: disjuntor → interruptor → ligador → 2 lâmpadas. */
function bigInstallation(circuits: number, level: 'beginner' | 'pro' = 'pro'): Project {
  const P = createProject({ level });
  const G = addDevice(P, 'grid1ph', { params: { earthing: 'TN-S' } });
  const R = addDevice(P, 'rcd2p');
  const BL = addDevice(P, 'busbar', { params: { bus: 'L' } });
  const BN = addDevice(P, 'busbar', { params: { bus: 'N' } });
  addWire(P, G, 'L', R, '1');
  addWire(P, G, 'N', R, '3');
  addWire(P, R, '2', BL, 'E');
  addWire(P, R, '4', BN, 'E');
  // Barramentos em cascata para ter saídas suficientes.
  let bl = BL;
  let bn = BN;
  let slot = 1;
  for (let c = 0; c < circuits; c++) {
    if (slot > 5) {
      const nl = addDevice(P, 'busbar', { params: { bus: 'L' } });
      const nn = addDevice(P, 'busbar', { params: { bus: 'N' } });
      addWire(P, bl, 'S6', nl, 'E');
      addWire(P, bn, 'S6', nn, 'E');
      bl = nl;
      bn = nn;
      slot = 1;
    }
    const Q = addDevice(P, 'mcb1pn');
    addWire(P, bl, `S${slot}`, Q, '1');
    addWire(P, bn, `S${slot}`, Q, '3');
    slot++;
    const S = addDevice(P, 'switch1', { state: { on: c % 2 === 0 } });
    const J = addDevice(P, 'junction');
    const JN = addDevice(P, 'junction');
    addWire(P, Q, '2', S, '1');
    addWire(P, S, '2', J, 'a');
    addWire(P, Q, '4', JN, 'a');
    for (const t of ['b', 'c']) {
      const H = addDevice(P, 'lampIncandescent');
      addWire(P, J, t, H, 'L', { length: 10 });
      addWire(P, JN, t, H, 'N', { length: 10 });
    }
  }
  return P;
}

describe('desempenho do solver', () => {
  it('300 nós resolvem em menos de 5 ms por passo', () => {
    const P = bigInstallation(24);
    const sim = new Simulator(P);
    for (let i = 0; i < 20; i++) sim.step(0.02); // aquecimento do JIT
    const nodes = sim.stats.nodes - 1;
    expect(nodes).toBeGreaterThanOrEqual(300);
    const times: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      sim.solve();
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[times.length >> 1]!;
    console.info(`nós: ${nodes}, elementos: ${sim.stats.elements}, mediana: ${median.toFixed(2)} ms, p90: ${times[Math.floor(times.length * 0.9)]!.toFixed(2)} ms`);
    expect(median).toBeLessThan(5);
  });

  it('um passo completo (resolver + lógica) com 300 nós também fica abaixo de 5 ms', () => {
    const sim = new Simulator(bigInstallation(24));
    for (let i = 0; i < 20; i++) sim.step(0.02);
    const times: number[] = [];
    for (let i = 0; i < 50; i++) {
      sim.step(0.02);
      times.push(sim.stats.solveMs);
    }
    times.sort((a, b) => a - b);
    expect(times[times.length >> 1]!).toBeLessThan(5);
  });
});
