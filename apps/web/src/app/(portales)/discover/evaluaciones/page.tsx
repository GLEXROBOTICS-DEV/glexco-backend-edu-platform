import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { CardSkeleton } from '../../../../components/ui';
import { AssessmentList } from '../../../../components/assessment-list';

export const metadata: Metadata = { title: 'Mis actividades' };

export default async function DiscoverEvaluaciones() {
  const t = await getTranslations('pantallas');

  return (
    <>
      <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="font-semibold">
        {t('misActividades')}
      </h1>

      <Suspense fallback={<CardSkeleton />}>
        <AssessmentList portal="discover" />
      </Suspense>
    </>
  );
}
