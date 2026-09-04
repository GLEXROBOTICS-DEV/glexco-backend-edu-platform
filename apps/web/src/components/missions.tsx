import type { TranslationValues } from 'next-intl';
import { getFormatter, getTranslations } from 'next-intl/server';
import { BadgeIcon, BuildIcon } from '@glexco/icons';
import { fetchMyKits } from '../lib/catalog';
import { currentMission, fetchMissions, type MissionItem } from '../lib/missions';
import { ProgressBar } from './continue-learning';
import { EmptyState, SectionTitle, StatePill } from './ui';

/**
 * La misión de la semana, en el dashboard.
 *
 * Una sola: la de esta semana, o la más vieja que quedó pendiente. La portada
 * responde «qué hago ahora» y una lista de ocho misiones no responde eso; el
 * listado completo vive en la zona de retos.
 *
 * **Se enseña la vencida antes que la bloqueada, y eso es deliberado.** El
 * cliente decidió que una misión sin terminar no reprograma nada: queda
 * pendiente y se puede completar tarde. Poner delante la que se quedó atrás
 * convierte un «llegas tarde» en un «todavía puedes», que es la diferencia entre
 * un niño que retoma y uno que abandona.
 */
export async function WeeklyMission({ portal }: { portal: 'discover' | 'academy' }) {
  const { kits, failed } = await fetchMyKits();

  // Sin kit no hay misiones, y ya hay un aviso en la portada que dice qué hacer:
  // repetirlo aquí sería decirle dos veces lo mismo en la misma pantalla.
  if (failed || kits.length === 0) return null;

  const t = await getTranslations('misiones');
  const format = await getFormatter();

  // El primer kit: es el que la portada usa para todo lo demás. Quien tenga dos
  // ve las del otro en su zona de retos, donde están separadas por kit.
  const kit = kits[0]!;
  const { items } = await fetchMissions(kit.kitId);
  const mission = currentMission(items);

  if (!mission) return null;

  const completadas = items.filter((item) => item.state === 'completed').length;

  return (
    <article
      className="rounded-[var(--portal-radius)] border border-line-200 bg-white p-[var(--portal-card-padding)]"
      data-mission={mission.missionId}
      data-mission-state={mission.state}
    >
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="eyebrow">{t('tituloBloque')}</h2>
        <a
          href={`/${portal}/${portal === 'discover' ? 'retos' : 'proyectos'}`}
          className="text-sm font-medium text-brand-600 hover:text-brand-400"
        >
          {t('verTodas')}
        </a>
      </div>

      <MissionBody mission={mission} t={t} format={format} />

      {/* Cuántas lleva del total: es lo que da sentido a "semana 3 de 8" y lo
          que hace que completar una se sienta como avanzar y no como tachar. */}
      <p className="mt-4 text-xs text-ink-500">
        {t('completadasDeTotal', { hechas: completadas, total: items.length })}
      </p>
    </article>
  );
}

/**
 * La lista completa, por semana.
 *
 * Va en la zona de retos porque es lo mismo: cosas que hacer con el kit. Se
 * enseñan TAMBIÉN las que aún no han abierto —saber lo que viene es la mitad de
 * para qué existe una misión semanal— y se distinguen por estado, no por
 * ausencia.
 *
 * No recibe `portal` y no enlaza a ninguna parte: una misión no se abre, se
 * cumple haciendo el trabajo que pide. Un botón «empezar la misión» prometería
 * una pantalla que no existe.
 */
export async function MissionList() {
  const { kits, failed } = await fetchMyKits();
  if (failed || kits.length === 0) return null;

  const t = await getTranslations('misiones');
  const format = await getFormatter();

  const grupos = await Promise.all(
    kits.map(async (kit) => ({ kit, items: (await fetchMissions(kit.kitId)).items })),
  );

  const total = grupos.reduce((sum, grupo) => sum + grupo.items.length, 0);
  if (total === 0) {
    return (
      <EmptyState
        level={3}
        icon={<BuildIcon size={32} />}
        title={t('vacioTitulo')}
        description={t('vacioDescripcion')}
      />
    );
  }

  return (
    <>
      {grupos
        .filter((grupo) => grupo.items.length > 0)
        .map((grupo) => (
          <section key={grupo.kit.kitId} aria-labelledby={`misiones-${grupo.kit.kitId}`}>
            <SectionTitle id={`misiones-${grupo.kit.kitId}`}>
              {t('tituloDeKit', { kit: grupo.kit.name })}
            </SectionTitle>

            <ul className="grid list-none gap-3" data-missions={grupo.items.length}>
              {[...grupo.items]
                .sort((a, b) => a.weekNumber - b.weekNumber)
                .map((mission) => (
                  <li
                    key={mission.missionId}
                    data-mission={mission.missionId}
                    data-mission-state={mission.state}
                    className={`rounded-[var(--portal-radius)] border p-[var(--portal-card-padding)] ${
                      mission.state === 'locked'
                        ? 'border-dashed border-line-300 bg-surface-50'
                        : 'border-line-200 bg-white'
                    }`}
                  >
                    <MissionBody mission={mission} t={t} format={format} />
                  </li>
                ))}
            </ul>
          </section>
        ))}
    </>
  );
}

/**
 * El cuerpo de una misión, compartido por el bloque y la lista.
 *
 * Recibe el traductor y el formateador por props: la lista puede tener veinte, y
 * pedirlos dentro abriría veinte puntos de suspensión.
 */
function MissionBody({
  mission,
  t,
  format,
}: {
  mission: MissionItem;
  t: (key: string, values?: TranslationValues) => string;
  format: Awaited<ReturnType<typeof getFormatter>>;
}) {
  const percent =
    mission.total === 0 ? 0 : Math.round((mission.met / mission.total) * 100);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-400">
            {t('semana', { numero: mission.weekNumber })}
          </p>
          <h3 className="mt-0.5 font-display text-lg font-semibold">{mission.title}</h3>
          <p className="mt-1 text-sm text-ink-500">{mission.description}</p>
        </div>

        {/* El estado en TEXTO y no solo con el borde: el par «pendiente» y
            «vencida» en dos grises no lo distingue nadie, y un lector de
            pantalla no lee un borde discontinuo. */}
        <MissionPill mission={mission} t={t} format={format} />
      </div>

      {mission.state === 'completed' ? (
        <p className="mt-4 flex items-center gap-2 text-sm font-medium text-state-done-fg">
          <BadgeIcon size={18} />
          {mission.onTime === false
            ? t('completadaTarde', { puntos: mission.xpReward })
            : t('completadaATiempo', { puntos: mission.xpReward })}
        </p>
      ) : (
        <div className="mt-4">
          <ProgressBar
            percent={percent}
            label={t('avanceDe', { mision: mission.title })}
            className="max-w-md"
          />

          <ul className="mt-3 grid gap-1.5">
            {mission.objectives.map((objective, index) => (
              <li key={index} className="flex items-baseline gap-2 text-sm">
                {/* La marca lleva su texto en `sr-only`: un tic verde no lo lee
                    un lector de pantalla, y el estado de cada objetivo es justo
                    lo que hace falta para saber qué falta. */}
                <span
                  className={objective.done ? 'text-state-done-fg' : 'text-ink-300'}
                  aria-hidden="true"
                >
                  {objective.done ? '✓' : '○'}
                </span>
                <span className="sr-only">
                  {objective.done ? t('objetivoHecho') : t('objetivoPendiente')}
                </span>
                <span className={objective.done ? 'text-ink-500' : 'text-ink-700'}>
                  {t(`objetivo.${objective.kind}`, { cuantos: objective.target })}
                  {' · '}
                  {t('avanceObjetivo', {
                    actual: Math.min(objective.current, objective.target),
                    total: objective.target,
                  })}
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-3 text-xs text-ink-400">
            {t('recompensa', { puntos: mission.xpReward })}
          </p>
        </div>
      )}
    </>
  );
}

function MissionPill({
  mission,
  t,
  format,
}: {
  mission: MissionItem;
  t: (key: string, values?: TranslationValues) => string;
  format: Awaited<ReturnType<typeof getFormatter>>;
}) {
  if (mission.state === 'completed') {
    return <StatePill state="done">{t('estado.completed')}</StatePill>;
  }

  if (mission.state === 'overdue') {
    // No dice «fuera de plazo» a secas: dice que todavía se puede. La misión no
    // se cierra, y el aviso tiene que decir eso o el alumno la abandona.
    return <StatePill state="late">{t('estado.overdue')}</StatePill>;
  }

  if (mission.state === 'locked') {
    return (
      <StatePill state="idle">
        {mission.opensAt
          ? t('abreEl', {
              fecha: format.dateTime(new Date(mission.opensAt), {
                day: 'numeric',
                month: 'short',
                timeZone: 'America/Lima',
              }),
            })
          : t('estado.locked')}
      </StatePill>
    );
  }

  return <StatePill state="doing">{t('estado.current')}</StatePill>;
}
