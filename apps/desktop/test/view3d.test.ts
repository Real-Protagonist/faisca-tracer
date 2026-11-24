/** Vista 3D sem browser: todos os equipamentos têm modelo e a cena cabe no orçamento de desenho. */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { addDevice, addWire, createProject, defaultRegistry, lookFrom, parseProject, Simulator, type Device, type Project } from '@faisca/sim-core';
import { EXAMPLES } from '@faisca/content';
import { buildModel, MODELS, modelId } from '../src/view3d/models';
import { buildScene, drawCalls, ratingText, type Mode } from '../src/view3d/scene';

const triangles = (g: THREE.Object3D) => {
  let n = 0;
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const geo = m.geometry;
    n += (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3;
  });
  return n;
};

/** Actualiza todos os modelos com o estado de uma simulação. */
function animate(P: Project, mode: Mode, seconds = 1) {
  const sim = new Simulator(P);
  sim.run(seconds);
  const built = buildScene(sim.project, defaultRegistry, mode);
  const live = (d: Device) => ({ look: lookFrom(sim.measurements(d.id)), state: sim.device(d.id)!.state, params: d.params });
  for (let i = 0; i < 5; i++) built.update(live, 1 / 60);
  return built;
}

describe('modelos 3D', () => {
  it('todos os equipamentos da biblioteca têm modelo 3D', () => {
    const missing = defaultRegistry.all().filter((d) => !MODELS[modelId(d)]).map((d) => d.type);
    expect(missing).toEqual([]);
  });

  it('cada modelo constrói-se, actualiza-se e tem no máximo 20 malhas', () => {
    for (const def of defaultRegistry.all()) {
      const P = createProject();
      const d = addDevice(P, def.type);
      const sim = new Simulator(P);
      sim.step(0.05);
      const m = buildModel({ d, def, W: def.size.w / 40, H: def.size.h / 40, terms: def.terminals.map((t) => ({ x: (t.x - def.size.w / 2) / 40, y: -(t.y - def.size.h / 2) / 40, top: t.y < def.size.h / 2 })) });
      m.update?.({ look: lookFrom(sim.measurements(d.id)), state: d.state, params: d.params }, 1 / 60);
      expect(drawCalls(m.root), def.type).toBeGreaterThan(0);
      expect(drawCalls(m.root), def.type).toBeLessThanOrEqual(20);
      const box = new THREE.Box3().setFromObject(m.root);
      expect(box.isEmpty(), def.type).toBe(false);
    }
  });

  it('aparelhos iguais partilham a geometria fixa', () => {
    const P = createProject();
    const a = addDevice(P, 'mcb1pn');
    const b = addDevice(P, 'mcb1pn');
    const built = buildScene(P, defaultRegistry, 'bench');
    const geo = (d: Device) => (built.models.get(d.id)!.root.children[0] as THREE.Mesh).geometry;
    expect(geo(a)).toBe(geo(b));
  });
});

describe('estados animados', () => {
  it('a lâmpada acende, o motor roda e a alavanca do disjuntor cai no disparo', () => {
    const P = createProject({ domain: 'industrial' });
    const G = addDevice(P, 'grid3ph');
    const M = addDevice(P, 'motor3ph');
    ['L1', 'L2', 'L3'].forEach((l, k) => addWire(P, G, l, M, ['U1', 'V1', 'W1'][k]!));
    const H = addDevice(P, 'lampIncandescent');
    addWire(P, G, 'L1', H, 'L');
    addWire(P, G, 'N', H, 'N');
    const Q = addDevice(P, 'mcb1pn', { state: { closed: false, trip: 'magnetic' } });
    const built = animate(P, 'bench', 3);
    const lampGlow = built.models.get(H.id)!.root.children.find((o) => ((o as THREE.Mesh).material as THREE.MeshStandardMaterial)?.emissiveIntensity !== undefined && o !== built.models.get(H.id)!.root.children[0]) as THREE.Mesh;
    expect((lampGlow.material as THREE.MeshStandardMaterial).emissiveIntensity).toBeGreaterThan(1);
    // Veio do motor: roda entre actualizações.
    const shaft = built.models.get(M.id)!.root.children[1]!;
    const a0 = shaft.rotation.z;
    const sim = new Simulator(P);
    sim.run(3);
    built.update((d) => ({ look: lookFrom(sim.measurements(d.id)), state: sim.device(d.id)!.state, params: d.params }), 0.1);
    expect(shaft.rotation.z).not.toBe(a0);
    // Alavanca do disjuntor disparado: a meio (cerca de 90°).
    const lever = built.models.get(Q.id)!.root.children[1]!;
    for (let i = 0; i < 30; i++) built.update((d) => ({ look: lookFrom([]), state: d.state, params: d.params }), 0.05);
    expect(Math.abs(lever.rotation.x)).toBeGreaterThan(1.2);
    expect(Math.abs(lever.rotation.x)).toBeLessThan(1.9);
  });
});

describe('ligações na bancada', () => {
  function lamp() {
    const P = createProject();
    const G = addDevice(P, 'grid1ph', { params: { earthing: 'TN-S' } });
    const Q = addDevice(P, 'mcb1pn', { x: 0, y: 200 });
    const H = addDevice(P, 'lampIncandescent', { x: 0, y: 400 });
    addWire(P, G, 'L', Q, '1');
    addWire(P, G, 'N', Q, '3');
    const wl = addWire(P, Q, '2', H, 'L');
    addWire(P, Q, '4', H, 'N');
    return { P, Q, H, wl };
  }

  it('todos os bornes da bancada têm posição; na instalação real não há bornes clicáveis', () => {
    const { P } = lamp();
    const bench = buildScene(P, defaultRegistry, 'bench');
    const n = P.devices.reduce((s, d) => s + defaultRegistry.require(d.type).terminals.length, 0);
    expect(bench.terminals.size).toBe(n);
    expect(bench.looseEnds.size).toBe(0);
    expect(buildScene(P, defaultRegistry, 'real').terminals.size).toBe(0);
  });

  it('uma ponta desligada fica pendurada à frente do painel, longe do borne', () => {
    const { P, H, wl } = lamp();
    wl.detached = ['b'];
    const built = buildScene(P, defaultRegistry, 'bench');
    const loose = built.looseEnds.get(`${wl.id}:b`)!;
    expect(loose).toBeDefined();
    const term = built.terminals.get(`${H.id}:L`)!.pos;
    expect(loose.pos.distanceTo(term)).toBeGreaterThan(0.4);
    expect(loose.pos.z).toBeGreaterThan(0.3); // à frente do painel
    expect(built.looseEnds.size).toBe(1);
  });

  it('o calibre impresso sai dos parâmetros', () => {
    const def = (t: string) => defaultRegistry.require(t);
    const dev = (t: string, params: Record<string, unknown> = {}) => ({ id: 'x', type: t, name: 'X', x: 0, y: 0, rot: 0, params, state: {} }) as unknown as Device;
    expect(ratingText(def('mcb1pn'), dev('mcb1pn'))).toBe('C10 · 6 kA');
    expect(ratingText(def('mcb3p'), dev('mcb3p', { In: 32, curve: 'D' }))).toBe('D32 · 10 kA');
    expect(ratingText(def('rcd2p'), dev('rcd2p'))).toBe('30 mA · 40 A');
    expect(ratingText(def('contactor3p'), dev('contactor3p'))).toBe('230 V · 12 A');
  });
});

describe('cenas', () => {
  it('todos os exemplos constroem a bancada e a instalação real', () => {
    for (const ex of EXAMPLES) {
      for (const mode of ['bench', 'real'] as Mode[]) {
        const built = animate(parseProject(ex.text), mode, 0.2);
        expect(built.models.size, `${ex.id} ${mode}`).toBe(parseProject(ex.text).devices.length - (mode === 'real' ? parseProject(ex.text).devices.filter((d) => ['frame', 'note'].includes(d.type)).length : 0));
        expect(built.bounds.isEmpty()).toBe(false);
        built.dispose();
      }
    }
  });

  it('100 aparelhos: menos de 600 chamadas de desenho e 400 mil triângulos, construída em menos de 1,5 s', () => {
    const P = hundred();
    expect(P.devices.length).toBe(100);
    for (const mode of ['bench', 'real'] as Mode[]) {
      const t0 = performance.now();
      const built = animate(P, mode, 0.1);
      const ms = performance.now() - t0;
      const calls = drawCalls(built.group);
      const tris = triangles(built.group);
      console.log(`${mode}: ${calls} chamadas de desenho, ${Math.round(tris / 1000)} mil triângulos, ${ms.toFixed(0)} ms`);
      expect(calls).toBeLessThan(600);
      expect(tris).toBeLessThan(400_000);
      expect(ms).toBeLessThan(1500);
    }
  });

  it('actualizar 100 aparelhos num fotograma custa menos de 2 ms', () => {
    const P = hundred();
    const sim = new Simulator(P);
    sim.run(0.5);
    const built = buildScene(sim.project, defaultRegistry, 'bench');
    const looks = new Map(sim.project.devices.map((d) => [d.id, lookFrom(sim.measurements(d.id))]));
    const live = (d: Device) => ({ look: looks.get(d.id)!, state: d.state, params: d.params });
    let best = Infinity;
    for (let r = 0; r < 5; r++) {
      const t0 = performance.now();
      for (let i = 0; i < 60; i++) built.update(live, 1 / 60);
      best = Math.min(best, (performance.now() - t0) / 60);
    }
    expect(best).toBeLessThan(2);
  });
});

/** Quadro industrial com 100 aparelhos: 10 arranques directos completos (rede comum). */
export function hundred(): Project {
  const P = createProject({ domain: 'industrial', level: 'pro' });
  const G = addDevice(P, 'grid3ph', { x: 0, y: 0 });
  const kinds = ['motorBreaker', 'contactor3p', 'thermalRelay', 'motor3ph', 'buttonNC', 'buttonNO', 'pilotLight', 'pilotLight', 'lampIncandescent'];
  for (let i = 0; i < 11 && P.devices.length < 100; i++) {
    const col = (i % 4) * 700;
    const row = Math.floor(i / 4) * 800 + 140;
    const d: Record<string, Device> = {};
    kinds.forEach((k, j) => {
      if (P.devices.length >= 100) return;
      d[k + j] = addDevice(P, k, { x: col + (j < 4 ? 0 : 320), y: row + (j < 4 ? j * 170 : (j - 4) * 120) });
    });
    const Q = d.motorBreaker0, K = d.contactor3p1, F = d.thermalRelay2, M = d.motor3ph3;
    if (Q && K && F && M) {
      ['L1', 'L2', 'L3'].forEach((l, k) => addWire(P, G, l, Q, ['1', '3', '5'][k]!));
      [['2', '1'], ['4', '3'], ['6', '5']].forEach(([a, b]) => addWire(P, Q, a!, K, b!));
      [['2', '1'], ['4', '3'], ['6', '5']].forEach(([a, b]) => addWire(P, K, a!, F, b!));
      ['U1', 'V1', 'W1'].forEach((t, k) => addWire(P, F, ['2', '4', '6'][k]!, M, t));
    }
  }
  return P;
}
