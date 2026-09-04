import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CardSkeleton } from '../../../../components/ui';
import { PageHeader } from '../../../../components/page-header';
import { Achievements } from '../../../../components/achievements';

export const metadata: Metadata = { title: 'Logros' };

/**
 * Logros en Academy.
 *
 * No estaba, y el cliente pidió que estuviera: la gamificación no deja de
 * motivar a los diecisiete años, solo cambia el tono. Por eso el componente
 * habla de «insignias» y «niveles» y no de «tu nivel de Explorador», que es el
 * vocabulario de primaria.
 *
 * Sigue sin haber ninguna comparación con nadie, igual que en Discover.
 */
export default function AcademyLogros() {
  return (
    <>
      <PageHeader
        title="Logros"
        subtitle="Lo que has conseguido, y lo que viene después."
      />

      <Suspense fallback={<CardSkeleton />}>
        <Achievements portal="academy" />
      </Suspense>
    </>
  );
}
