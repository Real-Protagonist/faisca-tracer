/** Traduções: mesmas chaves nos três idiomas, cobertura total do núcleo e mensagens bem escritas. */
import { describe, expect, it } from 'vitest';
import i18next from 'i18next';
import pt from '../pt.json';
import en from '../en.json';
import fr from '../fr.json';
import {
  APPLIANCES,
  createProject,
  addDevice,
  DIAG_CODES,
  EVENT_CODES,
  defaultRegistry,
  Simulator,
  type Measurement,
} from '../../sim-core/index';

type Tree = { [k: string]: string | Tree };
const LANGS = { pt, en, fr } as Record<string, Tree>;

function flatten(t: Tree, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(t)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else flatten(v, key, out);
  }
  return out;
}
const FLAT = Object.fromEntries(Object.entries(LANGS).map(([l, t]) => [l, flatten(t)])) as Record<string, Record<string, string>>;
const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}|\$t\(([^)]+)\)/g)].map((m) => m[0]).sort();

describe('paridade entre idiomas', () => {
  for (const lang of ['en', 'fr']) {
    it(`${lang} tem exactamente as mesmas chaves que pt`, () => {
      const a = Object.keys(FLAT.pt!).sort();
      const b = Object.keys(FLAT[lang]!).sort();
      expect(b.filter((k) => !a.includes(k)), 'chaves a mais').toEqual([]);
      expect(a.filter((k) => !b.includes(k)), 'chaves em falta').toEqual([]);
    });
    it(`${lang} usa as mesmas variáveis que pt em cada mensagem`, () => {
      for (const [k, v] of Object.entries(FLAT.pt!)) expect(placeholders(FLAT[lang]![k]!), k).toEqual(placeholders(v));
    });
  }
  it('nenhum texto vazio', () => {
    for (const [lang, f] of Object.entries(FLAT)) for (const [k, v] of Object.entries(f)) expect(v.trim(), `${lang}:${k}`).not.toBe('');
  });
});

/** Todas as chaves que o núcleo pode pedir. */
function requiredKeys(): Set<string> {
  const keys = new Set<string>();
  const add = (k: string) => keys.add(k);
  for (const def of defaultRegistry.all()) {
    add(`device.${def.type}.name`);
    add(`device.${def.type}.desc`);
    add(`category.${def.category}`);
    for (const p of def.params) {
      add(p.labelKey ?? `param.${p.key}`);
      if (p.translatedOptions) for (const o of p.options ?? []) add(`option.${p.key}.${o}`);
    }
    for (const s of def.simplifications ?? []) add(s);

    // Medições e comandos em vários estados: inicial e depois de cada comando.
    const P = createProject();
    const d = addDevice(P, def.type);
    const sim = new Simulator(P);
    sim.step(0.02);
    const collect = (ms: Measurement[]) => {
      for (const m of ms) {
        add(m.key);
        if (typeof m.value !== 'number') add(m.value.key);
      }
    };
    for (let round = 0; round < 3; round++) {
      collect(sim.measurements(d.id));
      for (const a of def.actions?.(sim.device(d.id)!) ?? []) {
        add(a.labelKey ?? `action.${a.id}`);
        sim.operate(d.id, a.id, 'down');
        collect(sim.measurements(d.id));
        sim.operate(d.id, a.id, 'up');
      }
    }
  }
  // Estados calculados (dependem da simulação).
  for (const s of ['tripped_magnetic', 'tripped_thermal', 'tripped_residual', 'starting', 'running', 'stopped', 'burnt', 'charging', 'discharging']) add(`state.${s}`);
  for (const z of ['AC1', 'AC2', 'AC3', 'AC4']) add(`state.zone_${z}`);
  for (const a of Object.keys(APPLIANCES)) add(`state.appliance_${a}`);
  for (const c of DIAG_CODES) for (const part of ['title', 'cause', 'hint', 'learn']) add(`diag.${c.toLowerCase()}.${part}`);
  for (const c of EVENT_CODES) add(`event.${c}`);
  for (const c of ['L1', 'L2', 'L3', 'N', 'PE', 'C', 'DC+', 'DC-']) {
    add(`color.${c}`);
    add(`role.${c}`);
  }
  for (const k of ['not_faisca', 'newer_version', 'no_migration', 'invalid', 'unknown_device']) add(`file.error.${k}`);
  add('app.disclaimer');
  return keys;
}

describe('cobertura do núcleo de simulação', () => {
  const required = requiredKeys();
  it('cada chave pedida pelo núcleo existe em pt, en e fr', () => {
    for (const lang of Object.keys(FLAT)) {
      const missing = [...required].filter((k) => !(k in FLAT[lang]!));
      expect(missing, lang).toEqual([]);
    }
  });
});

describe('mensagens de diagnóstico', () => {
  const sample: Record<string, string> = {
    device: 'Q2', terminal: 'N', blocker: 'Q2', current: '771 A', ratio: '77', rated: '10 A', icn: '6 kA', idn: '30 mA',
    location: 'X2', voltage: '400 V', nominal: '230 V', drop: '6,2 %', limit: '3 %', section: '1,5 mm²', length: '60 m',
    iz: '24 A', nextSection: '4 mm²', lowerRating: '20 A', from: 'Q4', to: 'E1', expected: 'N', actual: 'L1', power: '130 W',
    source: 'G1', rcd: 'no',
  };

  it('interpolam em pt, en e fr sem variáveis por resolver (i18next)', async () => {
    const i18n = i18next.createInstance();
    await i18n.init({ resources: { pt: { translation: pt }, en: { translation: en }, fr: { translation: fr } }, lng: 'pt', interpolation: { escapeValue: false } });
    for (const lng of ['pt', 'en', 'fr'])
      for (const c of DIAG_CODES)
        for (const part of ['title', 'cause', 'hint', 'learn']) {
          const s = i18n.t(`diag.${c.toLowerCase()}.${part}`, { lng, ...sample });
          expect(s, `${lng} ${c}.${part}`).not.toMatch(/\{\{|\$t\(|diag\./);
        }
    expect(i18n.t('diag.wire_color.hint', { lng: 'pt', ...sample })).toBe('Use um cabo azul neste condutor.');
    expect(i18n.t('diag.mcb_magnetic_trip.cause', { lng: 'pt', ...sample })).toBe('Curto-circuito: passaram 771 A, 77 vezes a sua corrente nominal.');
  });

  it('título, causa e dica têm menos de 15 palavras por frase', () => {
    for (const [lang, f] of Object.entries(FLAT))
      for (const c of DIAG_CODES)
        for (const part of ['title', 'cause', 'hint']) {
          const text = f[`diag.${c.toLowerCase()}.${part}`]!;
          for (const sentence of text.split(/[.:;]\s+/)) {
            const words = sentence.split(/\s+/).filter((w) => /[\p{L}\p{N}{]/u.test(w));
            expect(words.length, `${lang} ${c}.${part}: «${sentence}»`).toBeLessThan(15);
          }
        }
  });

  it('a dica começa por um verbo no imperativo (lista de verbos conhecida)', () => {
    const verbs: Record<string, RegExp> = {
      pt: /^(Ligue|Retire|Use|Procure|Divida|Escolha|Elimine|Desligue|Aumente|Aperte|Instale|Recarregue|Reveja|Substitua|Reponha|Verifique|Experimente)\b/,
      en: /^(Connect|Remove|Use|Find|Split|Choose|Unplug|Supply|Increase|Tighten|Install|Recharge|Check|Switch|Replace|Restore)\b/,
      fr: /^(Reliez|Retirez|Placez|Utilisez|Cherchez|Répartissez|Choisissez|Supprimez|Débranchez|Alimentez|Augmentez|Resserrez|Installez|Rechargez|Vérifiez|Fermez|Remplacez|Rétablissez|Allumez|Coupez)\b/,
    };
    for (const [lang, f] of Object.entries(FLAT))
      for (const c of DIAG_CODES) expect(f[`diag.${c.toLowerCase()}.hint`], `${lang} ${c}`).toMatch(verbs[lang]!);
  });
});
