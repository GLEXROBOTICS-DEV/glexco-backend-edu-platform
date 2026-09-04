import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireSession } from '../../../lib/session';
import { fetchLearningProgress } from '../../../lib/learning';
import { CardSkeleton, Stat } from '../../../components/ui';
import { ActionSkeleton, AnnouncementsAction, PageHeader } from '../../../components/page-header';
import { ContinueLearning } from '../../../components/continue-learning';
import { LearningPath } from '../../../components/learning-path';
import { RecentBadges, UpcomingActivities } from '../../../components/upcoming';
import { NoKitNotice } from '../../../components/no-kit-notice';

export const metadata: Metadata = { title: 'Academy' };

/**
 * Portada de Academy.
 *
 * A diferencia de Discover no abre con la banda azul de bienvenida: el canvas la
 * reserva para primaria a proposito. A un estudiante de diecisiete anos, una
 * cabecera que le saluda por su nombre de pila le habla como a un nino; lo que
 * espera arriba son sus cifras.
 *
 * El orden es el del canvas y responde a tres preguntas en este orden: como voy
 * (cifras), a donde lleva esto (ruta), y que hago ahora (continuar y proximas).
 */
export default async function AcademyHome() {
  const session = await requireSession();

  return (
    <>
      <PageHeader
        title="Mi formación"
        subtitle={`${session.firstName} ${session.lastName}`}
        actions={
          <Suspense fallback={<ActionSkeleton />}>
            <AnnouncementsAction portal="academy" />
          </Suspense>
        }
      />

      {/* Solo aparece si no ha activado nada: sin kit, el resto de la portada
          se le queda vacia y este es el unico paso que puede dar. */}
      <Suspense fallback={null}>
        <NoKitNotice portal="academy" />
      </Suspense>

      <Suspense fallback={<CifrasSkeleton />}>
        <Cifras />
      </Suspense>

      {/* La ruta ocupa dos tercios y las proximas actividades el otro: eran las
          dos de dos tercios, asi que en pantalla ancha la segunda saltaba de fila
          y dejaba un hueco. */}
      <div className="grid gap-[var(--portal-gap)] lg:grid-cols-3">
        <Suspense fallback={<CardSkeleton />}>
          <LearningPath />
        </Suspense>
        <Suspense fallback={<CardSkeleton />}>
          <UpcomingActivities portal="academy" className="" />
        </Suspense>
      </div>

      <Suspense fallback={<CardSkeleton />}>
        <ContinueLearning portal="academy" />
      </Suspense>

      {/* Los logros tambien en Academy: la gamificacion no deja de motivar a los
          diecisiete anos, solo cambia el tono. */}
      <Suspense fallback={<CardSkeleton />}>
        <RecentBadges portal="academy" />
      </Suspense>


    </>
  );
}

/**
 * Las cifras de cabecera.
 *
 * Antes eran tres guiones fijos. Un guion en el sitio de un dato se lee como
 * "no tienes ninguno", no como "esto no esta hecho", asi que un alumno con tres
 * cursos en marcha veia un panel que le decia que no tenia nada.
 *
 * El canvas dibuja cuatro; aqui hay tres porque las horas acumuladas no las mide
 * nadie todavia y la de certificaciones llega con la fase de certificados. Una
 * cuarta tarjeta clavada en 0 para siempre es peor que no tenerla.
 */
async function Cifras() {
  const { data, failed } = await fetchLearningProgress();
  if (failed) return null;

  const activos = data.courses.filter((c) => c.lessonsCompleted < c.lessonCount).length;

  return (
    <section aria-labelledby="resumen" className="grid gap-[var(--portal-gap)] sm:grid-cols-3">
      <h2 id="resumen" className="sr-only">
        Resumen de tu formación
      </h2>
      <Stat value={String(activos)} label="Cursos activos" />
      <Stat value={String(data.coursesCompleted)} label="Completados" />
      <Stat value={String(data.badges.length)} label="Logros" />
    </section>
  );
}

function CifrasSkeleton() {
  return (
    <div className="grid gap-[var(--portal-gap)] sm:grid-cols-3" aria-hidden="true">
      {['Cursos activos', 'Completados', 'Logros'].map((label) => (
        <div
          key={label}
          className="rounded-[var(--portal-radius)] border border-line-200 bg-white p-[var(--portal-card-padding)]"
        >
          <p className="mb-2 text-xs text-ink-500">{label}</p>
          <div className="h-7 w-12 animate-pulse rounded bg-surface-200" />
        </div>
      ))}
    </div>
  );
}
