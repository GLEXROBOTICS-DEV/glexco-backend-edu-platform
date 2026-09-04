import type { Metadata } from 'next';
import { Suspense } from 'react';
import { KitIcon, RobotIcon } from '@glexco/icons';
import { requireSession } from '../../../lib/session';
import { fetchMyKits, gradeLabel } from '../../../lib/catalog';
import { Card, CardSkeleton, EmptyState, SectionTitle } from '../../../components/ui';
import { AnnouncementList } from '../../../components/announcements';
import { HeroFigureSkeleton, PortalHero } from '../../../components/portal-hero';
import { ContinueLearning, HeroLearningFigures } from '../../../components/continue-learning';

export const metadata: Metadata = { title: 'Discover' };

export default async function DiscoverHome() {
  const session = await requireSession();

  return (
    <>
      {/* El saludo se pinta ya, con el nombre que trae la sesion; solo las tres
          cifras esperan al servicio de aprendizaje, y lo hacen sobre un hueco de
          su misma altura para que la banda no cambie de tamano al llegar. */}
      <PortalHero
        greeting={`¡Hola, ${session.firstName}!`}
        subtitle="Continúa tu aventura donde la dejaste."
        figures={
          <Suspense
            fallback={
              <>
                <HeroFigureSkeleton label="cursos" />
                <HeroFigureSkeleton label="insignias" />
                <HeroFigureSkeleton label="puntos" />
              </>
            }
          >
            <HeroLearningFigures portal="discover" />
          </Suspense>
        }
      />

      <Suspense fallback={<CardSkeleton />}>
        <ContinueLearning portal="discover" />
      </Suspense>

      {/* Suspense con un esqueleto con la FORMA del contenido, no un spinner
          generico: el alumno ve enseguida cuantas tarjetas vienen y la pagina no
          da el salto de maquetacion cuando llegan. */}
      <Suspense fallback={<KitsSkeleton />}>
        <MisKits />
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

async function MisKits() {
  const { kits, failed } = await fetchMyKits();

  if (failed) {
    return (
      <EmptyState
        title="No pudimos cargar tus kits"
        description="Vuelve a intentarlo en un momento. Si sigue pasando, avisa a tu docente."
      />
    );
  }

  if (kits.length === 0) {
    return (
      <EmptyState
        icon={<KitIcon size={32} />}
        title="Todavía no tienes ningún kit"
        description="Activa el código que viene dentro de tu libro para desbloquear tu contenido."
        action={{ href: '/discover/activar', label: 'Activar mi código' }}
      />
    );
  }

  return (
    <section aria-labelledby="mis-kits">
      <SectionTitle id="mis-kits">Mi kit</SectionTitle>

      <div className="grid gap-[var(--portal-gap)] sm:grid-cols-2">
        {kits.map((kit) => (
          <Card key={kit.kitId}>
            <div className="flex items-start gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-[calc(var(--portal-radius)*0.75)] bg-brand-200/25 text-brand-600">
                <RobotIcon size={26} />
              </span>
              <div className="min-w-0">
                <h3 className="truncate font-display text-lg font-semibold">{kit.name}</h3>
                <p className="mt-0.5 text-sm text-ink-500">{gradeLabel(kit.grade)}</p>
                {kit.robotPlatforms.length > 0 ? (
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    {kit.robotPlatforms.map((platform) => (
                      <li
                        key={platform}
                        className="rounded-full bg-state-warn-bg px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-state-warn-fg"
                      >
                        {platform}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>

            <a
              href={`/discover/biblioteca?kit=${kit.kitId}`}
              className="btn btn-primary mt-5"
            >
              Continuar aprendiendo
            </a>
          </Card>
        ))}
      </div>
    </section>
  );
}

function KitsSkeleton() {
  return (
    <div className="grid gap-[var(--portal-gap)] sm:grid-cols-2">
      <CardSkeleton />
      <CardSkeleton />
    </div>
  );
}
