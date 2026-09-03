import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CardSkeleton } from '../../../../components/ui';
import { KitLibrary } from '../../../../components/library';

export const metadata: Metadata = { title: 'Biblioteca' };

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AcademyBiblioteca({ searchParams }: PageProps) {
  const params = await searchParams;
  const kit = params['kit'];

  return (
    <>
      <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="font-semibold">
        Biblioteca
      </h1>

      {/* El esqueleto tiene la FORMA de las tarjetas que vienen, no es un
          spinner: reserva el hueco y la pagina no salta cuando llega la lista. */}
      <Suspense fallback={<Cargando />}>
        <KitLibrary portal="academy" kitId={typeof kit === 'string' ? kit : undefined} />
      </Suspense>
    </>
  );
}

function Cargando() {
  return (
    <div className="grid gap-[var(--portal-gap)] sm:grid-cols-2">
      <CardSkeleton />
      <CardSkeleton />
    </div>
  );
}
