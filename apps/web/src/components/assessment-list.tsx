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

  if (failed) {
    return (
      <EmptyState
        title="No pudimos cargar tus evaluaciones"
        description="Vuelve a intentarlo en un momento."
      />
    );
  }

  if (kits.length === 0) {
    return (
      <EmptyState
        icon={<ChallengeIcon size={32} />}
        title="Todavia no tienes contenido activado"
        description="Activa el codigo de tu libro para acceder a tus actividades."
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
        title={portal === 'discover' ? 'Aun no hay actividades' : 'Aun no hay evaluaciones'}
        description="Cuando tu docente publique alguna, aparecera aqui."
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
                        {assessment.questionCount}{' '}
                        {assessment.questionCount === 1 ? 'pregunta' : 'preguntas'} ·{' '}
                        {assessment.totalPoints} puntos
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
                            {dueLabel(assessment.dueAt)}
                          </StatePill>
                        </p>
                      ) : null}

                      <p className="mt-2 text-xs text-ink-400">
                        {assessment.origin === 'glexco' ? 'Incluida en tu kit' : 'De tu docente'}
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
                    {portal === 'discover' ? 'Abrir actividad' : 'Abrir evaluación'}
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

function dueLabel(iso: string): string {
  const days = daysLeft(iso);
  if (days === null) return '';
  if (days < 0) return 'Cerrada';
  if (days === 0) return 'Cierra hoy';
  if (days === 1) return 'Cierra mañana';
  if (days <= 7) return `Cierra en ${days} días`;

  return `Cierra el ${new Intl.DateTimeFormat('es-PE', {
    day: 'numeric',
    month: 'long',
    timeZone: 'America/Lima',
  }).format(new Date(iso))}`;
}

function daysLeft(iso: string): number | null {
  const due = new Date(iso).getTime();
  if (Number.isNaN(due)) return null;
  return Math.ceil((due - Date.now()) / 86_400_000) - 1;
}
