/** Acções da aplicação que precisam de ficheiros ou diálogos (fora do store puro). */
import { createProject, parseProject, ProjectFileError, serializeProject } from '@faisca/sim-core';
import { i18n } from './i18n';
import { clearRecovery, openFile, openPath, pushRecent, readRecovery, saveFile, writeRecovery } from './platform/files';
import { loadProject, ui, useApp } from './store';

const t = (k: string, o: Record<string, unknown> = {}) => i18n.t(k, o);

function confirmDiscard(): boolean {
  return !useApp.getState().dirty || window.confirm(t('ui.confirm.discard'));
}

export function newProject() {
  if (!confirmDiscard()) return;
  const { project } = useApp.getState();
  loadProject(createProject({ domain: project.domain, level: project.level, lang: useApp.getState().lang }));
}

function openText(text: string, path: string | null, name: string) {
  try {
    const P = parseProject(text);
    P.name ??= name.replace(/\.faisca$/i, '');
    loadProject(P, path);
    if (path) pushRecent({ path, name });
  } catch (e) {
    const key = e instanceof ProjectFileError ? e.key : 'file.error.invalid';
    window.alert(t(key));
  }
}

export async function openProject() {
  if (!confirmDiscard()) return;
  const f = await openFile();
  if (f) openText(f.text, f.path, f.name);
}

export async function openRecent(path: string) {
  if (!confirmDiscard()) return;
  try {
    const f = await openPath(path);
    openText(f.text, f.path, f.name);
  } catch {
    window.alert(t('file.error.invalid'));
  }
}

const fileName = () => `${useApp.getState().project.name || t('ui.untitled')}.faisca`;

export async function saveProject(as = false) {
  const { project, filePath, lang } = useApp.getState();
  const text = serializeProject({ ...project, lang });
  const r = await saveFile(text, as ? null : filePath, fileName());
  if (!r) return;
  ui.markSaved(r.path);
  if (r.path) pushRecent({ path: r.path, name: r.name });
  await clearRecovery();
}

/** Guarda uma cópia de recuperação a cada 30 s quando há alterações por guardar. */
export function startAutosave(intervalMs = 30000): () => void {
  const id = window.setInterval(() => {
    const { dirty, project, lang } = useApp.getState();
    if (dirty) void writeRecovery(serializeProject({ ...project, lang }));
  }, intervalMs);
  return () => window.clearInterval(id);
}

export async function pendingRecovery(): Promise<string | null> {
  return readRecovery();
}

export function restoreRecovery(text: string) {
  openText(text, null, t('ui.recovered'));
  useApp.setState({ dirty: true });
  void clearRecovery();
}

export function discardRecovery() {
  void clearRecovery();
}
