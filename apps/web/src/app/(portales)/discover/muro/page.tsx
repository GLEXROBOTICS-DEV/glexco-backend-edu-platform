import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CardSkeleton } from '../../../../components/ui';
import { PageHeader } from '../../../../components/page-header';
import { ClassroomWall } from '../../../../components/wall';

export const metadata: Metadata = { title: 'El muro' };

/**
 * El muro de la clase: las preguntas.
 *
 * **Separado de los anuncios y no una pestaña de la misma pantalla.** Son dos
 * cosas que se leen distinto: un aviso del docente hay que verlo hoy, y una
 * conversación se sigue a lo largo de la semana. Mezclarlas enterraba el aviso
 * importante entre las preguntas.
 */
export default function Muro() {
  return (
    <>
      <PageHeader
        title="El muro de tu clase"
        subtitle="Pregunta lo que no entiendas. Si tú tienes la duda, seguramente alguien más también."
      />

      <Suspense fallback={<CardSkeleton />}>
        <ClassroomWall only="question" />
      </Suspense>
    </>
  );
}
