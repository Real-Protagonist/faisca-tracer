/**
 * Exercícios: separador «Exercício» (enunciado, objectivos, progresso, pontuação, solução),
 * lista dos exercícios incluídos e verificação automática depois de cada alteração do esquema.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { parseExercise, type Exercise, type Text } from '@faisca/sim-core';
import { EXERCISES } from '@faisca/content';
import { checkExerciseNow, closeExercise, openExercise, restartExercise, showSolution, useApp } from '../store';

/** Texto de um exercício: chave de tradução (incluídos) ou texto do formador (não se traduz). */
export const exText = (t: TFunction, x: Text) => ('key' in x ? t(x.key) : x.text);

/** Exercícios incluídos, já lidos e validados (selo verificado). */
let builtIn: Exercise[] | null = null;
export function builtInExercises(): Exercise[] {
  builtIn ??= EXERCISES.map((e) => parseExercise(e.text));
  return builtIn;
}

/** Verifica o exercício 0,7 s depois de cada alteração do esquema (não a cada passo da simulação). */
export function useExerciseAutoCheck() {
  const project = useApp((s) => s.project);
  const active = useApp((s) => !!s.exercise);
  const key = useMemo(() => JSON.stringify([project.devices.map((d) => [d.id, d.params, d.type]), project.wires]), [project]);
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(checkExerciseNow, 700);
    return () => clearTimeout(id);
  }, [key, active]);
}

export function ExercisePanel() {
  const { t } = useTranslation();
  const e = useApp((s) => s.exercise);
  if (!e) return <p className="muted pad">{t('ui.exercise.none')}</p>;
  const r = e.result;
  const ok = new Map(r?.results.map((x) => [x.id, x.ok]) ?? []);
  const done = !!r?.done;
  return (
    <div className="exercise" data-testid="exercise">
      <div className="exercise-head">
        <h3>{exText(t, e.ex.title)}</h3>
        <span className="exercise-score" data-testid="exercise-score" data-percent={r?.percent ?? 0}>
          {r ? t('ui.exercise.progress', { score: r.score, total: r.total }) : t('ui.exercise.checking')}
          {e.solutionShown && <em> · {t('ui.exercise.solutionShown')}</em>}
        </span>
      </div>
      <div className="exercise-bar" aria-hidden>
        <div style={{ width: `${r?.percent ?? 0}%` }} className={done ? 'done' : ''} />
      </div>
      <div className="exercise-body">
        <p className="statement">{exText(t, e.ex.statement)}</p>
        <ul className="objectives" aria-label={t('ui.exercise.objectives')}>
          {e.ex.objectives.map((o) => {
            const st = ok.get(o.id);
            return (
              <li key={o.id} data-objective={o.id} data-ok={st === undefined ? 'pending' : String(st)} className={st ? 'ok' : st === false ? 'fail' : ''}>
                <span className="mark" aria-label={st ? t('ui.exercise.ok') : t('ui.exercise.notYet')}>
                  {st ? '✓' : '○'}
                </span>
                {exText(t, o.text)}
              </li>
            );
          })}
        </ul>
        <div className="exercise-actions">
          {done && (
            <strong className="exercise-done" data-testid="exercise-done">
              {t('ui.exercise.done')}
            </strong>
          )}
          <button onClick={checkExerciseNow} disabled={e.checking} data-testid="exercise-check">
            {e.checking ? t('ui.exercise.checking') : t('ui.exercise.check')}
          </button>
          <button onClick={restartExercise}>{t('ui.exercise.restart')}</button>
          {e.ex.solution && (
            <button onClick={() => window.confirm(t('ui.exercise.solutionConfirm')) && showSolution()} data-testid="exercise-solution">
              {t('ui.exercise.solution')}
            </button>
          )}
          <button onClick={closeExercise}>{t('ui.exercise.close')}</button>
        </div>
      </div>
    </div>
  );
}

/** Lista dos exercícios incluídos, por área e nível. */
export function ExerciseList({ onClose, domain, level }: { onClose: () => void; domain?: 'domestic' | 'industrial'; level?: 'beginner' | 'pro' }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<'all' | 'mine'>(domain ? 'mine' : 'all');
  const list = builtInExercises().filter((x) => filter === 'all' || ((!domain || x.domain === domain) && (!level || x.level === level)));
  const groups = (['domestic', 'industrial'] as const).flatMap((d) => (['beginner', 'pro'] as const).map((l) => ({ d, l, items: list.filter((x) => x.domain === d && x.level === l) }))).filter((g) => g.items.length);
  return (
    <div className="modal-back" role="presentation" onClick={onClose}>
      <div className="modal exercise-list" role="dialog" aria-modal="true" aria-labelledby="ex-list-title" onClick={(e) => e.stopPropagation()} data-testid="exercise-list">
        <h2 id="ex-list-title">{t('ui.exercise.listTitle')}</h2>
        {domain && (
          <label className="check">
            <input type="checkbox" checked={filter === 'all'} onChange={(e) => setFilter(e.target.checked ? 'all' : 'mine')} /> {t('ui.exercise.showAll')}
          </label>
        )}
        {groups.map((g) => (
          <section key={g.d + g.l}>
            <h3>
              {t(`domain.${g.d}`)} · {t(`level.${g.l}`)}
            </h3>
            <ul>
              {g.items.map((x) => (
                <li key={x.id}>
                  <button
                    className="link"
                    onClick={() => {
                      openExercise(x);
                      onClose();
                    }}
                    data-testid={`ex-${x.id}`}
                  >
                    <strong>{exText(t, x.title)}</strong>
                  </button>
                  <span className="muted small"> — {t('ui.exercise.count', { count: x.objectives.length })}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <div className="buttons right">
          <button onClick={onClose}>{t('ui.close')}</button>
        </div>
      </div>
    </div>
  );
}
