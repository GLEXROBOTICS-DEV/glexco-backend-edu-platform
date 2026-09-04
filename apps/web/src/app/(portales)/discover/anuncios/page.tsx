import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CardSkeleton } from '../../../../components/ui';
import { PageHeader } from '../../../../components/page-header';
import { AnnouncementList } from '../../../../components/announcements';

export const metadata: Metadata = { title: 'Anuncios' };

/**
 * Anuncios del salon, en su propia pantalla.
 *
 * Estaban al final de la portada, empujando hacia abajo el contenido a medias.
 * El canvas los deja fuera del cuerpo y los deja a un clic desde la cabecera:
 * son avisos que se leen una vez, no aquello a lo que el alumno viene.
 */
export default function Anuncios() {
  return (
    <>
      <PageHeader
        title="Anuncios de tu salón"
        subtitle="Lo que ha publicado tu docente. Los fijados van siempre arriba."
      />

      <Suspense fallback={<CardSkeleton />}>
        <AnnouncementList title="Del salón" />
      </Suspense>
    </>
  );
}
