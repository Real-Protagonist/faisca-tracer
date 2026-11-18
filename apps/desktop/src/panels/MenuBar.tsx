/** Barra de menus: Ficheiro, Editar, Ver, Simulação, Exercícios, Ferramentas, Ajuda; idioma; área e nível. */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Lang } from '@faisca/sim-core';
import { newProject, openProject, openRecent, saveProject } from '../actions';
import { isTauri, recentFiles } from '../platform/files';
import { rememberLang } from '../i18n';
import {
  align,
  copySelection,
  deleteSelection,
  groupInFrame,
  paste,
  redo,
  resetSim,
  rotateSelection,
  selectAll,
  setLang,
  setSim,
  stepOnce,
  ui,
  undo,
  useApp,
} from '../store';
import { fitView, zoomBy } from '../view';

interface Item {
  key: string;
  shortcut?: string;
  run?: () => void;
  disabled?: boolean;
  sep?: boolean;
}

export function MenuBar({ onAbout }: { onAbout: () => void }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const project = useApp((s) => s.project);
  const lang = useApp((s) => s.lang);
  const sim = useApp((s) => s.sim);
  const past = useApp((s) => s.past.length);
  const future = useApp((s) => s.future.length);
  const sel = useApp((s) => s.selection);
  const clip = useApp((s) => !!s.clipboard);

  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);

  const recents = isTauri() ? recentFiles() : [];
  const menus: { key: string; items: Item[] }[] = [
    {
      key: 'file',
      items: [
        { key: 'ui.menu.new', shortcut: 'Ctrl+N', run: newProject },
        { key: 'ui.menu.open', shortcut: 'Ctrl+O', run: () => void openProject() },
        ...recents.map((r) => ({ key: r.name, run: () => void openRecent(r.path) })),
        { key: 'sep1', sep: true },
        { key: 'ui.menu.save', shortcut: 'Ctrl+S', run: () => void saveProject() },
        { key: 'ui.menu.saveAs', shortcut: 'Ctrl+Shift+S', run: () => void saveProject(true) },
        { key: 'sep2', sep: true },
        { key: 'ui.menu.export', disabled: true },
        { key: 'ui.menu.print', disabled: true },
      ],
    },
    {
      key: 'edit',
      items: [
        { key: 'ui.menu.undo', shortcut: 'Ctrl+Z', run: undo, disabled: !past },
        { key: 'ui.menu.redo', shortcut: 'Ctrl+Y', run: redo, disabled: !future },
        { key: 'sep1', sep: true },
        { key: 'ui.menu.copy', shortcut: 'Ctrl+C', run: copySelection, disabled: !sel.devices.length },
        { key: 'ui.menu.paste', shortcut: 'Ctrl+V', run: () => paste(), disabled: !clip },
        { key: 'ui.menu.delete', shortcut: 'Del', run: deleteSelection, disabled: !sel.devices.length && !sel.wires.length },
        { key: 'ui.menu.selectAll', shortcut: 'Ctrl+A', run: selectAll },
        { key: 'sep2', sep: true },
        { key: 'ui.menu.rotate', shortcut: 'R', run: rotateSelection, disabled: !sel.devices.length },
        { key: 'ui.menu.alignLeft', run: () => align('left'), disabled: sel.devices.length < 2 },
        { key: 'ui.menu.alignTop', run: () => align('top'), disabled: sel.devices.length < 2 },
        { key: 'ui.menu.group', run: groupInFrame, disabled: !sel.devices.length },
      ],
    },
    {
      key: 'view',
      items: [
        { key: 'ui.menu.zoomIn', shortcut: '+', run: () => zoomBy(1.2) },
        { key: 'ui.menu.zoomOut', shortcut: '−', run: () => zoomBy(1 / 1.2) },
        { key: 'ui.menu.fit', shortcut: '0', run: fitView },
        { key: 'sep1', sep: true },
        { key: 'ui.tab.logic', run: () => ui.setTab('logic') },
        { key: 'ui.tab.physical', run: () => ui.setTab('physical') },
      ],
    },
    {
      key: 'simulation',
      items: [
        { key: sim.running ? 'ui.sim.pause' : 'ui.sim.start', shortcut: 'F5', run: () => setSim({ running: !sim.running }), disabled: !sim.realtime },
        { key: 'ui.sim.step', shortcut: 'F6', run: () => stepOnce(0.1) },
        { key: sim.realtime ? 'ui.sim.toStep' : 'ui.sim.toRealtime', run: () => setSim({ realtime: !sim.realtime, running: !sim.realtime }) },
        { key: 'ui.sim.reset', run: resetSim },
      ],
    },
    { key: 'exercises', items: [{ key: 'ui.menu.soon', disabled: true }] },
    {
      key: 'tools',
      items: [
        { key: 'ui.tool.select', shortcut: 'V', run: () => ui.setTool('select') },
        { key: 'ui.tool.operate', shortcut: 'H', run: () => ui.setTool('operate') },
        { key: 'ui.tool.wire', shortcut: 'W', run: () => ui.setTool('wire') },
        { key: 'ui.tool.probe', shortcut: 'M', run: () => ui.setTool('probe') },
        { key: 'ui.tool.clamp', shortcut: 'P', run: () => ui.setTool('clamp') },
        { key: 'ui.tool.delete', shortcut: 'D', run: () => ui.setTool('delete') },
      ],
    },
    { key: 'help', items: [{ key: 'ui.menu.tour', disabled: true }, { key: 'ui.menu.about', run: onAbout }] },
  ];

  const changeLang = (l: Lang) => {
    void i18n.changeLanguage(l);
    rememberLang(l);
    setLang(l);
  };

  return (
    <div className="menubar" ref={ref} role="menubar">
      <span className="brand" aria-hidden>
        ⚡
      </span>
      {menus.map((m) => (
        <div key={m.key} className="menu">
          <button role="menuitem" aria-haspopup="true" aria-expanded={open === m.key} className={open === m.key ? 'open' : ''} onClick={() => setOpen(open === m.key ? null : m.key)} onMouseEnter={() => open && setOpen(m.key)} data-testid={`menu-${m.key}`}>
            {t(`ui.menu.${m.key}`)}
          </button>
          {open === m.key && (
            <div className="dropdown" role="menu">
              {m.items.map((it) =>
                it.sep ? (
                  <hr key={it.key} />
                ) : (
                  <button
                    key={it.key}
                    role="menuitem"
                    disabled={it.disabled}
                    data-testid={`item-${it.key}`}
                    onClick={() => {
                      setOpen(null);
                      it.run?.();
                    }}
                  >
                    <span>{it.key.startsWith('ui.') ? t(it.key) : it.key}</span>
                    {it.shortcut && <kbd>{it.shortcut}</kbd>}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
      <div className="spacer" />
      <span className="chip" title={t('ui.project.areaLevel')}>
        {t(`domain.${project.domain}`)} · {t(`level.${project.level}`)}
      </span>
      <label className="lang">
        <span className="sr-only">{t('ui.lang')}</span>
        <select value={lang} onChange={(e) => changeLang(e.target.value as Lang)} aria-label={t('ui.lang')} data-testid="lang">
          <option value="pt">Português</option>
          <option value="en">English</option>
          <option value="fr">Français</option>
        </select>
      </label>
    </div>
  );
}
