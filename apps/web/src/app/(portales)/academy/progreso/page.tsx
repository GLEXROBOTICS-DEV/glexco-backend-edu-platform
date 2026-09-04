import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { CardSkeleton } from '../../../../components/ui';
import { StudentDashboard } from '../../../../components/student-dashboard';
import { ExplorerProgress } from '../../../../components/explorer-progress';

export const metadata: Metadata = { title: 'Mi progreso' };

export default async function AcademyProgreso() {
  const t = await getTranslations('pantallas');

  return (
    <>
      <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="font-semibold">
        {t('miProgreso')}
      </h1>

      {/* El progreso por CONTENIDO va primero, y el de evaluaciones despues. Es
          lo que el alumno puede mover hoy mismo: abrir la siguiente leccion. La
          nota depende de una evaluacion que quiza no toca hasta la semana que
          viene. */}
      <Suspense fallback={<CardSkeleton />}>
        <ExplorerProgress portal="academy" />
      </Suspense>

      {/* El dashboard viene de una proyeccion que puede tardar unos cientos de
          milisegundos. El esqueleto reserva el hueco para que la pagina no salte
          cuando llegan los numeros. */}
      <Suspense fallback={<CardSkeleton />}>
        <StudentDashboard portal="academy" />
      </Suspense>
    </>
  );
}
