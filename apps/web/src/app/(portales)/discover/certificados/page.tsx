import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { CardSkeleton } from '../../../../components/ui';
import { PageHeader } from '../../../../components/page-header';
import { MyCertificates } from '../../../../components/certificate';

export const metadata: Metadata = { title: 'Mis certificados' };

/**
 * Mis certificaciones.
 *
 * Cierra el ultimo destino de la barra que llevaba a un 404.
 */
export default async function DiscoverCertificados() {
  const t = await getTranslations('pantallas');

  return (
    <>
      <PageHeader
        title={t('misCertificados')}
        subtitle={t('certificadosSubtitulo')}
      />

      <Suspense fallback={<CardSkeleton />}>
        <MyCertificates portal="discover" />
      </Suspense>
    </>
  );
}
