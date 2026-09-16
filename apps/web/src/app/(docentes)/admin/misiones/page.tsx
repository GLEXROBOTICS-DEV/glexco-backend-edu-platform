import type { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PERMISSIONS } from '@glexco/contracts';
import { requireSession } from '../../../../lib/session';
import { fetchAllKits } from '../../../../lib/catalog';
import { gradeLabel, safeLabel } from '../../../../lib/vocabulary';
import {
  fetchAuthoredMissions,
  occupiedWeeks,
  type AuthoredMission,
} from '../../../../lib/missions.authoring';
import { Card, CardSkeleton, EmptyState, SectionTitle, StatePill } from '../../../../components/ui';
import { PageHeader } from '../../../../components/page-header';
import { MissionForm } from '../../../../components/mission-form';

export const metadata: Metadata = { title: 'Misiones' };

/**
 * Misiones semanales de un kit.
 *
 * **Era la pieza sin camino.** El modelo estaba entero desde la Fase 5 -incluido
 * `origin`, porque el cliente ya dijo que las instituciones podrian ajustarlas-
 * y `assertMissionIsUsable` validaba sin que nadie la invocara: las misiones
 * solo entraban por el sembrador, escribiendo directo en PostgreSQL. En Railway,
 * donde la base no esta expuesta -ni debe estarlo-, no habia forma de publicar
 * ninguna, y la Zona de retos del alumno decia "todavia no hay misiones".
 *
 * El kit se elige por la URL y no con estado de cliente: asi la pantalla se
 * puede enlazar, compartir y recargar, y funciona sin JavaScript.
 */
export default async function AdminMisiones({
  searchParams,
}: {
  searchParams: Promise<{ kit?: string }>;
}) {
  const session = await requireSession();

  // Mismo permiso que el resto de la publicacion de contenido: una mision es
  // contenido que viene con el kit. Quien llegue aqui por una URL copiada va a
  // su panel, no a una pantalla de error.
  if (!session.permissions.includes(PERMISSIONS.CONTENT_PUBLISH)) {
    redirect('/admin');
  }

  const { kit } = await searchParams;
  const t = await getTranslations('admin');

  return (
    <>
      <PageHeader title={t('misionesTitulo')} subtitle={t('misionesSubtitulo')} />

      <Suspense fallback={<CardSkeleton />}>
        <Kits selected={kit ?? null} />
      </Suspense>
    </>
  );
}

/**
 * El selector de kit, y lo que cuelga de el.
 *
 * Es un `<form method="get">` y no un desplegable con JavaScript: el kit acaba
 * en la URL, que es donde tiene que estar para poder volver a esta pantalla.
 */
async function Kits({ selected }: { selected: string | null }) {
  const t = await getTranslations('admin');
  const vocab = await getTranslations();
  const { items } = await fetchAllKits({ includeUnpublished: true });

  if (items.length === 0) {
    return (
      <EmptyState
        title={t('sinKits')}
        description={t('sinKitsParaMisiones')}
      />
    );
  }

  // Sin kit elegido se toma el primero, en vez de ensenar un hueco: quien entra
  // aqui quiere ver misiones, y obligarle a elegir antes de mostrar nada es un
  // paso que no decide nada.
  const kitId = selected && items.some((item) => item.kitId === selected) ? selected : items[0]!.kitId;

  return (
    <>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">{t('kitParaMisiones')}</span>
          <select name="kit" defaultValue={kitId} className="field min-w-[16rem]">
            {items.map((item) => (
              <option key={item.kitId} value={item.kitId}>
                {item.name} · {gradeLabel(vocab, item.grade)}
              </option>
            ))}
          </select>
        </label>
        {/* Sin JavaScript el desplegable no dispara nada, asi que el boton no es
            decorativo: es la unica forma de cambiar de kit en un equipo escolar
            con el bundle a medias. */}
        <button type="submit" className="btn btn-secondary">
          {t('eligeUnKit')}
        </button>
      </form>

      <Suspense fallback={<CardSkeleton />}>
        <Misiones kitId={kitId} />
      </Suspense>
    </>
  );
}

async function Misiones({ kitId }: { kitId: string }) {
  const t = await getTranslations('admin');
  const { items, failed } = await fetchAuthoredMissions(kitId);

  if (failed) {
    return (
      <EmptyState
        title={t('noPudimosLeerCatalogo')}
        description={t('vuelveAIntentarloAdmin')}
      />
    );
  }

  const ocupadas = [...occupiedWeeks(items)];

  return (
    <>
      <section aria-labelledby="misiones" className="grid gap-[var(--portal-gap)]">
        <SectionTitle id="misiones">{t('misionesDelKit', { cuantas: items.length })}</SectionTitle>

        {items.length === 0 ? (
          <EmptyState title={t('sinMisionesEnKit')} description={t('sinMisionesEnKitAyuda')} />
        ) : (
          <ul className="grid list-none gap-3" data-missions={items.length}>
            {items.map((mission) => (
              <li key={mission.missionId}>
                <MissionCard mission={mission} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <MissionForm kitId={kitId} occupied={ocupadas} />
    </>
  );
}

async function MissionCard({ mission }: { mission: AuthoredMission }) {
  const t = await getTranslations('admin');
  const vocab = await getTranslations();

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow mb-1">{t('semanaNumero', { numero: mission.weekNumber })}</p>
          <h3 className="font-display text-base font-semibold">{mission.title}</h3>
          {mission.description ? (
            <p className="mt-1 text-sm text-ink-500">{mission.description}</p>
          ) : null}

          <ul className="mt-2 grid list-none gap-0.5 text-xs text-ink-500">
            {mission.objectives.map((objective, index) => (
              <li key={index}>
                {safeLabel(vocab, 'objetivosMision', objective.kind)}: {objective.target}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {/* El origen con su palabra y no solo con un color: es lo que dice si
              esta mision se puede tocar desde aqui, y esa es la invariante 8
              -contenido de GLEXCO es el mismo para todo el pais-. */}
          <StatePill state={mission.origin === 'glexco' ? 'idle' : 'done'}>
            {mission.origin === 'glexco' ? t('deGlexco') : t('deMiColegio')}
          </StatePill>
          <p className="text-xs font-medium text-ink-700">
            {t('puntosXp', { cuantos: mission.xpReward })}
          </p>
        </div>
      </div>
    </Card>
  );
}
