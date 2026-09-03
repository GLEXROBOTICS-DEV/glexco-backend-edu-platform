import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CardSkeleton } from '../../../../components/ui';
import { AssessmentList } from '../../../../components/assessment-list';

export const metadata: Metadata = { title: 'Mis evaluaciones' };

export default function AcademyEvaluaciones() {
  return (
    <>
      <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="font-semibold">
        Mis evaluaciones
      </h1>

      <Suspense fallback={<CardSkeleton />}>
        <AssessmentList portal="academy" />
      </Suspense>
    </>
  );
}
