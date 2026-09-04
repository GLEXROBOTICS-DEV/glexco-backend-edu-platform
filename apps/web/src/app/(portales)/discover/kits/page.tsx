import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { CardSkeleton } from '../../../../components/ui';
import { MyContent } from '../../../../components/my-content';

export const metadata: Metadata = { title: 'Mis kits' };

/**
 * Mis kits.
 *
 * Estaba en la barra de navegacion sin pantalla detras: el alumno pulsaba y
 * caia en un 404.
 */
export default async function DiscoverKits() {
  const t = await getTranslations('pantallas');

  return (
    <>
      <section>
        <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="font-display font-semibold">
          {t('misKits')}
        </h1>
        <p className="mt-1 text-[15px] text-ink-500">
          {t('kitsSubtitulo')}
        </p>
      </section>

      <Suspense fallback={<CardSkeleton />}>
        <MyContent portal="discover" />
      </Suspense>
    </>
  );
}
