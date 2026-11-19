/** Formatação das medições e dos tempos no idioma da interface. */
import { formatNumber, formatQuantity, type Lang, type Measurement } from '@faisca/sim-core';
import type { TFunction } from 'i18next';

export function fmtMeasurement(m: Measurement, lang: Lang, t: TFunction): string {
  if (typeof m.value !== 'number') return t(m.value.key, m.value.values ?? {});
  if (!Number.isFinite(m.value)) return '—';
  if (!m.unit) return formatNumber(m.value, lang, 2);
  return formatQuantity(m.value, m.unit, lang);
}

/**
 * Relógio da simulação em formato de hora: «00:02:35». Com `tenths`, acrescenta as décimas
 * («00:02:35,4»), para se ver o avanço de 0,1 s no modo passo a passo.
 */
export function fmtClock(seconds: number, tenths: boolean, lang: Lang): string {
  const d = Math.max(0, Math.round(seconds * 10));
  const s = Math.floor(d / 10);
  const hms = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((x) => String(x).padStart(2, '0')).join(':');
  return tenths ? `${hms}${lang === 'en' ? '.' : ','}${d % 10}` : hms;
}
