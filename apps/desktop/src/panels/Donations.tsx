/** Modal «Doações»: transferência internacional (IBAN + SWIFT/BIC), conta bancária angolana (nacional) e Bitcoin. */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_NAME, DONATIONS } from '../brand';

/** Chaves literais (o teste de traduções encontra-as no código). */
const TITLE: Record<string, string> = { international: 'ui.donations.international.title', bank: 'ui.donations.bank.title', bitcoin: 'ui.donations.bitcoin.title' };
const NOTE: Record<string, string> = { international: 'ui.donations.international.note', bank: 'ui.donations.bank.note', bitcoin: 'ui.donations.bitcoin.note' };
const FIELD: Record<string, string> = {
  holder: 'ui.donations.field.holder',
  bank: 'ui.donations.field.bank',
  iban: 'ui.donations.field.iban',
  account: 'ui.donations.field.account',
  swift: 'ui.donations.field.swift',
  card: 'ui.donations.field.card',
  link: 'ui.donations.field.link',
  address: 'ui.donations.field.address',
  network: 'ui.donations.field.network',
};

export function Donations({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => ref.current?.focus(), []);
  const copy = async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* sem acesso à área de transferência */
    }
  };
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal donations" role="dialog" aria-modal="true" aria-labelledby="don-title" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()} data-testid="donations">
        <h2 id="don-title">{t('ui.donations.title', { app: APP_NAME })}</h2>
        <p className="desc">{t('ui.donations.intro', { app: APP_NAME })}</p>
        {DONATIONS.map((m) => (
          <section key={m.id} className="donation" data-method={m.id}>
            <h3>{t(TITLE[m.id]!)}</h3>
            <p className="muted small">{t(NOTE[m.id]!)}</p>
            <dl>
              {m.fields.map((f) => {
                const id = `${m.id}.${f.key}`;
                return (
                  <div key={f.key} className="donation-field">
                    <dt>{t(FIELD[f.key]!)}</dt>
                    <dd>
                      {f.value ? (
                        <>
                          {f.key === 'link' ? (
                            <a href={f.value} target="_blank" rel="noreferrer">
                              {f.value}
                            </a>
                          ) : (
                            <code>{f.value}</code>
                          )}
                          <button className="link small" onClick={() => void copy(id, f.value)}>
                            {copied === id ? t('ui.donations.copied') : t('ui.donations.copy')}
                          </button>
                        </>
                      ) : (
                        <span className="muted">{t('ui.donations.missing')}</span>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        ))}
        <div className="buttons right">
          <button ref={ref} onClick={onClose}>
            {t('ui.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
