import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { CardSkeleton } from '../../../../components/ui';
import { PageHeader } from '../../../../components/page-header';
import { RobotLab } from '../../../../components/robot-lab';

export const metadata: Metadata = { title: 'Laboratorio' };

export default async function Laboratorio() {
  const t = await getTranslations('laboratorio');

  return (
    <>
      <PageHeader title={t('titulo')} subtitle={t('subtitulo')} />

      <Suspense fallback={<CardSkeleton />}>
        <RobotLab portal="discover" />
      </Suspense>
    </>
  );
}
