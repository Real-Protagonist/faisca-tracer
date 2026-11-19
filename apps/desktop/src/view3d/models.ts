/**
 * Modelos 3D dos equipamentos, um por cada `model3d` do núcleo. Cada modelo tem uma malha
 * estática (partilhada entre aparelhos iguais) e partes móveis que seguem o estado da simulação:
 * alavancas que caem no disparo, lâmpadas que acendem, rotores que rodam, LED, botões premidos.
 *
 * Coordenadas locais: origem no centro do aparelho, X para a direita, Y para cima, Z para a
 * frente; as costas do aparelho estão em z = 0 (encostadas ao painel). 1 unidade = 40 px do esquema.
 */
import * as THREE from 'three';
import type { Device, DeviceDef, Look, ParamValue } from '@faisca/sim-core';
import { cached, COL, glowMaterial, mats, type Kit } from './kit';

export interface Live {
  look: Look;
  state: Record<string, unknown>;
  params: Record<string, ParamValue>;
}

export interface Model {
  root: THREE.Group;
  /** Profundidade (para os cabos chegarem à frente dos bornes). */
  depth: number;
  update?(live: Live, dt: number): void;
}

/** Onde o aparelho fica na instalação real. */
export type Mount = 'board' | 'wall' | 'ceiling' | 'floor' | 'outside' | 'none';

export interface BuildInput {
  d: Device;
  def: DeviceDef;
  /** Largura e altura do símbolo, em unidades (px / 40). */
  W: number;
  H: number;
  /** Bornes em coordenadas locais (x, y) e se estão em cima. */
  terms: { x: number; y: number; top: boolean }[];
}

type Builder = (b: BuildInput) => Model;

const num = (v: ParamValue | undefined, def = 0) => (typeof v === 'number' ? v : Number(v ?? def) || def);
const bit = (mask: unknown, k: number) => ((Number(mask) || 0) >> k) % 2 === 1;

/* ---------------- peças móveis ---------------- */

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number] = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  return m;
}

const G = {
  lever: cached('p:lever', (k) => k.box(0.16, 0.42, 0.14, COL.dark, [0, 0.21, 0])),
  knob: cached('p:knob', (k) => k.cyl(0.22, 0.14, COL.dark, [0, 0, 0], [Math.PI / 2, 0, 0], 16).box(0.06, 0.34, 0.06, COL.white, [0, 0, 0.08])),
  led: new THREE.SphereGeometry(0.07, 10, 6),
  flag: new THREE.BoxGeometry(0.22, 0.14, 0.02),
  push: new THREE.CylinderGeometry(0.2, 0.2, 0.14, 18).rotateX(Math.PI / 2),
  bulb: new THREE.SphereGeometry(0.42, 18, 12),
  tube: new THREE.CylinderGeometry(0.11, 0.11, 2.4, 14).rotateZ(Math.PI / 2),
  shaft: cached('p:shaft', (k) => k.cyl(0.07, 0.5, COL.metal, [0, 0, 0.25], [Math.PI / 2, 0, 0], 10).box(0.6, 0.08, 0.04, COL.orange, [0, 0, 0.5]).box(0.08, 0.6, 0.04, COL.orange, [0, 0, 0.5])),
  mushroom: new THREE.SphereGeometry(0.34, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2),
};

/** Alavanca de aparelho modular: para cima ligado, para baixo desligado, a meio disparado. */
function lever(root: THREE.Group, x: number, y: number, z: number, blue = false) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.add(mesh(G.lever, blue ? mats().leverBlue : mats().lever));
  root.add(g);
  let cur = 0;
  return (target: 'on' | 'off' | 'trip', dt: number) => {
    const goal = target === 'on' ? -0.15 : target === 'off' ? Math.PI - 0.15 : Math.PI / 2;
    // A alavanca cai depressa no disparo e sobe à mão mais devagar.
    cur += (goal - cur) * Math.min(1, dt * (target === 'trip' ? 25 : 12));
    g.rotation.x = -cur;
  };
}

/** Indicador luminoso com material próprio. */
function led(root: THREE.Group, x: number, y: number, z: number, color: number, scale = 1) {
  const m = glowMaterial(color);
  const o = mesh(G.led, m, [x, y, z]);
  o.scale.setScalar(scale);
  root.add(o);
  return (on: number) => {
    m.emissiveIntensity = on * 2.2;
    m.color.setHex(on > 0.05 ? color : 0x6b7079);
  };
}

/** Bandeirola de estado (vermelho: disparo; verde: contactor fechado). */
function flag(root: THREE.Group, x: number, y: number, z: number, which: 'redFlag' | 'greenFlag') {
  const o = mesh(G.flag, mats()[which]!, [x, y, z]);
  root.add(o);
  return (show: boolean) => void (o.visible = show);
}

function body(root: THREE.Group, geo: THREE.BufferGeometry) {
  root.add(mesh(geo, mats().vertex));
}

/* ---------------- famílias ---------------- */

/** Corpo modular DIN: base com os bornes e frente saliente. */
function dinShape(k: Kit, W: number, H: number, D: number, terms: BuildInput['terms'], color: number = COL.body) {
  k.box(W, H, D * 0.55, color, [0, 0, D * 0.275]);
  k.box(W * 0.96, H * 0.5, D * 0.45, color, [0, 0, D * 0.775]);
  for (const t of terms) k.screw(t.x, t.top ? H / 2 - 0.16 : -H / 2 + 0.16, D * 0.55);
}

const termKey = (b: BuildInput) => b.terms.map((t) => `${t.x.toFixed(2)},${t.top ? 1 : 0}`).join(';');

/** Disjuntores, interruptor geral, diferenciais, disjuntor-motor e fusíveis. */
const breaker = (kind: 'mcb' | 'rcd' | 'switch' | 'fuse' | 'motor'): Builder => (b) => {
  const { W, H } = b;
  const D = 1.2;
  const root = new THREE.Group();
  body(root, cached(`din:${kind}:${W}:${H}:${termKey(b)}`, (k) => {
    dinShape(k, W, H, D, b.terms);
    k.box(W * 0.9, 0.12, 0.02, kind === 'rcd' ? COL.yellow : COL.bodyGrey, [0, H * 0.18, D + 0.01]);
    if (kind === 'rcd') k.cyl(0.09, 0.05, COL.yellow, [W * 0.3, -H * 0.12, D], [Math.PI / 2, 0, 0], 10);
    if (kind === 'fuse') k.box(W * 0.5, H * 0.4, 0.04, COL.bodyGrey, [0, -H * 0.05, D + 0.01]);
  }));
  if (kind === 'fuse') {
    const set = flag(root, 0, -H * 0.05, D + 0.05, 'redFlag');
    return { root, depth: D, update: (l) => set(!!l.state.blown) };
  }
  if (kind === 'motor') {
    // Manípulo rotativo: vertical ligado, rodado a 90° desligado, a 45° disparado.
    const knob = mesh(G.knob, mats().vertex, [0, H * 0.05, D + 0.07]);
    root.add(knob);
    const tripFlag = flag(root, W * 0.32, H * 0.3, D + 0.02, 'redFlag');
    let a = 0;
    return {
      root,
      depth: D,
      update: (l, dt) => {
        const goal = l.state.trip ? -Math.PI / 4 : l.state.closed ? 0 : -Math.PI / 2;
        a += (goal - a) * Math.min(1, dt * 12);
        knob.rotation.z = a;
        tripFlag(!!l.state.trip);
      },
    };
  }
  const set = lever(root, 0, -0.1, D, kind === 'rcd');
  const trip = flag(root, W * 0.3, H * 0.3, D + 0.01, 'redFlag');
  return {
    root,
    depth: D,
    update: (l, dt) => {
      set(l.state.trip ? 'trip' : l.state.closed ? 'on' : 'off', dt);
      trip(!!l.state.trip);
    },
  };
};

/** Contactores, relés, temporizadores e relé de fases: bandeirola verde quando actuados. */
const relay = (kind: 'contactor' | 'din-relay' | 'thermal' | 'starter'): Builder => (b) => {
  const { W, H } = b;
  const D = kind === 'contactor' || kind === 'starter' ? 1.5 : 1.2;
  const root = new THREE.Group();
  body(root, cached(`relay:${kind}:${W}:${H}:${termKey(b)}`, (k) => {
    dinShape(k, W, H, D, b.terms, kind === 'starter' ? COL.bodyGrey : COL.body);
    k.box(W * 0.3, H * 0.22, 0.03, COL.dark, [0, 0, D + 0.01]);
    if (kind === 'thermal') k.cyl(0.14, 0.06, COL.blue, [W * 0.3, 0, D], [Math.PI / 2, 0, 0], 12);
  }));
  const on = flag(root, 0, 0, D + 0.04, 'greenFlag');
  const bad = flag(root, W * 0.3, H * 0.28, D + 0.02, 'redFlag');
  const lamp = led(root, -W * 0.36, H * 0.28, D + 0.02, COL.green, 0.8);
  return {
    root,
    depth: D,
    update: (l) => {
      const s = l.state;
      const active = kind === 'thermal' ? false : !!(s.closed || s.coil || s.on || s.ok || (s.stage && s.stage !== 'off'));
      on(active);
      bad(!!(s.coilBurnt || s.tripped));
      lamp(active || (kind === 'thermal' && !s.tripped) ? 1 : 0);
    },
  };
};

/** Caixa com visor (contador, PLC, variador, analisador). */
const display = (kind: 'meter' | 'plc' | 'vfd' | 'energy'): Builder => (b) => {
  const { W, H } = b;
  const D = kind === 'vfd' ? 1.8 : 1.3;
  const root = new THREE.Group();
  body(root, cached(`box:${kind}:${W}:${H}:${termKey(b)}`, (k) => {
    dinShape(k, W, H, D, b.terms, kind === 'vfd' ? COL.dark : kind === 'plc' ? COL.bodyGrey : COL.body);
    k.box(Math.min(W * 0.4, 2.2), H * 0.28, 0.02, COL.screen, [kind === 'plc' ? -W * 0.25 : 0, H * 0.05, D + 0.01]);
  }));
  const screen = led(root, kind === 'plc' ? -W * 0.25 : 0, H * 0.05, D + 0.03, kind === 'vfd' ? COL.green : 0x7cf0a8, 0.5);
  if (kind === 'plc') {
    // 8 LED de entradas e 8 de saídas.
    const ins = Array.from({ length: 8 }, (_, i) => led(root, (i - 3.5) * 0.28 + W * 0.18, H * 0.3, D + 0.02, COL.green, 0.55));
    const outs = Array.from({ length: 8 }, (_, i) => led(root, (i - 3.5) * 0.28 + W * 0.18, -H * 0.3, D + 0.02, COL.orange, 0.55));
    return {
      root,
      depth: D,
      update: (l) => {
        screen(l.look.state === 'no_power' ? 0 : 0.6);
        ins.forEach((f, i) => f(bit(l.state.i, i) ? 1 : 0));
        outs.forEach((f, i) => f(bit(l.state.q, i) ? 1 : 0));
      },
    };
  }
  return {
    root,
    depth: D,
    update: (l) => screen(kind === 'vfd' ? (l.look.num('frequency') > 0.05 ? 1 : 0.15) : 0.5),
  };
};

/** Aparelhos de painel redondos: botões, emergência, selector, sinalizador. */
const panelRound = (kind: 'push' | 'push-green' | 'push-red' | 'emergency' | 'selector' | 'pilot'): Builder => (b) => {
  const { W, H } = b;
  const D = 0.9;
  const root = new THREE.Group();
  const capCol = kind === 'push-red' ? COL.red : kind === 'push-green' || kind === 'push' ? COL.green : COL.dark;
  body(root, cached(`round:${kind}:${W}:${H}:${termKey(b)}`, (k) => {
    k.box(W * 0.9, H * 0.85, D, COL.bodyGrey, [0, 0, D / 2]);
    k.cyl(0.36, 0.08, COL.metal, [0, 0, D + 0.04], [Math.PI / 2, 0, 0], 20);
    if (kind === 'emergency') k.cyl(0.55, 0.03, COL.yellow, [0, 0, D + 0.02], [Math.PI / 2, 0, 0], 24);
    for (const t of b.terms) k.screw(t.x, t.top ? H * 0.42 - 0.12 : -H * 0.42 + 0.12, D);
  }));
  if (kind === 'pilot') {
    const colors: Record<string, number> = { green: COL.green, red: COL.red, orange: COL.orange, white: 0xfff6dc, blue: COL.blue };
    const set = led(root, 0, 0, D + 0.12, colors[String(b.d.params.color)] ?? COL.green, 3.2);
    return { root, depth: D, update: (l) => set(l.look.state === 'lit' ? 1 : 0) };
  }
  if (kind === 'selector') {
    const knob = mesh(G.knob, mats().vertex, [0, 0, D + 0.1]);
    root.add(knob);
    return { root, depth: D, update: (l) => void (knob.rotation.z = [0, 0.7, -0.7][Number(l.state.pos ?? 0)] ?? 0) };
  }
  const cap = mesh(kind === 'emergency' ? G.mushroom : G.push, kind === 'emergency' ? mats().redFlag : new THREE.MeshStandardMaterial({ color: capCol, roughness: 0.4 }), [0, 0, D + 0.12]);
  root.add(cap);
  return { root, depth: D, update: (l) => void (cap.position.z = D + (l.state.pressed ? 0.02 : 0.12)) };
};

/** Lâmpada (ou campainha) num casquilho, acesa conforme o brilho. */
const lamp = (kind: 'bulb' | 'tube' | 'bell'): Builder => (b) => {
  const { W, H } = b;
  const D = 0.8;
  const root = new THREE.Group();
  body(root, cached(`lamp:${kind}:${W}:${H}:${termKey(b)}`, (k) => {
    k.box(W * 0.8, 0.5, 0.5, COL.white, [0, H / 2 - 0.3, 0.25]);
    if (kind === 'tube') k.box(W * 0.95, 0.3, 0.3, COL.bodyGrey, [0, 0.1, 0.25]);
    else k.cyl(0.22, 0.4, COL.metal, [0, H / 2 - 0.65, 0.35], undefined, 12);
    if (kind === 'bell') k.sphere(0.45, COL.metal, [0, -0.1, 0.4], 14);
    for (const t of b.terms) k.screw(t.x, H / 2 - 0.3, 0.5);
  }));
  if (kind === 'bell') return { root, depth: D };
  const m = glowMaterial(0xffc46b);
  const g = mesh(kind === 'tube' ? G.tube : G.bulb, m, kind === 'tube' ? [0, -0.25, 0.25] : [0, H / 2 - 1.15, 0.35]);
  if (kind === 'tube') g.scale.x = Math.min(1, (W * 0.9) / 2.4);
  root.add(g);
  return {
    root,
    depth: D,
    update: (l) => {
      const v = l.look.num('brightness') / 100 || (l.look.state === 'lit' ? 1 : 0);
      const on = l.state.burnt ? 0 : Math.min(1.4, v);
      m.emissiveIntensity = on * 2.4;
      m.color.setHex(on > 0.05 ? 0xfff3d6 : l.state.burnt ? 0x555555 : 0xdfe4ea);
    },
  };
};

/** Motor: carcaça com alhetas, caixa de bornes e ventoinha/veio que rodam. */
const motor = (three: boolean): Builder => (b) => {
  const { W, H } = b;
  const R = Math.min(W, H) * 0.32;
  const D = R * 2 + 0.4;
  const root = new THREE.Group();
  body(root, cached(`motor:${three}:${W}:${H}`, (k) => {
    k.cyl(R, W * 0.7, COL.motor, [0, -H * 0.05, R + 0.2], [0, 0, Math.PI / 2], 24);
    for (let i = -3; i <= 3; i++) k.box(W * 0.62, 0.04, R * 2.15, COL.motor, [0, -H * 0.05 + (i * R) / 3.6, R + 0.2]);
    k.box(W * 0.3, H * 0.22, R, COL.dark, [0, H * 0.32, R]);
    k.box(W * 0.8, 0.12, R * 1.6, COL.steel, [0, -H * 0.05 - R - 0.06, R + 0.2]);
  }));
  const s = new THREE.Group();
  s.position.set(W * 0.35, -H * 0.05, R + 0.2);
  s.rotation.y = Math.PI / 2;
  s.add(mesh(G.shaft, mats().vertex));
  root.add(s);
  const lockFlag = flag(root, 0, H * 0.45, R * 1.6, 'redFlag');
  let a = 0;
  return {
    root,
    depth: D,
    update: (l, dt) => {
      // Uma volta por segundo à velocidade nominal (a velocidade real seria um borrão).
      const rpm = l.look.num('speed');
      const dir = l.look.str('direction') === 'reverse' ? -1 : 1;
      a += dir * (rpm / 1500) * Math.PI * 2 * dt;
      s.rotation.z = a;
      lockFlag(!!l.state.locked || !!l.state.burnt);
    },
  };
};

/** Caixa genérica (aparelho de campo) com um LED de estado. */
const boxDevice = (key: string, color: number, depth: number, extra?: (k: Kit, W: number, H: number, D: number) => void, ledOn?: (l: Live) => number, ledColor: number = COL.green): Builder => (b) => {
  const { W, H } = b;
  const D = depth;
  const root = new THREE.Group();
  body(root, cached(`box:${key}:${W}:${H}:${termKey(b)}`, (k) => {
    k.box(W * 0.9, H * 0.85, D, color, [0, 0, D / 2]);
    extra?.(k, W, H, D);
    for (const t of b.terms) k.screw(t.x, t.top ? H * 0.42 - 0.12 : -H * 0.42 + 0.12, D);
  }));
  if (!ledOn) return { root, depth: D };
  const set = led(root, W * 0.33, H * 0.25, D + 0.03, ledColor);
  return { root, depth: D, update: (l) => set(ledOn(l)) };
};

/** Interruptor de parede: espelho e tecla basculante. */
const wallSwitch: Builder = (b) => {
  const { W, H } = b;
  const D = 0.35;
  const root = new THREE.Group();
  body(root, cached(`wall-switch:${W}:${H}:${termKey(b)}`, (k) => {
    k.box(Math.min(W, 1.8), Math.min(H, 1.8), D, COL.white, [0, 0, D / 2]);
    for (const t of b.terms) k.screw(t.x, t.top ? H / 2 - 0.12 : -H / 2 + 0.12, 0.1);
  }));
  const rocker = mesh(cached('p:rocker', (k) => k.box(0.8, 0.9, 0.12, COL.bodyGrey)), mats().vertex, [0, 0, D + 0.04]);
  root.add(rocker);
  return {
    root,
    depth: D,
    update: (l) => {
      const on = !!(l.state.on || l.state.pressed || l.state.crossed || l.state.pos === 2);
      rocker.rotation.x = on ? 0.18 : -0.18;
    },
  };
};

/** Tomada: espelho com os alvéolos e o contacto de terra. */
const socket: Builder = (b) => {
  const { W, H } = b;
  const root = new THREE.Group();
  body(root, cached(`socket:${W}:${H}`, (k) => {
    k.box(Math.min(W, 1.8), Math.min(H, 1.8), 0.35, COL.white, [0, 0, 0.175]);
    k.cyl(0.55, 0.06, COL.bodyGrey, [0, 0, 0.38], [Math.PI / 2, 0, 0], 24);
    k.cyl(0.07, 0.04, COL.black, [-0.2, 0, 0.42], [Math.PI / 2, 0, 0], 8);
    k.cyl(0.07, 0.04, COL.black, [0.2, 0, 0.42], [Math.PI / 2, 0, 0], 8);
    k.box(0.1, 0.16, 0.04, COL.metal, [0, 0.42, 0.42]);
  }));
  return { root, depth: 0.4 };
};

/** Aquecedor: radiador com alhetas que ficam alaranjadas com a potência. */
const heater = (three: boolean): Builder => (b) => {
  const { W, H } = b;
  const root = new THREE.Group();
  const D = 0.7;
  body(root, cached(`heater:${three}:${W}:${H}`, (k) => {
    k.box(W * 0.9, H * 0.8, 0.3, COL.white, [0, -0.1, 0.15]);
    for (const t of b.terms) k.screw(t.x, H / 2 - 0.12, 0.3);
  }));
  const m = glowMaterial(0xff6a2a);
  const fins = new THREE.Mesh(cached(`p:fins:${W}`, (k) => {
    for (let i = 0; i < 6; i++) k.box(W * 0.8, 0.1, 0.35, COL.white, [0, -0.6 + i * 0.22, 0]);
  }), m);
  fins.position.set(0, -0.05, 0.5);
  root.add(fins);
  return {
    root,
    depth: D,
    update: (l) => {
      const p = Math.max(0, l.look.num('activePower')) / Math.max(1, num(l.params.P, 1) * (three ? 1000 : 1));
      m.emissiveIntensity = Math.min(1, p) * 0.9;
      m.color.setHex(p > 0.05 ? 0xffd2b8 : 0xf0f0f0);
    },
  };
};

/** Pessoa: corpo simplificado que muda de cor com a zona da IEC 60479-1. */
const person: Builder = (b) => {
  const { H } = b;
  const root = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x5f7fa6, roughness: 0.7 });
  const s = H / 3.2;
  root.add(mesh(new THREE.CapsuleGeometry(0.32 * s, 1.2 * s, 4, 10), m, [0, -0.2 * s, 0.5]));
  root.add(mesh(new THREE.SphereGeometry(0.28 * s, 14, 10), m, [0, 0.95 * s, 0.5]));
  return {
    root,
    depth: 0.8,
    update: (l) => {
      const z = l.look.state;
      m.color.setHex(z === 'zone_AC4' || z === 'zone_AC3' ? COL.red : z === 'zone_AC2' ? COL.orange : 0x5f7fa6);
    },
  };
};

/** Falhas: caixa vermelha com um raio que brilha quando activa. */
const fault: Builder = (b) => {
  const { W, H } = b;
  const root = new THREE.Group();
  body(root, cached(`fault:${W}:${H}:${termKey(b)}`, (k) => {
    k.box(W * 0.8, H * 0.7, 0.4, COL.dark, [0, 0, 0.2]);
    for (const t of b.terms) k.screw(t.x, t.top ? H * 0.35 - 0.1 : -H * 0.35 + 0.1, 0.4);
  }));
  const set = led(root, 0, 0, 0.45, COL.red, 2.2);
  return { root, depth: 0.4, update: (l) => set(l.state.active ? 1 : 0.1) };
};

/** Moldura e nota: só marcam o painel. */
const frame: Builder = (b) => {
  const root = new THREE.Group();
  const { W, H } = b;
  body(root, cached(`frame:${W}:${H}`, (k) => {
    const t = 0.06;
    k.box(W, t, t, COL.steel, [0, H / 2, t]).box(W, t, t, COL.steel, [0, -H / 2, t]);
    k.box(t, H, t, COL.steel, [-W / 2, 0, t]).box(t, H, t, COL.steel, [W / 2, 0, t]);
  }));
  return { root, depth: 0.1 };
};

const note: Builder = (b) => {
  const root = new THREE.Group();
  body(root, cached(`note:${b.W}:${b.H}`, (k) => k.box(b.W * 0.9, b.H * 0.9, 0.04, 0xfff3a6, [0, 0, 0.02])));
  return { root, depth: 0.05 };
};

/** Modelo de cada `model3d` e onde fica na instalação real. */
export const MODELS: Record<string, { build: Builder; mount: Mount }> = {
  'din-1p': { build: breaker('mcb'), mount: 'board' },
  'din-2p': { build: breaker('mcb'), mount: 'board' },
  'din-3p': { build: breaker('mcb'), mount: 'board' },
  'din-4p': { build: breaker('mcb'), mount: 'board' },
  'rcd': { build: breaker('rcd'), mount: 'board' },
  'fuse-holder': { build: breaker('fuse'), mount: 'board' },
  'motor-breaker': { build: breaker('motor'), mount: 'board' },
  'din-relay': { build: relay('din-relay'), mount: 'board' },
  'contactor': { build: relay('contactor'), mount: 'board' },
  'thermal-relay': { build: relay('thermal'), mount: 'board' },
  'starter': { build: relay('starter'), mount: 'board' },
  'energy-meter': { build: display('energy'), mount: 'board' },
  'meter': { build: display('meter'), mount: 'board' },
  'plc': { build: display('plc'), mount: 'board' },
  'vfd': { build: display('vfd'), mount: 'board' },
  'busbar': {
    build: boxDevice('busbar', COL.bodyGrey, 0.5, (k, W, H) => k.box(W * 0.85, Math.min(0.3, H * 0.3), 0.1, COL.copper, [0, 0, 0.55])),
    mount: 'board',
  },
  'junction': { build: boxDevice('junction', COL.bodyGrey, 0.5), mount: 'wall' },
  'push-button': { build: panelRound('push'), mount: 'wall' },
  'push-button-green': { build: panelRound('push-green'), mount: 'wall' },
  'push-button-red': { build: panelRound('push-red'), mount: 'wall' },
  'emergency-stop': { build: panelRound('emergency'), mount: 'wall' },
  'selector': { build: panelRound('selector'), mount: 'wall' },
  'pilot-light': { build: panelRound('pilot'), mount: 'board' },
  'wall-switch': { build: wallSwitch, mount: 'wall' },
  'socket': { build: socket, mount: 'wall' },
  'lamp-bulb': { build: lamp('bulb'), mount: 'ceiling' },
  'lamp-tube': { build: lamp('tube'), mount: 'ceiling' },
  'bell': { build: lamp('bell'), mount: 'wall' },
  'heater': { build: heater(false), mount: 'wall' },
  'heater-3ph': { build: heater(true), mount: 'floor' },
  'motor': { build: motor(false), mount: 'floor' },
  'motor-3ph': { build: motor(true), mount: 'floor' },
  'capacitor-bank': {
    build: boxDevice('capacitor-bank', COL.cabinet, 1.4, (k, W, H, D) => {
      for (let i = 0; i < 3; i++) k.cyl(0.3, H * 0.5, COL.metal, [(i - 1) * W * 0.25, -H * 0.05, D * 0.5]);
    }, (l) => (l.state.on === false ? 0 : 1)),
    mount: 'floor',
  },
  'supply-cabinet': {
    build: boxDevice('supply', COL.cabinet, 1.6, (k, W, H, D) => k.box(W * 0.3, 0.06, 0.02, COL.yellow, [0, H * 0.25, D + 0.01]), (l) => (l.state.on === false ? 0 : 1)),
    mount: 'outside',
  },
  'transformer': {
    build: boxDevice('transformer', COL.dark, 1.2, (k, W, H, D) => {
      k.cyl(0.42, H * 0.5, COL.copper, [-W * 0.18, 0, D * 0.6]);
      k.cyl(0.42, H * 0.5, COL.copper, [W * 0.18, 0, D * 0.6]);
    }),
    mount: 'board',
  },
  'battery': {
    build: boxDevice('battery', COL.dark, 1.2, (k, W, H, D) => k.box(W * 0.85, 0.12, 0.02, COL.yellow, [0, H * 0.3, D + 0.01]), (l) => Math.max(0.1, l.look.num('soc') / 100), COL.green),
    mount: 'floor',
  },
  'solar-panel': {
    build: boxDevice('solar', 0x1d3f7a, 0.2, (k, W, H, D) => {
      for (let i = 1; i < 4; i++) k.box(0.03, H * 0.8, 0.02, COL.metal, [-W * 0.45 + (i * W * 0.9) / 4, 0, D + 0.01]);
    }),
    mount: 'outside',
  },
  'earth-rod': {
    build: boxDevice('earth-rod', COL.green, 0.3, (k, _W, H) => k.cyl(0.08, H, COL.copper, [0, -H * 0.2, 0.4])),
    mount: 'outside',
  },
  'sensor': {
    build: boxDevice('sensor', COL.yellow, 0.8, (k, W, H, D) => k.cyl(0.3, 0.4, COL.metal, [W * 0.3, -H * 0.2, D + 0.2], [Math.PI / 2, 0, 0], 14), (l) => (l.state.actuated || l.state.detected ? 1 : 0), COL.orange),
    mount: 'wall',
  },
  'fault': { build: fault, mount: 'floor' },
  'person': { build: person, mount: 'floor' },
  'frame': { build: frame, mount: 'none' },
  'note': { build: note, mount: 'none' },
};

/** Identificador do modelo de um equipamento (o diferencial usa o modelo próprio com botão de teste). */
export function modelId(def: DeviceDef): string {
  if (def.type === 'rcd2p' || def.type === 'rcbo') return 'rcd';
  return def.model3d ?? '';
}

/** Constrói o modelo de um aparelho. */
export function buildModel(b: BuildInput): Model {
  const spec = MODELS[modelId(b.def)];
  if (!spec) throw new Error(`Sem modelo 3D: ${b.def.type}`);
  const m = spec.build(b);
  m.root.userData.deviceId = b.d.id;
  return m;
}

export const mountOf = (def: DeviceDef): Mount => MODELS[modelId(def)]?.mount ?? 'none';
