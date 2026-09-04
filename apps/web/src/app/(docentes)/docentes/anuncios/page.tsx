import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CardSkeleton } from '../../../../components/ui';
import { ClassroomWall } from '../../../../components/wall';
import { AnnouncementForm } from '../../../../components/announcement-form';
import { fetchMyClassrooms } from '../../../../lib/classrooms';

export const metadata: Metadata = { title: 'El muro' };

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
          El muro de tus salones
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Tus avisos y las preguntas de tus alumnos, en el mismo sitio. Responder aquí lo ve
          toda la clase, que es de lo que se trata: la duda de uno le sirve al resto.
        </p>
      </div>

      <Suspense fallback={<CardSkeleton />}>
        <Formulario />
      </Suspense>

      <Suspense fallback={<CardSkeleton />}>
        <ClassroomWall canAsk={false} />
      </Suspense>
    </>
  );
}

async function Formulario() {
  const { items } = await fetchMyClassrooms();
  return <AnnouncementForm classrooms={items} />;
}
