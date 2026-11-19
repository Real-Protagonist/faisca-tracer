/**
 * Separador «Verificação»: regras indicativas da IEC 60364 aplicadas ao esquema, com o resultado
 * de cada regra, os aparelhos verificados e a referência. No nível Iniciante, só as regras básicas.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BEGINNER_RULES, DEFAULT_RULES, parseRuleSet } from '@faisca/sim-core';
import { runCompliance, select, useApp } from '../store';
import { openFile, RULES_FILTER } from '../platform/files';

export function CompliancePanel() {
  const { t } = useTranslation();
  const c = useApp((s) => s.compliance);
  const level = useApp((s) => s.project.level);
  const [error, setError] = useState(false);
  const rules = c.rules ?? DEFAULT_RULES;
  const results = (c.results ?? []).filter((r) => level === 'pro' || BEGINNER_RULES.includes(r.id));
  const loadRules = async () => {
    const f = await openFile(RULES_FILTER);
    if (!f) return;
    try {
      const r = parseRuleSet(f.text);
      setError(false);
      runCompliance(r);
    } catch {
      setError(true);
    }
  };
  return (
    <div className="compliance" data-testid="compliance">
      <div className="compliance-bar">
        <button onClick={() => runCompliance()} disabled={c.running} data-testid="check-run">
          {t('ui.check.run')}
        </button>
        <span className="muted small">
          {t('ui.check.rules')}: {rules.name}
        </span>
        {level === 'pro' && (
          <>
            <button className="link small" onClick={() => void loadRules()}>
              {t('ui.check.loadRules')}
            </button>
            {c.rules && (
              <button className="link small" onClick={() => runCompliance(null)}>
                {t('ui.check.defaultRules')}
              </button>
            )}
          </>
        )}
        {!!results.length && (
          <button onClick={() => void import('../export/export').then((m) => m.exportCompliancePdf(results, rules))} data-testid="check-pdf">
            {t('ui.check.exportPdf')}
          </button>
        )}
      </div>
      {error && <p className="error small">{t('ui.check.badRules')}</p>}
      {!c.results && <p className="muted small">{t(level === 'pro' ? 'ui.check.intro' : 'ui.check.introBeginner')}</p>}
      <ul className="rules">
        {results.map((r) => (
          <li key={r.id} data-rule={r.id} data-status={r.status} className={r.status}>
            <details open={r.status === 'fail'}>
              <summary>
                <span className={`badge-status ${r.status}`}>{t(`ui.check.status.${r.status}`)}</span> {t(`compliance.${r.id}.title`)}
                <span className="muted small"> · {r.reference}</span>
              </summary>
              <ul>
                {r.items.map((it, i) => (
                  <li key={i} className={it.ok ? 'ok' : 'fail'}>
                    <button className="link" onClick={() => select({ devices: it.targets.filter((x) => x.kind === 'device').map((x) => x.id), wires: it.targets.filter((x) => x.kind === 'wire').map((x) => x.id) })}>
                      {it.ok ? '✓' : '✗'} {t(`compliance.${r.id}.item`, it.values)}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
      <p className="muted small disclaimer">{t('app.disclaimer')}</p>
    </div>
  );
}
