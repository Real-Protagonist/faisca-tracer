/**
 * Kit de geometria dos modelos 3D. As partes fixas de um aparelho são caixas e cilindros com cor
 * por vértice, fundidas numa só malha (uma chamada de desenho por aparelho). As partes móveis
 * (alavancas, rotores, luzes) são malhas à parte, com materiais partilhados.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type Vec3 = [number, number, number];

/** Paleta comum (sRGB). */
export const COL = {
  body: 0xf2f2ee,
  bodyGrey: 0xd9dcdf,
  dark: 0x2b2f36,
  black: 0x17191d,
  metal: 0xb8bec6,
  copper: 0xc27a3e,
  brass: 0xc9a43b,
  red: 0xd63a3a,
  green: 0x2fa65a,
  blue: 0x2f6fd6,
  yellow: 0xf3c623,
  orange: 0xf39a2b,
  steel: 0x7d8792,
  board: 0xe9e4d8,
  wood: 0xa57a4f,
  motor: 0x3f6f9b,
  cabinet: 0xc9ccd1,
  screen: 0x0e2a1a,
  white: 0xffffff,
} as const;

/** Construtor de uma malha estática com cor por vértice. */
export class Kit {
  private parts: THREE.BufferGeometry[] = [];

  private add(g: THREE.BufferGeometry, color: number, pos: Vec3, rot?: Vec3) {
    const geo = g.index ? g.toNonIndexed() : g;
    if (geo !== g) g.dispose();
    const c = new THREE.Color(color);
    const n = geo.getAttribute('position').count;
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) cols.set([c.r, c.g, c.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.deleteAttribute('uv');
    if (rot) geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)));
    geo.translate(...pos);
    this.parts.push(geo);
    return this;
  }

  /** Caixa com o centro em `pos`. */
  box(w: number, h: number, d: number, color: number, pos: Vec3 = [0, 0, 0], rot?: Vec3) {
    return this.add(new THREE.BoxGeometry(w, h, d), color, pos, rot);
  }

  /** Cilindro ao longo de Y (rodar com `rot`). */
  cyl(r: number, h: number, color: number, pos: Vec3 = [0, 0, 0], rot?: Vec3, seg = 16, r2 = r) {
    return this.add(new THREE.CylinderGeometry(r2, r, h, seg), color, pos, rot);
  }

  sphere(r: number, color: number, pos: Vec3 = [0, 0, 0], seg = 12) {
    return this.add(new THREE.SphereGeometry(r, seg, Math.max(6, seg / 2)), color, pos);
  }

  /** Parafuso de terminal (cobre/latão) na face da frente. */
  screw(x: number, y: number, z: number) {
    return this.cyl(0.045, 0.03, COL.brass, [x, y, z], [Math.PI / 2, 0, 0], 8);
  }

  get count() {
    return this.parts.length;
  }

  build(): THREE.BufferGeometry {
    const g = this.parts.length ? mergeGeometries(this.parts, false)! : new THREE.BufferGeometry();
    for (const p of this.parts) p.dispose();
    this.parts = [];
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

const cache = new Map<string, THREE.BufferGeometry>();

/** Geometria estática partilhada por todos os aparelhos com a mesma chave. */
export function cached(key: string, make: (k: Kit) => void): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) {
    const k = new Kit();
    make(k);
    g = k.build();
    cache.set(key, g);
  }
  return g;
}

export const cacheSize = () => cache.size;

/* ---------- materiais partilhados ---------- */

let shared: Record<string, THREE.Material> | null = null;

/** Materiais partilhados (criados uma vez). */
export function mats() {
  shared ??= {
    vertex: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05 }),
    lever: new THREE.MeshStandardMaterial({ color: COL.dark, roughness: 0.5 }),
    leverBlue: new THREE.MeshStandardMaterial({ color: 0x2c5fa8, roughness: 0.5 }),
    rotor: new THREE.MeshStandardMaterial({ color: COL.metal, roughness: 0.35, metalness: 0.6 }),
    fan: new THREE.MeshStandardMaterial({ color: COL.orange, roughness: 0.5 }),
    redFlag: new THREE.MeshStandardMaterial({ color: COL.red, emissive: COL.red, emissiveIntensity: 0.4 }),
    greenFlag: new THREE.MeshStandardMaterial({ color: COL.green, emissive: COL.green, emissiveIntensity: 0.3 }),
    off: new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.5 }),
    rail: new THREE.MeshStandardMaterial({ color: COL.metal, roughness: 0.3, metalness: 0.7 }),
    board: new THREE.MeshStandardMaterial({ color: COL.board, roughness: 0.9 }),
    floor: new THREE.MeshStandardMaterial({ color: 0xbfb6a6, roughness: 0.95 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0x9a9d9f, roughness: 1 }),
    wall: new THREE.MeshStandardMaterial({ color: 0xf1ede4, roughness: 1 }),
    table: new THREE.MeshStandardMaterial({ color: COL.wood, roughness: 0.8 }),
  };
  return shared;
}

/** Material próprio de uma luz (cor e intensidade variam por aparelho). */
export const glowMaterial = (color: number) => new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 0, roughness: 0.3, transparent: true, opacity: 0.9 });
