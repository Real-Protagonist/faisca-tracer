/** Desenha em SVG as primitivas de um símbolo do núcleo. */
import type { Prim } from '@faisca/sim-core';

function PrimView({ p }: { p: Prim }) {
  switch (p.t) {
    case 'line':
      return <line className={p.cls ?? 'sl'} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} />;
    case 'circle':
      return <circle className={p.cls ?? 'sl'} cx={p.cx} cy={p.cy} r={p.r} style={p.fill ? { fill: p.fill } : undefined} />;
    case 'rect':
      return <rect className={p.cls ?? 'sl'} x={p.x} y={p.y} width={Math.max(0, p.w)} height={Math.max(0, p.h)} rx={p.rx ?? 0} style={p.fill ? { fill: p.fill } : undefined} />;
    case 'ellipse':
      return <ellipse className={p.cls ?? 'sl'} cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} />;
    case 'path':
      return <path className={p.cls ?? 'sl'} d={p.d} style={p.fill ? { fill: p.fill } : undefined} />;
    case 'text':
      return (
        <text className={p.cls ?? 'txt'} x={p.x} y={p.y} textAnchor={p.anchor ?? 'middle'}>
          {p.text}
        </text>
      );
    case 'rotor': {
      const items = p.items.map((q, i) => <PrimView key={i} p={q} />);
      if (p.spin < 0.02) return <g>{items}</g>;
      // Uma volta por segundo à velocidade nominal (animação, não a velocidade real).
      const dur = `${(1 / p.spin).toFixed(2)}s`;
      return (
        <g>
          <animateTransform attributeName="transform" type="rotate" from={`0 ${p.cx} ${p.cy}`} to={`${360 * p.dir} ${p.cx} ${p.cy}`} dur={dur} repeatCount="indefinite" />
          {items}
        </g>
      );
    }
  }
}

export function SymbolView({ prims }: { prims: Prim[] }) {
  return (
    <>
      {prims.map((p, i) => (
        <PrimView key={i} p={p} />
      ))}
    </>
  );
}
