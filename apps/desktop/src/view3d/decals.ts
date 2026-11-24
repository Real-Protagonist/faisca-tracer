/**
 * Etiquetas impressas nos aparelhos da vista 3D: números dos bornes junto aos parafusos e o
 * calibre na frente («C16», «30 mA»). Todos os textos vão para uma textura partilhada (atlas) e
 * todos os rectângulos para uma só malha: uma chamada de desenho para a bancada inteira.
 * Precisa de um <canvas> (navegador); em Node não há etiquetas.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface DecalItem {
  /** Matriz do aparelho (coordenadas locais do modelo → cena). */
  matrix: THREE.Matrix4;
  /** Centro do rectângulo e tamanho, em coordenadas locais do modelo. */
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  /** Textos e posição horizontal de cada um (0 = esquerda, 1 = direita). */
  labels: { text: string; at: number }[];
  ink: string;
  bold?: boolean;
}

/** Altura de cada linha do atlas (px) e tamanho do atlas. */
const ROW = 40;
const SIZE = 2048;
const FONT = 'system-ui, "Segoe UI", Roboto, Arial, sans-serif';

interface Atlas {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  x: number;
  y: number;
  geos: THREE.BufferGeometry[];
}

export interface Decals {
  group: THREE.Group;
  dispose(): void;
}

export function buildDecals(items: DecalItem[]): Decals | null {
  if (typeof document === 'undefined' || !items.length) return null;
  const atlases: Atlas[] = [];
  const newAtlas = () => {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const g = canvas.getContext('2d');
    if (!g) return null;
    const a: Atlas = { canvas, g, x: 0, y: 0, geos: [] };
    atlases.push(a);
    return a;
  };
  let cur = newAtlas();
  if (!cur) return null;

  for (const it of items) {
    // A largura da célula segue a proporção do rectângulo, para o texto não ficar deformado.
    const cw = Math.max(8, Math.min(SIZE, Math.round((ROW * it.w) / it.h)));
    if (cur.x + cw > SIZE) {
      cur.x = 0;
      cur.y += ROW;
    }
    if (cur.y + ROW > SIZE) {
      const next = newAtlas();
      if (!next) break;
      cur = next;
    }
    const { g } = cur;
    g.save();
    g.beginPath();
    g.rect(cur.x, cur.y, cw, ROW);
    g.clip();
    g.fillStyle = it.ink;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `${it.bold ? 700 : 600} ${Math.round(ROW * 0.62)}px ${FONT}`;
    for (const l of it.labels) g.fillText(l.text, cur.x + l.at * cw, cur.y + ROW / 2 + 1);
    g.restore();

    const geo = new THREE.PlaneGeometry(it.w, it.h);
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    const u0 = cur.x / SIZE;
    const u1 = (cur.x + cw) / SIZE;
    const v1 = 1 - cur.y / SIZE;
    const v0 = 1 - (cur.y + ROW) / SIZE;
    // PlaneGeometry: vértices (0) cima-esquerda, (1) cima-direita, (2) baixo-esquerda, (3) baixo-direita.
    uv.setXY(0, u0, v1);
    uv.setXY(1, u1, v1);
    uv.setXY(2, u0, v0);
    uv.setXY(3, u1, v0);
    geo.translate(it.x, it.y, it.z);
    geo.applyMatrix4(it.matrix);
    cur.geos.push(geo);
    cur.x += cw + 2;
  }

  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  for (const a of atlases) {
    if (!a.geos.length) continue;
    const geo = mergeGeometries(a.geos, false)!;
    a.geos.forEach((x) => x.dispose());
    const tex = new THREE.CanvasTexture(a.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 2;
    m.userData.decals = true;
    // As etiquetas não apanham cliques: o clique passa para o aparelho por baixo.
    m.raycast = () => {};
    group.add(m);
    disposables.push(geo, tex, mat);
  }
  return { group, dispose: () => disposables.forEach((d) => d.dispose()) };
}
