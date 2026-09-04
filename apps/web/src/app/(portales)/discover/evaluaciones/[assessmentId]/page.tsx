import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CardSkeleton } from '../../../../../components/ui';
import { AssessmentResult } from '../../../../../components/assessment-result';

export const metadata: Metadata = { title: 'Actividad' };

/**
 * Como me fue en esta evaluación.
 *
 * **Es la pantalla de aterrizaje, y no consume ningún intento.** Antes esta ruta
 * abría un intento nada más cargar, así que volver a mirar la nota gastaba uno de
 * los tres y el alumno acababa viendo «ya agotaste tus intentos» sin haber
 * respondido nada más. Responder es ahora un paso aparte, en `/responder`.
 */
export default async function Resultado({
  params,
}: {
  params: Promise<{ assessmentId: string }>;
}) {
  const { assessmentId } = await params;

  return (
    <>
      <section>
        <a
          href="/discover/evaluaciones"
          className="text-sm font-medium text-brand-600 hover:underline"
        >
          ← Mis actividades
        </a>
      </section>

      <Suspense fallback={<CardSkeleton />}>
        <AssessmentResult assessmentId={assessmentId} portal="discover" />
      </Suspense>
    </>
  );
}
