import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CardSkeleton } from '../../../../components/ui';
import { StudentDashboard } from '../../../../components/student-dashboard';

export const metadata: Metadata = { title: 'Mi progreso' };

export default function AcademyProgreso() {
  return (
    <>
      <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="font-semibold">
        Mi progreso
      </h1>

      {/* El dashboard viene de una proyeccion que puede tardar unos cientos de
          milisegundos. El esqueleto reserva el hueco para que la pagina no salte
          cuando llegan los numeros. */}
      <Suspense fallback={<CardSkeleton />}>
        <StudentDashboard portal="academy" />
      </Suspense>
    </>
  );
}
