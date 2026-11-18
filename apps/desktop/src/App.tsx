/** Janela principal: menus, ferramentas, área de trabalho, propriedades e doca, como no Packet Tracer. */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MenuBar } from './panels/MenuBar';
import { Toolbar } from './panels/Toolbar';
import { Properties } from './panels/Properties';
import { Dock } from './panels/Dock';
import { About } from './panels/About';
import { Canvas } from './editor/Canvas';
import { Meter } from './editor/Meter';
import { Physical3D } from './view3d/Physical3D';
import { newProject, openProject, pendingRecovery, restoreRecovery, discardRecovery, saveProject } from './actions';
import {
  commit,
  copySelection,
  deleteSelection,
  paste,
  redo,
  rotateSelection,
  selectAll,
  setProbes,
  setSim,
  stepOnce,
  ui,
  undo,
  useApp,
  type Tool,
} from './store';
import { fitView, zoomBy } from './view';

const TOOL_KEYS: Record<string, Tool> = { v: 'select', h: 'operate', w: 'wire', m: 'probe', p: 'clamp', d: 'delete' };

function onKey(e: KeyboardEvent) {
  const typing = !!(e.target as HTMLElement).closest('input,select,textarea');
  const k = e.key.toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && k === 's') {
    e.preventDefault();
    return void saveProject(e.shiftKey);
  }
  if (typing) return;
  const s = useApp.getState();
  if (ctrl) {
    const map: Record<string, () => void> = {
      z: () => (e.shiftKey ? redo() : undo()),
      y: redo,
      c: copySelection,
      v: () => paste(),
      a: selectAll,
      o: () => void openProject(),
      n: newProject,
    };
    if (map[k]) {
      e.preventDefault();
      map[k]!();
    }
    return;
  }
  if (e.key === 'F5') {
    e.preventDefault();
    return setSim({ running: !s.sim.running, realtime: true });
  }
  if (e.key === 'F6') {
    e.preventDefault();
    return stepOnce(0.1);
  }
  if (e.key === 'Delete' || e.key === 'Backspace') return deleteSelection();
  if (e.key === 'Escape') {
    ui.setPlacing(null);
    ui.setWireStart(null);
    if (s.tool === 'probe' || s.tool === 'clamp') setProbes({ red: null, black: null, clamp: null });
    return;
  }
  if (e.key.startsWith('Arrow') && s.selection.devices.length) {
    e.preventDefault();
    const dx = e.key === 'ArrowLeft' ? -20 : e.key === 'ArrowRight' ? 20 : 0;
    const dy = e.key === 'ArrowUp' ? -20 : e.key === 'ArrowDown' ? 20 : 0;
    const ids = s.selection.devices;
    return commit((P) => P.devices.forEach((d) => ids.includes(d.id) && ((d.x += dx), (d.y += dy))));
  }
  if (TOOL_KEYS[k]) return ui.setTool(TOOL_KEYS[k]!);
  if (k === 'r') return rotateSelection();
  if (k === '+' || k === '=') return zoomBy(1.2);
  if (k === '-') return zoomBy(1 / 1.2);
  if (k === '0') return fitView();
}

export function App() {
  const { t } = useTranslation();
  const tab = useApp((s) => s.tab);
  const dirty = useApp((s) => s.dirty);
  const name = useApp((s) => s.project.name);
  const [about, setAbout] = useState(false);
  const [recovery, setRecovery] = useState<string | null>(null);

  useEffect(() => {
    window.addEventListener('keydown', onKey);
    void pendingRecovery().then(setRecovery);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    document.title = `${dirty ? '• ' : ''}${name || t('ui.untitled')} — ${t('app.name')}`;
  }, [dirty, name, t]);

  return (
    <div className="app">
      <MenuBar onAbout={() => setAbout(true)} />
      <Toolbar />
      {recovery && (
        <div className="banner" role="alert">
          <span>{t('ui.recovery.found')}</span>
          <button
            onClick={() => {
              restoreRecovery(recovery);
              setRecovery(null);
            }}
          >
            {t('ui.recovery.restore')}
          </button>
          <button
            onClick={() => {
              discardRecovery();
              setRecovery(null);
            }}
          >
            {t('ui.recovery.discard')}
          </button>
        </div>
      )}
      <main className="work">
        <div className="stage">
          {tab === 'logic' ? <Canvas /> : <Physical3D />}
          {tab === 'logic' && <Meter />}
        </div>
        <Properties />
      </main>
      <Dock />
      {about && <About onClose={() => setAbout(false)} />}
    </div>
  );
}
