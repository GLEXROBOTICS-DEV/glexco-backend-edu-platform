import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CardSkeleton } from '../../../../components/ui';
import { Achievements } from '../../../../components/achievements';

export const metadata: Metadata = { title: 'Mis logros' };

/**
 * Mis logros.
 *
 * Esta ruta estaba en la barra de navegacion desde que existe el portal y no
 * tenia pantalla detras: el alumno pulsaba "Mis logros" y aterrizaba en un 404.
 */
export default function DiscoverLogros() {
  return (
    <>
      <section>
        <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="font-display font-semibold">
          Mis logros
        </h1>
        <p className="mt-1 text-[15px] text-ink-500">
          Todo lo que has conseguido, y lo que viene despues.
        </p>
      </section>

      <Suspense fallback={<CardSkeleton />}>
        <Achievements portal="discover" />
      </Suspense>
    </>
  );
}
