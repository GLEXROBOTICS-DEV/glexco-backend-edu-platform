import { getFormatter, getTranslations } from 'next-intl/server';
import { BadgeIcon, RobotIcon } from '@glexco/icons';
import { fetchMyKits } from '../lib/catalog';
import { fetchAvailableAssessments, fetchMyResult } from '../lib/assessments';
import { EmptyState, StatePill } from './ui';
import { EvidenceView } from './evidence-view';

/**
 * El portafolio: lo que el alumno YA ha construido.
 *
 * No es una lista de notas y esa es la diferencia con «Mi progreso». Aquí lo que
 * se ve es el trabajo: qué montó, qué entregó y qué le dijo su docente. Un
 * portafolio existe para poder ENSEÑARLO —a la familia, al siguiente profesor,
 * a quien le entreviste algún día—, y una tabla de porcentajes no se enseña.
 *
 * **Se construye con lo que ya hay.** No hay tabla de portafolio ni evento nuevo:
 * un elemento de portafolio es una entrega corregida de un reto o un proyecto,
 * con su evidencia. Crear un agregado aparte obligaría a copiar cada entrega en
 * dos sitios y a mantenerlos de acuerdo, y el día que se despegaran nadie sabría
 * cuál es la buena.
 *
 * Lo que aquí NO se pinta es un cuestionario. Un examen de marcar aprobado no es
 * una pieza de portafolio: no hay nada que mostrar.
 */

const HANDS_ON = new Set(['practical', 'project', 'stem_activity']);

export async function Portfolio({ portal }: { portal: 'discover' | 'academy' }) {
  const { kits, failed } = await fetchMyKits();
  const t = await getTranslations('portafolio');
  const vocab = await getTranslations();
  const format = await getFormatter();

  if (failed) {
    return <EmptyState title={t('falloTitulo')} description={t('falloDescripcion')} />;
  }

  if (kits.length === 0) {
    return (
      <EmptyState
        icon={<RobotIcon size={32} />}
        title={vocab('sinKit.tituloDiscover')}
        description={vocab('sinKit.descripcion')}
        action={{ href: `/${portal}/activar`, label: vocab('sinKit.accion') }}
      />
    );
  }

  // Los retos de todos sus kits, y de cada uno su resultado. Son unas pocas
  // llamadas -los retos por kit se cuentan con los dedos- y a cambio no hace
  // falta un endpoint nuevo ni una proyeccion que mantener al dia.
  const candidates = (
    await Promise.all(
      kits.map(async (kit) => {
        const { items } = await fetchAvailableAssessments(kit.kitId);
        return items.filter((item) => HANDS_ON.has(item.kind)).map((item) => ({ kit, item }));
      }),
    )
  ).flat();

  const pieces = (
    await Promise.all(
      candidates.map(async ({ kit, item }) => {
        const result = await fetchMyResult(item.assessmentId);
        // Solo lo ENTREGADO entra. Un reto que existe y que nadie ha hecho no es
        // una pieza de portafolio, es una tarea pendiente, y su sitio es la zona
        // de retos.
        if (!result?.best) return null;
        return { kit, item, best: result.best };
      }),
    )
  ).filter((piece): piece is NonNullable<typeof piece> => piece !== null);

  if (pieces.length === 0) {
    return (
      <EmptyState
        icon={<BadgeIcon size={32} />}
        title={t('vacioTitulo')}
        description={t('vacioDescripcion')}
        action={{ href: `/${portal}/${portal === 'discover' ? 'retos' : 'proyectos'}`, label: t('verRetos') }}
      />
    );
  }

  // Lo más reciente primero: un portafolio se lee por arriba, y lo último que
  // hizo es lo que quiere enseñar.
  const ordered = [...pieces].sort(
    (a, b) =>
      Date.parse(b.best.gradedAt ?? b.best.submittedAt ?? '') -
      Date.parse(a.best.gradedAt ?? a.best.submittedAt ?? ''),
  );

  return (
    <ul className="grid list-none gap-[var(--portal-gap)]" data-portfolio={ordered.length}>
      {ordered.map(({ kit, item, best }) => {
        const percentage =
          best.score !== null && best.maxScore > 0
            ? Math.round((best.score / best.maxScore) * 100)
            : null;

        // La evidencia puede no existir: lo normal es que el docente revise el
        // montaje en clase. Su ausencia no es un fallo ni se pinta como tal.
        const evidence = best.evidenceAssetIds?.[0];

        return (
          <li
            key={item.assessmentId}
            data-piece={item.assessmentId}
            className="rounded-[var(--portal-radius)] border border-line-200 bg-white p-[var(--portal-card-padding)]"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-display text-lg font-semibold">{item.title}</h2>
                <p className="mt-0.5 text-sm text-ink-500">
                  {kit.name} · {t(`tipo.${item.kind}`)}
                  {best.gradedAt
                    ? ` · ${t('entregadoEl', {
                        fecha: format.dateTime(new Date(best.gradedAt), {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                          timeZone: 'America/Lima',
                        }),
                      })}`
                    : ''}
                </p>
              </div>

              {/* La nota va con su palabra, no solo con el color: el par
                  aprobado/no aprobado en verde y rojo es indistinguible con
                  protanopía. */}
              {percentage === null ? (
                <StatePill state="doing">{t('enRevision')}</StatePill>
              ) : (
                <StatePill state={best.passed ? 'done' : 'late'}>
                  {best.passed ? t('logrado') : t('porMejorar')} · {percentage} %
                </StatePill>
              )}
            </div>

            {evidence ? (
              <div className="mt-4">
                <EvidenceView mediaAssetId={evidence} />
              </div>
            ) : null}

            {/* El comentario del docente es la mitad del valor de un portafolio:
                la nota dice cuánto, y el comentario dice qué. */}
            {best.feedback ? (
              <div className="mt-4 rounded-[calc(var(--portal-radius)*0.75)] bg-state-doing-bg p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-state-doing-fg">
                  {t('deTuDocente')}
                </p>
                <p className="mt-1.5 text-sm text-ink-900">{best.feedback}</p>
              </div>
            ) : null}

            <a
              href={`/${portal}/evaluaciones/${item.assessmentId}`}
              className="mt-4 inline-block text-sm font-medium text-brand-600 hover:underline"
            >
              {t('verDetalle')}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
