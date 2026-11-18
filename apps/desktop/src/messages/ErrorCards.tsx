/**
 * Cartões de erro no canto do esquema: o que aconteceu, porquê e o que fazer.
 * Ficam até o utilizador os fechar ou a falha desaparecer.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Diagnostic } from '@faisca/sim-core';
import { dismissCard, pruneDismissed, select, setFlag, useApp } from '../store';
import { centerOn } from '../view';
import { Figure } from './figures';

/** Avisos de montagem que só aparecem no painel Problemas (aparecem a cada aparelho colocado). */
const PANEL_ONLY = new Set(['TERMINAL_UNCONNECTED']);
/** Diagnósticos de montagem: o cartão espera que o utilizador pare de editar. */
const ASSEMBLY = new Set(['SOURCE_SHORT', 'LOAD_NO_RETURN', 'SWITCH_ON_NEUTRAL', 'PE_MISSING', 'CABLE_UNPROTECTED', 'WIRE_COLOR', 'LOAD_PHASE_PHASE']);
const IDLE_MS = 2500;
const MAX_CARDS = 3;
/** Valores técnicos mostrados no perfil Profissional. */
const TECH = ['current', 'ratio', 'rated', 'voltage', 'nominal', 'drop', 'iz', 'icn', 'idn', 'power'];

export const cardKey = (d: Diagnostic) => `${d.code}|${d.targets.map((x) => x.id).join(',')}`;

export function ErrorCards() {
  const diags = useApp((s) => s.snapshot?.diagnostics);
  const dismissed = useApp((s) => s.dismissed);
  const lastEdit = useApp((s) => s.lastEdit);
  const [now, setNow] = useState(Date.now());

  // Relógio para libertar os avisos de montagem depois de o utilizador parar de editar.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const all = useMemo(() => (diags ?? []).filter((d) => d.severity !== 'info' && !PANEL_ONLY.has(d.code)), [diags]);
  useEffect(() => pruneDismissed(all.map(cardKey)), [all]);
  const idle = now - lastEdit > IDLE_MS;
  const visible = all.filter((d) => !dismissed.includes(cardKey(d)) && (idle || !ASSEMBLY.has(d.code)));
  if (!visible.length) return null;
  const shown = visible.slice(0, MAX_CARDS);
  return (
    <div className="error-cards" aria-live="polite" data-testid="error-cards">
      {shown.map((d) => (
        <Card key={cardKey(d)} d={d} />
      ))}
      {visible.length > MAX_CARDS && <More count={visible.length - MAX_CARDS} />}
    </div>
  );
}

function More({ count }: { count: number }) {
  const { t } = useTranslation();
  return <div className="cards-more">{t('cards.more', { count })}</div>;
}

function Card({ d }: { d: Diagnostic }) {
  const { t } = useTranslation();
  const pro = useApp((s) => s.project.level === 'pro');
  const [fix, setFix] = useState(false);
  const [learn, setLearn] = useState(false);
  const show = () => {
    select({ devices: d.targets.filter((x) => x.kind === 'device').map((x) => x.id), wires: d.targets.filter((x) => x.kind === 'wire').map((x) => x.id) });
    const target = d.fix ? (d.targets.find((x) => x.id === d.fix!.id) ?? { kind: 'device' as const, id: d.fix.id }) : d.targets[0];
    if (target) centerOn(target.kind, target.id);
  };
  const tech = Object.entries(d.values).filter(([k]) => TECH.includes(k));
  return (
    <section className={`card ${d.severity}`} role={d.severity === 'error' ? 'alert' : 'status'} data-code={d.code}>
      <header>
        <span className="icon" aria-hidden>
          {d.severity === 'error' ? '⛔' : '⚠'}
        </span>
        <h3 className="card-title">{t(d.titleKey, d.values)}</h3>
        <button className="close" aria-label={t('cards.close')} onClick={() => dismissCard(cardKey(d))}>
          ✕
        </button>
      </header>
      <p className="card-cause">{t(d.causeKey, d.values)}</p>
      <p className="card-hint">{t(d.hintKey, d.values)}</p>
      {pro && tech.length > 0 && (
        <p className="card-values">
          <span className="sr-only">{t('cards.values')}: </span>
          {tech.map(([, v]) => v).join(' · ')}
        </p>
      )}
      {(fix || learn) && (
        <div className="card-learn" data-testid="card-full-hint">
          {learn && <Figure code={d.code} />}
          <p>{t(d.learnKey, d.values)}</p>
        </div>
      )}
      <div className="card-buttons">
        <button onClick={show}>{t('cards.show')}</button>
        <button
          aria-expanded={fix}
          onClick={() => {
            setFix(!fix);
            setFlag('howToFix');
            if (!fix) show();
          }}
          data-testid="card-how-to-fix"
        >
          {t('cards.howToFix')}
        </button>
        {!pro && (
          <button aria-expanded={learn} onClick={() => setLearn(!learn)} data-testid="card-learn">
            {t('cards.learnMore')}
          </button>
        )}
      </div>
    </section>
  );
}
