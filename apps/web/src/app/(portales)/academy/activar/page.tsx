import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ActivationForm } from '../../../../components/activation-form';

export const metadata: Metadata = { title: 'Activar mi código' };

export default async function AcademyActivar() {
  const t = await getTranslations('pantallas');

  return (
    <>
      <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="font-semibold">
        {t('activarCodigo')}
      </h1>
      <p className="max-w-md text-sm text-ink-500">
        {t('activarSubtitulo')}
      </p>

      <ActivationForm portal="academy" />
    </>
  );
}
