import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { CardSkeleton } from '../../../../components/ui';
import { PageHeader } from '../../../../components/page-header';
import { ClassroomWall } from '../../../../components/wall';

export const metadata: Metadata = { title: 'Anuncios' };

/**
 * Anuncios del salon, en su propia pantalla.
 *
 * Estaban al final de la portada, empujando hacia abajo el contenido a medias.
 * El canvas los deja fuera del cuerpo y los deja a un clic desde la cabecera:
 * son avisos que se leen una vez, no aquello a lo que el alumno viene.
 */
export default async function Anuncios() {
  const t = await getTranslations('pantallas');

  return (
    <>
      <PageHeader
        title={t('anunciosTitulo')}
        subtitle={t('anunciosSubtitulo')}
      />

      <Suspense fallback={<CardSkeleton />}>
        <ClassroomWall only="announcement" canAsk={false} />
      </Suspense>
    </>
  );
}
