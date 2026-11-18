/** Vista física 3D: chega na Fase 5. */
import { useTranslation } from 'react-i18next';

export function Physical3D() {
  const { t } = useTranslation();
  return (
    <div className="placeholder" role="note">
      <p>{t('ui.view3d.soon')}</p>
    </div>
  );
}
