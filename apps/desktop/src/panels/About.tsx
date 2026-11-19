/** Ecrã «Sobre»: aviso didáctico e simplificações dos modelos físicos. */
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { registry } from '../store';
import { APP_NAME, AUTHOR, COPYRIGHT_YEAR } from '../brand';

export function About({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const simpl = [...new Set(registry.all().flatMap((d) => d.simplifications ?? []))];
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2 id="about-title">{t('app.name')}</h2>
        <p className="muted">{t('ui.about.version', { version: __APP_VERSION__ })}</p>
        <p className="copyright" data-testid="copyright">
          {t('ui.about.copyright', { year: COPYRIGHT_YEAR, author: AUTHOR || APP_NAME })}
        </p>
        <p className="disclaimer">{t('app.disclaimer')}</p>
        <h3>{t('ui.about.simplifications')}</h3>
        <ul>
          {simpl.map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ul>
        <div className="buttons right">
          <button ref={ref} onClick={onClose}>
            {t('ui.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
