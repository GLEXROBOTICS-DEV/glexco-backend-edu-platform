import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CardSkeleton } from '../../../../components/ui';
import { PageHeader } from '../../../../components/page-header';
import { RobotLab } from '../../../../components/robot-lab';

export const metadata: Metadata = { title: 'Laboratorio de robots' };

export default function Laboratorio() {
  return (
    <>
      <PageHeader title="Laboratorio de robots" subtitle="Las plataformas robóticas a las que tienes acceso." />

      <Suspense fallback={<CardSkeleton />}>
        <RobotLab portal="academy" />
      </Suspense>
    </>
  );
}
