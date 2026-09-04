import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { CardSkeleton } from '../../../../components/ui';
import { PageHeader } from '../../../../components/page-header';
import { ChallengeList } from '../../../../components/challenges';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('retos');
  return { title: t('titulo') };
}

/**
 * Zona de retos.
 *
 * El canvas la dibuja en la barra desde el principio y no existia. Lo que
 * lista son las evaluaciones de tipo `practical`, `project` y `stem_activity`
 * de sus kits: un reto de construccion ES una de esas, con su plazo y su
 * correccion. Ver la nota de `ChallengeList`.
 */
export default async function DiscoverRetos() {
  const t = await getTranslations('retos');

  return (
    <>
      <PageHeader title={t('titulo')} subtitle={t('subtitulo')} />

      <Suspense fallback={<CardSkeleton />}>
        <ChallengeList portal="discover" />
      </Suspense>
    </>
  );
}
