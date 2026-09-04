import type { TranslationValues } from 'next-intl';
import { getFormatter, getTranslations } from 'next-intl/server';
import { ChallengeIcon, RobotIcon } from '@glexco/icons';
import { fetchMyKits } from '../lib/catalog';
import { fetchAvailableAssessments, type AssessmentSummary } from '../lib/assessments';
import { Card, EmptyState, SectionTitle, StatePill } from './ui';

/**
 * Retos y proyectos: lo que se hace CON LAS MANOS.
 *
 * El canvas dibuja «Zona de retos» en Discover y «Proyectos y desafíos» en
 * Academy, y hasta ahora esas dos entradas no existían. La tentación era crear
 * un dominio nuevo de retos, con su publicación, sus plazos, su corrección y su
 * analítica; y sería duplicar entero lo que ya hace `assessment`.
 *
 * **Un reto de construcción ES una evaluación de tipo `practical`.** Un proyecto
 * final es una de tipo `project`. Ya se publican, ya tienen plazo, ya llegan a
 * la bandeja del docente y ya cuentan en los dashboards. Lo único que faltaba
 * era la pantalla que los separa de los cuestionarios: mezclados en «Mis
 * actividades», un examen de marcar y un montaje que ocupa una tarde se leían
 * igual, y son dos cosas que el alumno planifica de forma distinta.
 *
 * Aquí no se listan cuestionarios, y en «Mis actividades» se sigue listando
 * todo: quien busque «lo que tengo pendiente» lo encuentra en un sitio, y quien
 * busque «qué construyo» lo encuentra en el otro.
 */

/** Lo que se hace con las manos. Un `quiz` no entra. */
const HANDS_ON = new Set(['practical', 'project', 'stem_activity']);

export async function ChallengeList({ portal }: { portal: 'discover' | 'academy' }) {
  const { kits, failed } = await fetchMyKits();
  const t = await getTranslations('retos');
  const vocab = await getTranslations();
  const format = await getFormatter();

  if (failed) {
    return <EmptyState title={t('falloTitulo')} description={t('falloDescripcion')} />;
  }

  if (kits.length === 0) {
    return (
      <EmptyState
        icon={<ChallengeIcon size={32} />}
        title={vocab('sinKit.tituloDiscover')}
        description={vocab('sinKit.descripcion')}
        action={{ href: `/${portal}/activar`, label: vocab('sinKit.accion') }}
      />
    );
  }

  const groups = await Promise.all(
    kits.map(async (kit) => ({
      kit,
      items: (await fetchAvailableAssessments(kit.kitId)).items.filter((item) =>
        HANDS_ON.has(item.kind),
      ),
    })),
  );

  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  if (total === 0) {
    return (
      <EmptyState
        icon={<RobotIcon size={32} />}
        title={portal === 'discover' ? t('sinRetosTitulo') : t('sinProyectosTitulo')}
        description={t('sinRetosDescripcion')}
      />
    );
  }

  return (
    <>
      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <section key={group.kit.kitId} aria-labelledby={`retos-${group.kit.kitId}`}>
            <SectionTitle id={`retos-${group.kit.kitId}`}>{group.kit.name}</SectionTitle>

            <ul className="grid list-none gap-[var(--portal-gap)] sm:grid-cols-2">
              {group.items.map((item) => (
                <li key={item.assessmentId}>
                  <ChallengeCard portal={portal} item={item} t={t} format={format} />
                </li>
              ))}
            </ul>
          </section>
        ))}
    </>
  );
}

/**
 * Una tarjeta de reto.
 *
 * Lleva el TIPO en texto -«Reto de construcción», «Proyecto»- y no solo un
 * icono. El alumno decide con eso si esto le ocupa veinte minutos o un fin de
 * semana, y es la primera cosa que necesita saber.
 */
function ChallengeCard({
  portal,
  item,
  t,
  format,
}: {
  portal: 'discover' | 'academy';
  item: AssessmentSummary;
  /** Por props: es una lista, y el padre ya lo tiene. */
  t: (key: string, values?: TranslationValues) => string;
  format: Awaited<ReturnType<typeof getFormatter>>;
}) {
  return (
    <Card className="flex h-full flex-col">
      <div className="flex items-start gap-4">
        <span
          className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--portal-accent)] text-brand-700"
          aria-hidden="true"
        >
          <RobotIcon size={22} />
        </span>

        <div className="min-w-0 flex-1">
          <h3 className="font-display text-base font-semibold">{item.title}</h3>

          <p className="mt-0.5 text-sm text-ink-500">
            {t(`tipo.${item.kind}`)} · {t('puntos', { puntos: item.totalPoints })}
          </p>

          {item.dueAt ? (
            <p className="mt-2">
              <StatePill state={dueState(item.dueAt)}>{dueLabel(item.dueAt, t, format)}</StatePill>
            </p>
          ) : null}

          {/* De dónde viene: el alumno tiene derecho a saber si lo evalúa
              material de GLEXCO -igual para todos- o algo de su profesor. */}
          <p className="mt-2 text-xs text-ink-400">
            {item.origin === 'glexco' ? t('incluidoEnTuKit') : t('deTuDocente')}
          </p>
        </div>
      </div>

      {/* Al resultado y NO directamente a responder: abrir para mirar no puede
          gastar un intento. Es la misma separación que se hizo en los
          cuestionarios cuando el cliente reportó «ya agoté mis intentos». */}
      <a
        href={`/${portal}/evaluaciones/${item.assessmentId}`}
        className="btn btn-primary mt-5 justify-self-start"
      >
        {t('abrir')}
      </a>
    </Card>
  );
}

function dueState(iso: string): 'late' | 'warn' | 'idle' {
  const days = daysLeft(iso);
  if (days === null) return 'idle';
  if (days < 0) return 'late';
  if (days <= 2) return 'warn';
  return 'idle';
}

function dueLabel(
  iso: string,
  t: (key: string, values?: TranslationValues) => string,
  format: Awaited<ReturnType<typeof getFormatter>>,
): string {
  const days = daysLeft(iso);
  if (days === null) return '';
  if (days < 0) return t('cerrado');
  if (days === 0) return t('cierraHoy');
  if (days === 1) return t('cierraManana');
  if (days <= 7) return t('cierraEnDias', { dias: days });

  return t('cierraElDia', {
    fecha: format.dateTime(new Date(iso), {
      day: 'numeric',
      month: 'long',
      timeZone: 'America/Lima',
    }),
  });
}

function daysLeft(iso: string): number | null {
  const due = new Date(iso).getTime();
  if (Number.isNaN(due)) return null;
  return Math.ceil((due - Date.now()) / 86_400_000) - 1;
}
