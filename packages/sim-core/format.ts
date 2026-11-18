/** Formatação de grandezas segundo o idioma: `229,8 V` em PT e FR, `229.8 V` em EN. */
import type { Lang } from './project/types';

const LOCALE: Record<Lang, string> = { pt: 'pt-PT', en: 'en-GB', fr: 'fr-FR' };

/** Unidades que levam prefixos SI (m, k, M). */
const SI_UNITS = new Set(['V', 'A', 'W', 'VA', 'var', 'Ω', 'F', 'H', 'Wh']);

const cache = new Map<string, Intl.NumberFormat>();
function nf(lang: Lang, digits: number): Intl.NumberFormat {
  const k = lang + digits;
  let f = cache.get(k);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE[lang], {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
      useGrouping: false,
    });
    cache.set(k, f);
  }
  return f;
}

/** Número com até `digits` casas decimais, no formato do idioma. */
export function formatNumber(v: number, lang: Lang, digits = 2): string {
  return nf(lang, digits).format(Number.isFinite(v) ? v : 0);
}

const digitsFor = (a: number) => (a >= 1000 ? 0 : a >= 10 ? 1 : 2);

/**
 * Grandeza com unidade e prefixo SI: 0,261 A → «261 mA», 771 → «771 A», 6,2 % → «6,2 %».
 * Até 9999 V/W/VA não se usa «k» (é mais legível para alunos).
 */
export function formatQuantity(value: number, unit: string, lang: Lang): string {
  if (!Number.isFinite(value)) return '—';
  const a = Math.abs(value);
  if (!SI_UNITS.has(unit)) {
    return `${formatNumber(value, lang, a >= 100 ? 0 : a >= 10 ? 1 : 2)}${unit ? ' ' + unit : ''}`;
  }
  let m = 1;
  let p = '';
  if (a >= 1e6) {
    m = 1e6;
    p = 'M';
  } else if (a >= 1e4 || (a >= 1e3 && unit === 'Ω')) {
    m = 1e3;
    p = 'k';
  } else if (a > 0 && a < 1e-3) {
    m = 1e-6;
    p = 'µ';
  } else if (a > 0 && a < 1) {
    m = 1e-3;
    p = 'm';
  }
  const x = value / m;
  return `${formatNumber(x, lang, digitsFor(Math.abs(x)))} ${p}${unit}`;
}

export const formatter = (lang: Lang) => (v: number, unit: string) => formatQuantity(v, unit, lang);
