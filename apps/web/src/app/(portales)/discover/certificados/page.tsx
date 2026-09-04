import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CardSkeleton } from '../../../../components/ui';
import { PageHeader } from '../../../../components/page-header';
import { MyCertificates } from '../../../../components/certificate';

export const metadata: Metadata = { title: 'Mis certificados' };

/**
 * Mis certificaciones.
 *
 * Cierra el ultimo destino de la barra que llevaba a un 404.
 */
export default function DiscoverCertificados() {
  return (
    <>
      <PageHeader
        title="Mis certificados"
        subtitle="Se emiten al terminar todas las lecciones de un curso. Cualquiera puede comprobar que son auténticos con el código QR."
      />

      <Suspense fallback={<CardSkeleton />}>
        <MyCertificates portal="discover" />
      </Suspense>
    </>
  );
}
