/**
 * Vista física 3D (separador «Físico 3D»): bancada didáctica ou instalação real, gerada a partir
 * do esquema. Os estados animam-se num só ciclo por fotograma, sem renderizar o React a cada passo
 * da simulação. Clicar num aparelho selecciona-o e opera-o (como a ferramenta Operar).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { lookFrom, type Device, type Look } from '@faisca/sim-core';
import { operate, registry, select, useApp } from '../store';
import { buildScene, drawCalls, type Built, type Mode } from './scene';

const MODE_KEY = 'faisca.view3d';
const EMPTY_LOOK = lookFrom([]);

function savedMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'real' ? 'real' : 'bench';
  } catch {
    return 'bench';
  }
}

/** Estatísticas expostas aos testes de interface. */
export const stats3d = {
  fps: 0,
  calls: 0,
  triangles: 0,
  devices: 0,
  frameMs: 0,
  /** Posição no ecrã (px da janela) do centro de um aparelho, ou null. */
  screenOf: (_id: string): { x: number; y: number } | null => null,
};

export function Physical3D() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>(savedMode);
  const [names, setNames] = useState(true);
  const [fps, setFps] = useState(0);
  const change = (m: Mode) => {
    setMode(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* sem armazenamento */
    }
  };
  useEffect(() => {
    (window as any).faisca3d = stats3d;
    const id = setInterval(() => setFps(stats3d.fps), 500);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="view3d" data-testid="view3d" data-mode={mode}>
      <Canvas dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: 'high-performance' }} camera={{ fov: 38, near: 0.05, far: 500 }} frameloop="always">
        <color attach="background" args={['#1a2029']} />
        <hemisphereLight args={[0xdfe8ff, 0x303030, 1.1]} />
        <directionalLight position={[-6, 10, 14]} intensity={1.6} />
        <ambientLight intensity={0.35} />
        <SceneContent mode={mode} names={names} />
      </Canvas>
      <div className="view3d-bar" role="toolbar" aria-label={t('ui.view3d.title')}>
        <div className="seg" role="radiogroup" aria-label={t('ui.view3d.mode')}>
          <button role="radio" aria-checked={mode === 'bench'} className={mode === 'bench' ? 'active' : ''} onClick={() => change('bench')} data-testid="view3d-bench">
            {t('ui.view3d.bench')}
          </button>
          <button role="radio" aria-checked={mode === 'real'} className={mode === 'real' ? 'active' : ''} onClick={() => change('real')} data-testid="view3d-real">
            {t('ui.view3d.real')}
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} data-testid="view3d-names" /> {t('ui.view3d.names')}
        </label>
        <span className="hint">{t('ui.view3d.hint')}</span>
        <span className="fps" data-testid="view3d-fps">
          {t('ui.view3d.fps', { fps })}
        </span>
      </div>
    </div>
  );
}

/** Chave da estrutura do esquema: a cena só se reconstrói quando ela muda (não a cada passo). */
function structureKey(P: ReturnType<typeof useApp.getState>['project']): string {
  return JSON.stringify([P.domain, P.devices.map((d) => [d.id, d.type, d.x, d.y, d.rot, d.params]), P.wires.map((w) => [w.id, w.a, w.b, w.conductor, w.points, w.fault])]);
}

function SceneContent({ mode, names }: { mode: Mode; names: boolean }) {
  const project = useApp((s) => s.project);
  const selection = useApp((s) => s.selection);
  const key = structureKey(project);
  const { camera, gl } = useThree();
  const built = useMemo<Built>(() => buildScene(useApp.getState().project, registry, mode), [key, mode]);
  useEffect(() => () => built.dispose(), [built]);

  // Câmara orbital, enquadrada na cena quando o modo muda ou a cena aparece.
  const controls = useMemo(() => new OrbitControls(camera, gl.domElement), [camera, gl]);
  useEffect(() => {
    controls.enableDamping = true;
    controls.screenSpacePanning = true;
    return () => controls.dispose();
  }, [controls]);
  const framed = useRef<string>('');
  useEffect(() => {
    const tag = `${mode}:${project.devices.length > 0}`;
    if (framed.current === tag) return;
    framed.current = tag;
    fitCamera(camera as THREE.PerspectiveCamera, built.bounds, mode);
    controls.target.copy(built.bounds.getCenter(new THREE.Vector3()));
    controls.update();
  }, [built]);

  // Etiquetas com o nome de cada aparelho.
  const labels = useMemo(() => {
    const g = new THREE.Group();
    for (const d of project.devices) {
      const a = built.anchors.get(d.id);
      // Na instalação real, os aparelhos do quadro são pequenos demais para ter nome cada um.
      if (!a || (mode === 'real' && built.inBoard.has(d.id))) continue;
      const s = label(d.name, mode === 'real' ? 0.22 : 1.5);
      s.position.copy(a);
      g.add(s);
    }
    return g;
  }, [built]);
  useEffect(
    () => () =>
      labels.traverse((o) => {
        const s = o as THREE.Sprite;
        if (s.isSprite) {
          s.material.map?.dispose();
          s.material.dispose();
        }
      }),
    [labels],
  );

  // Contorno do aparelho seleccionado.
  const helper = useMemo(() => {
    const id = selection.devices[0];
    const m = id ? built.models.get(id) : undefined;
    return m ? new THREE.BoxHelper(m.root, 0x2f80ed) : null;
  }, [built, selection.devices[0]]);

  // Estado por fotograma: lê o último resultado da simulação sem passar pelo React.
  const looks = useRef<{ snap: unknown; project: unknown; map: Map<string, Look>; byId: Map<string, Device> }>({ snap: null, project: null, map: new Map(), byId: new Map() });
  const frames = useRef({ n: 0, t: performance.now() });
  useFrame((state, dt) => {
    const t0 = performance.now();
    const { snapshot, project: P } = useApp.getState();
    // Só se recalcula quando chega um resultado novo da simulação (não a cada fotograma).
    if (looks.current.snap !== snapshot || looks.current.project !== P) {
      looks.current = {
        snap: snapshot,
        project: P,
        map: new Map(P.devices.map((d) => [d.id, lookFrom(snapshot?.measurements[d.id] ?? [])])),
        byId: new Map(P.devices.map((d) => [d.id, d])),
      };
    }
    const { map, byId } = looks.current;
    built.update((d: Device) => {
      const cur = byId.get(d.id) ?? d;
      return { look: map.get(d.id) ?? EMPTY_LOOK, state: cur.state, params: cur.params };
    }, Math.min(dt, 0.1));
    helper?.update();
    controls.update();
    stats3d.frameMs = performance.now() - t0;
    const f = frames.current;
    f.n++;
    if (t0 - f.t >= 1000) {
      stats3d.fps = Math.round((f.n * 1000) / (t0 - f.t));
      stats3d.calls = state.gl.info.render.calls;
      stats3d.triangles = state.gl.info.render.triangles;
      stats3d.devices = built.models.size;
      f.n = 0;
      f.t = t0;
    }
  });

  // Clique para operar: premir no aparelho, largar sem arrastar.
  const down = useRef<{ x: number; y: number; id: string; momentary: string | null } | null>(null);
  const deviceAt = (e: ThreeEvent<PointerEvent>) => {
    let o: THREE.Object3D | null = e.object;
    while (o && !o.userData.deviceId) o = o.parent;
    return (o?.userData.deviceId as string | undefined) ?? null;
  };
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    const id = deviceAt(e);
    if (!id) return;
    e.stopPropagation();
    const d = useApp.getState().project.devices.find((x) => x.id === id);
    const a = d && registry.require(d.type).actions?.(d).find((x) => !x.manualOnly);
    down.current = { x: e.clientX, y: e.clientY, id, momentary: a?.momentary ? a.id : null };
    if (a?.momentary) operate(id, a.id, 'down');
  };
  const onUp = (e: ThreeEvent<PointerEvent>) => {
    const p = down.current;
    down.current = null;
    if (!p) return;
    if (p.momentary) return operate(p.id, p.momentary, 'up');
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 5) return;
    select({ devices: [p.id] });
    const d = useApp.getState().project.devices.find((x) => x.id === p.id);
    const a = d && registry.require(d.type).actions?.(d).find((x) => !x.manualOnly);
    if (a) operate(p.id, a.id);
  };
  useEffect(() => {
    const release = () => {
      const p = down.current;
      if (p?.momentary) operate(p.id, p.momentary, 'up');
      down.current = null;
    };
    window.addEventListener('pointerup', release);
    return () => window.removeEventListener('pointerup', release);
  }, []);

  useEffect(() => {
    stats3d.devices = built.models.size;
    stats3d.calls = drawCalls(built.group);
    stats3d.screenOf = (id) => {
      const m = built.models.get(id);
      if (!m) return null;
      const box = new THREE.Box3().setFromObject(m.root);
      const p = box.getCenter(new THREE.Vector3());
      p.project(camera);
      const r = gl.domElement.getBoundingClientRect();
      return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
    };
  }, [built, camera, gl]);

  return (
    <>
      <primitive object={built.group} onPointerDown={onDown} onPointerUp={onUp} onPointerOver={() => (gl.domElement.style.cursor = 'pointer')} onPointerOut={() => (gl.domElement.style.cursor = '')} />
      {names && <primitive object={labels} />}
      {helper && <primitive object={helper} />}
    </>
  );
}

/** Enquadra a cena: a bancada de frente, a instalação real de um canto, a ver o chão. */
function fitCamera(cam: THREE.PerspectiveCamera, bounds: THREE.Box3, mode: Mode) {
  const c = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const vfov = (cam.fov * Math.PI) / 180;
  const tanV = Math.tan(vfov / 2);
  const tanH = tanV * cam.aspect;
  let dir: THREE.Vector3;
  let dist: number;
  if (mode === 'bench') {
    dir = new THREE.Vector3(0, 0.12, 1).normalize();
    dist = Math.max(size.y / 2 / tanV, size.x / 2 / tanH) * 1.08 + size.z / 2;
  } else {
    dir = new THREE.Vector3(0.55, 0.6, 1).normalize();
    const r = size.length() / 2;
    dist = (r / Math.min(tanV, tanH)) * 0.8;
  }
  cam.position.copy(c).addScaledVector(dir, dist);
  cam.near = Math.max(0.05, dist / 500);
  cam.far = dist * 10;
  cam.updateProjectionMatrix();
  cam.lookAt(c);
}

/** Etiqueta com o nome (textura de texto). Os nomes são do utilizador: não se traduzem. */
function label(text: string, scale: number): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(14,18,26,0.82)';
  g.beginPath();
  g.roundRect(2, 8, 252, 48, 14);
  g.fill();
  g.fillStyle = '#eef3f8';
  g.font = '600 32px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.scale.set(1.6 * scale, 0.4 * scale, 1);
  s.renderOrder = 10;
  return s;
}
