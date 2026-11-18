/** Traduções: o texto visível sai todo de packages/i18n/{pt,en,fr}.json. */
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import pt from '@faisca/i18n/pt.json';
import en from '@faisca/i18n/en.json';
import fr from '@faisca/i18n/fr.json';
import type { Lang } from '@faisca/sim-core';

const PREF_KEY = 'faisca.lang';

/** Idioma guardado nas preferências ou, na primeira abertura, o do sistema operativo. */
export function preferredLang(): Lang {
  try {
    const saved = localStorage.getItem(PREF_KEY);
    if (saved === 'pt' || saved === 'en' || saved === 'fr') return saved;
  } catch {
    /* sem preferências */
  }
  const sys = (navigator.language || 'pt').slice(0, 2);
  return sys === 'en' || sys === 'fr' ? sys : 'pt';
}

export function rememberLang(l: Lang) {
  try {
    localStorage.setItem(PREF_KEY, l);
  } catch {
    /* sem preferências */
  }
}

export const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  resources: { pt: { translation: pt }, en: { translation: en }, fr: { translation: fr } },
  lng: preferredLang(),
  fallbackLng: 'pt',
  interpolation: { escapeValue: false },
  returnNull: false,
});
