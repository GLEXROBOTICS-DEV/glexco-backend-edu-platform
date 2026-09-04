import { ChallengeIcon } from '@glexco/icons';
import { fetchMyResult, type MyAttempt } from '../lib/assessments';
import { DonutChart } from './charts';
import { EmptyState } from './ui';

/**
 * "Como me fue" en una evaluacion, en su propia pantalla.
 *
 * **Entrar aqui no consume ningun intento.** Antes el resultado solo vivia en la
 * pantalla que lo acababa de calcular: recargar, volver atras o abrir el enlace
 * otro dia abria un intento NUEVO, y a los tres el alumno solo veia "ya agotaste
 * tus intentos" sin haber respondido nada mas. Un intento se gasta cuando el
 * alumno decide volver a intentarlo, y para eso hay un boton.
 *
 * Nunca se dice cual era la respuesta correcta. Las recomendaciones vienen del
 * backend y son deliberadamente genericas: en un cuestionario de tres preguntas,
 * senalar cual se fallo es practicamente decir cual era la buena.
 */
export async function AssessmentResult({
  assessmentId,
  portal,
}: {
  assessmentId: string;
  portal: 'discover' | 'academy';
}) {
  const result = await fetchMyResult(assessmentId);

  if (!result) {
    return (
      <EmptyState
        title="No pudimos cargar esta actividad"
        description="Vuelve a intentarlo en un momento. Si sigue pasando, avisa a tu docente."
        action={{ href: `/${portal}/evaluaciones`, label: 'Ver mis actividades' }}
      />
    );
  }

  const responder = `/${portal}/evaluaciones/${assessmentId}/responder`;
  const best = result.best;

  // Todavia no ha entregado nada: la pantalla es una invitacion a empezar, no un
  // resultado vacio.
  if (!best && !result.inProgress) {
    return (
      <EmptyState
        icon={<ChallengeIcon size={32} />}
        title={result.title}
        description={
          result.attemptsLeft > 0
            ? `Tienes ${result.maxAttempts} ${result.maxAttempts === 1 ? 'intento' : 'intentos'} para esta actividad. Cuando la abras empieza a contar.`
            : 'Ya no te quedan intentos para esta actividad.'
        }
        {...(result.attemptsLeft > 0
          ? { action: { href: responder, label: 'Empezar' } }
          : {})}
      />
    );
  }

  const percentage =
    best && best.score !== null && best.maxScore > 0
      ? Math.round((best.score / best.maxScore) * 100)
      : null;

  const awaiting = best?.status === 'submitted';

  return (
    <div className="grid gap-[var(--portal-gap)]">
      <div className="grid gap-[var(--portal-gap)] lg:grid-cols-3">
        <div className="lg:col-span-1">
          {awaiting || percentage === null ? (
            <div className="rounded-[var(--portal-radius)] border border-line-200 bg-white p-[var(--portal-card-padding)] text-center">
              <p className="font-display text-xl font-semibold">Entregado</p>
              <p className="mt-2 text-sm text-ink-500">
                Tu docente tiene que revisar algunas respuestas.
              </p>
            </div>
          ) : (
            <DonutChart
              value={percentage}
              label="Tu mejor nota"
              caption={`${best!.score} de ${best!.maxScore} puntos`}
              tone={best!.passed ? 'good' : 'critical'}
              toneLabel={best!.passed ? 'Aprobado' : 'No aprobado'}
            />
          )}
        </div>

        <article className="rounded-[var(--portal-radius)] border border-line-200 bg-white p-[var(--portal-card-padding)] lg:col-span-2">
          <p className="eyebrow mb-3">Qué te conviene hacer ahora</p>

          {/* El comentario del docente manda sobre las recomendaciones
              automaticas: es especifico y lo escribio alguien que vio la
              entrega. Va primero y se distingue de lo demas. */}
          {best?.feedback ? (
            <div className="mb-4 rounded-[calc(var(--portal-radius)*0.75)] bg-state-doing-bg p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-state-doing-fg">
                De tu docente
              </p>
              <p className="mt-1.5 text-sm text-ink-900">{best.feedback}</p>
            </div>
          ) : null}

          {result.recommendations.length > 0 ? (
            <ul className="grid gap-2">
              {result.recommendations.map((line) => (
                <li key={line} className="flex gap-2.5 text-sm text-ink-700">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--portal-accent)]" aria-hidden="true" />
                  {line}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-500">
              Cuando tu docente termine de revisar verás aquí qué repasar.
            </p>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            {result.inProgress ? (
              <a href={responder} className="btn btn-primary">
                Continuar el intento
              </a>
            ) : result.attemptsLeft > 0 && !best?.passed ? (
              <a href={responder} className="btn btn-primary">
                Volver a intentarlo
              </a>
            ) : null}
            <a href={`/${portal}/progreso`} className="btn btn-secondary">
              Ver mi progreso
            </a>
          </div>

          {/* El recuento va SIEMPRE, aprobado o no. Es la cifra por la que el
              alumno pregunta antes de pulsar nada. */}
          <p className="mt-4 text-xs text-ink-500">
            {result.attemptsUsed} de {result.maxAttempts}{' '}
            {result.maxAttempts === 1 ? 'intento usado' : 'intentos usados'}
            {result.attemptsLeft === 0 ? ' · no te quedan más' : ''}
          </p>
        </article>
      </div>

      {result.attempts.length > 1 ? <Historial attempts={result.attempts} /> : null}
    </div>
  );
}

/**
 * Los intentos anteriores.
 *
 * Solo aparece a partir del segundo: con uno solo, una tabla de una fila repite
 * lo que ya dice la tarjeta de arriba.
 */
function Historial({ attempts }: { attempts: readonly MyAttempt[] }) {
  return (
    <section aria-labelledby="intentos">
      <h2 id="intentos" className="eyebrow mb-3">
        Tus intentos
      </h2>

      <ul className="grid gap-2">
        {[...attempts]
          .sort((a, b) => b.attemptNumber - a.attemptNumber)
          .map((attempt) => (
            <li
              key={attempt.submissionId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--portal-radius)] border border-line-200 bg-white px-4 py-3"
            >
              <span className="text-sm font-medium">Intento {attempt.attemptNumber}</span>
              <span className="text-sm tabular-nums text-ink-500">
                {attempt.status === 'in_progress'
                  ? 'sin entregar'
                  : attempt.score === null
                    ? 'pendiente de corregir'
                    : `${attempt.score} de ${attempt.maxScore} puntos`}
              </span>
            </li>
          ))}
      </ul>
    </section>
  );
}
