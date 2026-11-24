/** Painel de propriedades: nome, comandos, parâmetros, medições em tempo real, ligações, «Porque não funciona?». */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ampacity, formatNumber, formatQuantity, SECTIONS, type Conductor, type Device, type Measurement, type ParamDef, type Wire } from '@faisca/sim-core';
import {
  align,
  askWhyNot,
  commit,
  deleteSelection,
  groupInFrame,
  operate,
  registry,
  select,
  updateDevice,
  updateWire,
  attachWireEnd,
  detachWireEnd,
  useApp,
} from '../store';
import { fmtMeasurement } from '../format';
import { LadderEditor } from './Ladder';
import { WIRE_COLOR } from '../editor/Canvas';

export function Properties() {
  const { t } = useTranslation();
  const sel = useApp((s) => s.selection);
  const project = useApp((s) => s.project);
  const n = sel.devices.length + sel.wires.length;
  let body;
  if (n === 0) body = <ProjectProps />;
  else if (sel.devices.length === 1 && sel.wires.length === 0) {
    const d = project.devices.find((x) => x.id === sel.devices[0]);
    body = d ? <DeviceProps d={d} /> : null;
  } else if (sel.wires.length === 1 && sel.devices.length === 0) {
    const w = project.wires.find((x) => x.id === sel.wires[0]);
    body = w ? <WireProps w={w} /> : null;
  } else
    body = (
      <section>
        <h2>{t('ui.props.multi', { count: n })}</h2>
        <div className="buttons">
          <button onClick={() => align('left')} disabled={sel.devices.length < 2}>
            {t('ui.menu.alignLeft')}
          </button>
          <button onClick={() => align('top')} disabled={sel.devices.length < 2}>
            {t('ui.menu.alignTop')}
          </button>
          <button onClick={groupInFrame}>{t('ui.menu.group')}</button>
          <button className="danger" onClick={deleteSelection}>
            {t('ui.menu.delete')}
          </button>
        </div>
      </section>
    );
  return (
    <aside className="props" aria-label={t('ui.props.title')} data-testid="properties">
      {body}
    </aside>
  );
}

function NameField({ d }: { d: Device }) {
  const { t } = useTranslation();
  const [v, setV] = useState(d.name);
  useEffect(() => setV(d.name), [d.name, d.id]);
  const save = () => v.trim() && v !== d.name && updateDevice(d.id, (x) => (x.name = v.trim()));
  return (
    <label className="field">
      <span>{t('ui.props.name')}</span>
      <input value={v} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && save()} data-testid="prop-name" />
    </label>
  );
}

function ParamField({ d, p }: { d: Device; p: ParamDef }) {
  const { t } = useTranslation();
  const lang = useApp((s) => s.lang);
  const value = d.params[p.key];
  const label = t(p.labelKey ?? `param.${p.key}`);
  const set = (v: string) => updateDevice(d.id, (x) => (x.params[p.key] = p.kind === 'number' || typeof p.default === 'number' ? Number(v) : v));
  if (p.kind === 'select') {
    return (
      <label className="field">
        <span>{label}</span>
        <select value={String(value)} onChange={(e) => set(e.target.value)} data-testid={`param-${p.key}`}>
          {(p.options ?? []).map((o) => (
            <option key={String(o)} value={String(o)}>
              {p.translatedOptions ? t(`option.${p.key}.${o}`) : typeof o === 'number' ? `${formatNumber(o, lang, 3)}${p.unit ? ' ' + p.unit : ''}` : o}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (p.kind === 'text') {
    return (
      <label className="field">
        <span>{label}</span>
        <TextInput value={String(value ?? '')} onSave={set} />
      </label>
    );
  }
  return (
    <label className="field">
      <span>
        {label}
        {p.unit ? ` (${p.unit})` : ''}
      </span>
      <NumberInput value={Number(value)} min={p.min} max={p.max} step={p.step} onSave={(v) => set(String(v))} />
    </label>
  );
}

function TextInput({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} onKeyDown={(e) => e.key === 'Enter' && v !== value && onSave(v)} />;
}

function NumberInput({ value, min, max, step, onSave }: { value: number; min?: number; max?: number; step?: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const save = () => {
    const x = Number(v.replace(',', '.'));
    if (!Number.isFinite(x)) return setV(String(value));
    const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, x));
    if (c !== value) onSave(c);
    setV(String(c));
  };
  return <input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && save()} />;
}

function DeviceProps({ d }: { d: Device }) {
  const { t } = useTranslation();
  const def = registry.require(d.type);
  const level = useApp((s) => s.project.level);
  const lang = useApp((s) => s.lang);
  const ms = useApp((s) => s.snapshot?.measurements[d.id]) ?? NO_MEAS;
  const whyNot = useApp((s) => (s.whyNot?.device === d.id ? s.whyNot.diagnostic : null));
  const project = useApp((s) => s.project);
  const pro = level === 'pro';
  const wires = project.wires.filter((w) => w.a.device === d.id || w.b.device === d.id);
  const name = (id: string) => project.devices.find((x) => x.id === id)?.name ?? id;
  return (
    <section>
      <h2>{t(`device.${d.type}.name`)}</h2>
      {!pro && <p className="desc">{t(`device.${d.type}.desc`)}</p>}
      {!def.annotation && <NameField d={d} />}
      {!!def.actions?.(d).length && (
        <div className="buttons" role="group" aria-label={t('ui.props.commands')}>
          {def.actions(d)
            .filter((a) => pro || !a.pro)
            .map((a) =>
              a.momentary ? (
                <button key={a.id} onPointerDown={() => operate(d.id, a.id, 'down')} onPointerUp={() => operate(d.id, a.id, 'up')} onPointerLeave={(e) => e.buttons && operate(d.id, a.id, 'up')} data-testid={`action-${a.id}`}>
                  {t(a.labelKey ?? `action.${a.id}`)}
                </button>
              ) : (
                <button key={a.id} onClick={() => operate(d.id, a.id)} data-testid={`action-${a.id}`}>
                  {t(a.labelKey ?? `action.${a.id}`)}
                </button>
              ),
            )}
        </div>
      )}
      {def.load && (
        <div className="whynot">
          <button onClick={() => askWhyNot(d.id)} data-testid="why-not">
            {t('ui.props.whyNot')}
          </button>
          {whyNot && (
            <div className={`diag-card ${whyNot.severity}`} data-testid="why-not-result" data-code={whyNot.code}>
              <strong>{t(whyNot.titleKey, whyNot.values)}</strong>
              <p>{t(whyNot.causeKey, whyNot.values)}</p>
              <p className="hint">{t(whyNot.hintKey, whyNot.values)}</p>
            </div>
          )}
        </div>
      )}
      {def.params.some((p) => !p.hidden) && (
        <>
          <h3>{t('ui.props.params')}</h3>
          {def.params.filter((p) => !p.hidden && (pro || !p.pro)).map((p) => (
            <ParamField key={p.key} d={d} p={p} />
          ))}
        </>
      )}
      {def.editor === 'ladder' && <LadderEditor d={d} ms={ms} />}
      {!!ms.length && (
        <>
          <h3>{t('ui.props.measurements')}</h3>
          <table className="meas" data-testid="measurements">
            <tbody>
              {ms.filter((m) => pro || !m.pro).map((m) => (
                <tr key={m.key} data-key={m.key}>
                  <th>{t(m.key)}</th>
                  <td>{fmtMeasurement(m, lang, t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {!!def.terminals.length && (
        <>
          <h3>{t('ui.props.connections')}</h3>
          <ul className="conn">
            {def.terminals.map((tm) => {
              const ws = wires.filter((w) => (w.a.device === d.id && w.a.terminal === tm.id) || (w.b.device === d.id && w.b.terminal === tm.id));
              return (
                <li key={tm.id}>
                  <b>{tm.label || tm.id}</b>{' '}
                  {ws.length ? (
                    ws.map((w) => {
                      const o = w.a.device === d.id && w.a.terminal === tm.id ? w.b : w.a;
                      return (
                        <button key={w.id} className="link" onClick={() => select({ wires: [w.id] })}>
                          <i className="swatch" style={{ background: WIRE_COLOR[w.conductor] }} /> {name(o.device)}:{o.terminal}
                        </button>
                      );
                    })
                  ) : (
                    <span className="muted">{t('ui.props.free')}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

const NO_MEAS: Measurement[] = [];
const CONDUCTORS: Conductor[] = ['L1', 'L2', 'L3', 'N', 'PE', 'C', 'DC+', 'DC-'];

function WireProps({ w }: { w: Wire }) {
  const { t } = useTranslation();
  const lang = useApp((s) => s.lang);
  const pro = useApp((s) => s.project.level === 'pro');
  const project = useApp((s) => s.project);
  const I = Math.abs(useApp((s) => s.snapshot?.wires[w.id] ?? 0));
  const name = (id: string) => project.devices.find((x) => x.id === id)?.name ?? id;
  const sec = (s: number) => `${formatNumber(s, lang, 2)} mm²`;
  return (
    <section>
      <h2>{t('ui.props.wire')}</h2>
      <p className="desc">
        {name(w.a.device)}:{w.a.terminal} → {name(w.b.device)}:{w.b.terminal}
      </p>
      <label className="field">
        <span>{t('ui.props.conductor')}</span>
        <select value={w.conductor} onChange={(e) => updateWire(w.id, (x) => (x.conductor = e.target.value as Conductor))} data-testid="wire-conductor">
          {CONDUCTORS.map((c) => (
            <option key={c} value={c}>
              {c} · {t(`color.${c}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t('ui.props.section')}</span>
        <select value={w.section} onChange={(e) => updateWire(w.id, (x) => (x.section = Number(e.target.value)))}>
          {SECTIONS.map((s) => (
            <option key={s} value={s}>
              {sec(s)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t('ui.props.length')} (m)</span>
        <NumberInput value={w.length} min={0.1} max={10000} onSave={(v) => updateWire(w.id, (x) => (x.length = v))} />
      </label>
      <label className="field">
        <span>{t('ui.props.material')}</span>
        <select value={w.material} onChange={(e) => updateWire(w.id, (x) => (x.material = e.target.value as 'Cu' | 'Al'))}>
          <option value="Cu">{t('ui.material.Cu')}</option>
          <option value="Al">{t('ui.material.Al')}</option>
        </select>
      </label>
      {pro && (
        <label className="field">
          <span>{t('ui.props.method')}</span>
          <select value={w.method ?? 'B1'} onChange={(e) => updateWire(w.id, (x) => (x.method = e.target.value as 'A1' | 'B1' | 'C'))}>
            {(['A1', 'B1', 'C'] as const).map((m) => (
              <option key={m} value={m}>
                {t(`ui.method.${m}`)}
              </option>
            ))}
          </select>
        </label>
      )}
      <h3>{t('ui.props.ends')}</h3>
      <table className="meas wire-ends">
        <tbody>
          {(['a', 'b'] as const).map((e) => {
            const off = !!w.detached?.includes(e);
            return (
              <tr key={e} data-testid={`wire-end-${e}`} className={off ? 'off' : ''}>
                <th>
                  {name(w[e].device)}:{w[e].terminal}
                </th>
                <td>{off ? t('ui.props.endDetached') : t('ui.props.endConnected')}</td>
                <td>
                  <button className="link small" onClick={() => (off ? attachWireEnd(w.id, e) : detachWireEnd(w.id, e))} data-testid={`wire-end-${e}-toggle`}>
                    {off ? t('ui.props.attachEnd') : t('ui.props.detachEnd')}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h3>{t('ui.props.measurements')}</h3>
      <table className="meas">
        <tbody>
          <tr>
            <th>{t('meas.current')}</th>
            <td>{formatQuantity(I, 'A', lang)}</td>
          </tr>
          <tr>
            <th>{t('ui.props.iz')}</th>
            <td>{formatQuantity(ampacity(w), 'A', lang)}</td>
          </tr>
        </tbody>
      </table>
      <h3>{t('ui.props.faults')}</h3>
      <label className="check">
        <input type="checkbox" checked={!!w.fault?.cut} onChange={(e) => updateWire(w.id, (x) => (x.fault = { ...x.fault, cut: e.target.checked }))} />
        {t('ui.props.cut')}
      </label>
      <label className="field">
        <span>{t('ui.props.contactR')} (Ω)</span>
        <NumberInput value={w.fault?.contactResistance ?? 0} min={0} max={1000} onSave={(v) => updateWire(w.id, (x) => (x.fault = { ...x.fault, contactResistance: v }))} />
      </label>
      <div className="buttons">
        <button className="danger" onClick={deleteSelection}>
          {t('ui.menu.delete')}
        </button>
      </div>
    </section>
  );
}

function ProjectProps() {
  const { t } = useTranslation();
  const P = useApp((s) => s.project);
  const stats = useApp((s) => s.snapshot?.stats);
  const lang = useApp((s) => s.lang);
  return (
    <section>
      <h2>{t('ui.props.project')}</h2>
      <label className="field">
        <span>{t('ui.props.name')}</span>
        <TextInput value={P.name ?? ''} onSave={(v) => commit((x) => (x.name = v))} />
      </label>
      <label className="field">
        <span>{t('ui.props.domain')}</span>
        <select value={P.domain} onChange={(e) => commit((x) => (x.domain = e.target.value as 'domestic' | 'industrial'))}>
          <option value="domestic">{t('domain.domestic')}</option>
          <option value="industrial">{t('domain.industrial')}</option>
        </select>
      </label>
      <label className="field">
        <span>{t('ui.props.level')}</span>
        <select value={P.level} onChange={(e) => commit((x) => (x.level = e.target.value as 'beginner' | 'pro'))} data-testid="project-level">
          <option value="beginner">{t('level.beginner')}</option>
          <option value="pro">{t('level.pro')}</option>
        </select>
      </label>
      <label className="field">
        <span>{t('ui.props.frequency')}</span>
        <select value={P.frequency} onChange={(e) => commit((x) => (x.frequency = Number(e.target.value) as 50 | 60))}>
          <option value={50}>50 Hz</option>
          <option value={60}>60 Hz</option>
        </select>
      </label>
      {stats && (
        <p className="muted small">
          {t('ui.props.stats', { nodes: stats.nodes - 1, ms: formatNumber(stats.solveMs, lang, 2) })}
        </p>
      )}
      <p className="muted small">{t('ui.props.hint')}</p>
    </section>
  );
}
