import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CardSkeleton } from '../../../../components/ui';
import { MyContent } from '../../../../components/my-content';

export const metadata: Metadata = { title: 'Cursos' };

/**
 * Mis cursos.
 *
 * Misma pantalla que "Mis kits" de Discover con otro vocabulario: en primaria se
 * compra un kit, y en secundaria lo que importa es el curso que va dentro.
 */
export default function AcademyCursos() {
  return (
    <>
      <section>
        <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="font-display font-semibold">
          Mis cursos
        </h1>
        <p className="mt-1 text-[15px] text-ink-500">
          Tu contenido activado, con el avance de cada curso.
        </p>
      </section>

      <Suspense fallback={<CardSkeleton />}>
        <MyContent portal="academy" />
      </Suspense>
    </>
  );
}
