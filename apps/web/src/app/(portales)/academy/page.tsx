import type { Metadata } from 'next';
import { Suspense } from 'react';
import { KitIcon, LevelIcon } from '@glexco/icons';
import { requireSession } from '../../../lib/session';
import { fetchMyKits, gradeLabel } from '../../../lib/catalog';
import { fetchLearningProgress } from '../../../lib/learning';
import { Card, CardSkeleton, EmptyState, SectionTitle, Stat } from '../../../components/ui';
import { AnnouncementList } from '../../../components/announcements';
import { ContinueLearning } from '../../../components/continue-learning';

export const metadata: Metadata = { title: 'Academy' };

/**
 * Portada de Academy.
 *
 * A diferencia de Discover no abre con la banda azul de bienvenida: el canvas la
 * reserva para primaria a proposito. A un estudiante de diecisiete anos, una
 * cabecera que le saluda por su nombre de pila le habla como a un nino; lo que
 * espera arriba son sus cifras.
 */
export default async function AcademyHome() {
  const session = await requireSession();

  return (
    <>
      <section>
        <h1
          style={{ fontSize: 'var(--portal-title-size)' }}
          className="font-display font-semibold"
        >
          Mi formación
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          {session.firstName} {session.lastName}
        </p>
      </section>

      {/* Las cifras van en su propio Suspense: son de otro servicio y no pueden
          retrasar la ruta formativa, que es lo que se viene a mirar. */}
      <Suspense fallback={<CifrasSkeleton />}>
        <Cifras />
      </Suspense>

      <Suspense fallback={<CardSkeleton />}>
        <ContinueLearning portal="academy" />
      </Suspense>

      <Suspense fallback={<CardSkeleton />}>
        <RutaFormativa />
      </Suspense>

      {/* Debajo de los kits, no encima. Lo primero que busca el alumno es su
          contenido; un aviso del docente es importante pero no puede empujar
          fuera de la pantalla aquello a lo que viene a entrar. */}
      <Suspense fallback={<CardSkeleton />}>
        <AnnouncementList hideWhenEmpty />
      </Suspense>
    </>
  );
}

/**
 * Las tres cifras de cabecera.
 *
 * Antes eran tres guiones fijos. Un guion en el sitio de un dato se lee como
 * "no tienes ninguno", no como "esto no esta hecho", asi que un alumno con tres
 * cursos en marcha veia un panel que le decia que no tenia nada.
 *
 * Son tres y no cuatro porque las horas acumuladas todavia no las mide nadie:
 * la cuarta tarjeta llegara cuando haya de donde sacarla.
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
          <div className="h-8 w-12 animate-pulse rounded bg-surface-200" />
          <p className="mt-1 text-sm text-ink-500">{label}</p>
        </div>
      ))}
    </div>
  );
}

async function RutaFormativa() {
  const { kits, failed } = await fetchMyKits();

  if (failed) {
    return (
      <EmptyState
        title="No pudimos cargar tu formación"
        description="Vuelve a intentarlo en un momento. Si continúa, escribe a soporte."
      />
    );
  }

  if (kits.length === 0) {
    return (
      <EmptyState
        icon={<KitIcon size={32} />}
        title="Aún no tienes contenido activado"
        description="Introduce el código de activación de tu libro para acceder a tu ruta formativa."
        action={{ href: '/academy/activar', label: 'Activar código' }}
      />
    );
  }

  return (
    <section aria-labelledby="ruta">
      <SectionTitle id="ruta">Ruta tecnológica GLEXCO</SectionTitle>

      <div className="grid gap-[var(--portal-gap)]">
        {kits.map((kit) => (
          <Card key={kit.kitId}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-[var(--portal-radius)] bg-brand-200/25 text-brand-700">
                  <LevelIcon size={22} />
                </span>
                <div>
                  <h3 className="font-display font-semibold">{kit.name}</h3>
                  <p className="text-sm text-ink-500">{gradeLabel(kit.grade)}</p>
                </div>
              </div>

              <a
                href={`/academy/biblioteca?kit=${kit.kitId}`}
                className="btn btn-secondary"
              >
                Ver contenido
              </a>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
