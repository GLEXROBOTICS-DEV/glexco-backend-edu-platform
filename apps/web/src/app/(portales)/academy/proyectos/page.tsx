import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { CardSkeleton } from '../../../../components/ui';
import { PageHeader } from '../../../../components/page-header';
import { ChallengeList } from '../../../../components/challenges';
import { MissionList } from '../../../../components/missions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('retos');
  return { title: t('tituloAcademy') };
}

/**
 * Zona de retos.
 *
 * El canvas la dibuja en la barra desde el principio y no existia. Lo que
 * lista son las evaluaciones de tipo `practical`, `project` y `stem_activity`
 * de sus kits: un reto de construccion ES una de esas, con su plazo y su
 * correccion. Ver la nota de `ChallengeList`.
 */
export default async function AcademyProyectos() {
  const t = await getTranslations('retos');

  return (
    <>
      <PageHeader title={t('tituloAcademy')} subtitle={t('subtituloAcademy')} />

      {/* Las misiones primero: son de esta semana y tienen ventana. Los
          retos no caducan igual, asi que van despues. */}
      <Suspense fallback={<CardSkeleton />}>
        <MissionList />
      </Suspense>

      <Suspense fallback={<CardSkeleton />}>
        <ChallengeList portal="academy" />
      </Suspense>
    </>
  );
}
