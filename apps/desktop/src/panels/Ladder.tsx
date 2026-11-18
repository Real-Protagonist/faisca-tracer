/**
 * Editor de ladder do autómato. Cada degrau tem colunas em série; cada coluna tem contactos em
 * paralelo; à direita, uma bobina. Os contactos que conduzem ficam a verde durante a simulação.
 */
import { useTranslation } from 'react-i18next';
import {
  COIL_TARGETS,
  parseLadder,
  PLC_COUNTERS,
  PLC_INPUTS,
  PLC_MEMORY,
  PLC_OUTPUTS,
  PLC_TIMERS,
  serializeLadder,
  type CoilKind,
  type Device,
  type LadderProgram,
  type LadderRung,
  type Measurement,
} from '@faisca/sim-core';
import { updateDevice } from '../store';

const RANGE: Record<string, number> = { I: PLC_INPUTS, Q: PLC_OUTPUTS, M: PLC_MEMORY, T: PLC_TIMERS, C: PLC_COUNTERS };
const operands = (kinds: string) => [...kinds].flatMap((k) => Array.from({ length: RANGE[k]! }, (_, n) => k + n));
const ALL = operands('IQMTC');
const KINDS: CoilKind[] = ['out', 'set', 'reset', 'ton', 'tof', 'ctu', 'res'];
/** Chaves literais (o teste de traduções encontra-as no código). */
const KIND_KEY: Record<CoilKind, string> = {
  out: 'ui.ladder.kind.out',
  set: 'ui.ladder.kind.set',
  reset: 'ui.ladder.kind.reset',
  ton: 'ui.ladder.kind.ton',
  tof: 'ui.ladder.kind.tof',
  ctu: 'ui.ladder.kind.ctu',
  res: 'ui.ladder.kind.res',
};

/** Imagem de bits a partir das medições do autómato («1000 0000» → [true, false…]). */
function image(ms: Measurement[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const read = (key: string, prefix: string) => {
    const m = ms.find((x) => x.key === key);
    const bits = typeof m?.value === 'object' ? (m.value.values?.bits ?? '') : '';
    [...bits.replace(/\s/g, '')].forEach((b, k) => (out[prefix + k] = b === '1'));
  };
  read('meas.inputs', 'I');
  read('meas.outputs', 'Q');
  read('meas.memory', 'M');
  read('meas.timers', 'T');
  return out;
}

export function LadderEditor({ d, ms }: { d: Device; ms: Measurement[] }) {
  const { t } = useTranslation();
  const prog = parseLadder(d.params.program);
  const live = image(ms);
  const save = (f: (p: LadderProgram) => void) => {
    const p = structuredClone(prog);
    f(p);
    updateDevice(d.id, (x) => (x.params.program = serializeLadder(p)));
  };
  const on = (op: string, nc?: boolean) => (live[op] ?? false) !== !!nc;

  return (
    <div className="ladder" data-testid="ladder">
      <h3>{t('ui.ladder.title')}</h3>
      <p className="desc">{t('ui.ladder.hint')}</p>
      {!prog.rungs.length && <p className="muted">{t('ui.ladder.empty')}</p>}
      {prog.rungs.map((r, i) => (
        <div className="rung" key={i} data-testid={`rung-${i}`}>
          <div className="rung-head">
            <b>{t('ui.ladder.rung', { n: i + 1 })}</b>
            <button className="link" onClick={() => save((p) => p.rungs.splice(i, 1))} aria-label={t('ui.ladder.removeRung')}>
              ✕
            </button>
          </div>
          <RungView r={r} on={on} coilOn={!!live[r.coil.op]} />
          <div className="cols">
            {r.cols.map((col, j) => (
              <div className="col" key={j}>
                {col.map((c, k) => (
                  <div className="contact" key={k}>
                    <select
                      value={c.op}
                      onChange={(e) => save((p) => (p.rungs[i]!.cols[j]![k]!.op = e.target.value))}
                      aria-label={t('ui.ladder.operand')}
                      data-testid={`op-${i}-${j}-${k}`}
                    >
                      {ALL.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                    <button
                      className={c.nc ? 'nc active' : 'nc'}
                      onClick={() => save((p) => {
                        const x = p.rungs[i]!.cols[j]![k]!;
                        if (x.nc) delete x.nc;
                        else x.nc = true;
                      })}
                      title={t('ui.ladder.toggle')}
                      data-testid={`nc-${i}-${j}-${k}`}
                    >
                      {c.nc ? t('ui.ladder.nc') : t('ui.ladder.no')}
                    </button>
                    <button
                      className="link"
                      onClick={() => save((p) => {
                        p.rungs[i]!.cols[j]!.splice(k, 1);
                        if (!p.rungs[i]!.cols[j]!.length) p.rungs[i]!.cols.splice(j, 1);
                      })}
                      aria-label={t('ui.ladder.removeContact')}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button className="link small" onClick={() => save((p) => p.rungs[i]!.cols[j]!.push({ op: 'I0' }))} data-testid={`par-${i}-${j}`}>
                  {t('ui.ladder.addParallel')}
                </button>
              </div>
            ))}
            <button className="link small" onClick={() => save((p) => p.rungs[i]!.cols.push([{ op: 'I0' }]))} data-testid={`ser-${i}`}>
              {t('ui.ladder.addSeries')}
            </button>
          </div>
          <div className="coil-row">
            <span>{t('ui.ladder.coil')}</span>
            <select
              value={r.coil.kind}
              onChange={(e) => save((p) => {
                const kind = e.target.value as CoilKind;
                const c = p.rungs[i]!.coil;
                c.kind = kind;
                if (!COIL_TARGETS[kind].includes(c.op[0]!)) c.op = COIL_TARGETS[kind][0] + '0';
                if ((kind === 'ton' || kind === 'tof' || kind === 'ctu') && !c.preset) c.preset = kind === 'ctu' ? 3 : 5;
              })}
              data-testid={`kind-${i}`}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(KIND_KEY[k])}
                </option>
              ))}
            </select>
            <select value={r.coil.op} onChange={(e) => save((p) => (p.rungs[i]!.coil.op = e.target.value))} aria-label={t('ui.ladder.operand')} data-testid={`coil-${i}`}>
              {operands(COIL_TARGETS[r.coil.kind]).map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
            {(r.coil.kind === 'ton' || r.coil.kind === 'tof' || r.coil.kind === 'ctu') && (
              <input
                className="preset"
                type="number"
                min={r.coil.kind === 'ctu' ? 1 : 0.1}
                step={r.coil.kind === 'ctu' ? 1 : 0.1}
                value={r.coil.preset ?? 1}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v > 0) save((p) => (p.rungs[i]!.coil.preset = v));
                }}
                aria-label={r.coil.kind === 'ctu' ? t('ui.ladder.presetCount') : t('ui.ladder.presetTime')}
              />
            )}
          </div>
        </div>
      ))}
      <button onClick={() => save((p) => p.rungs.push({ cols: [[{ op: 'I0' }]], coil: { kind: 'out', op: 'Q0' } }))} data-testid="add-rung">
        {t('ui.ladder.addRung')}
      </button>
    </div>
  );
}

/** Desenho do degrau: barras laterais, contactos (NA ‖, NF ‖ com traço) e bobina ( ). */
function RungView({ r, on, coilOn }: { r: LadderRung; on: (op: string, nc?: boolean) => boolean; coilOn: boolean }) {
  const CW = 46;
  const rows = Math.max(1, ...r.cols.map((c) => c.length));
  const w = 16 + r.cols.length * CW + 60;
  const h = 14 + rows * 26;
  const y0 = 18;
  const parts: JSX.Element[] = [];
  let x = 10;
  r.cols.forEach((col, j) => {
    const colOn = col.some((c) => on(c.op, c.nc));
    col.forEach((c, k) => {
      const y = y0 + k * 26;
      const cls = on(c.op, c.nc) ? 'lad on' : 'lad';
      parts.push(
        <g key={`${j}-${k}`}>
          <path className={cls} d={`M${x} ${y} H${x + 14} M${x + 14} ${y - 7} V${y + 7} M${x + 26} ${y - 7} V${y + 7} M${x + 26} ${y} H${x + CW}`} />
          {c.nc && <path className={cls} d={`M${x + 12} ${y + 7} L${x + 28} ${y - 7}`} />}
          <text className="lad-txt" x={x + 20} y={y - 10} textAnchor="middle">
            {c.op}
          </text>
        </g>,
      );
    });
    if (col.length > 1) parts.push(<path key={`v${j}`} className={colOn ? 'lad on' : 'lad'} d={`M${x} ${y0} V${y0 + (col.length - 1) * 26} M${x + CW} ${y0} V${y0 + (col.length - 1) * 26}`} />);
    x += CW;
  });
  const cx = x + 26;
  return (
    <svg className="rung-svg" viewBox={`0 0 ${Math.max(w, 120)} ${h}`} width="100%" height={h} aria-hidden>
      <path className="lad rail" d={`M4 4 V${h - 4} M${Math.max(w, 120) - 4} 4 V${h - 4}`} />
      <path className="lad" d={`M4 ${y0} H10`} />
      {parts}
      <path className={coilOn ? 'lad on' : 'lad'} d={`M${x} ${y0} H${cx - 10} M${cx + 10} ${y0} H${Math.max(w, 120) - 4}`} />
      <path className={coilOn ? 'lad on' : 'lad'} d={`M${cx - 6} ${y0 - 9} q-6 9 0 18 M${cx + 6} ${y0 - 9} q6 9 0 18`} />
      <text className="lad-txt" x={cx} y={y0 - 12} textAnchor="middle">
        {r.coil.kind === 'out' ? r.coil.op : `${r.coil.kind.toUpperCase()} ${r.coil.op}`}
      </text>
    </svg>
  );
}
