/**
 * Valores indicativos da IEC 60364 usados no cálculo e na verificação.
 * Configuráveis por país (ver `RuleSet`). O Faísca Tracer é didáctico: não substitui o projecto regulamentar.
 */
import type { InstallMethod, Material, Wire } from '../project/types';

/** Resistividade a 70 °C (Ω·mm²/m). */
export const RESISTIVITY: Record<Material, number> = { Cu: 0.0225, Al: 0.036 };
/** Reactância linear dos cabos (Ω/m), usada no perfil Profissional. */
export const CABLE_REACTANCE = 0.08e-3;

/** Secções normalizadas (mm²). */
export const SECTIONS = [1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240] as const;

/**
 * Corrente admissível Iz (A), cobre, isolamento PVC, 2 condutores carregados, 30 °C
 * (IEC 60364-5-52, quadro B.52.2). 1 mm² extrapolado.
 */
const IZ_CU: Record<InstallMethod, Record<number, number>> = {
  A1: { 1: 11, 1.5: 14.5, 2.5: 19.5, 4: 26, 6: 34, 10: 46, 16: 61, 25: 80, 35: 99, 50: 119, 70: 151, 95: 182, 120: 210, 150: 240, 185: 273, 240: 321 },
  B1: { 1: 13.5, 1.5: 17.5, 2.5: 24, 4: 32, 6: 41, 10: 57, 16: 76, 25: 101, 35: 125, 50: 151, 70: 192, 95: 232, 120: 269, 150: 309, 185: 353, 240: 415 },
  C: { 1: 15, 1.5: 19.5, 2.5: 27, 4: 36, 6: 46, 10: 63, 16: 85, 25: 112, 35: 138, 50: 168, 70: 213, 95: 258, 120: 299, 150: 344, 185: 392, 240: 461 },
};
/** Alumínio ≈ 78 % do cobre (simplificação). */
const AL_FACTOR = 0.78;

/** Corrente admissível do cabo (A). Secções fora da tabela usam a secção normalizada abaixo. */
export function ampacity(w: Pick<Wire, 'section' | 'material' | 'method'>): number {
  const table = IZ_CU[w.method ?? 'B1'];
  let iz = table[w.section];
  if (iz === undefined) {
    const below = SECTIONS.filter((s) => s <= w.section);
    iz = below.length ? table[below[below.length - 1]!]! : 0;
  }
  return iz * (w.material === 'Al' ? AL_FACTOR : 1);
}

/** Resistência de um condutor do cabo: R = ρ · L / S. */
export function wireResistance(w: Pick<Wire, 'length' | 'section' | 'material'>): number {
  return (RESISTIVITY[w.material] * w.length) / Math.max(w.section, 0.01);
}

/** Regras de verificação, configuráveis por país num ficheiro de regras. */
export interface RuleSet {
  id: string;
  /** Queda de tensão máxima desde a origem (%). */
  maxDropLighting: number;
  maxDropOther: number;
  /** IΔn máximo nos circuitos de tomadas e casas de banho (mA). */
  maxRcdSockets: number;
  /** Tensão de contacto limite convencional UL (V): Ra × IΔn ≤ UL. */
  touchVoltageLimit: number;
  /** Corrente no corpo a partir da qual a situação é perigosa (A). */
  dangerousBodyCurrent: number;
}

export const IEC_RULES: RuleSet = {
  id: 'iec-60364',
  maxDropLighting: 3,
  maxDropOther: 5,
  maxRcdSockets: 30,
  touchVoltageLimit: 50,
  dangerousBodyCurrent: 0.03,
};

/** Calibres normalizados de disjuntores (A). */
export const MCB_RATINGS = [1, 2, 3, 4, 6, 10, 13, 16, 20, 25, 32, 40, 50, 63] as const;
/** Calibres normalizados de fusíveis gG (A). */
export const FUSE_RATINGS = [2, 4, 6, 10, 16, 20, 25, 32, 40, 50, 63] as const;

/**
 * Zonas tempo-corrente da IEC 60479-1 (AC 15–100 Hz, mão–pés), aproximação indicativa
 * das curvas b e c1 por interpolação log-log. Pontos: [tempo (s), corrente (A)].
 */
const CURVE_B: [number, number][] = [[0.01, 0.2], [0.1, 0.1], [0.5, 0.025], [2, 0.01], [1e4, 0.01]];
const CURVE_C1: [number, number][] = [[0.01, 0.5], [0.1, 0.4], [0.5, 0.1], [1, 0.05], [3, 0.04], [1e4, 0.04]];

function logInterp(curve: [number, number][], t: number): number {
  const tt = Math.max(curve[0]![0], Math.min(t, curve[curve.length - 1]![0]));
  for (let i = 1; i < curve.length; i++) {
    const [t1, i1] = curve[i - 1]!;
    const [t2, i2] = curve[i]!;
    if (tt <= t2) {
      const f = Math.log(tt / t1) / Math.log(t2 / t1);
      return Math.exp(Math.log(i1) + f * Math.log(i2 / i1));
    }
  }
  return curve[curve.length - 1]![1];
}

export type BodyZone = 'AC-1' | 'AC-2' | 'AC-3' | 'AC-4';

/** Zona de efeito da corrente no corpo, pela corrente (A) e pelo tempo de exposição (s). */
export function bodyZone(current: number, seconds: number): BodyZone {
  if (current < 0.0005) return 'AC-1';
  const t = Math.max(seconds, 0.01);
  if (current <= logInterp(CURVE_B, t)) return 'AC-2';
  if (current <= logInterp(CURVE_C1, t)) return 'AC-3';
  return 'AC-4';
}
