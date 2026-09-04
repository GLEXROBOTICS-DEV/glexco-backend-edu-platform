import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { requireSession } from '../../../lib/session';
import { CardSkeleton } from '../../../components/ui';
import { HeroFigureSkeleton, PortalHero } from '../../../components/portal-hero';
import {
  ContinueLearning,
  HeroLearningFigures,
  HeroSubtitle,
} from '../../../components/continue-learning';
import { RecentBadges, UpcomingActivities } from '../../../components/upcoming';
import { NoKitNotice } from '../../../components/no-kit-notice';
import { WeeklyMission } from '../../../components/missions';
import { ActionSkeleton, ClassroomActions } from '../../../components/page-header';

export const metadata: Metadata = { title: 'Discover' };

/**
 * Portada de Discover.
 *
 * El orden es el del canvas: banda de bienvenida, lo que esta a medias, y por
 * ultimo lo que viene. Los anuncios del docente NO estan en el cuerpo -viven
 * detras del icono de la cabecera-: se leen una vez y ocupaban mas espacio que
 * el curso a medias, que se abre cada dia.
 */
export default async function DiscoverHome() {
  const session = await requireSession();
  const t = await getTranslations('portada');

  return (
    <>
      {/* El saludo se pinta ya, con el nombre que trae la sesion; solo las tres
          cifras y el nombre del curso esperan al servicio de aprendizaje, y lo
          hacen sobre huecos de su misma altura para que la banda no salte. */}
      <PortalHero
        greeting={
          // Sin nombre se saluda igual, pero SIN la coma huerfana. Pasa de
          // verdad: si identidad no responde, la sesion sigue adelante con lo
          // que da el token -que no lleva el nombre- para no echar al alumno a
          // la pantalla de ingreso por un fallo temporal. Con la plantilla a
          // secas, la cabecera decia "Hola, !", que se lee como roto.
          session.firstName
            ? t('saludo', { nombre: session.firstName })
            : t('saludoSinNombre')
        }
        subtitle={
          <Suspense fallback={t('aventuraGenerica')}>
            <HeroSubtitle portal="discover" />
          </Suspense>
        }
        action={
          <Suspense fallback={<>
              <ActionSkeleton onBrand />
              <ActionSkeleton onBrand />
            </>}>
            <ClassroomActions portal="discover" onBrand />
          </Suspense>
        }
        figures={
          <Suspense
            fallback={
              <>
                <HeroFigureSkeleton label={t('cifraCursos')} />
                <HeroFigureSkeleton label={t('cifraInsignias')} />
                <HeroFigureSkeleton label={t('cifraPuntos')} />
              </>
            }
          >
            <HeroLearningFigures portal="discover" />
          </Suspense>
        }
      />

      {/* Solo aparece si no ha activado nada: sin kit, el resto de la portada se
          le queda vacia y este es el unico paso que puede dar. */}
      <Suspense fallback={null}>
        <NoKitNotice portal="discover" />
      </Suspense>

      <Suspense fallback={<CardSkeleton />}>
        <ContinueLearning portal="discover" />
      </Suspense>

      {/* La mision de la semana va DESPUES del curso a medias y ANTES de lo
          que viene: responde "que hago ahora", que es la pregunta siguiente a
          "donde lo deje". */}
      <Suspense fallback={<CardSkeleton />}>
        <WeeklyMission portal="discover" />
      </Suspense>

      <div className="grid gap-[var(--portal-gap)] lg:grid-cols-3">
        <Suspense fallback={<CardSkeleton />}>
          <UpcomingActivities portal="discover" />
        </Suspense>
        <Suspense fallback={<CardSkeleton />}>
          <RecentBadges portal="discover" />
        </Suspense>
      </div>
    </>
  );
}
