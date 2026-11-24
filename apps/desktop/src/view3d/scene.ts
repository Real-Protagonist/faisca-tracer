/**
 * Cena 3D gerada a partir do esquema, em dois modos:
 *  - «bancada didáctica»: painel vertical onde cada aparelho fica na posição do esquema, com os
 *    modulares em calhas DIN e os cabos pelo mesmo percurso do esquema 2D;
 *  - «instalação real»: casa (doméstica) ou nave (industrial), com os aparelhos de protecção e
 *    comando num quadro na parede, lâmpadas no tecto, interruptores e tomadas nas paredes e
 *    motores no chão; os cabos seguem em tubo pelo tecto.
 * Só usa Three.js (sem DOM): pode ser testada em Node.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Device, DeviceDef, Project, Registry, WireEnd } from '@faisca/sim-core';
import { bbox, layoutWires, sizeOf, terminalPos, type Pt } from '../editor/geometry';
import { buildModel, modelId, mountOf, type Live, type Model, type Mount } from './models';
import { COL, mats } from './kit';
import { buildDecals, type DecalItem } from './decals';

export type Mode = 'bench' | 'real';

export const WIRE_HEX: Record<string, number> = { L1: 0x8b5a2b, L2: 0x262626, L3: 0x8a8f96, N: 0x2f6fd6, PE: 0x2e9e44, C: 0xd33a3a, 'DC+': 0xd33a3a, 'DC-': 0x262626 };
/** 40 px do esquema = 1 unidade da bancada. */
const U = 40;

export interface Built {
  group: THREE.Group;
  models: Map<string, Model>;
  /** Caixa que contém a cena (para enquadrar a câmara). */
  bounds: THREE.Box3;
  /** Posição de cada aparelho (para as etiquetas com o nome). */
  anchors: Map<string, THREE.Vector3>;
  /** Aparelhos montados dentro do quadro (instalação real). */
  inBoard: Set<string>;
  /** Bornes, para os ligar e desligar na vista 3D (só na bancada): «aparelho:borne» → posição. */
  terminals: Map<string, { pos: THREE.Vector3; end: WireEnd }>;
  /** Pontas de cabo desligadas, penduradas junto ao borne: «cabo:a|b» → posição da ponta. */
  looseEnds: Map<string, { pos: THREE.Vector3; wire: string; end: 'a' | 'b' }>;
  update(live: (d: Device) => Live | null, dt: number): void;
  dispose(): void;
}

interface Placed {
  d: Device;
  def: DeviceDef;
  model: Model;
  W: number;
  H: number;
  /** Bornes em coordenadas locais do modelo e o texto impresso de cada um. */
  terms: { x: number; y: number; top: boolean; label: string }[];
}

/** Bornes em coordenadas locais do modelo (x, y), a partir dos terminais do símbolo. */
function localTerms(registry: Registry, d: Device) {
  const def = registry.require(d.type);
  const { w, h } = sizeOf(def, d);
  return def.terminals.map((t) => ({ x: (t.x - w / 2) / U, y: -(t.y - h / 2) / U, top: t.y < h / 2 }));
}

function makeModel(registry: Registry, d: Device): Placed {
  const def = registry.require(d.type);
  const { w, h } = sizeOf(def, d);
  const W = w / U;
  const H = h / U;
  const terms = localTerms(registry, d).map((t) => ({ ...t, x: t.x * 0.92, y: t.y * 0.92 }));
  const labels = def.terminals.map((t) => t.label ?? t.id);
  return { d, def, model: buildModel({ d, def, W: W * 0.92, H: H * 0.92, terms }), W, H, terms: terms.map((t, i) => ({ ...t, label: labels[i]! })) };
}

/**
 * Calibre impresso na frente do aparelho, a partir dos parâmetros: «C16» (curva e corrente),
 * «30 mA», «230 V»… No máximo dois valores, como nas etiquetas reais.
 */
export function ratingText(def: DeviceDef, d: Device): string {
  const val = (k: string) => d.params[k] ?? def.params?.find((p) => p.key === k)?.default;
  const parts: string[] = [];
  const curve = val('curve');
  const In = val('In');
  const merged = typeof curve === 'string' && In !== undefined;
  if (merged) parts.push(`${curve}${In}`);
  for (const p of def.params ?? []) {
    if (parts.length >= 2) break;
    // Os parâmetros do perfil Profissional também vêm impressos (poder de corte, corrente nominal).
    if (p.hidden || !p.unit || p.key === 'curve' || (merged && p.key === 'In')) continue;
    const v = val(p.key);
    if (typeof v === 'number') parts.push(`${String(v).replace('.', ',')} ${p.unit}`);
  }
  return parts.join(' · ');
}

/** Etiquetas de um aparelho: números dos bornes de cima e de baixo e o calibre na frente. */
function decalsOf(p: Placed): DecalItem[] {
  const plate = p.model.plate;
  if (!plate) return [];
  const out: DecalItem[] = [];
  const matrix = p.model.root.matrixWorld.clone();
  const ink = plate.ink ?? '#2b2f36';
  const w = plate.w * 0.98;
  for (const top of [true, false]) {
    const row = p.terms.filter((t) => t.top === top);
    if (!row.length) continue;
    // Por baixo da frente saliente, os números ficariam tapados (a câmara olha de cima).
    const outer = !top && plate.edge !== undefined;
    const y = outer ? -(plate.screwY + plate.edge!) / 2 : (top ? 1 : -1) * (plate.screwY - 0.2);
    const h = outer ? Math.min(0.16, plate.edge! - plate.screwY - 0.03) : 0.16;
    out.push({
      matrix,
      x: 0,
      y,
      z: plate.z + 0.004,
      w,
      h,
      labels: row.map((t) => ({ text: t.label, at: (t.x + w / 2) / w })),
      ink,
    });
  }
  const rating = ratingText(p.def, p.d);
  if (plate.front && rating) out.push({ matrix, x: 0, y: plate.front.y, z: plate.front.z + 0.003, w: plate.w * 0.86, h: 0.15, labels: [{ text: rating, at: 0.5 }], ink, bold: true });
  return out;
}

/** Tubo por uma polilinha com cantos vivos. */
function tube(pts: THREE.Vector3[], radius: number): THREE.BufferGeometry | null {
  const clean = pts.filter((p, i) => i === 0 || p.distanceTo(pts[i - 1]!) > 1e-4);
  if (clean.length < 2) return null;
  const path = new THREE.CurvePath<THREE.Vector3>();
  for (let i = 1; i < clean.length; i++) path.add(new THREE.LineCurve3(clean[i - 1]!, clean[i]!));
  const g = new THREE.TubeGeometry(path, Math.max(2, (clean.length - 1) * 2), radius, 6, false);
  g.deleteAttribute('uv');
  return g;
}

/** Junta os tubos de cada cor numa só malha (uma chamada de desenho por cor). */
function wireMeshes(byColor: Map<number, THREE.BufferGeometry[]>, group: THREE.Group, disposables: { dispose(): void }[]) {
  for (const [hex, geos] of byColor) {
    if (!geos.length) continue;
    const g = mergeGeometries(geos, false)!;
    geos.forEach((x) => x.dispose());
    disposables.push(g);
    const m = new THREE.Mesh(g, wireMaterial(hex));
    m.userData.wires = true;
    group.add(m);
  }
}

const wireMats = new Map<number, THREE.Material>();
const wireMaterial = (hex: number) => {
  let m = wireMats.get(hex);
  if (!m) wireMats.set(hex, (m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.55 })));
  return m;
};

function finish(
  group: THREE.Group,
  placed: Placed[],
  anchors: Map<string, THREE.Vector3>,
  disposables: { dispose(): void }[],
  inBoard = new Set<string>(),
  terminals: Built['terminals'] = new Map(),
  looseEnds: Built['looseEnds'] = new Map(),
): Built {
  const models = new Map(placed.map((p) => [p.d.id, p.model]));
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  // Etiquetas impressas (só no navegador: precisam de um canvas).
  const decals = buildDecals(placed.flatMap(decalsOf));
  if (decals) {
    group.add(decals.group);
    disposables.push(decals);
  }
  return {
    group,
    models,
    bounds,
    anchors,
    inBoard,
    terminals,
    looseEnds,
    update(live, dt) {
      for (const p of placed) {
        if (!p.model.update) continue;
        const l = live(p.d);
        if (l) p.model.update(l, dt);
      }
    },
    dispose() {
      disposables.forEach((g) => g.dispose());
    },
  };
}

/* ---------------- bancada didáctica ---------------- */

export function buildBench(P: Project, registry: Registry): Built {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const anchors = new Map<string, THREE.Vector3>();
  const devs = P.devices.filter((d) => registry.get(d.type));
  const boxes = devs.map((d) => bbox(registry, d));
  const x0 = boxes.length ? Math.min(...boxes.map((b) => b.x)) : 0;
  const x1 = boxes.length ? Math.max(...boxes.map((b) => b.x + b.w)) : 400;
  const y0 = boxes.length ? Math.min(...boxes.map((b) => b.y)) : 0;
  const y1 = boxes.length ? Math.max(...boxes.map((b) => b.y + b.h)) : 300;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const at = (p: Pt, z: number) => new THREE.Vector3((p.x - cx) / U, -(p.y - cy) / U, z);

  // Painel e mesa.
  const bw = (x1 - x0) / U + 2;
  const bh = (y1 - y0) / U + 2;
  const board = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.12), mats().board);
  board.position.set(0, 0, -0.06);
  disposables.push(board.geometry);
  group.add(board);
  const table = new THREE.Mesh(new THREE.BoxGeometry(bw + 1, 0.2, 4), mats().table);
  table.position.set(0, -bh / 2 - 0.1, 1.9);
  disposables.push(table.geometry);
  group.add(table);

  const placed: Placed[] = [];
  const zOf = new Map<string, number>();
  const rails: { y: number; xa: number; xb: number }[] = [];
  devs.forEach((d, i) => {
    const p = makeModel(registry, d);
    const b = boxes[i]!;
    const c = at({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, 0.1);
    p.model.root.position.copy(c);
    p.model.root.rotation.z = (-d.rot * Math.PI) / 180;
    group.add(p.model.root);
    placed.push(p);
    zOf.set(d.id, 0.1 + p.model.depth);
    anchors.set(d.id, new THREE.Vector3(c.x, c.y + b.h / U / 2 + 0.35, c.z + p.model.depth));
    // Os modulares ficam numa calha DIN à sua altura.
    if (mountOf(registry.require(d.type)) === 'board' && d.rot % 180 === 0) {
      const xa = c.x - b.w / U / 2;
      const xb = c.x + b.w / U / 2;
      const r = rails.find((q) => Math.abs(q.y - c.y) < 0.3);
      if (r) Object.assign(r, { xa: Math.min(r.xa, xa), xb: Math.max(r.xb, xb) });
      else rails.push({ y: c.y, xa, xb });
    }
  });
  for (const r of rails) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(r.xb - r.xa + 0.6, 0.35, 0.08), mats().rail);
    rail.position.set((r.xa + r.xb) / 2, r.y, 0.04);
    disposables.push(rail.geometry);
    group.add(rail);
  }

  // Bornes: o ponto onde o cabo entra, junto ao parafuso.
  const terminals: Built['terminals'] = new Map();
  const termAt = (d: Device, terminal: string) => {
    const t = terminalPos(registry, d, terminal);
    if (!t) return null;
    const inward = new THREE.Vector3(-t.nx, t.ny, 0).multiplyScalar(0.18);
    return at(t, (zOf.get(d.id) ?? 0.5) * 0.55).add(inward);
  };
  for (const d of devs) {
    for (const t of registry.require(d.type).terminals) {
      const pos = termAt(d, t.id);
      if (pos) terminals.set(`${d.id}:${t.id}`, { pos, end: { device: d.id, terminal: t.id } });
    }
  }

  // Cabos: o percurso do esquema sobre o painel, e no fim sobem até ao borne do aparelho.
  // Nas pontas ligadas há uma ponteira metálica; uma ponta desligada fica pendurada, com o cobre à vista.
  const byColor = new Map<number, THREE.BufferGeometry[]>();
  const ferrules: THREE.BufferGeometry[] = [];
  const tips: THREE.BufferGeometry[] = [];
  const looseEnds: Built['looseEnds'] = new Map();
  const sleeve = (from: THREE.Vector3, toward: THREE.Vector3, len: number, r: number, into: THREE.BufferGeometry[]) => {
    const dir = toward.clone().sub(from);
    if (dir.lengthSq() < 1e-8) return;
    dir.normalize();
    const g = new THREE.CylinderGeometry(r, r, len, 10, 1);
    g.deleteAttribute('uv');
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    g.translate(from.x + (dir.x * len) / 2, from.y + (dir.y * len) / 2, from.z + (dir.z * len) / 2);
    into.push(g);
  };
  const routes = layoutWires(registry, P);
  for (const w of P.wires) {
    const pts = routes.get(w.id);
    if (!pts) continue;
    const z = 0.14;
    const radius = w.conductor === 'PE' ? 0.035 : 0.03;
    // Ponta de um cabo: no borne, ou solta (pendurada à frente do painel, junto ao borne).
    const tip = (e: WireEnd, which: 'a' | 'b', p: Pt): THREE.Vector3[] => {
      const d = P.devices.find((x) => x.id === e.device)!;
      const base = at(p, z);
      if (!w.detached?.includes(which)) return [termAt(d, e.terminal) ?? base, base];
      const t = terminalPos(registry, d, e.terminal)!;
      const out = new THREE.Vector3(t.nx, -t.ny, 0);
      const lift = base.clone().add(new THREE.Vector3(0, 0, 0.45));
      const hang = lift.clone().addScaledVector(out, 0.2).add(new THREE.Vector3(0, -0.95, 0.3));
      looseEnds.set(`${w.id}:${which}`, { pos: hang, wire: w.id, end: which });
      return [hang, lift, base];
    };
    const ea = tip(w.a, 'a', pts[0]!);
    const eb = tip(w.b, 'b', pts[pts.length - 1]!).reverse();
    const path = [...ea, ...pts.slice(1, -1).map((p) => at(p, z)), ...eb];
    const hex = WIRE_HEX[w.conductor] ?? 0x888888;
    const g = tube(path, radius);
    if (!g) continue;
    if (!byColor.has(hex)) byColor.set(hex, []);
    byColor.get(hex)!.push(g);
    for (const [which, first, next] of [['a', path[0]!, path[1]!], ['b', path[path.length - 1]!, path[path.length - 2]!]] as const) {
      if (w.detached?.includes(which)) sleeve(first.clone().sub(next.clone().sub(first).setLength(0.1)), first, 0.12, radius * 0.75, tips);
      else sleeve(first, next, 0.14, radius * 1.4, ferrules);
    }
    if (w.fault?.cut) {
      // Fio cortado: marca vermelha a meio.
      const mid = path[Math.floor(path.length / 2)]!;
      const mk = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), mats().redFlag);
      mk.position.copy(mid);
      disposables.push(mk.geometry);
      group.add(mk);
    }
  }
  wireMeshes(byColor, group, disposables);
  for (const [geos, mat] of [[ferrules, mats().rail], [tips, copperMaterial()]] as const) {
    if (!geos.length) continue;
    const g = mergeGeometries(geos, false)!;
    geos.forEach((x) => x.dispose());
    disposables.push(g);
    const m = new THREE.Mesh(g, mat);
    m.raycast = () => {};
    group.add(m);
  }
  return finish(group, placed, anchors, disposables, new Set(), terminals, looseEnds);
}

let copper: THREE.Material | null = null;
const copperMaterial = () => (copper ??= new THREE.MeshStandardMaterial({ color: COL.copper, roughness: 0.35, metalness: 0.7 }));

/* ---------------- instalação real ---------------- */

/** Escala dos modelos por sítio de montagem (o esquema é desenhado maior do que a realidade). */
const SCALE: Record<Mount, number> = { board: 0.16, wall: 0.13, ceiling: 0.22, floor: 0.32, outside: 0.35, none: 0 };
/** Altura ao chão dos aparelhos de parede, por modelo (m). */
const WALL_HEIGHT: Record<string, number> = { 'wall-switch': 1.1, socket: 0.3, heater: 0.45, bell: 2.1, junction: 2.3, sensor: 1, 'push-button': 1.2, 'push-button-green': 1.2, 'push-button-red': 1.2, 'emergency-stop': 1.3, selector: 1.2 };

export function buildReal(P: Project, registry: Registry): Built {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const anchors = new Map<string, THREE.Vector3>();
  const industrial = P.domain === 'industrial';
  const roomH = industrial ? 5 : 2.7;
  const S = industrial ? 0.6 : 0.4; // m por unidade do esquema
  const devs = P.devices.filter((d) => registry.get(d.type) && mountOf(registry.require(d.type)) !== 'none');
  const centre = (d: Device) => {
    const b = bbox(registry, d);
    return { x: ((b.x + b.w / 2) / U) * S, z: ((b.y + b.h / 2) / U) * S };
  };
  const field = devs.filter((d) => !['board', 'outside'].includes(mountOf(registry.require(d.type))));
  const cs = field.map(centre);
  let minX = cs.length ? Math.min(...cs.map((c) => c.x)) - 1.5 : 0;
  let maxX = cs.length ? Math.max(...cs.map((c) => c.x)) + 1.5 : 6;
  let minZ = cs.length ? Math.min(...cs.map((c) => c.z)) - 2 : 0;
  let maxZ = cs.length ? Math.max(...cs.map((c) => c.z)) + 1.5 : 5;
  const minW = industrial ? 12 : 6;
  const minD = industrial ? 9 : 5;
  if (maxX - minX < minW) maxX = minX + minW;
  if (maxZ - minZ < minD) maxZ = minZ + minD;
  const ox = (minX + maxX) / 2;
  const oz = (minZ + maxZ) / 2;
  minX -= ox;
  maxX -= ox;
  minZ -= oz;
  maxZ -= oz;

  // Chão, parede do fundo e parede da esquerda (as outras ficam abertas para se ver).
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number]) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    disposables.push(geo);
    group.add(m);
    return m;
  };
  add(new THREE.BoxGeometry(maxX - minX, 0.1, maxZ - minZ), industrial ? mats().concrete : mats().floor, [0, -0.05, 0]);
  add(new THREE.BoxGeometry(maxX - minX, roomH, 0.15), mats().wall, [0, roomH / 2, minZ - 0.075]);
  add(new THREE.BoxGeometry(0.15, roomH, maxZ - minZ), mats().wall, [minX - 0.075, roomH / 2, 0]);
  // Laje exterior, à direita, para a fonte, o eléctrodo de terra e os painéis.
  const outside = devs.filter((d) => mountOf(registry.require(d.type)) === 'outside').length;
  if (outside) add(new THREE.BoxGeometry(2.4, 0.08, Math.max(2, outside * 1.4 + 0.6)), mats().concrete, [maxX + 1.4, -0.04, minZ + Math.max(1, (outside * 1.4 + 0.6) / 2)]);

  const placed: Placed[] = [];
  const conduitFrom: THREE.Vector3[] = [];
  const conduitTo: THREE.Vector3[] = [];

  // Quadro na parede do fundo, à esquerda: aparelhos por linhas, pela ordem do esquema.
  const boardDevs = devs.filter((d) => mountOf(registry.require(d.type)) === 'board').sort((a, b) => a.y - b.y || a.x - b.x);
  const models = boardDevs.map((d) => makeModel(registry, d));
  // Largura do quadro: proporção de cerca de 3:2, sem passar a largura da parede.
  const area = models.reduce((s, p) => s + (p.W * SCALE.board + 0.04) * (p.H * SCALE.board + 0.12), 0);
  const innerW = Math.min(maxX - minX - 1.2, Math.max(industrial ? 2.2 : 1.4, Math.sqrt(area * 1.5) * 1.15));
  const rows: { items: Placed[]; w: number; h: number }[] = [];
  for (const p of models) {
    const w = p.W * SCALE.board + 0.04;
    const h = p.H * SCALE.board;
    let r = rows[rows.length - 1];
    if (!r || r.w + w > innerW) rows.push((r = { items: [], w: 0, h: 0 }));
    r.items.push(p);
    r.w += w;
    r.h = Math.max(r.h, h);
  }
  const cabH = Math.max(0.6, rows.reduce((s, r) => s + r.h + 0.12, 0.2));
  const cabW = innerW + 0.3;
  const cabX = minX + 0.4 + cabW / 2;
  const cabY = Math.min(Math.max(1.6, cabH / 2 + 0.6), roomH - 0.15 - cabH / 2);
  if (rows.length) {
    const cab = new THREE.Group();
    const shell = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats().off);
      m.position.set(x, y, z);
      disposables.push(m.geometry);
      cab.add(m);
    };
    shell(cabW, cabH, 0.04, 0, 0, 0.02);
    shell(cabW, 0.05, 0.3, 0, cabH / 2, 0.15);
    shell(cabW, 0.05, 0.3, 0, -cabH / 2, 0.15);
    shell(0.05, cabH, 0.3, -cabW / 2, 0, 0.15);
    shell(0.05, cabH, 0.3, cabW / 2, 0, 0.15);
    cab.position.set(cabX, cabY, minZ);
    group.add(cab);
    let y = cabY + cabH / 2 - 0.15;
    for (const r of rows) {
      y -= r.h / 2 + 0.06;
      const rail = add(new THREE.BoxGeometry(innerW, 0.035, 0.02), mats().rail, [cabX, y, minZ + 0.05]);
      rail.renderOrder = 0;
      let x = cabX - innerW / 2;
      for (const p of r.items) {
        const w = p.W * SCALE.board + 0.04;
        p.model.root.scale.setScalar(SCALE.board);
        p.model.root.position.set(x + w / 2, y, minZ + 0.05);
        group.add(p.model.root);
        placed.push(p);
        anchors.set(p.d.id, new THREE.Vector3(x + w / 2, y + (p.H * SCALE.board) / 2 + 0.08, minZ + 0.3));
        x += w;
      }
      y -= r.h / 2 + 0.06;
    }
  }
  const cabTop = new THREE.Vector3(cabX, cabY + cabH / 2, minZ + 0.15);

  for (const d of devs) {
    const def = registry.require(d.type);
    const mount = mountOf(def);
    if (mount === 'board') continue;
    const p = makeModel(registry, d);
    const s = d.type === 'person' ? 1.75 / (0.75 * p.H * 0.92) : SCALE[mount];
    const root = p.model.root;
    root.scale.setScalar(s);
    const c = centre(d);
    const x = Math.min(maxX - 0.5, Math.max(minX + 0.5, c.x - ox));
    const z = Math.min(maxZ - 0.5, Math.max(minZ + 0.5, c.z - oz));
    let feed: THREE.Vector3;
    if (mount === 'ceiling') {
      root.position.set(x, roomH - 0.02, z);
      root.rotation.x = Math.PI / 2;
      feed = new THREE.Vector3(x, roomH - 0.05, z);
    } else if (mount === 'wall') {
      // Na parede mais próxima: fundo, esquerda ou um pilar à direita.
      const h = WALL_HEIGHT[modelId(def)] ?? 1.2;
      const dBack = z - minZ;
      const dLeft = x - minX;
      if (dBack <= dLeft) {
        root.position.set(x, h, minZ);
        feed = new THREE.Vector3(x, roomH - 0.05, minZ + 0.1);
      } else {
        root.position.set(minX, h, z);
        root.rotation.y = Math.PI / 2;
        feed = new THREE.Vector3(minX + 0.1, roomH - 0.05, z);
      }
    } else if (mount === 'outside') {
      root.position.set(maxX + 1.2, (p.H * s) / 2 + 0.05, minZ + 0.6 + placed.filter((q) => mountOf(registry.require(q.d.type)) === 'outside').length * 1.4);
      feed = root.position.clone();
    } else {
      // No chão, de frente para a câmara.
      root.position.set(x, (p.H * s * 0.92) / 2 + 0.02, z);
      feed = new THREE.Vector3(x, roomH - 0.05, z);
    }
    group.add(root);
    placed.push(p);
    const top = root.position.clone();
    top.y += mount === 'ceiling' ? -0.3 : (p.H * s) / 2 + 0.25;
    anchors.set(d.id, top);
    if (mount !== 'outside' && d.type !== 'person') {
      conduitFrom.push(feed);
      conduitTo.push(root.position.clone());
    }
  }

  // Tubos dos cabos: do topo do quadro ao tecto, pelo tecto até ao aparelho e a descer.
  const geos: THREE.BufferGeometry[] = [];
  conduitFrom.forEach((f, i) => {
    const t = conduitTo[i]!;
    const up = new THREE.Vector3(cabTop.x, roomH - 0.05, cabTop.z);
    const g = tube([cabTop, up, new THREE.Vector3(f.x, up.y, up.z), new THREE.Vector3(f.x, up.y, f.z), f, new THREE.Vector3(f.x, Math.max(t.y, 0.1), f.z)], 0.025);
    if (g) geos.push(g);
  });
  if (geos.length) wireMeshes(new Map([[0x9aa3ad, geos]]), group, disposables);
  return finish(group, placed, anchors, disposables, new Set(boardDevs.map((d) => d.id)));
}

export function buildScene(P: Project, registry: Registry, mode: Mode): Built {
  return mode === 'bench' ? buildBench(P, registry) : buildReal(P, registry);
}

/** Número de chamadas de desenho (malhas visíveis) de uma cena. */
export function drawCalls(g: THREE.Object3D): number {
  let n = 0;
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.visible) n++;
  });
  return n;
}
