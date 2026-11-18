/** Formatação das medições e dos tempos no idioma da interface. */
import { formatNumber, formatQuantity, type Lang, type Measurement } from '@faisca/sim-core';
import type { TFunction } from 'i18next';

export function fmtMeasurement(m: Measurement, lang: Lang, t: TFunction): string {
  if (typeof m.value !== 'number') return t(m.value.key, m.value.values ?? {});
  if (!Number.isFinite(m.value)) return '—';
  if (!m.unit) return formatNumber(m.value, lang, 2);
  return formatQuantity(m.value, m.unit, lang);
}

export const fmtTime = (s: number, lang: Lang) => `${formatNumber(s, lang, s < 10 ? 2 : 1)} s`;
