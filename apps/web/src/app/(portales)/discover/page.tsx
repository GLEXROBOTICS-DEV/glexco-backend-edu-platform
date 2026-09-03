import type { Metadata } from 'next';
import { Suspense } from 'react';
import { KitIcon, RobotIcon } from '@glexco/icons';
import { requireSession } from '../../../lib/session';
import { fetchMyKits, gradeLabel } from '../../../lib/catalog';
import { Card, CardSkeleton, EmptyState, SectionTitle } from '../../../components/ui';

export const metadata: Metadata = { title: 'Discover' };

export default async function DiscoverHome() {
  const session = await requireSession();

  return (
    <>
      <section>
        <p className="text-sm font-medium text-ink-500">Hola, {session.firstName}</p>
        <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="font-semibold">
          Continúa tu aventura
        </h1>
      </section>

      {/* Suspense con un esqueleto con la FORMA del contenido, no un spinner
          generico: el alumno ve enseguida cuantas tarjetas vienen y la pagina no
          da el salto de maquetacion cuando llegan. */}
      <Suspense fallback={<KitsSkeleton />}>
        <MisKits />
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
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-600/10 text-brand-600">
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
                        className="rounded-full bg-surface-200 px-2.5 py-1 text-xs font-medium uppercase tracking-wide text-ink-700"
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
              className="mt-5 inline-flex rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
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
