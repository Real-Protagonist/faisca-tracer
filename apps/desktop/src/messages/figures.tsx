/**
 * Figuras didácticas do «Saber mais». Só têm símbolos e marcações normalizadas (L, N, PE, V, A),
 * que não se traduzem.
 */
const C = { L: '#8b5a2b', N: '#2f6fd6', PE: '#2e9e44', bad: '#d64545', ink: '#263040', hot: '#ff8a3d' };

const Source = ({ x = 30, y = 60 }) => (
  <g>
    <circle cx={x} cy={y} r={16} fill="#fff" stroke={C.ink} strokeWidth={2} />
    <path d={`M${x - 9} ${y} q4.5 -9 9 0 t9 0`} fill="none" stroke={C.ink} strokeWidth={2} />
  </g>
);
const Lamp = ({ x = 200, y = 60, lit = false }) => (
  <g>
    <circle cx={x} cy={y} r={14} fill={lit ? '#ffe27a' : '#fff'} stroke={C.ink} strokeWidth={2} />
    <path d={`M${x - 10} ${y - 10} L${x + 10} ${y + 10} M${x + 10} ${y - 10} L${x - 10} ${y + 10}`} stroke={C.ink} strokeWidth={1.6} />
  </g>
);
const Label = ({ x, y, t, c = C.ink }: { x: number; y: number; t: string; c?: string }) => (
  <text x={x} y={y} fontSize={12} fontWeight={600} fill={c}>
    {t}
  </text>
);
const Arrow = ({ d, c }: { d: string; c: string }) => <path d={d} fill="none" stroke={c} strokeWidth={2} markerEnd="url(#fig-arrow)" />;
const Break = ({ x, y }: { x: number; y: number }) => (
  <path d={`M${x - 7} ${y - 7} L${x + 7} ${y + 7} M${x + 7} ${y - 7} L${x - 7} ${y + 7}`} stroke={C.bad} strokeWidth={3} />
);
const Earth = ({ x, y }: { x: number; y: number }) => (
  <g stroke={C.PE} strokeWidth={2.5}>
    <path d={`M${x} ${y - 12} V${y}`} />
    <path d={`M${x - 12} ${y} H${x + 12} M${x - 8} ${y + 5} H${x + 8} M${x - 4} ${y + 10} H${x + 4}`} />
  </g>
);

/** Corrente de ida pela fase e volta pelo neutro; um X marca onde o circuito abre. */
function Loop({ open }: { open: boolean }) {
  return (
    <>
      <Source />
      <path d="M30 44 V20 H200 V46" fill="none" stroke={C.L} strokeWidth={3} />
      <path d="M30 76 V100 H200 V74" fill="none" stroke={C.N} strokeWidth={3} />
      <Lamp lit={!open} />
      <Label x={60} y={15} t="L" c={C.L} />
      <Label x={60} y={118} t="N" c={C.N} />
      {open ? <Break x={200} y={88} /> : <Arrow d="M90 20 H140" c={C.hot} />}
      {!open && <Arrow d="M140 100 H90" c={C.hot} />}
    </>
  );
}

function Short() {
  return (
    <>
      <Source />
      <path d="M30 44 V20 H140 V100 H30 V76" fill="none" stroke={C.L} strokeWidth={3} />
      <path d="M140 100 H30" fill="none" stroke={C.N} strokeWidth={3} />
      <path d="M128 50 l14 12 h-10 l14 14" fill="none" stroke={C.bad} strokeWidth={3} />
      <Label x={160} y={64} t="I ≫ In" c={C.bad} />
      <Lamp x={220} y={60} />
    </>
  );
}

function Overload() {
  return (
    <>
      <Source />
      <path d="M30 44 V20 H250" fill="none" stroke={C.L} strokeWidth={3} />
      <path d="M30 76 V104 H250" fill="none" stroke={C.N} strokeWidth={3} />
      {[90, 150, 210].map((x) => (
        <g key={x}>
          <path d={`M${x} 20 V44 M${x} 76 V104`} stroke={C.ink} strokeWidth={2} />
          <rect x={x - 12} y={44} width={24} height={32} fill="#ffd9c2" stroke={C.ink} strokeWidth={2} />
        </g>
      ))}
      <rect x={52} y={6} width={18} height={28} rx={9} fill="#fff" stroke={C.bad} strokeWidth={2} />
      <rect x={58} y={14} width={6} height={18} fill={C.bad} />
      <Label x={238} y={14} t="I > In" c={C.bad} />
    </>
  );
}

function Residual() {
  return (
    <>
      <Source />
      <ellipse cx={95} cy={60} rx={14} ry={40} fill="none" stroke={C.ink} strokeWidth={2} />
      <path d="M30 44 V30 H200 V60" fill="none" stroke={C.L} strokeWidth={3} />
      <path d="M30 76 V90 H200 V70" fill="none" stroke={C.N} strokeWidth={3} />
      <Label x={120} y={24} t="I₁" c={C.L} />
      <Label x={120} y={106} t="I₂ < I₁" c={C.N} />
      <Arrow d="M200 60 L240 110" c={C.bad} />
      <Earth x={250} y={118} />
      <Label x={210} y={88} t="IΔ" c={C.bad} />
    </>
  );
}

function EarthFig({ person }: { person: boolean }) {
  return (
    <>
      <Source />
      <path d="M30 44 V20 H170" fill="none" stroke={C.L} strokeWidth={3} />
      <rect x={150} y={30} width={60} height={50} rx={4} fill="#eef1f5" stroke={C.ink} strokeWidth={2} />
      <path d="M170 20 V48 l8 6 -8 6" fill="none" stroke={C.bad} strokeWidth={2.5} />
      {person ? (
        <g stroke={C.bad} strokeWidth={2.4} fill="none" strokeLinecap="round">
          <circle cx={245} cy={34} r={6} />
          <path d="M245 40 V66 M245 66 L238 86 M245 66 L252 86 M245 48 L212 56" />
          <Earth x={245} y={104} />
        </g>
      ) : (
        <g>
          <path d="M210 70 H250 V96" fill="none" stroke={C.PE} strokeWidth={3} strokeDasharray="6 4" />
          <Earth x={250} y={110} />
          <Label x={214} y={64} t="PE" c={C.PE} />
        </g>
      )}
    </>
  );
}

function SwitchNeutral() {
  return (
    <>
      <Source />
      <path d="M30 44 V20 H200 V46" fill="none" stroke={C.L} strokeWidth={3} />
      <path d="M30 76 V100 H110 M130 100 H200 V74" fill="none" stroke={C.N} strokeWidth={3} />
      <path d="M110 100 L128 88" stroke={C.ink} strokeWidth={2.5} />
      <Lamp />
      <Label x={110} y={118} t="N" c={C.N} />
      <path d="M220 40 l10 -8 m-6 14 l12 -2" stroke={C.bad} strokeWidth={2.5} />
      <Label x={226} y={70} t="230 V" c={C.bad} />
    </>
  );
}

function Drop() {
  return (
    <>
      <Source />
      <path d="M30 44 V20 H250 V46" fill="none" stroke={C.L} strokeWidth={3} />
      <path d="M30 76 V100 H250 V74" fill="none" stroke={C.N} strokeWidth={3} />
      <Lamp x={250} y={60} lit />
      {[70, 120, 170, 220].map((x, i) => (
        <rect key={x} x={x - 6} y={40 + i * 6} width={12} height={40 - i * 12 + 12} fill={C.hot} opacity={0.8} />
      ))}
      <Label x={80} y={118} t="ΔU = I · 2R" />
    </>
  );
}

function Voltage() {
  return (
    <>
      <Source />
      <Label x={10} y={100} t="230 V" />
      <path d="M30 44 V20 H200 V46 M30 76 V100 H200 V74" fill="none" stroke={C.L} strokeWidth={3} />
      <Lamp />
      <Label x={190} y={102} t="12 V" c={C.bad} />
      <path d="M220 36 l12 -10 M222 60 h16 M220 84 l12 10" stroke={C.bad} strokeWidth={2.5} />
    </>
  );
}

function Colours() {
  return (
    <>
      {[
        ['L', C.L, 30],
        ['N', C.N, 65],
        ['PE', C.PE, 100],
      ].map(([t, c, y]) => (
        <g key={t as string}>
          <path d={`M60 ${y} H250`} stroke={c as string} strokeWidth={5} />
          {t === 'PE' && <path d={`M60 ${y} H250`} stroke="#f2d32a" strokeWidth={5} strokeDasharray="10 10" />}
          <Label x={20} y={(y as number) + 4} t={t as string} c={c as string} />
        </g>
      ))}
    </>
  );
}

/** Motor trifásico com uma das três fases cortada. */
function PhaseLoss() {
  const cs = [C.L, '#262626', '#8a8f96'];
  return (
    <>
      {[0, 1, 2].map((k) => (
        <g key={k}>
          <path d={`M20 ${28 + 30 * k} H${k === 2 ? 120 : 196}`} fill="none" stroke={cs[k]} strokeWidth={3} />
          <Label x={2} y={32 + 30 * k} t={`L${k + 1}`} c={cs[k]} />
        </g>
      ))}
      <path d="M150 88 H196" fill="none" stroke={cs[2]} strokeWidth={3} strokeDasharray="5 4" />
      <Break x={135} y={88} />
      <circle cx={226} cy={58} r={28} fill="#fff" stroke={C.ink} strokeWidth={2} />
      <Label x={216} y={58} t="M" />
      <Label x={214} y={74} t="3~" />
    </>
  );
}

/** Auto-retenção: contacto 13-14 do contactor em paralelo com o botão de marcha. */
function SelfHold() {
  return (
    <>
      <path d="M20 20 V104" stroke={C.L} strokeWidth={3} />
      <path d="M260 20 V104" stroke={C.N} strokeWidth={3} />
      <path d="M20 44 H80 M110 44 H180" fill="none" stroke={C.ink} strokeWidth={2} />
      <path d="M80 44 L106 34" stroke={C.ink} strokeWidth={2} />
      <Label x={84} y={28} t="S1" />
      <path d="M60 44 V84 H80 M110 84 H130 V44" fill="none" stroke={C.hot} strokeWidth={2.5} />
      <path d="M80 84 L106 74" stroke={C.hot} strokeWidth={2.5} />
      <Label x={76} y={104} t="K1 13-14" c={C.hot} />
      <rect x={180} y={32} width={40} height={24} fill="#d9f5e3" stroke={C.ink} strokeWidth={2} />
      <Label x={190} y={49} t="K1" />
      <path d="M220 44 H260" stroke={C.ink} strokeWidth={2} />
    </>
  );
}

/** Bobina com a tensão errada. */
function CoilFig() {
  return (
    <>
      <Source />
      <path d="M46 60 H110 M170 60 H240" fill="none" stroke={C.L} strokeWidth={3} />
      <rect x={110} y={44} width={60} height={32} fill="#fff" stroke={C.ink} strokeWidth={2} />
      <Label x={122} y={65} t="A1 A2" />
      <Label x={110} y={30} t="Uc = ?" c={C.bad} />
    </>
  );
}

/** Contacto NF que alimenta a própria bobina: abre, a bobina cai, volta a fechar… */
function Oscillation() {
  return (
    <>
      <path d="M20 60 H70 M100 60 H150" fill="none" stroke={C.L} strokeWidth={3} />
      <path d="M70 60 L96 50 M96 44 V60" stroke={C.ink} strokeWidth={2} />
      <Label x={64} y={86} t="21-22" />
      <rect x={150} y={44} width={40} height={32} fill="#fff" stroke={C.ink} strokeWidth={2} />
      <Label x={160} y={65} t="K1" />
      <path d="M190 60 H240" stroke={C.N} strokeWidth={3} />
      <path d="M170 40 C170 10 84 10 84 40" fill="none" stroke={C.hot} strokeWidth={2} markerEnd="url(#fig-arrow)" />
    </>
  );
}

const FIGS: Record<string, () => JSX.Element> = {
  LOAD_NO_RETURN: () => <Loop open />,
  LOAD_NO_SUPPLY: () => <Loop open />,
  PATH_OPEN: () => <Loop open />,
  WIRE_CUT: () => <Loop open />,
  TERMINAL_UNCONNECTED: () => <Loop open />,
  SOURCE_OFF: () => <Loop open />,
  LOAD_OK: () => <Loop open={false} />,
  SOURCE_SHORT: Short,
  MCB_MAGNETIC_TRIP: Short,
  MCB_BREAKING_CAPACITY: Short,
  FUSE_BLOWN: Short,
  MCB_THERMAL_TRIP: Overload,
  CABLE_OVERLOAD: Overload,
  CABLE_UNPROTECTED: Overload,
  LOOSE_CONNECTION: Overload,
  RCD_TRIP: Residual,
  PE_MISSING: () => <EarthFig person={false} />,
  BODY_CURRENT: () => <EarthFig person />,
  SWITCH_ON_NEUTRAL: SwitchNeutral,
  VOLTAGE_DROP: Drop,
  LOW_VOLTAGE: Drop,
  WRONG_VOLTAGE: Voltage,
  WIRE_COLOR: Colours,
  LOAD_PHASE_PHASE: Voltage,
  MOTOR_PHASE_LOSS: PhaseLoss,
  OVERLOAD_PHASE_LOSS: PhaseLoss,
  MOTOR_NO_HOLD: SelfHold,
  COIL_VOLTAGE: CoilFig,
  COIL_OFF: CoilFig,
  CONTROL_UNSTABLE: Oscillation,
  MOTOR_OVERLOAD: Overload,
  MOTOR_OVERHEATED: Overload,
  MOTOR_STALLED: Overload,
  VFD_UNDERVOLTAGE: PhaseLoss,
};

export function Figure({ code }: { code: string }) {
  const F = FIGS[code] ?? (() => <Loop open={false} />);
  return (
    <svg className="figure" viewBox="0 0 280 124" role="img" aria-hidden>
      <defs>
        <marker id="fig-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill={C.hot} />
        </marker>
      </defs>
      <F />
    </svg>
  );
}
