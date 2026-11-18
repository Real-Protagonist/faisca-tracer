/**
 * Assistente de arranque: idioma (só na primeira abertura), área, nível e três saídas:
 * projecto vazio, abrir um exemplo ou começar um exercício.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createProject, parseProject, type Domain, type Lang, type Level } from '@faisca/sim-core';
import { EXAMPLES } from '@faisca/content';
import { rememberLang } from '../i18n';
import { closeWizard, loadProject, setLang, useApp } from '../store';
import { startTour, TOUR_OF } from '../tour/TourOverlay';
import { fitView } from '../view';

type Screen = 'lang' | 'area' | 'level' | 'start' | 'examples';

const PREF = 'faisca.lastProject';

export function lastChoice(): { domain: Domain; level: Level } {
  try {
    const v = JSON.parse(localStorage.getItem(PREF) ?? 'null');
    if (v && (v.domain === 'domestic' || v.domain === 'industrial') && (v.level === 'beginner' || v.level === 'pro')) return v;
  } catch {
    /* sem preferências */
  }
  return { domain: 'domestic', level: 'beginner' };
}

function remember(domain: Domain, level: Level) {
  try {
    localStorage.setItem(PREF, JSON.stringify({ domain, level }));
  } catch {
    /* sem preferências */
  }
}

const ICON: Record<string, string> = { domestic: '🏠', industrial: '🏭', beginner: '🌱', pro: '🛠', empty: '📄', example: '💡', exercise: '🎯' };

function Card({ id, title, text, selected, onClick, disabled, testid }: { id: string; title: string; text: string; selected?: boolean; onClick: () => void; disabled?: boolean; testid: string }) {
  return (
    <button className={selected ? 'wcard selected' : 'wcard'} onClick={onClick} disabled={disabled} data-testid={testid} aria-pressed={selected}>
      <span className="wicon" aria-hidden>
        {ICON[id] ?? '⚡'}
      </span>
      <strong>{title}</strong>
      <span>{text}</span>
    </button>
  );
}

export function Wizard() {
  const { t, i18n } = useTranslation();
  const { open, firstRun } = useApp((s) => s.wizard);
  const lang = useApp((s) => s.lang);
  const [screen, setScreen] = useState<Screen>('lang');
  const [domain, setDomain] = useState<Domain>(lastChoice().domain);
  const [level, setLevel] = useState<Level>(lastChoice().level);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setScreen(firstRun ? 'lang' : 'area');
  }, [open, firstRun]);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('.wcard')?.focus();
  }, [screen, open]);
  if (!open) return null;

  const order: Screen[] = firstRun ? ['lang', 'area', 'level', 'start'] : ['area', 'level', 'start'];
  const n = screen === 'examples' ? order.length : order.indexOf(screen) + 1;
  const back = () => setScreen(screen === 'examples' ? 'start' : order[Math.max(0, order.indexOf(screen) - 1)]!);

  const pickLang = (l: Lang) => {
    void i18n.changeLanguage(l);
    rememberLang(l);
    setLang(l);
    setScreen('area');
  };

  const finish = (P: ReturnType<typeof createProject>) => {
    remember(domain, level);
    closeWizard();
    loadProject(P);
    requestAnimationFrame(() => fitView());
  };

  const empty = () => {
    finish(createProject({ domain, level, lang }));
    // No nível Iniciante, o projecto vazio arranca o tour (o industrial chega na Fase 4).
    if (level === 'beginner') startTour(TOUR_OF[domain], false);
  };

  const examples = EXAMPLES.filter((e) => e.domain === domain && e.level === level);

  return (
    <div className="modal-back wizard-back">
      <div className="modal wizard" role="dialog" aria-modal="true" aria-labelledby="wizard-title" ref={ref} data-testid="wizard" data-screen={screen} onKeyDown={(e) => e.key === 'Escape' && !firstRun && closeWizard()}>
        <header>
          <h2 id="wizard-title">{t('wizard.title')}</h2>
          <span className="muted">{t('wizard.step', { n, total: order.length })}</span>
        </header>

        {screen === 'lang' && (
          <>
            <h3>{t('wizard.lang.title')}</h3>
            <div className="wcards">
              {(
                [
                  ['pt', 'Português'],
                  ['en', 'English'],
                  ['fr', 'Français'],
                ] as const
              ).map(([l, name]) => (
                <button key={l} className={lang === l ? 'wcard selected' : 'wcard'} onClick={() => pickLang(l)} data-testid={`wizard-lang-${l}`}>
                  <span className="wicon" aria-hidden>
                    {l.toUpperCase()}
                  </span>
                  <strong>{name}</strong>
                </button>
              ))}
            </div>
            <p className="muted small">{t('wizard.lang.hint')}</p>
          </>
        )}

        {screen === 'area' && (
          <>
            <h3>{t('wizard.area.title')}</h3>
            <div className="wcards">
              {(['domestic', 'industrial'] as const).map((d) => (
                <Card key={d} id={d} title={t(`domain.${d}`)} text={t(`wizard.area.${d}`) + (d === 'industrial' ? ` ${t('wizard.area.industrialSoon')}` : '')} selected={domain === d} onClick={() => (setDomain(d), setScreen('level'))} testid={`wizard-area-${d}`} />
              ))}
            </div>
          </>
        )}

        {screen === 'level' && (
          <>
            <h3>{t('wizard.level.title')}</h3>
            <div className="wcards">
              {(['beginner', 'pro'] as const).map((l) => (
                <Card key={l} id={l} title={t(`level.${l}`)} text={t(`wizard.level.${l}`)} selected={level === l} onClick={() => (setLevel(l), setScreen('start'))} testid={`wizard-level-${l}`} />
              ))}
            </div>
          </>
        )}

        {screen === 'start' && (
          <>
            <h3>{t('wizard.start.title')}</h3>
            <div className="wcards three">
              <Card id="empty" title={t('wizard.start.empty')} text={t(level === 'beginner' && domain === 'domestic' ? 'wizard.start.emptyBeginner' : 'wizard.start.emptyPro')} onClick={empty} testid="wizard-empty" />
              <Card id="example" title={t('wizard.start.example')} text={t('wizard.start.exampleHint')} onClick={() => setScreen('examples')} testid="wizard-example" />
              <Card id="exercise" title={t('wizard.start.exercise')} text={t('wizard.start.exerciseSoon')} onClick={() => undefined} disabled testid="wizard-exercise" />
            </div>
          </>
        )}

        {screen === 'examples' && (
          <>
            <h3>{t('wizard.examples.title')}</h3>
            {examples.length ? (
              <div className="wcards">
                {examples.map((e) => (
                  <Card
                    key={e.id}
                    id="example"
                    title={t(`example.${e.id}.title`)}
                    text={t(`example.${e.id}.desc`)}
                    onClick={() => {
                      const P = parseProject(e.text);
                      P.name = t(`example.${e.id}.title`);
                      P.lang = lang;
                      finish(P);
                    }}
                    testid={`wizard-ex-${e.id}`}
                  />
                ))}
              </div>
            ) : (
              <p className="muted">{t('wizard.examples.none')}</p>
            )}
          </>
        )}

        <footer className="buttons">
          {screen !== order[0] && (
            <button onClick={back} data-testid="wizard-back">
              {t('wizard.back')}
            </button>
          )}
          <span className="spacer" />
          {!firstRun && (
            <button className="link" onClick={closeWizard}>
              {t('wizard.cancel')}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
