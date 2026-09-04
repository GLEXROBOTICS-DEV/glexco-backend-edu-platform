import { ChallengeIcon } from '@glexco/icons';
import { fetchMyKits } from '../lib/catalog';
import { fetchAvailableAssessments } from '../lib/assessments';
import { Card, EmptyState, SectionTitle } from './ui';

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
                      <p className="mt-2 text-xs text-ink-400">
                        {assessment.origin === 'glexco' ? 'Incluida en tu kit' : 'De tu docente'}
                      </p>
                    </div>
                  </div>

                  <a
                    href={`/${portal}/evaluaciones/${assessment.assessmentId}`}
                    className="btn btn-primary mt-5"
                  >
                    {portal === 'discover' ? 'Empezar' : 'Comenzar evaluacion'}
                  </a>
                </Card>
              ))}
            </div>
          </section>
        ))}
    </>
  );
}
