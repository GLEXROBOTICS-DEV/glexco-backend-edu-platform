import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { CardSkeleton } from '../../../../components/ui';
import { PageHeader } from '../../../../components/page-header';
import { Portfolio } from '../../../../components/portfolio';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('portafolio');
  return { title: t('titulo') };
}

/**
 * Mi portafolio.
 *
 * Lo que ya construyo, con la evidencia que entrego y el comentario de su
 * docente. Se arma con las entregas corregidas de los retos: no hay tabla
 * nueva. Ver la nota de `Portfolio`.
 */
export default async function DiscoverPortafolio() {
  const t = await getTranslations('portafolio');

  return (
    <>
      <PageHeader title={t('titulo')} subtitle={t('subtitulo')} />

      <Suspense fallback={<CardSkeleton />}>
        <Portfolio portal="discover" />
      </Suspense>
    </>
  );
}
