import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CardSkeleton } from '../../../../components/ui';
import { AnnouncementList } from '../../../../components/announcements';
import { AnnouncementForm } from '../../../../components/announcement-form';
import { fetchMyClassrooms } from '../../../../lib/classrooms';

export const metadata: Metadata = { title: 'Anuncios' };

/**
 * Anuncios del docente.
 *
 * El formulario va ARRIBA y la lista debajo. Es al reves de lo habitual, y es
 * deliberado: a esta pantalla se entra a escribir, no a leer. Poner la lista
 * primero obliga a bajar por los anuncios de todo el trimestre cada vez que hay
 * que avisar de algo.
 */
export default function AnunciosPage() {
  return (
    <>
      <div>
        <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="font-semibold">
          Anuncios
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Tus alumnos los verán la próxima vez que entren al portal.
        </p>
      </div>

      <Suspense fallback={<CardSkeleton />}>
        <Formulario />
      </Suspense>

      <Suspense fallback={<CardSkeleton />}>
        <AnnouncementList
          title="Publicados"
          emptyMessage="Todavía no has publicado ningún anuncio."
        />
      </Suspense>
    </>
  );
}

async function Formulario() {
  const { items } = await fetchMyClassrooms();
  return <AnnouncementForm classrooms={items} />;
}
