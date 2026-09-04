import type { TranslationValues } from 'next-intl';
import { getFormatter, getTranslations } from 'next-intl/server';
import { ChallengeIcon } from '@glexco/icons';
import { fetchMyKits } from '../lib/catalog';
import { fetchAvailableAssessments } from '../lib/assessments';
import { Card, EmptyState, SectionTitle, StatePill } from './ui';

/**
 * Las evaluaciones que el alumno puede hacer.
 *
 * Se listan por KIT y no de forma global porque el derecho de acceso es por
 * kit: un listado global seria el atajo por el que apareceria material de kits
 * no comprados. Es la misma razon por la que `listLibrary` exige `kitId` en el
 * backend.
 */
export async function AssessmentList({ portal }: { portal: 'discover' | 'academy' }) {
  const { kits, failed } = await fetchMyKits();
  const t = await getTranslations('evaluacion');
  const format = await getFormatter();

  if (failed) {
    return <EmptyState title={t('falloTitulo')} description={t('falloDescripcion')} />;
  }

  if (kits.length === 0) {
    return (
      <EmptyState
        icon={<ChallengeIcon size={32} />}
        title={t('sinKitTitulo')}
        description={t('sinKitDescripcion')}
      />
    );
  }

  const groups = await Promise.all(
    kits.map(async (kit) => ({
      kit,
      assessments: (await fetchAvailableAssessments(kit.kitId)).items,
    })),
  );

  const total = groups.reduce((sum, group) => sum + group.assessments.length, 0);

  if (total === 0) {
    return (
      <EmptyState
        icon={<ChallengeIcon size={32} />}
        title={portal === 'discover' ? t('sinActividadesTitulo') : t('sinEvaluacionesTitulo')}
        description={t('sinPublicarDescripcion')}
      />
    );
  }

  return (
    <>
      {groups
        .filter((group) => group.assessments.length > 0)
        .map((group) => (
          <section key={group.kit.kitId} aria-labelledby={`kit-${group.kit.kitId}`}>
            <SectionTitle id={`kit-${group.kit.kitId}`}>{group.kit.name}</SectionTitle>

            <div className="grid gap-[var(--portal-gap)] sm:grid-cols-2">
              {group.assessments.map((assessment) => (
                <Card key={assessment.assessmentId}>
                  <div className="flex items-start gap-4">
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-600/10 text-brand-600">
                      <ChallengeIcon size={22} />
                    </span>
                    <div className="min-w-0">
                      <h3 className="truncate font-display text-base font-semibold">
                        {assessment.title}
                      </h3>
                      <p className="mt-0.5 text-sm text-ink-500">
                        {t('preguntasYPuntos', {
                          preguntas: assessment.questionCount,
                          puntos: assessment.totalPoints,
                        })}
                      </p>
                      {/*
                        Se dice de donde viene. Un alumno tiene derecho a saber
                        si lo que responde es material de GLEXCO -igual para
                        todos- o algo que preparo su profesor.
                      */}
                      {/*
                        La fecha limite va ARRIBA y con su estado, no escondida
                        en la pantalla siguiente: es lo que decide si el alumno
                        tiene que ponerse hoy o puede dejarlo, y descubrir que
                        cerro al abrirla es descubrirlo tarde.
                      */}
                      {assessment.dueAt ? (
                        <p className="mt-2">
                          <StatePill state={dueState(assessment.dueAt)}>
                            {dueLabel(assessment.dueAt, t, format)}
                          </StatePill>
                        </p>
                      ) : null}

                      <p className="mt-2 text-xs text-ink-400">
                        {assessment.origin === 'glexco'
                          ? t('incluidaEnTuKit')
                          : t('deTuDocente')}
                      </p>
                    </div>
                  </div>

                  {/* "Abrir" y no "Empezar": este enlace lleva a la pantalla de
                      resultado, que tambien es la de entrada, y desde alli se
                      empieza con un boton aparte. La palabra importa porque un
                      alumno que ya entrego pulsaria "Empezar" creyendo que va a
                      ver su nota, y antes eso le costaba un intento. */}
                  <a
                    href={`/${portal}/evaluaciones/${assessment.assessmentId}`}
                    className="btn btn-primary mt-5"
                  >
                    {portal === 'discover' ? t('abrirActividad') : t('abrirEvaluacion')}
                  </a>
                </Card>
              ))}
            </div>
          </section>
        ))}
    </>
  );
}

/**
 * Estado de la fecha limite.
 *
 * Tres tramos y no dos: "cerrada" es distinto de "cierra hoy", y las dos son
 * distintas de "queda tiempo". Con un solo aviso, el alumno no sabe si tiene que
 * correr o si ya no puede hacer nada.
 */
function dueState(iso: string): 'late' | 'warn' | 'idle' {
  const days = daysLeft(iso);
  if (days === null) return 'idle';
  if (days < 0) return 'late';
  if (days <= 2) return 'warn';
  return 'idle';
}

/**
 * "Cierra manana", "Cierra el 18 de septiembre".
 *
 * Recibe el traductor y el formateador, como el resto de fechas del portal: una
 * funcion suelta no puede pedirlos, y la fecha larga iba con `es-PE` escrito a
 * mano, asi que en ingles salia media frase traducida y la fecha en espanol.
 */
function dueLabel(
  iso: string,
  t: (key: string, values?: TranslationValues) => string,
  format: Awaited<ReturnType<typeof getFormatter>>,
): string {
  const days = daysLeft(iso);
  if (days === null) return '';
  if (days < 0) return t('cerrada');
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
