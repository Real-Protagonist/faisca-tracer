/**
 * Tour guiado: destaca uma zona, escurece o resto, explica numa ou duas frases e espera que o
 * utilizador faça a acção. Só avança quando a acção está certa.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TOURS } from '@faisca/content';
import { openExercise, setTour, useApp } from '../store';
import { builtInExercises } from '../panels/Exercise';
import { evaluate, mistake, showMe } from './engine';
import { ensureVisible } from '../view';

const SAVE_KEY = 'faisca.tour';

/** Passo guardado para retomar o tour onde ficou. */
export function savedTour(): { id: string; index: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null');
    return v && typeof v.id === 'string' && typeof v.index === 'number' ? v : null;
  } catch {
    return null;
  }
}

/** Tour de cada área. */
export const TOUR_OF: Record<'domestic' | 'industrial', string> = { domestic: 'domestic-first-light', industrial: 'industrial-first-motor' };

export function startTour(id: string, resume = true) {
  const saved = savedTour();
  setTour({ id, index: resume && saved?.id === id ? saved.index : 0 });
}

function save(v: { id: string; index: number } | null) {
  try {
    if (v) localStorage.setItem(SAVE_KEY, JSON.stringify(v));
    else localStorage.removeItem(SAVE_KEY);
  } catch {
    /* sem armazenamento */
  }
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function TourOverlay() {
  const { t } = useTranslation();
  const tourState = useApp((s) => s.tour);
  const project = useApp((s) => s.project);
  const snapshot = useApp((s) => s.snapshot);
  const probes = useApp((s) => s.probes);
  const tab = useApp((s) => s.tab);
  const flags = useApp((s) => s.flags);
  const events = useApp((s) => s.events);
  const [next, setNext] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [doneDomain, setDoneDomain] = useState<'domestic' | 'industrial'>('domestic');
  const sinceSeq = useRef(0);
  const tour = tourState ? TOURS[tourState.id] : undefined;
  const step = tour && tourState ? tour.steps[tourState.index] : undefined;
  const total = tour ? Math.max(...tour.steps.map((s) => s.step)) : 0;

  // Novo passo: esquece o «Seguinte» e os eventos anteriores, guarda o progresso.
  useEffect(() => {
    setNext(false);
    sinceSeq.current = useApp.getState().events.at(-1)?.seq ?? 0;
    if (tourState) save(tourState);
  }, [tourState?.id, tourState?.index]);

  // A zona destacada segue o elemento (que pode mudar de tamanho ou de sítio).
  useLayoutEffect(() => {
    if (!step) return setRect(null);
    // O alvo pode estar fora da zona visível (azulejo no fim da biblioteca): traz-se à vista.
    document.querySelector(step.targetSelector)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    let raf = 0;
    const measure = () => {
      const el = document.querySelector(step.targetSelector);
      const r = el?.getBoundingClientRect();
      setRect((old) => {
        const n = r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
        return JSON.stringify(old) === JSON.stringify(n) ? old : n;
      });
      raf = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(raf);
  }, [step]);

  const ok = useMemo(() => {
    if (!step) return false;
    return evaluate(step.waitFor, { project, snapshot, probes, tab, flags, events, sinceSeq: sinceSeq.current, next });
  }, [step, project, snapshot, probes, tab, flags, events, next]);

  // Acção certa: avança.
  useEffect(() => {
    if (!ok || !tour || !tourState) return;
    const id = setTimeout(() => {
      if (tourState.index + 1 >= tour.steps.length) {
        setTour(null);
        save(null);
        setDone(tour.doneTextKey ?? 'tour.ui.done.text');
        setDoneDomain(tour.domain);
      } else setTour({ id: tourState.id, index: tourState.index + 1 });
    }, step?.waitFor.type === 'next' ? 0 : 600);
    return () => clearTimeout(id);
  }, [ok]);

  if (done)
    return (
      <div className="modal-back" role="presentation">
        <div className="modal tour-done" role="dialog" aria-modal="true" aria-labelledby="tour-done-title" data-testid="tour-done">
          <h2 id="tour-done-title">{t('tour.ui.done.title')}</h2>
          <p>{t(done)}</p>
          <div className="buttons right">
            <button
              onClick={() => {
                // O primeiro exercício do mesmo tema: o primeiro do nível Iniciante da área do tour.
                const ex = builtInExercises().find((x) => x.domain === doneDomain && x.level === 'beginner');
                setDone(null);
                if (ex) openExercise(ex);
              }}
              data-testid="tour-first-exercise"
            >
              {t('tour.ui.done.exercise')}
            </button>
            <button autoFocus onClick={() => setDone(null)}>
              {t('tour.ui.done.close')}
            </button>
          </div>
        </div>
      </div>
    );
  if (!tour || !step || !tourState) return null;

  const wrong = mistake(step, snapshot?.diagnostics ?? []);
  const pad = 6;
  const hole = rect && { x: rect.x - pad, y: rect.y - pad, w: rect.w + 2 * pad, h: rect.h + 2 * pad };
  // A bolha fica por baixo da zona, por cima se não couber, ou dentro (canto inferior direito) se a zona for grande.
  const bw = 360;
  const bh = 230;
  const below = !hole || hole.y + hole.h + bh < window.innerHeight;
  const above = !below && !!hole && hole.y - bh > 0;
  const inside = !below && !above;
  const bx = !hole ? window.innerWidth / 2 - bw / 2 : inside ? hole.x + hole.w - bw - 16 : Math.min(window.innerWidth - bw - 12, Math.max(12, hole.x + hole.w / 2 - bw / 2));
  const by0 = !hole ? window.innerHeight / 3 : below ? hole.y + hole.h + 12 : above ? hole.y - 12 : hole.y + hole.h - bh - 16;
  // A bolha nunca sai do ecrã, mesmo com o alvo meio escondido.
  const by = above ? Math.max(bh + 8, Math.min(window.innerHeight - 8, by0)) : Math.max(8, Math.min(window.innerHeight - bh - 8, by0));

  return (
    <>
      {hole && <div className="tour-hole" style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }} aria-hidden />}
      <div
        className="tour-bubble"
        style={{ left: bx, top: by, width: bw, transform: above ? 'translateY(-100%)' : undefined }}
        role="dialog"
        aria-live="polite"
        aria-label={t(tour.titleKey)}
        data-testid="tour"
        data-step={step.id}
      >
        <div className="tour-progress">
          <span>{t('tour.ui.progress', { n: step.step, total })}</span>
          <div className="bar" aria-hidden>
            <i style={{ width: `${(100 * step.step) / total}%` }} />
          </div>
        </div>
        <p className="tour-text">{t(step.textKey)}</p>
        {wrong && (
          <div className="tour-mistake" role="alert" data-testid="tour-mistake" data-code={wrong.code}>
            <strong>{t('tour.ui.mistake')}</strong> {t(wrong.titleKey, wrong.values)}. {t(wrong.hintKey, wrong.values)}
          </div>
        )}
        <div className="buttons">
          {step.waitFor.type === 'next' ? (
            <button className="primary" onClick={() => setNext(true)} data-testid="tour-next" autoFocus>
              {t('tour.ui.next')}
            </button>
          ) : (
            step.showMeAction && (
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await showMe(step.showMeAction!, () => useApp.getState().project);
                  // O que «Mostrar-me» colocou tem de ficar à vista.
                  requestAnimationFrame(ensureVisible);
                  setBusy(false);
                }}
                data-testid="tour-show-me"
              >
                {t('tour.ui.showMe')}
              </button>
            )
          )}
          <button
            className="link"
            onClick={() => {
              setTour(null);
            }}
            data-testid="tour-exit"
          >
            {t('tour.ui.exit')}
          </button>
        </div>
      </div>
    </>
  );
}
