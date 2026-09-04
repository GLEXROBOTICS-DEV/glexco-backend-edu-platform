import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CardSkeleton } from '../../../../components/ui';
import { PageHeader } from '../../../../components/page-header';
import { RobotLab } from '../../../../components/robot-lab';

export const metadata: Metadata = { title: 'Laboratorio' };

export default function Laboratorio() {
  return (
    <>
      <PageHeader title="Laboratorio" subtitle="Los robots que puedes construir y programar con tus kits." />

      <Suspense fallback={<CardSkeleton />}>
        <RobotLab portal="discover" />
      </Suspense>
    </>
  );
}
