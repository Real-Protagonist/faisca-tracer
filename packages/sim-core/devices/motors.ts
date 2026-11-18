/** Motores domésticos: motor monofásico de indução (bomba de água, compressor). */
import { rms } from '../solver/complex';
import { loadReading, m, ms, num, p, ps, sel } from './common';
import type { DeviceDef } from './types';

type Phase = 'stopped' | 'starting' | 'running';

interface MotorRT {
  phase?: Phase;
  tStart?: number;
}

/** Tempo de arranque pela inércia da carga (s). */
export const START_TIME: Record<string, number> = { low: 0.3, medium: 0.8, high: 2 };
/** Factor de potência com o rotor bloqueado. */
const LOCKED_PF = 0.4;
const VN = 230;

/** Corrente nominal: I = P / (U · η · cos φ). */
export const motor1Rated = (Pkw: number, eta: number, pf: number, V = VN) => (Pkw * 1000) / (V * eta * pf);

export const motor1ph: DeviceDef<MotorRT> = {
  type: 'motor1ph',
  category: 'motors',
  domain: ['domestic'],
  level: 'beginner',
  prefix: 'M',
  size: { w: 80, h: 90 },
  terminals: [
    { id: 'L', x: 20, y: 0, kind: 'L', label: 'L' },
    { id: 'N', x: 40, y: 0, kind: 'N', label: 'N' },
    { id: 'PE', x: 60, y: 0, kind: 'PE', label: 'PE' },
  ],
  params: [
    sel('Pm', [0.37, 0.55, 0.75, 1.1, 1.5, 2.2], 0.75, 'kW'),
    num('PF', 0.8, '', 0.5, 1, 0.01, true),
    num('eta', 0.78, '', 0.4, 0.98, 0.01, true),
    num('kStart', 6, '', 3, 8, 0.5, true),
    sel('inertia', ['low', 'medium', 'high'], 'medium', undefined, true, true),
  ],
  initialState: () => ({}),
  classI: true,
  load: {
    phase: 'L',
    neutral: 'N',
    nominalVoltage: () => VN,
    working: (_d, _sol, rt: MotorRT) => rt.phase === 'running',
  },
  stamp(d, b, rt) {
    const pf = p(d, 'PF');
    const S = (p(d, 'Pm') * 1000) / (p(d, 'eta') * pf);
    const Z = (VN * VN) / S;
    if (rt.phase === 'starting') {
      const Zl = Z / p(d, 'kStart');
      b.Z(b.node('L'), b.node('N'), { R: Zl * LOCKED_PF, L: (Zl * Math.sqrt(1 - LOCKED_PF ** 2)) / b.omega }, 'z');
    } else {
      b.Z(b.node('L'), b.node('N'), { R: Z * pf, L: (Z * Math.sqrt(1 - pf * pf)) / b.omega }, 'z');
    }
  },
  logic(d, ctx, rt) {
    const V = rms(ctx.sol.vv(d, 'L', 'N'));
    const phase = rt.phase ?? 'stopped';
    if (V < 0.3 * VN) {
      rt.phase = 'stopped';
      return phase !== 'stopped';
    }
    if (phase === 'stopped') {
      rt.phase = 'starting';
      rt.tStart = 0;
      return true;
    }
    if (phase === 'starting') {
      if (V >= 0.7 * VN) rt.tStart = (rt.tStart ?? 0) + ctx.dt;
      if ((rt.tStart ?? 0) >= (START_TIME[ps(d, 'inertia')] ?? 0.8)) {
        rt.phase = 'running';
        ctx.emit({ code: 'motor_running', severity: 'info', values: { device: d.name } });
        return true;
      }
      return false;
    }
    // Em marcha: tensão muito baixa faz o motor perder velocidade e bloquear.
    if (V < 0.6 * VN) {
      rt.phase = 'starting';
      rt.tStart = 0;
      ctx.emit({ code: 'motor_stalled', severity: 'warning', values: { device: d.name, voltage: ctx.fmt(V, 'V') } });
      return true;
    }
    return false;
  },
  measure(d, sol, rt) {
    const L = loadReading(sol, d, 'L', 'N', 'z');
    const spd = rt.phase === 'running' ? 1 : rt.phase === 'starting' ? Math.min(1, (rt.tStart ?? 0) / (START_TIME[ps(d, 'inertia')] ?? 0.8)) : 0;
    return [
      ms('meas.state', rt.phase ?? 'stopped'),
      ...L.rows,
      m('meas.speed', 1450 * spd, 'rpm', true),
      m('meas.ratedCurrent', motor1Rated(p(d, 'Pm'), p(d, 'eta'), p(d, 'PF')), 'A', true),
    ];
  },
  model3d: 'motor',
  simplifications: ['simpl.motor1_two_state'],
};

export const motors = [motor1ph];
