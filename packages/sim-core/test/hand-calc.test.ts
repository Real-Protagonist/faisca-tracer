/**
 * Casos de cálculo à mão. Cada teste escreve a fórmula da electrotecnia e compara-a com o
 * resultado do motor. Rede: fonte ideal de 230 V com impedância Zs em cada condutor.
 */
import { describe, expect, it } from 'vitest';
import {
  addDevice,
  addWire,
  allDiagnostics,
  cabs,
  carg,
  createProject,
  formatQuantity,
  fuseTime,
  mcbTripTime,
  motor1Rated,
  nodeVoltage,
  elementCurrent,
  rms,
  solveNetwork,
  whyNotWorking,
  type Element,
  type Network,
} from '../index';
import { base, C, feed, rel, runUntil, Rw, sim } from './helpers';

const U = 230;

/* ------------------------------------------------------------------ */
describe('Solver MNA (circuitos elementares)', () => {
  const net = (n: number, els: Element[], f = 50): Network => ({ nodeCount: n, elements: els, omega: 2 * Math.PI * f, nodeLabels: [] });

  it('1. divisor de tensão DC: U2 = U · R2 / (R1 + R2)', () => {
    const N = net(3, [
      { k: 'V', a: 1, b: 0, ac: 0, phase: 0, dc: 10 },
      { k: 'Z', a: 1, b: 2, R: 1, L: 0, C: 0 },
      { k: 'Z', a: 2, b: 0, R: 4, L: 0, C: 0 },
    ]);
    const s = solveNetwork(N);
    rel(s.dc!.xr[1]!, (10 * 4) / 5, 1e-8);
  });

  it('2. RL série em AC: I = U / √(R² + X²), φ = −45° com X = R', () => {
    const L = 10 / (2 * Math.PI * 50);
    const z: Element = { k: 'Z', a: 1, b: 0, R: 10, L, C: 0 };
    const s = solveNetwork(net(2, [{ k: 'V', a: 1, b: 0, ac: U, phase: 0, dc: 0 }, z]));
    const i = elementCurrent(s.ac, z);
    rel(cabs(i), U / Math.hypot(10, 10), 1e-8);
    expect(carg(i)).toBeCloseTo(-45, 6);
  });

  it('3. RC série em AC: Xc = 1/(ωC), corrente adiantada 45°', () => {
    const Cf = 1 / (2 * Math.PI * 50 * 10);
    const z: Element = { k: 'Z', a: 1, b: 0, R: 10, L: 0, C: Cf };
    const s = solveNetwork(net(2, [{ k: 'V', a: 1, b: 0, ac: U, phase: 0, dc: 0 }, z]));
    const i = elementCurrent(s.ac, z);
    rel(cabs(i), U / Math.hypot(10, 10), 1e-8);
    expect(carg(i)).toBeCloseTo(45, 6);
  });

  it('4. sobreposição AC + DC: Ief = √(Iac² + Idc²)', () => {
    // 10 V AC em série com 5 V DC sobre 5 Ω: Iac = 2 A, Idc = 1 A.
    const z: Element = { k: 'Z', a: 2, b: 0, R: 5, L: 0, C: 0 };
    const s = solveNetwork(net(3, [{ k: 'V', a: 1, b: 0, ac: 10, phase: 0, dc: 0 }, { k: 'V', a: 2, b: 1, ac: 0, phase: 0, dc: 5 }, z]));
    const i = { ac: elementCurrent(s.ac, z), dc: elementCurrent(s.dc, z).re };
    rel(cabs(i.ac), 2, 1e-8);
    rel(i.dc, 1, 1e-8);
    rel(rms(i), Math.sqrt(5), 1e-8);
  });

  it('5. transformador ideal: U2 = U1 / n e I1 = I2 / n', () => {
    // 230 V, n = 10, carga de 23 Ω no secundário: U2 = 23 V, I2 = 1 A, I1 = 0,1 A.
    const x: Element = { k: 'X', p1: 1, p2: 0, s1: 2, s2: 0, n: 10 };
    const load: Element = { k: 'Z', a: 2, b: 0, R: 23, L: 0, C: 0 };
    const src: Element = { k: 'V', a: 1, b: 0, ac: U, phase: 0, dc: 0 };
    const s = solveNetwork(net(3, [src, x, load]));
    rel(cabs(nodeVoltage(s.ac, 2)), 23, 1e-8);
    rel(cabs(elementCurrent(s.ac, load)), 1, 1e-8);
    // O GMIN (10⁻⁹ S por nó) acrescenta ~0,2 µA: erro relativo ≈ 2·10⁻⁶.
    rel(cabs(elementCurrent(s.ac, src)), 0.1, 1e-5);
  });

  it('6. fonte de corrente: U = I · R', () => {
    const s = solveNetwork(net(2, [{ k: 'I', a: 0, b: 1, ac: { re: 0, im: 0 }, dc: 2 }, { k: 'Z', a: 1, b: 0, R: 7, L: 0, C: 0 }]));
    rel(s.dc!.xr[0]!, 14, 1e-8);
  });

  it('7. rede em escada: resultado esparso = Kirchhoff (corrente na fonte = soma nas cargas)', () => {
    // 40 nós em cadeia, cada um com 1 Ω em série e 100 Ω para a terra.
    const els: Element[] = [{ k: 'V', a: 1, b: 0, ac: U, phase: 0, dc: 0 }];
    const shunts: Element[] = [];
    for (let k = 1; k < 40; k++) {
      els.push({ k: 'Z', a: k, b: k + 1, R: 1, L: 0, C: 0 });
      const sh: Element = { k: 'Z', a: k + 1, b: 0, R: 100, L: 0, C: 0 };
      els.push(sh);
      shunts.push(sh);
    }
    const s = solveNetwork(net(41, els));
    const total = shunts.reduce((a, e) => a + elementCurrent(s.ac, e).re, 0);
    rel(Math.abs(elementCurrent(s.ac, els[0]!).re), total, 1e-6);
  });
});

/* ------------------------------------------------------------------ */
describe('Cargas domésticas', () => {
  it('8. lâmpada de 60 W a 230 V: I = 0,261 A (exemplo do prompt)', () => {
    const s = base({ Zs: 0.001, len: 0.1 });
    const H = addDevice(s.P, 'lampIncandescent', { params: { P: 60 } });
    feed(s, H, 'L', 'N', 0.1);
    const x = sim(s.P);
    x.step(0.02);
    expect(x.measure(H.id, 'meas.current')).toBeCloseTo(0.261, 3);
  });

  it('9. lâmpada de 60 W com Zs e cabos: I = U / (U²/P + 2Zs + 4Rc + 2Rcontacto)', () => {
    const s = base();
    const H = addDevice(s.P, 'lampIncandescent', { params: { P: 60 } });
    feed(s, H);
    const x = sim(s.P);
    x.step(0.02);
    const I = U / (U * U / 60 + 2 * 0.15 + 4 * s.rw + 2 * C);
    rel(x.measure(H.id, 'meas.current'), I, 1e-6);
    rel(x.measure(H.id, 'meas.activePower'), I * I * (U * U / 60), 1e-6);
  });

  it('10. lâmpadas de 100 W e 60 W em paralelo: a corrente no disjuntor é a soma', () => {
    const s = base({ Zs: 0.001, len: 0.1 });
    const H1 = addDevice(s.P, 'lampIncandescent', { params: { P: 100 } });
    const H2 = addDevice(s.P, 'lampIncandescent', { params: { P: 60 } });
    feed(s, H1, 'L', 'N', 0.1);
    feed(s, H2, 'L', 'N', 0.1);
    const x = sim(s.P);
    x.step(0.02);
    // Diferença só pelo GMIN (10⁻⁹ S por nó).
    rel(x.measure(s.Q.id, 'meas.current'), x.measure(H1.id, 'meas.current') + x.measure(H2.id, 'meas.current'), 1e-5);
    rel(x.measure(s.Q.id, 'meas.current'), 160 / U, 2e-3);
  });

  it('11. duas lâmpadas iguais em série: I = U / (2R), cada uma com U/2', () => {
    const s = base({ Zs: 0.001, len: 0.1 });
    const H1 = addDevice(s.P, 'lampIncandescent', { params: { P: 60 } });
    const H2 = addDevice(s.P, 'lampIncandescent', { params: { P: 60 } });
    addWire(s.P, s.Q, '2', H1, 'L', { length: 0.1 });
    addWire(s.P, H1, 'N', H2, 'L', { length: 0.1 });
    addWire(s.P, H2, 'N', s.Q, '4', { length: 0.1 });
    const x = sim(s.P);
    x.step(0.02);
    rel(x.measure(H1.id, 'meas.current'), U / (2 * (U * U) / 60), 2e-4);
    rel(x.measure(H1.id, 'meas.voltage'), U / 2, 2e-4);
  });

  it('12. lâmpada LED de 9 W: I = P / U = 39,1 mA', () => {
    const s = base({ Zs: 0.001, len: 0.1 });
    const H = addDevice(s.P, 'lampLed', { params: { P: 9 } });
    feed(s, H, 'L', 'N', 0.1);
    const x = sim(s.P);
    x.step(0.02);
    rel(x.measure(H.id, 'meas.current'), 9 / U, 1e-4);
  });

  it('13. fluorescente 36 W, FP 0,5: I = P / (U · cos φ) = 0,313 A', () => {
    const s = base({ Zs: 0.001, len: 0.1 });
    const H = addDevice(s.P, 'lampFluorescent', { params: { P: 36, PF: 0.5 } });
    feed(s, H, 'L', 'N', 0.1);
    const x = sim(s.P);
    x.step(0.02);
    rel(x.measure(H.id, 'meas.current'), 36 / (U * 0.5), 1e-4);
    rel(x.measure(H.id, 'meas.powerFactor'), 0.5, 1e-4);
  });

  it('14. tomada com chaleira de 2200 W: I = 9,565 A', () => {
    const s = base({ Zs: 0.001, len: 0.1, S: 2.5 });
    const X = addDevice(s.P, 'socket', { params: { appliance: 'kettle' } });
    feed(s, X, 'L', 'N', 0.1, 2.5);
    const x = sim(s.P);
    x.step(0.02);
    expect(x.measure(X.id, 'meas.current')).toBeCloseTo(9.565, 2);
    rel(x.measure(X.id, 'meas.current'), U / ((U * U) / 2200 + 2 * 0.001 + 4 * Rw(0.1, 2.5) + 2 * C), 1e-6);
  });

  it('15. frigorífico 200 W, FP 0,7: I = 1,242 A e Q = P · tg φ = 204 var', () => {
    const s = base({ Zs: 0.001, len: 0.1 });
    const X = addDevice(s.P, 'socket', { params: { appliance: 'fridge' } });
    feed(s, X, 'L', 'N', 0.1);
    const x = sim(s.P);
    x.step(0.02);
    rel(x.measure(X.id, 'meas.current'), 200 / (U * 0.7), 1e-4);
    rel(x.measure(X.id, 'meas.reactivePower'), 200 * Math.tan(Math.acos(0.7)), 1e-4);
    rel(x.measure(X.id, 'meas.powerFactor'), 0.7, 1e-4);
  });

  it('16. aquecedor de 2000 W por cabo de 2,5 mm² com 20 m: queda ΔU = I · 2R', () => {
    const s = base({ Zs: 0.001, len: 0.1, S: 2.5 });
    const E = addDevice(s.P, 'heater', { params: { P: 2000 } });
    feed(s, E, 'L', 'N', 20, 2.5);
    const x = sim(s.P);
    x.step(0.02);
    const Rh = (U * U) / 2000;
    const Rline = 2 * 0.001 + 2 * Rw(0.1, 2.5) + 2 * C + 2 * Rw(20, 2.5);
    const I = U / (Rh + Rline);
    rel(x.measure(E.id, 'meas.current'), I, 1e-6);
    rel(x.measure(E.id, 'meas.voltage'), I * Rh, 1e-6);
  });

  it('17. cabo de alumínio: R = 0,036 · L / S', () => {
    const s = base({ Zs: 0.001, len: 0.1, S: 16 });
    const E = addDevice(s.P, 'heater', { params: { P: 4500 } });
    addWire(s.P, s.Q, '2', E, 'L', { length: 50, section: 16, material: 'Al' });
    addWire(s.P, s.Q, '4', E, 'N', { length: 50, section: 16, material: 'Al' });
    const x = sim(s.P);
    x.step(0.02);
    const I = U / ((U * U) / 4500 + 2 * 0.001 + 2 * Rw(0.1, 16) + 2 * C + 2 * Rw(50, 16, 0.036));
    rel(x.measure(E.id, 'meas.current'), I, 1e-6);
  });

  it('18. perfil Profissional: reactância do cabo 0,08 mΩ/m', () => {
    const s = base({ Zs: 0.001, len: 0.1, S: 2.5, level: 'pro' });
    const E = addDevice(s.P, 'heater', { params: { P: 2000 } });
    feed(s, E, 'L', 'N', 100, 2.5);
    const x = sim(s.P);
    x.step(0.02);
    const R = (U * U) / 2000 + 2 * 0.001 + 2 * Rw(0.1, 2.5) + 2 * C + 2 * Rw(100, 2.5);
    const X = 0.08e-3 * (2 * 0.1 + 2 * 100);
    rel(x.measure(E.id, 'meas.current'), U / Math.hypot(R, X), 1e-6);
  });

  it('19. motor monofásico 0,75 kW, η 0,78, FP 0,8: In = P / (U · η · cos φ) = 5,23 A', () => {
    const s = base({ Zs: 0.001, len: 0.1, S: 2.5 });
    const M = addDevice(s.P, 'motor1ph', { params: { Pm: 0.75, eta: 0.78, PF: 0.8, inertia: 'medium' } });
    feed(s, M, 'L', 'N', 0.1, 2.5);
    const x = sim(s.P, 0.02);
    x.run(1.5, 0.02);
    rel(x.measure(M.id, 'meas.current'), motor1Rated(0.75, 0.78, 0.8), 1e-3);
    expect(motor1Rated(0.75, 0.78, 0.8)).toBeCloseTo(5.226, 3);
  });

  it('20. motor monofásico: arranque a 6 × In e passagem a marcha ao fim de 0,8 s', () => {
    const s = base({ Zs: 0.001, len: 0.1, S: 2.5, mcb: { In: 16, curve: 'C' } });
    const M = addDevice(s.P, 'motor1ph', { params: { Pm: 0.75, kStart: 6, inertia: 'medium' } });
    feed(s, M, 'L', 'N', 0.1, 2.5);
    const x = sim(s.P, 0.02);
    x.step(0.02);
    rel(x.measure(M.id, 'meas.current'), 6 * motor1Rated(0.75, 0.78, 0.8), 2e-3);
    x.run(1, 0.02);
    const ev = x.events.find((e) => e.code === 'motor_running');
    expect(ev).toBeDefined();
    expect(ev!.t).toBeGreaterThanOrEqual(0.8 - 0.021);
    expect(ev!.t).toBeLessThanOrEqual(0.8 + 0.021);
    expect(s.Q.state.closed).toBe(true);
  });

  it('21. contador de energia: E = P · t (aquecedor de 1000 W durante 6 min = 0,1 kWh)', () => {
    const s = base({ Zs: 0.001, len: 0.1, S: 2.5 });
    const Pm = addDevice(s.P, 'energyMeter1ph');
    const E = addDevice(s.P, 'heater', { params: { P: 1000 } });
    addWire(s.P, s.Q, '2', Pm, 'Li', { length: 0.1 });
    addWire(s.P, s.Q, '4', Pm, 'Ni', { length: 0.1 });
    addWire(s.P, Pm, 'Lo', E, 'L', { length: 0.1 });
    addWire(s.P, Pm, 'No', E, 'N', { length: 0.1 });
    const x = sim(s.P, 1);
    x.run(360, 1);
    const P = x.measure(Pm.id, 'meas.activePower');
    rel(P, 1000, 2e-3);
    rel(x.measure(Pm.id, 'meas.energy'), (P * 360) / 3600 / 1000, 1e-3);
  });

  it('22. ligador: a corrente de entrada é a soma das três saídas (lei dos nós)', () => {
    const s = base({ Zs: 0.001, len: 0.1 });
    const J = addDevice(s.P, 'junction');
    const Bn = addDevice(s.P, 'busbar', { params: { bus: 'N' } });
    addWire(s.P, s.Q, '2', J, 'a', { length: 0.1 });
    addWire(s.P, s.Q, '4', Bn, 'E', { length: 0.1 });
    const lamps = [40, 60, 100].map((P, k) => {
      const H = addDevice(s.P, 'lampIncandescent', { params: { P } });
      addWire(s.P, J, ['b', 'c', 'd'][k]!, H, 'L', { length: 0.1 });
      addWire(s.P, Bn, `S${k + 1}`, H, 'N', { length: 0.1 });
      return H;
    });
    const x = sim(s.P);
    x.step(0.02);
    const sum = lamps.reduce((a, H) => a + x.measure(H.id, 'meas.current'), 0);
    rel(x.measure(s.Q.id, 'meas.current'), sum, 1e-5); // GMIN

    rel(sum, 200 / U, 2e-3);
  });

  it('23. amperímetro em série e voltímetro em paralelo medem I e U da lâmpada', () => {
    const s = base();
    const A = addDevice(s.P, 'ammeter');
    const V = addDevice(s.P, 'voltmeter');
    const H = addDevice(s.P, 'lampIncandescent', { params: { P: 100 } });
    addWire(s.P, s.Q, '2', A, 'A');
    addWire(s.P, A, 'B', H, 'L');
    addWire(s.P, s.Q, '4', H, 'N');
    addWire(s.P, V, 'A', H, 'L', { length: 0.5 });
    addWire(s.P, V, 'B', H, 'N', { length: 0.5 });
    const x = sim(s.P);
    x.step(0.02);
    const Rl = (U * U) / 100;
    const I = U / (Rl + 2 * 0.15 + 5 * s.rw + 3 * C);
    // O voltímetro (10 MΩ) em paralelo altera o resultado em ~5·10⁻⁵.
    rel(x.measure(A.id, 'meas.reading'), I, 1e-4);
    rel(x.measure(V.id, 'meas.reading'), I * Rl, 1e-4);
  });

  it('24. ligação solta de 2 Ω: I = U / (R + Rc) e P perdida = I² · Rc', () => {
    const s = base({ Zs: 0.001, len: 0.1, S: 2.5 });
    const E = addDevice(s.P, 'heater', { params: { P: 2000 } });
    feed(s, E, 'L', 'N', 0.1, 2.5);
    s.P.wires[2]!.fault = { contactResistance: 2 };
    const x = sim(s.P);
    x.step(0.02);
    const I = U / ((U * U) / 2000 + 2 + 2 * 0.001 + 4 * Rw(0.1, 2.5) + 2 * C);
    rel(x.measure(E.id, 'meas.current'), I, 1e-6);
    const d = allDiagnostics(x).find((g) => g.code === 'LOOSE_CONNECTION');
    expect(d?.values.power).toBe(formatQuantity(I * I * 2, 'W', 'pt'));
  });
});

/* ------------------------------------------------------------------ */
describe('Fontes DC e transformador', () => {
  it('25. bateria 12 V carregada (12,72 V) com lâmpada de 21 W: I = E / (R + Ri + 2Rc)', () => {
    const P = createProject();
    const G = addDevice(P, 'battery', { params: { V: 12, soc0: 100, Ri: 0.02 } });
    const H = addDevice(P, 'lampIncandescent', { params: { P: 21, Vn: 12 } });
    addWire(P, G, 'P', H, 'L', { length: 1, section: 2.5 });
    addWire(P, G, 'M', H, 'N', { length: 1, section: 2.5 });
    const x = sim(P);
    x.step(0.02);
    const E = 12 * (0.98 + 0.08);
    rel(x.measure(H.id, 'meas.current'), E / (144 / 21 + 0.02 + 2 * Rw(1, 2.5)), 1e-6);
  });

  it('26. descarga da bateria: ΔSOC = I · t / Ah', () => {
    const P = createProject();
    const G = addDevice(P, 'battery', { params: { V: 12, Ah: 100, soc0: 100 } });
    const H = addDevice(P, 'lampIncandescent', { params: { P: 21, Vn: 12 } });
    addWire(P, G, 'P', H, 'L', { length: 1, section: 2.5 });
    addWire(P, G, 'M', H, 'N', { length: 1, section: 2.5 });
    const x = sim(P, 1);
    x.step(1);
    const I = x.measure(G.id, 'meas.current');
    x.run(599, 1);
    rel(100 - x.measure(G.id, 'meas.soc'), (100 * I * 600) / 3600 / 100, 5e-3);
    rel(x.measure(G.id, 'meas.autonomy'), (x.measure(G.id, 'meas.soc') / 100) * 100 / x.measure(G.id, 'meas.current'), 1e-6);
  });

  it('27. painel solar em curto-circuito (amperímetro): I ≈ Isc', () => {
    const P = createProject();
    const G = addDevice(P, 'solarPanel', { params: { Voc: 22, Isc: 6, irr: 100 } });
    const A = addDevice(P, 'ammeter');
    addWire(P, G, 'P', A, 'A', { length: 1, section: 2.5 });
    addWire(P, A, 'B', G, 'M', { length: 1, section: 2.5 });
    const x = sim(P);
    x.step(0.02);
    rel(x.measure(A.id, 'meas.reading'), 22 / (22 / 6 + C + 2 * Rw(1, 2.5)), 1e-6);
  });

  it('28. painel solar em vazio a 50 % de irradiância: Uoc = Voc · (0,88 + 0,12 · 0,5)', () => {
    const P = createProject();
    const G = addDevice(P, 'solarPanel', { params: { Voc: 22, Isc: 6, irr: 50 } });
    const V = addDevice(P, 'voltmeter');
    addWire(P, G, 'P', V, 'A');
    addWire(P, G, 'M', V, 'B');
    const x = sim(P);
    x.step(0.02);
    rel(x.measure(V.id, 'meas.reading'), 22 * (0.88 + 0.06), 1e-5);
  });

  it('29. transformador 230/12 V em vazio: U2 = U1 / n', () => {
    const s = base({ Zs: 0.15 });
    const T = addDevice(s.P, 'transformer1ph', { params: { V1: 230, V2: 12, S: 63 } });
    feed(s, T, 'P1', 'P2');
    const x = sim(s.P);
    x.step(0.02);
    const Rm = (230 * 230) / (0.02 * 63);
    const U1 = (U * Rm) / (Rm + 2 * 0.15 + 4 * s.rw + 2 * C);
    rel(x.measure(T.id, 'meas.secondaryVoltage'), U1 / (230 / 12), 1e-6);
  });

  it('30. transformador com campainha de 12 V: I1 ≈ I2 / n', () => {
    const s = base();
    const T = addDevice(s.P, 'transformer1ph', { params: { V1: 230, V2: 12, S: 63 } });
    const H = addDevice(s.P, 'bell', { params: { Vn: 12 } });
    feed(s, T, 'P1', 'P2');
    addWire(s.P, T, 'S1', H, '1');
    addWire(s.P, T, 'S2', H, '2');
    const x = sim(s.P);
    x.step(0.02);
    const I2 = x.measure(T.id, 'meas.secondaryCurrent');
    rel(I2, 5 / 12, 0.02); // 5 VA a 12 V, menos a queda interna (uk = 5 %)
    rel(x.measure(T.id, 'meas.primaryCurrent') * (230 / 12), I2, 0.03);
  });
});

/* ------------------------------------------------------------------ */
describe('Comando de iluminação', () => {
  function stair(withIntermediate: boolean) {
    const s = base({ Zs: 0.001, len: 0.1 });
    const S1 = addDevice(s.P, 'stairSwitch');
    const S2 = addDevice(s.P, 'stairSwitch');
    const H = addDevice(s.P, 'lampIncandescent');
    addWire(s.P, s.Q, '2', S1, 'C');
    if (withIntermediate) {
      const K = addDevice(s.P, 'intermediateSwitch');
      addWire(s.P, S1, '1', K, 'A');
      addWire(s.P, S1, '2', K, 'B');
      addWire(s.P, K, 'C', S2, '1');
      addWire(s.P, K, 'D', S2, '2');
      addWire(s.P, S2, 'C', H, 'L');
      addWire(s.P, s.Q, '4', H, 'N');
      return { s, S1, S2, H, K };
    }
    addWire(s.P, S1, '1', S2, '1');
    addWire(s.P, S1, '2', S2, '2');
    addWire(s.P, S2, 'C', H, 'L');
    addWire(s.P, s.Q, '4', H, 'N');
    return { s, S1, S2, H, K: null };
  }

  it('31. comando de escada: a lâmpada acende quando os dois comutadores estão na mesma posição', () => {
    const { s, S1, S2, H } = stair(false);
    const x = sim(s.P);
    for (const [p1, p2] of [[1, 1], [1, 2], [2, 1], [2, 2]] as const) {
      x.device(S1.id)!.state.pos = p1;
      x.device(S2.id)!.state.pos = p2;
      x.step(0.02);
      const lit = x.measure(H.id, 'meas.current') > 0.2;
      expect(lit, `${p1}/${p2}`).toBe(p1 === p2);
    }
  });

  it('32. comando de três sítios com inversor: acende quando (S1 = S2) XOR inversor cruzado', () => {
    const { s, S1, S2, H, K } = stair(true);
    const x = sim(s.P);
    for (const p1 of [1, 2])
      for (const p2 of [1, 2])
        for (const cr of [false, true]) {
          x.device(S1.id)!.state.pos = p1;
          x.device(S2.id)!.state.pos = p2;
          x.device(K!.id)!.state.crossed = cr;
          x.step(0.02);
          expect(x.measure(H.id, 'meas.current') > 0.2, `${p1}/${p2}/${cr}`).toBe((p1 === p2) !== cr);
        }
  });

  it('33. telerruptor: cada impulso no botão muda o estado da lâmpada', () => {
    const s = base({ Zs: 0.001, len: 0.1 });
    const S = addDevice(s.P, 'pushButton');
    const K = addDevice(s.P, 'impulseRelay', { params: { Vc: 230 } });
    const H = addDevice(s.P, 'lampIncandescent');
    addWire(s.P, s.Q, '2', S, '1');
    addWire(s.P, S, '2', K, 'A1');
    addWire(s.P, K, 'A2', s.Q, '4');
    addWire(s.P, s.Q, '2', K, '1');
    addWire(s.P, K, '2', H, 'L');
    addWire(s.P, H, 'N', s.Q, '4');
    const x = sim(s.P);
    x.step(0.02);
    expect(x.measure(H.id, 'meas.current')).toBeLessThan(1e-3);
    for (const expectLit of [true, false, true]) {
      x.operate(S.id, 'press', 'down');
      x.step(0.1);
      x.operate(S.id, 'press', 'up');
      x.step(0.1);
      expect(x.measure(H.id, 'meas.current') > 0.2).toBe(expectLit);
    }
  });
});

/* ------------------------------------------------------------------ */
describe('Protecções contra sobreintensidades', () => {
  /** Disjuntor a alimentar um curto com resistência Rf: I = U / (2Zs + 4Rc + 2Rcontacto + Rf). */
  function faultCircuit(mcb: Record<string, number | string>, Rf: number, Zs = 0.15, protection = 'mcb1pn', len = 2, S = 1.5) {
    const s = base({ Zs, mcb, protection, len, S });
    const F = addDevice(s.P, 'shortCircuit', { params: { Rf }, state: { active: true } });
    if (protection === 'fuseGG') {
      addWire(s.P, s.Q, '2', F, '1');
      addWire(s.P, s.P.devices[0]!, 'N', F, '2');
      return { s, F, loop: 2 * Zs + 3 * s.rw + 0.003 + Rf };
    }
    feed(s, F, '1', '2', len, S);
    return { s, F, loop: 2 * Zs + 4 * s.rw + 2 * C + Rf };
  }

  it('34. curto franco num C10: disparo magnético no primeiro passo; I = U / Zloop', () => {
    const { s, loop } = faultCircuit({ In: 10, curve: 'C' }, 0.001);
    const x = sim(s.P, 0.02);
    x.step(0.02);
    const ev = x.events.find((e) => e.code === 'mcb_magnetic_trip');
    expect(ev).toBeDefined();
    expect(x.device(s.Q.id)!.state.trip).toBe('magnetic');
    rel(Number(x.device(s.Q.id)!.state.tripCurrent), U / loop, 1e-6);
  });

  it('35. B16 a 70 A (4,4 × In, abaixo do magnético): disparo térmico em t = K / (r² − 1,13²)', () => {
    const target = 70;
    const { s } = faultCircuit({ In: 16, curve: 'B' }, 1);
    const loop0 = 2 * 0.15 + 4 * s.rw + 2 * C;
    s.P.devices.find((d) => d.type === 'shortCircuit')!.params.Rf = U / target - loop0;
    const x = sim(s.P, 0.05);
    const t = runUntil(x, () => x.device(s.Q.id)!.state.trip === 'thermal', 60, 0.05);
    expect(x.device(s.Q.id)!.state.trip).toBe('thermal');
    const expected = mcbTripTime(target / 16);
    expect(Math.abs(t - expected)).toBeLessThanOrEqual(0.05 + 1e-9);
  });

  it('36. 19 A num disjuntor de 16 A dispara por sobrecarga em ≈ 1126 s (exemplo do prompt)', () => {
    const { s } = faultCircuit({ In: 16, curve: 'C' }, 1);
    s.P.devices.find((d) => d.type === 'shortCircuit')!.params.Rf = U / 19 - (2 * 0.15 + 4 * s.rw + 2 * C);
    const x = sim(s.P, 1);
    const t = runUntil(x, () => !!x.device(s.Q.id)!.state.trip, 3600, 1);
    rel(t, 150 / ((19 / 16) ** 2 - 1.13 ** 2), 1.5e-3);
    const d = allDiagnostics(x).find((g) => g.code === 'MCB_THERMAL_TRIP')!;
    expect(d.values).toMatchObject({ device: 'Q1', current: '19 A', rated: '16 A' });
  });

  it('37. a 1,12 · In o disjuntor não dispara numa hora (IEC 60898: 1,13 · In)', () => {
    const { s } = faultCircuit({ In: 16 }, 1);
    s.P.devices.find((d) => d.type === 'shortCircuit')!.params.Rf = U / (1.12 * 16) - (2 * 0.15 + 4 * s.rw + 2 * C);
    const x = sim(s.P, 2);
    x.run(3600, 2);
    expect(x.device(s.Q.id)!.state.closed).toBe(true);
  });

  it('38. a 1,45 · In o disjuntor dispara antes de uma hora', () => {
    const { s } = faultCircuit({ In: 16 }, 1);
    s.P.devices.find((d) => d.type === 'shortCircuit')!.params.Rf = U / (1.45 * 16) - (2 * 0.15 + 4 * s.rw + 2 * C);
    const x = sim(s.P, 1);
    const t = runUntil(x, () => !!x.device(s.Q.id)!.state.trip, 3600, 1);
    expect(t).toBeLessThan(3600);
    rel(t, mcbTripTime(1.45), 1e-2);
  });

  it('39. poder de corte excedido: Icc = U / Zloop > Icn = 6 kA', () => {
    const { s, loop } = faultCircuit({ In: 16, curve: 'C', Icn: 6 }, 0.001, 0.005, 'mcb1pn', 0.5, 10);
    const x = sim(s.P);
    x.step(0.02);
    expect(U / loop).toBeGreaterThan(6000);
    const d = allDiagnostics(x).find((g) => g.code === 'MCB_BREAKING_CAPACITY');
    expect(d?.values.icn).toBe('6 kA');
  });

  it('40. corrente de curto-circuito presumida fase-neutro nos bornes da carga', () => {
    const s = base();
    const H = addDevice(s.P, 'lampIncandescent');
    feed(s, H);
    const x = sim(s.P);
    const I = x.prospectiveCurrent({ device: H.id, terminal: 'L' }, { device: H.id, terminal: 'N' });
    rel(I, U / (2 * 0.15 + 4 * s.rw + 2 * C + 1e-3), 1e-5);
  });

  it('41. corrente de defeito fase-PE em TN-S: I = U / (Zs,L + Rc,L + Rdef + Rc,PE + Zs,PE)', () => {
    const s = base({ earthing: 'TN-S', mcb: { In: 16, curve: 'C' } });
    const E = addDevice(s.P, 'heater', { params: { defect: 'frank' }, state: { on: false } });
    feed(s, E);
    addWire(s.P, s.G, 'PE', E, 'PE');
    const x = sim(s.P, 0.02);
    x.step(0.02);
    const If = U / (0.15 + 2 * s.rw + C + 0.5 + s.rw + 0.15);
    rel(Number(x.device(s.Q.id)!.state.tripCurrent), If, 1e-4);
    expect(x.device(s.Q.id)!.state.trip).toBe('magnetic');
  });

  it('42. fusível gG 16 A a 80 A (5 × In) funde em 2 s (tabela)', () => {
    const { s } = faultCircuit({ In: 16 }, 1, 0.15, 'fuseGG');
    const loop0 = 2 * 0.15 + 3 * s.rw + 0.003;
    s.P.devices.find((d) => d.type === 'shortCircuit')!.params.Rf = U / 80 - loop0;
    const x = sim(s.P, 0.02);
    const t = runUntil(x, () => !!x.device(s.Q.id)!.state.blown, 10, 0.02);
    expect(Math.abs(t - fuseTime(80, 16))).toBeLessThanOrEqual(0.02 + 1e-9);
    rel(fuseTime(80, 16), 2, 1e-9);
  });

  it('43. fusível gG 16 A a 1,25 · In não funde numa hora', () => {
    const { s } = faultCircuit({ In: 16 }, 1, 0.15, 'fuseGG');
    s.P.devices.find((d) => d.type === 'shortCircuit')!.params.Rf = U / 20 - (2 * 0.15 + 3 * s.rw + 0.003);
    const x = sim(s.P, 2);
    x.run(3600, 2);
    expect(x.device(s.Q.id)!.state.blown).toBe(false);
  });

  it('44. fusível gG 10 A: a curva desloca-se para 1,9 · In (IEC 60269)', () => {
    // A 50 A: 5 × In; na tabela escalada (×1,9/1,6) fica entre 4 × (5 s) e 5 × (2 s).
    const k = 5 / (1.9 / 1.6);
    const f = Math.log(k / 4) / Math.log(5 / 4);
    rel(fuseTime(50, 10), Math.exp(Math.log(5) + f * Math.log(2 / 5)), 1e-9);
    expect(fuseTime(1.85 * 10, 10)).toBe(Infinity);
  });
});

/* ------------------------------------------------------------------ */
describe('Diferenciais, terra e pessoas', () => {
  function ttCircuit(o: { IDn?: number; withRcd?: boolean } = {}) {
    const s = base({ earthing: 'TT', Zs: 0.15, Rb: 2, protection: o.withRcd === false ? 'mcb1pn' : 'rcd2p', mcb: { IDn: o.IDn ?? 30 } });
    return s;
  }

  it('45. defeito de 1000 Ω à terra em TT: If = U / (Zs + Rc + Rf + Rb), diferencial dispara em 20 ms', () => {
    const s = ttCircuit();
    const D = addDevice(s.P, 'earthFault', { params: { Rf: 1000 }, state: { active: true } });
    addWire(s.P, s.Q, '2', D, 'A');
    const x = sim(s.P, 0.01);
    x.step(0.01);
    const If = U / (0.15 + 2 * s.rw + C + 1000 + 2);
    rel(x.measure(D.id, 'meas.faultCurrent'), If, 1e-5);
    const t = runUntil(x, () => !!x.device(s.Q.id)!.state.trip, 1, 0.01);
    expect(t).toBeCloseTo(0.02, 6); // If > 5 · IΔn
  });

  it('46. fuga de 77 mA (entre IΔn e 5 · IΔn): disparo em 40 ms', () => {
    const s = ttCircuit();
    const D = addDevice(s.P, 'earthFault', { params: { Rf: 3000 }, state: { active: true } });
    addWire(s.P, s.Q, '2', D, 'A');
    const x = sim(s.P, 0.01);
    const t = runUntil(x, () => !!x.device(s.Q.id)!.state.trip, 1, 0.01);
    expect(t).toBeCloseTo(0.04, 6);
  });

  it('47. fuga de 20 mA num diferencial de 30 mA: não dispara', () => {
    const s = ttCircuit();
    const D = addDevice(s.P, 'earthFault', { params: { Rf: U / 0.02 }, state: { active: true } });
    addWire(s.P, s.Q, '2', D, 'A');
    const x = sim(s.P, 0.05);
    x.run(5);
    expect(x.device(s.Q.id)!.state.closed).toBe(true);
    rel(x.measure(s.Q.id, 'meas.residualCurrent'), 0.02, 2e-3);
  });

  it('48. carga normal: corrente residual nula (fase e neutro iguais)', () => {
    const s = ttCircuit();
    const E = addDevice(s.P, 'heater');
    feed(s, E);
    const x = sim(s.P);
    x.step(0.02);
    expect(x.measure(s.Q.id, 'meas.residualCurrent')).toBeLessThan(1e-6);
  });

  it('49. botão de teste: corrente de ensaio 1,5 · IΔn e disparo', () => {
    const s = ttCircuit();
    const H = addDevice(s.P, 'lampIncandescent');
    feed(s, H);
    const x = sim(s.P, 0.01);
    x.step(0.01);
    x.operate(s.Q.id, 'test');
    rel(x.measure(s.Q.id, 'meas.residualCurrent'), U / (U / 0.045 + 2 * 0.15 + 2 * s.rw + 2 * C), 2e-2);
    runUntil(x, () => !!x.device(s.Q.id)!.state.trip, 1, 0.01);
    expect(x.device(s.Q.id)!.state.trip).toBe('residual');
  });

  it('50. tomada com defeito de 5 kΩ em TT: fuga = U / (Rdef + Ra + Rb + …) ≈ 46 mA, diferencial dispara', () => {
    const s = ttCircuit();
    const X = addDevice(s.P, 'socket', { params: { appliance: 'laptop', defect: 'leak' } });
    const Ea = addDevice(s.P, 'earthElectrode', { params: { Ra: 20 } });
    feed(s, X);
    addWire(s.P, X, 'PE', Ea, 'PE');
    const x = sim(s.P, 0.01);
    x.step(0.01);
    rel(x.measure(X.id, 'meas.leakCurrent'), U / (5000 + 20 + 2 + 0.15 + 3 * s.rw + C), 1e-3);
    runUntil(x, () => !!x.device(s.Q.id)!.state.trip, 1, 0.01);
    const d = allDiagnostics(x).find((g) => g.code === 'RCD_TRIP')!;
    expect(d.values.location).toBe('X1');
    expect(d.values.current).toBe('45,8 mA');
  });

  it('51. pessoa toca na carcaça de um aquecedor sem terra (defeito franco), sem diferencial: I = U / (Rdef + Rcorpo + Rchão + Rb + …)', () => {
    const s = ttCircuit({ withRcd: false });
    const E = addDevice(s.P, 'heater', { params: { defect: 'frank' }, state: { on: false } });
    const Z = addDevice(s.P, 'person', { params: { floor: 'shoes', Rbody: 1000 } });
    feed(s, E);
    addWire(s.P, Z, 'M', E, 'PE');
    const x = sim(s.P, 0.05);
    x.run(1.2);
    const I = U / (0.15 + 3 * s.rw + C + 0.5 + 1000 + 1000 + 2);
    rel(x.measure(Z.id, 'meas.bodyCurrent'), I, 1e-5);
    const d = allDiagnostics(x).find((g) => g.code === 'BODY_CURRENT')!;
    expect(d.severity).toBe('error');
    expect(d.values.location).toBe(E.name);
    const zone = x.measurements(Z.id).find((m) => m.key === 'meas.bodyZone')!.value;
    expect(zone).toEqual({ key: 'state.zone_AC4', values: undefined });
  });

  it('52. massa ligada ao eléctrodo (Ra = 20 Ω): tensão de contacto = If · Ra', () => {
    const s = ttCircuit({ withRcd: false });
    const E = addDevice(s.P, 'heater', { params: { defect: 'strong' }, state: { on: false } });
    const Ea = addDevice(s.P, 'earthElectrode', { params: { Ra: 20 } });
    feed(s, E);
    addWire(s.P, E, 'PE', Ea, 'PE');
    const x = sim(s.P);
    x.step(0.02);
    const If = U / (0.15 + 2 * s.rw + C + 500 + s.rw + 20 + 2);
    rel(x.measure(Ea.id, 'meas.earthCurrent'), If, 1e-5);
    rel(x.measure(Ea.id, 'meas.earthVoltage'), If * 20, 1e-5);
  });

  it('53. regra TT: Ra × IΔn ≤ 50 V → com 30 mA, Ra até 1667 Ω', () => {
    expect(1666 * 0.03).toBeLessThanOrEqual(50);
    expect(1667 * 0.03).toBeGreaterThan(50);
  });
});

/* ------------------------------------------------------------------ */
describe('Falhas e «Porque não funciona?»', () => {
  it('54. lâmpada de 12 V ligada a 230 V funde (P = 367 × Pn) e o diagnóstico explica', () => {
    const s = base();
    const H = addDevice(s.P, 'lampIncandescent', { params: { P: 21, Vn: 12 } });
    feed(s, H);
    const x = sim(s.P, 0.05);
    x.run(1);
    expect(x.device(H.id)!.state.burnt).toBe(true);
    const d = whyNotWorking(x, H.id);
    expect(d.code).toBe('WRONG_VOLTAGE');
    expect(d.values.nominal).toBe('12 V');
  });

  it('55. queda de tensão de um aquecedor por 60 m de 1,5 mm²: ΔU% = I · 2R / U', () => {
    const s = base({ Zs: 0.15, len: 0.1 });
    const E = addDevice(s.P, 'heater', { params: { P: 2000 } });
    feed(s, E, 'L', 'N', 60, 1.5);
    const x = sim(s.P);
    x.step(0.02);
    const Rl = 2 * Rw(0.1, 1.5) + 2 * C + 2 * Rw(60, 1.5);
    const I = U / ((U * U) / 2000 + 0.3 + Rl);
    const d = allDiagnostics(x).find((g) => g.code === 'VOLTAGE_DROP')!;
    expect(d.values.drop).toBe(formatQuantity((100 * I * Rl) / U, '%', 'pt'));
    expect(d.values.section).toBe('1,5 mm²');
    expect(d.values.length).toBe('60 m');
  });
});

describe('Ainda por implementar (Fase 4)', () => {
  it.todo('motor trifásico 4 kW, FP 0,85, η 0,88 a 400 V = 7,72 A');
});
