import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CardSkeleton } from '../../../../components/ui';
import { MyContent } from '../../../../components/my-content';

export const metadata: Metadata = { title: 'Mis kits' };

/**
 * Mis kits.
 *
 * Estaba en la barra de navegacion sin pantalla detras: el alumno pulsaba y
 * caia en un 404.
 */
export default function DiscoverKits() {
  return (
    <>
      <section>
        <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="font-display font-semibold">
          Mis kits
        </h1>
        <p className="mt-1 text-[15px] text-ink-500">
          Lo que has activado con el codigo de tu libro, y cuanto llevas de cada curso.
        </p>
      </section>

      <Suspense fallback={<CardSkeleton />}>
        <MyContent portal="discover" />
      </Suspense>
    </>
  );
}
