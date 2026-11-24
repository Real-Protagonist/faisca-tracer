/**
 * Vista física 3D (separador «Físico 3D»): bancada didáctica ou instalação real, gerada a partir
 * do esquema. Os estados animam-se num só ciclo por fotograma, sem renderizar o React a cada passo
 * da simulação. Clicar num aparelho selecciona-o e opera-o (como a ferramenta Operar); duplo
 * clique aproxima a câmara para ver os detalhes.
 *
 * Modo «Ligações» (só na bancada): os bornes ficam clicáveis. Clicar num borne mostra os cabos
 * ligados, para desligar um ou começar um cabo novo; clicar numa ponta solta e depois num borne
 * liga-a (ao mesmo borne ou a outro).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { lookFrom, type Device, type Look, type Wire, type WireEnd } from '@faisca/sim-core';
import { attachWireEnd, connect, detachWireEnd, operate, registry, select, useApp } from '../store';
import { buildScene, drawCalls, type Built, type Mode } from './scene';

const MODE_KEY = 'faisca.view3d';
const EMPTY_LOOK = lookFrom([]);
/** Espera do clique simples antes de operar: um duplo clique aproxima em vez de operar duas vezes. */
const CLICK_DELAY = 230;

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
  /** Posição no ecrã de um borne («aparelho:borne») ou de uma ponta solta («cabo:a|b»). */
  terminalScreen: (_key: string): { x: number; y: number } | null => null,
  looseScreen: (_key: string): { x: number; y: number } | null => null,
  /** Distância da câmara ao alvo (para verificar o duplo clique). */
  distance: 0,
};

/** O que o modo «Ligações» está à espera: o destino de um cabo novo ou o borne de uma ponta solta. */
type Pending = { kind: 'new'; from: WireEnd } | { kind: 'attach'; wire: string; end: 'a' | 'b' } | null;

interface TermMenu {
  x: number;
  y: number;
  at: WireEnd;
  wires: { w: Wire; end: 'a' | 'b' }[];
}

const keyOf = (e: WireEnd) => `${e.device}:${e.terminal}`;
const nameOf = (id: string) => useApp.getState().project.devices.find((d) => d.id === id)?.name ?? id;
const endText = (e: WireEnd) => `${nameOf(e.device)}:${e.terminal}`;

/** Cabos ligados (não soltos) a um borne, com a ponta que lá está. */
function wiresAt(at: WireEnd) {
  const out: { w: Wire; end: 'a' | 'b' }[] = [];
  for (const w of useApp.getState().project.wires)
    for (const end of ['a', 'b'] as const) if (w[end].device === at.device && w[end].terminal === at.terminal && !w.detached?.includes(end)) out.push({ w, end });
  return out;
}

export function Physical3D() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>(savedMode);
  const [names, setNames] = useState(true);
  const [fps, setFps] = useState(0);
  const [wiring, setWiring] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [menu, setMenu] = useState<TermMenu | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [fitSeq, setFitSeq] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const change = (m: Mode) => {
    setMode(m);
    if (m === 'real') setWiring(false);
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
  // Sair do modo «Ligações» cancela o que estava pendente.
  useEffect(() => {
    if (!wiring) {
      setPending(null);
      setMenu(null);
      setHover(null);
    }
  }, [wiring]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPending(null);
      setMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const local = (x: number, y: number) => {
    const r = box.current?.getBoundingClientRect();
    return r ? { x: x - r.left, y: y - r.top } : { x, y };
  };
  const onTerminal = (at: WireEnd, clientX: number, clientY: number) => {
    setMenu(null);
    if (pending?.kind === 'attach') {
      if (attachWireEnd(pending.wire, pending.end, at)) select({ wires: [pending.wire] });
      setPending(null);
      return;
    }
    if (pending?.kind === 'new') {
      if (keyOf(pending.from) !== keyOf(at)) {
        const id = connect(pending.from, at);
        if (id) select({ wires: [id] });
      }
      setPending(null);
      return;
    }
    const ws = wiresAt(at);
    if (!ws.length) setPending({ kind: 'new', from: at });
    else setMenu({ ...local(clientX, clientY), at, wires: ws });
  };
  const onLoose = (wire: string, end: 'a' | 'b') => {
    setMenu(null);
    setPending({ kind: 'attach', wire, end });
    select({ wires: [wire] });
  };
  const status = !wiring
    ? t('ui.view3d.hint')
    : pending?.kind === 'new'
      ? t('ui.view3d.pickTarget')
      : pending?.kind === 'attach'
        ? t('ui.view3d.pickAttach')
        : t('ui.view3d.wiringHint');

  return (
    <div className={`view3d${wiring ? ' wiring' : ''}`} ref={box} data-testid="view3d" data-mode={mode} data-wiring={wiring ? (pending?.kind ?? 'idle') : undefined}>
      <Canvas
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ fov: 38, near: 0.05, far: 500 }}
        frameloop="always"
        onPointerMissed={() => {
          setMenu(null);
          setPending(null);
        }}
      >
        <color attach="background" args={['#1a2029']} />
        <hemisphereLight args={[0xdfe8ff, 0x303030, 1.1]} />
        <directionalLight position={[-6, 10, 14]} intensity={1.6} />
        <ambientLight intensity={0.35} />
        <SceneContent mode={mode} names={names} wiring={wiring && mode === 'bench'} pending={pending} fitSeq={fitSeq} onTerminal={onTerminal} onLoose={onLoose} onHover={setHover} />
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
        <button
          className={`tool-toggle${wiring ? ' active' : ''}`}
          aria-pressed={wiring}
          disabled={mode !== 'bench'}
          title={mode === 'bench' ? t('ui.view3d.wiringTitle') : t('ui.view3d.wiringBenchOnly')}
          onClick={() => setWiring((w) => !w)}
          data-testid="view3d-wiring"
        >
          {t('ui.view3d.wiring')}
        </button>
        <button className="tool-toggle" title={t('ui.view3d.fitTitle')} onClick={() => setFitSeq((n) => n + 1)} data-testid="view3d-fit">
          {t('ui.view3d.fit')}
        </button>
        <label className="check">
          <input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} data-testid="view3d-names" /> {t('ui.view3d.names')}
        </label>
        <span className={`hint${wiring && pending ? ' pending' : ''}`} data-testid="view3d-hint">
          {wiring && pending ? (hover ? `${status} · ${hover}` : status) : (hover ?? status)}
        </span>
        <span className="fps" data-testid="view3d-fps">
          {t('ui.view3d.fps', { fps })}
        </span>
      </div>
      {menu && (
        <div className="view3d-menu" role="menu" style={{ left: menu.x, top: menu.y }} data-testid="view3d-menu">
          <div className="title">{t('ui.view3d.terminal', { device: nameOf(menu.at.device), terminal: menu.at.terminal })}</div>
          {menu.wires.map(({ w, end }) => (
            <button
              key={w.id + end}
              role="menuitem"
              onClick={() => {
                detachWireEnd(w.id, end);
                select({ wires: [w.id] });
                setMenu(null);
              }}
              data-testid={`view3d-detach-${w.id}`}
            >
              <span className="chip" style={{ background: CHIP[w.conductor] ?? '#888' }} />
              {t('ui.view3d.detach', { to: endText(w[end === 'a' ? 'b' : 'a']) })}
            </button>
          ))}
          <button
            role="menuitem"
            onClick={() => {
              setPending({ kind: 'new', from: menu.at });
              setMenu(null);
            }}
            data-testid="view3d-new-wire"
          >
            {t('ui.view3d.newWire')}
          </button>
          <button role="menuitem" className="muted" onClick={() => setMenu(null)}>
            {t('ui.view3d.cancel')}
          </button>
        </div>
      )}
    </div>
  );
}

const CHIP: Record<string, string> = { L1: '#8b5a2b', L2: '#262626', L3: '#8a8f96', N: '#2f6fd6', PE: '#2e9e44', C: '#d33a3a', 'DC+': '#d33a3a', 'DC-': '#262626' };

/** Chave da estrutura do esquema: a cena só se reconstrói quando ela muda (não a cada passo). */
function structureKey(P: ReturnType<typeof useApp.getState>['project']): string {
  return JSON.stringify([P.domain, P.devices.map((d) => [d.id, d.type, d.x, d.y, d.rot, d.params]), P.wires.map((w) => [w.id, w.a, w.b, w.conductor, w.points, w.fault, w.detached])]);
}

/* ---------------- bornes clicáveis (modo «Ligações») ---------------- */

const HOT_GEO = new THREE.SphereGeometry(0.1, 14, 10);
const LOOSE_GEO = new THREE.SphereGeometry(0.13, 14, 10);
const HOT = { wired: new THREE.Color(0xffb020), free: new THREE.Color(0x8fb3ff), hover: new THREE.Color(0xffffff), pending: new THREE.Color(0x2fd37a), loose: new THREE.Color(0xff6b3d) };

function Hotspots({ built, pending, onTerminal, onLoose, onHover }: { built: Built; pending: Pending; onTerminal: (at: WireEnd, x: number, y: number) => void; onLoose: (wire: string, end: 'a' | 'b') => void; onHover: (s: string | null) => void }) {
  const { t } = useTranslation();
  const { gl } = useThree();
  const project = useApp((s) => s.project);
  const terms = useMemo(() => [...built.terminals.values()], [built]);
  const loose = useMemo(() => [...built.looseEnds.values()], [built]);
  const [hot, setHot] = useState<{ kind: 't' | 'l'; i: number } | null>(null);

  const make = (geo: THREE.BufferGeometry, n: number, pos: (i: number) => THREE.Vector3) => {
    const m = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9 }), Math.max(1, n));
    const M = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const p = pos(i);
      m.setMatrixAt(i, M.makeTranslation(p.x, p.y, p.z));
      m.setColorAt(i, HOT.free);
    }
    m.count = n;
    m.renderOrder = 4;
    return m;
  };
  const termMesh = useMemo(() => make(HOT_GEO, terms.length, (i) => terms[i]!.pos), [terms]);
  const looseMesh = useMemo(() => make(LOOSE_GEO, loose.length, (i) => loose[i]!.pos), [loose]);
  useEffect(
    () => () => {
      (termMesh.material as THREE.Material).dispose();
      (looseMesh.material as THREE.Material).dispose();
      termMesh.dispose();
      looseMesh.dispose();
    },
    [termMesh, looseMesh],
  );

  // Cores: borne com cabos (âmbar), livre (azul), em espera (verde), sob o rato (branco).
  useEffect(() => {
    const wired = new Set<string>();
    for (const w of project.wires) for (const e of ['a', 'b'] as const) if (!w.detached?.includes(e)) wired.add(keyOf(w[e]));
    let pend: string | null = null;
    if (pending?.kind === 'new') pend = keyOf(pending.from);
    if (pending?.kind === 'attach') {
      const w = project.wires.find((x) => x.id === pending.wire);
      if (w) pend = keyOf(w[pending.end]);
    }
    terms.forEach((tm, i) => {
      const k = keyOf(tm.end);
      termMesh.setColorAt(i, hot?.kind === 't' && hot.i === i ? HOT.hover : k === pend ? HOT.pending : wired.has(k) ? HOT.wired : HOT.free);
    });
    if (termMesh.instanceColor) termMesh.instanceColor.needsUpdate = true;
    loose.forEach((l, i) => {
      const held = pending?.kind === 'attach' && pending.wire === l.wire && pending.end === l.end;
      looseMesh.setColorAt(i, hot?.kind === 'l' && hot.i === i ? HOT.hover : held ? HOT.pending : HOT.loose);
    });
    if (looseMesh.instanceColor) looseMesh.instanceColor.needsUpdate = true;
  }, [terms, loose, termMesh, looseMesh, hot, pending, project.wires]);

  const describe = (kind: 't' | 'l', i: number) => {
    if (kind === 't') {
      const e = terms[i]!.end;
      return t('ui.view3d.terminal', { device: nameOf(e.device), terminal: e.terminal });
    }
    const l = loose[i]!;
    const w = useApp.getState().project.wires.find((x) => x.id === l.wire);
    return w ? t('ui.view3d.loose', { from: endText(w.a), to: endText(w.b) }) : null;
  };
  const enter = (kind: 't' | 'l') => (e: ThreeEvent<PointerEvent>) => {
    if (e.instanceId === undefined) return;
    e.stopPropagation();
    setHot({ kind, i: e.instanceId });
    onHover(describe(kind, e.instanceId));
    gl.domElement.style.cursor = 'pointer';
  };
  const leave = () => {
    setHot(null);
    onHover(null);
    gl.domElement.style.cursor = '';
  };
  return (
    <>
      <primitive
        object={termMesh}
        onPointerMove={enter('t')}
        onPointerOut={leave}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          if (e.instanceId === undefined || e.delta > 5) return;
          e.stopPropagation();
          onTerminal(terms[e.instanceId]!.end, e.clientX, e.clientY);
        }}
      />
      {loose.length > 0 && (
        <primitive
          object={looseMesh}
          onPointerMove={enter('l')}
          onPointerOut={leave}
          onClick={(e: ThreeEvent<MouseEvent>) => {
            if (e.instanceId === undefined || e.delta > 5) return;
            e.stopPropagation();
            const l = loose[e.instanceId]!;
            onLoose(l.wire, l.end);
          }}
        />
      )}
    </>
  );
}

/* ---------------- cena ---------------- */

interface SceneProps {
  mode: Mode;
  names: boolean;
  wiring: boolean;
  pending: Pending;
  fitSeq: number;
  onTerminal: (at: WireEnd, x: number, y: number) => void;
  onLoose: (wire: string, end: 'a' | 'b') => void;
  onHover: (s: string | null) => void;
}

function SceneContent({ mode, names, wiring, pending, fitSeq, onTerminal, onLoose, onHover }: SceneProps) {
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
    const v = fitView(camera as THREE.PerspectiveCamera, built.bounds, mode);
    camera.position.copy(v.pos);
    controls.target.copy(v.target);
    controls.update();
  }, [built]);

  // Voo da câmara (duplo clique num aparelho, botão «Ver tudo»).
  const fly = useRef<{ p0: THREE.Vector3; t0: THREE.Vector3; p1: THREE.Vector3; t1: THREE.Vector3; k: number } | null>(null);
  const flyTo = (pos: THREE.Vector3, target: THREE.Vector3) => {
    fly.current = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, k: 0 };
  };
  const firstFit = useRef(true);
  useEffect(() => {
    if (firstFit.current) {
      firstFit.current = false;
      return;
    }
    const v = fitView(camera as THREE.PerspectiveCamera, built.bounds, mode);
    flyTo(v.pos, v.target);
  }, [fitSeq]);
  const zoomTo = (id: string) => {
    const m = built.models.get(id);
    if (!m) return;
    const b = new THREE.Box3().setFromObject(m.root);
    const c = b.getCenter(new THREE.Vector3());
    const size = b.getSize(new THREE.Vector3());
    const cam = camera as THREE.PerspectiveCamera;
    const tanV = Math.tan(((cam.fov * Math.PI) / 180) / 2);
    const dist = Math.max(size.y / 2 / tanV, size.x / 2 / (tanV * cam.aspect)) * 1.7 + size.z;
    // Na bancada, de frente e um pouco de cima; na instalação real, na direcção de onde se olha.
    const dir = mode === 'bench' ? new THREE.Vector3(0.12, 0.25, 1).normalize() : camera.position.clone().sub(controls.target).normalize();
    flyTo(c.clone().addScaledVector(dir, Math.max(dist, 0.5)), c);
  };

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
    const f0 = fly.current;
    if (f0) {
      f0.k = Math.min(1, f0.k + dt / 0.6);
      const e = f0.k < 0.5 ? 2 * f0.k * f0.k : 1 - (-2 * f0.k + 2) ** 2 / 2;
      camera.position.lerpVectors(f0.p0, f0.p1, e);
      controls.target.lerpVectors(f0.t0, f0.t1, e);
      if (f0.k >= 1) fly.current = null;
    }
    helper?.update();
    controls.update();
    stats3d.distance = camera.position.distanceTo(controls.target);
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

  // Clique para operar: premir no aparelho, largar sem arrastar. No modo «Ligações» os aparelhos não se operam.
  const down = useRef<{ x: number; y: number; id: string; momentary: string | null } | null>(null);
  const pendingClick = useRef<number | null>(null);
  const deviceAt = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    let o: THREE.Object3D | null = e.object;
    while (o && !o.userData.deviceId) o = o.parent;
    return (o?.userData.deviceId as string | undefined) ?? null;
  };
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (wiring) return;
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
    if (!a) return;
    if (pendingClick.current) clearTimeout(pendingClick.current);
    pendingClick.current = window.setTimeout(() => {
      pendingClick.current = null;
      operate(p.id, a.id);
    }, CLICK_DELAY);
  };
  const onDouble = (e: ThreeEvent<MouseEvent>) => {
    const id = deviceAt(e);
    if (!id) return;
    e.stopPropagation();
    if (pendingClick.current) {
      clearTimeout(pendingClick.current);
      pendingClick.current = null;
    }
    zoomTo(id);
  };
  useEffect(() => {
    const release = () => {
      const p = down.current;
      if (p?.momentary) operate(p.id, p.momentary, 'up');
      down.current = null;
    };
    window.addEventListener('pointerup', release);
    return () => {
      window.removeEventListener('pointerup', release);
      if (pendingClick.current) clearTimeout(pendingClick.current);
    };
  }, []);

  useEffect(() => {
    const toScreen = (p: THREE.Vector3) => {
      const v = p.clone().project(camera);
      const r = gl.domElement.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    };
    stats3d.devices = built.models.size;
    stats3d.calls = drawCalls(built.group);
    stats3d.screenOf = (id) => {
      const m = built.models.get(id);
      if (!m) return null;
      return toScreen(new THREE.Box3().setFromObject(m.root).getCenter(new THREE.Vector3()));
    };
    stats3d.terminalScreen = (k) => {
      const tm = built.terminals.get(k);
      return tm ? toScreen(tm.pos) : null;
    };
    stats3d.looseScreen = (k) => {
      const l = built.looseEnds.get(k);
      return l ? toScreen(l.pos) : null;
    };
  }, [built, camera, gl]);

  return (
    <>
      <primitive
        object={built.group}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onDoubleClick={onDouble}
        onPointerOver={() => !wiring && (gl.domElement.style.cursor = 'pointer')}
        onPointerOut={() => !wiring && (gl.domElement.style.cursor = '')}
      />
      {names && <primitive object={labels} />}
      {helper && <primitive object={helper} />}
      {wiring && <Hotspots built={built} pending={pending} onTerminal={onTerminal} onLoose={onLoose} onHover={onHover} />}
    </>
  );
}

/** Enquadramento da cena: a bancada de frente, a instalação real de um canto, a ver o chão. */
function fitView(cam: THREE.PerspectiveCamera, bounds: THREE.Box3, mode: Mode): { pos: THREE.Vector3; target: THREE.Vector3 } {
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
  // O plano próximo fica pequeno para se poder aproximar dos aparelhos sem os cortar.
  cam.near = Math.min(0.05, Math.max(0.01, dist / 2000));
  cam.far = dist * 10;
  cam.updateProjectionMatrix();
  return { pos: c.clone().addScaledVector(dir, dist), target: c };
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
