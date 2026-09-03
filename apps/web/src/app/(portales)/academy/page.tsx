import type { Metadata } from 'next';
import { Suspense } from 'react';
import { KitIcon, LevelIcon } from '@glexco/icons';
import { requireSession } from '../../../lib/session';
import { fetchMyKits, gradeLabel } from '../../../lib/catalog';
import { Card, CardSkeleton, EmptyState, SectionTitle, Stat } from '../../../components/ui';
import { AnnouncementList } from '../../../components/announcements';

export const metadata: Metadata = { title: 'Academy' };

export default async function AcademyHome() {
  const session = await requireSession();

  return (
    <>
      <section>
        <p className="text-sm font-medium text-ink-500">
          {session.firstName} {session.lastName}
        </p>
        <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="font-semibold">
          Mi formación
        </h1>
      </section>

      {/* Las cifras van fuera del Suspense de los cursos: son baratas de
          calcular y verlas de inmediato da sensacion de pagina cargada aunque el
          resto tarde. */}
      <section aria-labelledby="resumen" className="grid gap-[var(--portal-gap)] sm:grid-cols-3">
        <h2 id="resumen" className="sr-only">
          Resumen de tu formación
        </h2>
        <Stat value="—" label="Cursos activos" />
        <Stat value="—" label="Completados" />
        <Stat value="—" label="Horas acumuladas" />
      </section>

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
                <span className="grid size-10 place-items-center rounded-lg bg-brand-700/10 text-brand-700">
                  <LevelIcon size={22} />
                </span>
                <div>
                  <h3 className="font-display font-semibold">{kit.name}</h3>
                  <p className="text-sm text-ink-500">{gradeLabel(kit.grade)}</p>
                </div>
              </div>

              <a
                href={`/academy/biblioteca?kit=${kit.kitId}`}
                className="rounded-lg border border-brand-600 px-4 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-600 hover:text-white"
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
