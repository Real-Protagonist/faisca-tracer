/**
 * Ficheiros: diálogos nativos e sistema de ficheiros no Tauri; no navegador (desenvolvimento e
 * testes), selector de ficheiros e descarga. Recuperação automática a cada 30 s.
 */
export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface OpenedFile {
  path: string | null;
  name: string;
  text: string;
}

const FILTER = { name: 'Faísca', extensions: ['faisca'] };
const RECOVERY_KEY = 'faisca.recovery';
const RECENT_KEY = 'faisca.recent';
const RECOVERY_FILE = 'recuperacao.faisca';

const baseName = (p: string) => p.split(/[\/]/).pop() ?? p;

export async function openFile(): Promise<OpenedFile | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await open({ multiple: false, directory: false, filters: [FILTER] });
    if (!path || Array.isArray(path)) return null;
    return { path, name: baseName(path), text: await readTextFile(path) };
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.faisca,application/json';
    input.dataset.testid = 'file-input';
    input.style.display = 'none';
    input.onchange = async () => {
      const f = input.files?.[0];
      input.remove();
      resolve(f ? { path: null, name: f.name, text: await f.text() } : null);
    };
    document.body.appendChild(input);
    input.click();
  });
}

/** Abre um caminho conhecido (projectos recentes, só no Tauri). */
export async function openPath(path: string): Promise<OpenedFile> {
  const { readTextFile } = await import('@tauri-apps/plugin-fs');
  return { path, name: baseName(path), text: await readTextFile(path) };
}

/** Guarda; sem caminho (ou «Guardar como»), pergunta onde. Devolve o caminho, ou null se cancelado. */
export async function saveFile(text: string, path: string | null, suggestedName: string): Promise<{ path: string | null; name: string } | null> {
  if (isTauri()) {
    let target = path;
    if (!target) {
      const { save } = await import('@tauri-apps/plugin-dialog');
      target = await save({ defaultPath: suggestedName, filters: [FILTER] });
      if (!target) return null;
    }
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(target, text);
    return { path: target, name: baseName(target) };
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = suggestedName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return { path: null, name: suggestedName };
}

export async function writeRecovery(text: string): Promise<void> {
  try {
    if (isTauri()) {
      const { writeTextFile, mkdir, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      if (!(await exists('', { baseDir: BaseDirectory.AppData }))) await mkdir('', { baseDir: BaseDirectory.AppData, recursive: true });
      await writeTextFile(RECOVERY_FILE, text, { baseDir: BaseDirectory.AppData });
    } else localStorage.setItem(RECOVERY_KEY, text);
  } catch (e) {
    console.warn('[recuperação]', e);
  }
}

export async function readRecovery(): Promise<string | null> {
  try {
    if (isTauri()) {
      const { readTextFile, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      if (!(await exists(RECOVERY_FILE, { baseDir: BaseDirectory.AppData }))) return null;
      return await readTextFile(RECOVERY_FILE, { baseDir: BaseDirectory.AppData });
    }
    return localStorage.getItem(RECOVERY_KEY);
  } catch {
    return null;
  }
}

export async function clearRecovery(): Promise<void> {
  try {
    if (isTauri()) {
      const { remove, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      if (await exists(RECOVERY_FILE, { baseDir: BaseDirectory.AppData })) await remove(RECOVERY_FILE, { baseDir: BaseDirectory.AppData });
    } else localStorage.removeItem(RECOVERY_KEY);
  } catch {
    /* sem recuperação para limpar */
  }
}

export interface Recent {
  path: string;
  name: string;
}

export function recentFiles(): Recent[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as Recent[];
  } catch {
    return [];
  }
}

export function pushRecent(r: Recent) {
  const list = [r, ...recentFiles().filter((x) => x.path !== r.path)].slice(0, 8);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* armazenamento indisponível */
  }
}
