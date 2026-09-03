import type { Metadata } from 'next';
import { requireSession } from '../../../../../lib/session';
import { startAttempt } from '../../../../../lib/assessment.actions';
import { fetchMyClassroom } from '../../../../../lib/classrooms';
import { QuizForm } from '../../../../../components/quiz-form';
import { EmptyState } from '../../../../../components/ui';

export const metadata: Metadata = { title: 'Evaluación' };

/**
 * Responder una evaluación.
 *
 * El intento se abre **al cargar la página**, en el servidor. Es deliberado: el
 * límite de tiempo empieza a contar cuando el alumno ve las preguntas, no
 * cuando pulsa un botón extra, y si el intento se abriera con un clic
 * posterior habría que decidir qué hacer con quien abre la página y se va.
 *
 * Abrir dos veces devuelve el MISMO intento, no uno nuevo: recargar la página
 * -o volver atrás- no debe gastarle un intento a nadie. Eso lo garantiza el
 * backend, no esta pantalla.
 */
export default async function AcademyEvaluacion({
  params,
}: {
  params: Promise<{ assessmentId: string }>;
}) {
  // Se exige sesion aunque el nombre no se use en esta pantalla: el layout ya
  // comprueba, pero Next renderiza layout y pagina en paralelo y sin esto la
  // pagina abriria un intento con el token que hubiera.
  await requireSession();
  const { assessmentId } = await params;

  // El salon se resuelve ANTES de abrir el intento y viaja con el: una entrega
  // sin salon no aparece en la bandeja de correccion de ningun docente, asi que
  // lo abierto a mano se quedaria sin corregir para siempre.
  const classroomId = await fetchMyClassroom();
  const state = await startAttempt(assessmentId, classroomId);

  if (state.error || !state.attempt) {
    return (
      <EmptyState
        title="No puedes abrir esta evaluación"
        description={state.error ?? 'Vuelve a intentarlo en un momento.'}
        action={{ href: '/academy/evaluaciones', label: 'Ver mis evaluaciones' }}
      />
    );
  }

  return (
    <>
      <section>
        <a href="/academy/evaluaciones" className="text-sm font-medium text-brand-600 hover:underline">
          ← Mis evaluaciones
        </a>
        <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="mt-1 font-semibold">
          Evaluación
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Intento {state.attempt.attemptNumber}
          {state.attempt.attemptsLeft > 0
            ? ` · te quedan ${state.attempt.attemptsLeft} después de este`
            : ' · es tu último intento'}
        </p>
      </section>

      <QuizForm
        submissionId={state.attempt.submissionId}
        questions={state.attempt.questions}
        timeLimitMinutes={state.attempt.timeLimitMinutes}
        attemptsLeft={state.attempt.attemptsLeft}
      />
    </>
  );
}
