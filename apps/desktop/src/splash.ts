/**
 * Ecrã de arranque (definido no index.html): logótipo, nome e barra de progresso; no desktop,
 * também a versão. A barra avança por CSS enquanto o código carrega e chega ao fim quando a
 * simulação devolve o primeiro resultado; depois o ecrã desaparece.
 */
import { i18n } from './i18n';
import { isTauri } from './platform/files';
import { useApp } from './store';

/** Tempo mínimo visível desde o início do carregamento (ms), para não piscar. */
const MIN_MS = 900;
/** Se a simulação não responder, o ecrã sai na mesma. */
const MAX_MS = 5000;

export function startSplash() {
  const el = document.getElementById('splash');
  const bar = document.getElementById('splash-progress');
  if (!el || !bar) return;
  if (isTauri()) {
    const v = document.getElementById('splash-version');
    if (v) v.textContent = i18n.t('ui.about.version', { version: __APP_VERSION__ });
  }
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    bar.classList.add('full');
    setTimeout(() => {
      el.classList.add('done');
      setTimeout(() => el.remove(), 400);
    }, Math.max(250, MIN_MS - performance.now()));
  };
  if (useApp.getState().snapshot) finish();
  else {
    const unsub = useApp.subscribe((s) => {
      if (s.snapshot) {
        unsub();
        finish();
      }
    });
  }
  setTimeout(finish, Math.max(0, MAX_MS - performance.now()));
}
