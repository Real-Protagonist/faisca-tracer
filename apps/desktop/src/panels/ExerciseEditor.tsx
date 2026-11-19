/**
 * Editor de exercícios para formadores. O projecto aberto é a solução; o formador escreve o
 * enunciado, escolhe os cabos que o aluno terá de ligar e define os objectivos como regras
 * (sem programar). Exporta um `.fast-ex` com selo, só depois de a solução cumprir os objectivos.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { checkObjective, serializeExercise, type Exercise, type Objective, type Rule, type Step } from '@faisca/sim-core';
import { registry, useApp } from '../store';
import { EXERCISE_FILTER, saveExport } from '../platform/files';

type Kind = 'works' | 'off' | 'opens' | 'clean' | 'measure';
const KINDS: Kind[] = ['works', 'off', 'opens', 'clean', 'measure'];
/** Chaves literais (o teste de traduções encontra-as no código). */
const KIND_KEY: Record<Kind, string> = {
  works: 'ui.editor.kind.works',
  off: 'ui.editor.kind.off',
  opens: 'ui.editor.kind.opens',
  clean: 'ui.editor.kind.clean',
  measure: 'ui.editor.kind.measure',
};

interface Draft {
  id: string;
  text: string;
  kind: Kind;
  device: string;
  key: string;
  min: string;
  max: string;
  steps: Step[];
}

type WireMode = 'all' | 'control' | 'none';

function ruleOf(o: Draft): Rule {
  switch (o.kind) {
    case 'works':
      return { type: 'working', device: o.device };
    case 'off':
      return { type: 'working', device: o.device, value: false };
    case 'opens':
      return { type: 'deviceState', device: o.device, key: 'closed', value: false };
    case 'clean':
      return { type: 'noDiag' };
    case 'measure':
      return { type: 'measure', device: o.device, key: o.key, ...(o.min !== '' ? { min: Number(o.min.replace(',', '.')) } : {}), ...(o.max !== '' ? { max: Number(o.max.replace(',', '.')) } : {}) };
  }
}

const toObjective = (o: Draft): Objective => ({ id: o.id, text: { text: o.text }, rule: ruleOf(o), ...(o.steps.length ? { given: o.steps } : {}) });

export function ExerciseEditor({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const project = useApp((s) => s.project);
  const snapshot = useApp((s) => s.snapshot);
  const [title, setTitle] = useState(project.name ?? '');
  const [statement, setStatement] = useState('');
  const [wires, setWires] = useState<WireMode>('all');
  const [objs, setObjs] = useState<Draft[]>([]);
  const [tested, setTested] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState('');
  const names = project.devices.filter((d) => !registry.get(d.type)?.annotation).map((d) => d.name);
  const loads = project.devices.filter((d) => registry.get(d.type)?.load).map((d) => d.name);
  const opening = project.devices.filter((d) => 'closed' in d.state).map((d) => d.name);
  const byName = (n: string) => project.devices.find((d) => d.name === n);
  const actionsOf = (n: string) => {
    const d = byName(n);
    const def = d && registry.get(d.type);
    if (!d || !def?.actions) return [];
    // Comandos possíveis em qualquer estado: os do estado actual e os do estado oposto.
    const ids = new Map<string, boolean>();
    for (const a of def.actions(d)) ids.set(a.id, !!a.momentary);
    const flipped = structuredClone(d);
    for (const k of ['on', 'closed', 'pressed', 'active', 'run', 'locked', 'actuated', 'detected']) if (k in flipped.state) flipped.state[k] = !flipped.state[k];
    for (const a of def.actions(flipped)) ids.set(a.id, !!a.momentary);
    return [...ids].map(([id, momentary]) => ({ id, momentary }));
  };
  const numKeys = (n: string) => {
    const d = byName(n);
    return (d && snapshot?.measurements[d.id]?.filter((m) => typeof m.value === 'number').map((m) => m.key)) ?? [];
  };
  const update = (i: number, p: Partial<Draft>) => {
    setObjs(objs.map((o, k) => (k === i ? { ...o, ...p } : o)));
    setTested({});
  };
  const add = () => {
    const device = loads[0] ?? names[0] ?? '';
    setObjs([...objs, { id: `o${Date.now().toString(36)}${objs.length}`, text: '', kind: 'works', device, key: numKeys(device)[0] ?? '', min: '', max: '', steps: [] }]);
  };
  const test = () => {
    const r: Record<string, boolean> = {};
    for (const o of objs) r[o.id] = checkObjective(toObjective(o), project, registry);
    setTested(r);
    return r;
  };
  const exportFile = async () => {
    setMessage('');
    if (!title.trim() || !statement.trim() || !objs.length || objs.some((o) => !o.text.trim())) return setMessage(t('ui.editor.incomplete'));
    const r = test();
    if (objs.some((o) => !r[o.id])) return setMessage(t('ui.editor.notSolved'));
    const initial = structuredClone(project);
    initial.wires = wires === 'none' ? initial.wires : wires === 'control' ? initial.wires.filter((w) => w.section >= 2.5) : [];
    const ex: Exercise = {
      id: `ex-${Date.now().toString(36)}`,
      domain: project.domain,
      level: project.level,
      title: { text: title.trim() },
      statement: { text: statement.trim() },
      objectives: objs.map(toObjective),
      initial,
      solution: structuredClone(project),
    };
    const saved = await saveExport(serializeExercise(ex), `${title.trim().replace(/[\\/:*?"<>|]+/g, '_')}.fast-ex`, EXERCISE_FILTER, 'application/json');
    if (saved) setMessage(t('ui.editor.saved'));
  };

  return (
    <div className="modal-back" role="presentation">
      <div className="modal exercise-editor" role="dialog" aria-modal="true" aria-labelledby="ex-ed-title" data-testid="exercise-editor">
        <h2 id="ex-ed-title">{t('ui.editor.title')}</h2>
        <p className="desc">{t('ui.editor.intro')}</p>
        <label className="field">
          <span>{t('ui.editor.exTitle')}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="ed-title" />
        </label>
        <label className="field col">
          <span>{t('ui.editor.statement')}</span>
          <textarea rows={3} value={statement} onChange={(e) => setStatement(e.target.value)} data-testid="ed-statement" />
        </label>
        <label className="field">
          <span>{t('ui.editor.wires')}</span>
          <select value={wires} onChange={(e) => setWires(e.target.value as WireMode)} data-testid="ed-wires">
            <option value="all">{t('ui.editor.wiresAll')}</option>
            <option value="control">{t('ui.editor.wiresControl')}</option>
            <option value="none">{t('ui.editor.wiresNone')}</option>
          </select>
        </label>
        <h3>{t('ui.exercise.objectives')}</h3>
        {objs.map((o, i) => (
          <div className="ed-objective" key={o.id} data-testid={`ed-obj-${i}`}>
            <div className="row">
              <span className={tested[o.id] === undefined ? 'mark' : tested[o.id] ? 'mark ok' : 'mark fail'}>{tested[o.id] === undefined ? '○' : tested[o.id] ? '✓' : '✗'}</span>
              <input placeholder={t('ui.editor.objText')} value={o.text} onChange={(e) => update(i, { text: e.target.value })} data-testid={`ed-obj-text-${i}`} />
              <button className="link" onClick={() => setObjs(objs.filter((_, k) => k !== i))} aria-label={t('ui.editor.remove')}>
                ✕
              </button>
            </div>
            <div className="row">
              <select value={o.kind} onChange={(e) => update(i, { kind: e.target.value as Kind, device: e.target.value === 'opens' ? (opening[0] ?? '') : o.device })} data-testid={`ed-obj-kind-${i}`}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(KIND_KEY[k])}
                  </option>
                ))}
              </select>
              {o.kind !== 'clean' && (
                <select value={o.device} onChange={(e) => update(i, { device: e.target.value, key: numKeys(e.target.value)[0] ?? '' })} data-testid={`ed-obj-device-${i}`}>
                  {(o.kind === 'opens' ? opening : o.kind === 'measure' ? names : loads).map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              )}
              {o.kind === 'measure' && (
                <>
                  <select value={o.key} onChange={(e) => update(i, { key: e.target.value })}>
                    {numKeys(o.device).map((k) => (
                      <option key={k} value={k}>
                        {t(k)}
                      </option>
                    ))}
                  </select>
                  <input className="short" placeholder={t('ui.editor.min')} value={o.min} onChange={(e) => update(i, { min: e.target.value })} />
                  <input className="short" placeholder={t('ui.editor.max')} value={o.max} onChange={(e) => update(i, { max: e.target.value })} />
                </>
              )}
            </div>
            <div className="row steps">
              <span className="muted small">{t('ui.editor.given')}</span>
              {o.steps.map((s, k) => (
                <span className="step" key={k}>
                  {'op' in s ? `${s.op}: ${t(`action.${s.action}`)}` : 'press' in s ? `${s.press}: ${t('action.press')}` : 'run' in s ? t('ui.editor.wait', { s: s.run }) : ''}
                  <button className="link" onClick={() => update(i, { steps: o.steps.filter((_, j) => j !== k) })} aria-label={t('ui.editor.remove')}>
                    ✕
                  </button>
                </span>
              ))}
              <StepAdder names={names.filter((n) => actionsOf(n).length)} actionsOf={actionsOf} onAdd={(s) => update(i, { steps: [...o.steps, s] })} />
            </div>
          </div>
        ))}
        <div className="buttons">
          <button onClick={add} disabled={!names.length} data-testid="ed-add">
            {t('ui.editor.add')}
          </button>
          <button onClick={test} disabled={!objs.length} data-testid="ed-test">
            {t('ui.editor.test')}
          </button>
        </div>
        {message && (
          <p className="small" role="status" data-testid="ed-message">
            {message}
          </p>
        )}
        <div className="buttons right">
          <button onClick={onClose}>{t('ui.close')}</button>
          <button className="primary" onClick={() => void exportFile()} data-testid="ed-export">
            {t('ui.editor.export')}
          </button>
        </div>
      </div>
    </div>
  );
}

function StepAdder({ names, actionsOf, onAdd }: { names: string[]; actionsOf: (n: string) => { id: string; momentary: boolean }[]; onAdd: (s: Step) => void }) {
  const { t } = useTranslation();
  const [dev, setDev] = useState(names[0] ?? '');
  const acts = actionsOf(dev);
  const [act, setAct] = useState('');
  const a = acts.find((x) => x.id === act) ?? acts[0];
  return (
    <span className="step-adder">
      <select value={dev} onChange={(e) => setDev(e.target.value)} aria-label={t('ui.editor.device')}>
        {names.map((n) => (
          <option key={n}>{n}</option>
        ))}
      </select>
      <select value={a?.id ?? ''} onChange={(e) => setAct(e.target.value)} aria-label={t('ui.editor.action')}>
        {acts.map((x) => (
          <option key={x.id} value={x.id}>
            {t(`action.${x.id}`)}
          </option>
        ))}
      </select>
      <button className="link small" disabled={!a} onClick={() => a && onAdd(a.momentary ? { press: dev, hold: 0.3 } : { op: dev, action: a.id })}>
        {t('ui.editor.addStep')}
      </button>
      <button className="link small" onClick={() => onAdd({ run: 2 })}>
        {t('ui.editor.addWait')}
      </button>
    </span>
  );
}
