import type { Metadata } from 'next';
import { requireSession } from '../../../../../../lib/session';
import { startAttempt } from '../../../../../../lib/assessment.actions';
import { fetchGroupOptions } from '../../../../../../lib/assessments';
import { fetchMyClassroom } from '../../../../../../lib/classrooms';
import { GroupPicker } from '../../../../../../components/group-picker';
import { QuizForm } from '../../../../../../components/quiz-form';
import { EmptyState } from '../../../../../../components/ui';

export const metadata: Metadata = { title: 'Actividad' };

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
 *
 * Y por eso esta pantalla vive en `/responder` y no en la raíz de la
 * evaluación: llegar aquí es una DECISIÓN del alumno. Cuando abrir el
 * resultado abría un intento, volver a mirar la nota gastaba uno de los tres y
 * a la tercera solo quedaba «ya agotaste tus intentos».
 */
export default async function DiscoverEvaluacion({
  params,
}: {
  params: Promise<{ assessmentId: string }>;
}) {
  const session = await requireSession();
  const { assessmentId } = await params;

  // El salon se resuelve ANTES de abrir el intento y viaja con el: una entrega
  // sin salon no aparece en la bandeja de correccion de ningun docente, asi que
  // lo abierto a mano se quedaria sin corregir para siempre.
  const classroomId = await fetchMyClassroom();

  // **En una actividad de grupo hay que preguntar ANTES de abrir el intento.**
  // Es la unica excepcion a abrir el intento al cargar, y no es negociable: una
  // vez abierto, la entrega ya es de una sola persona y meter al grupo despues
  // significaria rehacerla borrando lo que se hubiera escrito.
  const grupo = await fetchGroupOptions(assessmentId);

  // Se intenta abrir SIN companeros, tambien en las de grupo, y la respuesta
  // distingue los dos casos sin una llamada extra: si el alumno ya tenia un
  // intento abierto con su grupo, el backend lo devuelve -esa rama va antes de
  // validar el tamano-; y si no lo tenia, falla por tamano de grupo, que es la
  // senal de que hay que preguntarle con quien trabaja.
  const state = await startAttempt(assessmentId, classroomId);

  if (grupo.groupWork && state.error) {
    return (
      <>
        <section>
          <a href="/discover/evaluaciones" className="text-sm font-medium text-brand-600 hover:underline">
            ← Mis actividades
          </a>
          <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="mt-1 font-semibold">
            ¡Vamos, {session.firstName}!
          </h1>
        </section>

        <GroupPicker
          assessmentId={assessmentId}
          classroomId={classroomId}
          classmates={grupo.available}
          takenCount={grupo.takenCount}
          minSize={grupo.groupWork.minSize}
          maxSize={grupo.groupWork.maxSize}
          studentName={`${session.firstName} ${session.lastName}`}
        />
      </>
    );
  }

  if (state.error || !state.attempt) {
    return (
      <EmptyState
        title="No puedes abrir esta actividad"
        description={state.error ?? 'Vuelve a intentarlo en un momento.'}
        action={{ href: `/discover/evaluaciones/${assessmentId}`, label: 'Ver cómo me fue' }}
      />
    );
  }

  return (
    <>
      <section>
        <a href="/discover/evaluaciones" className="text-sm font-medium text-brand-600 hover:underline">
          ← Mis actividades
        </a>
        <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="mt-1 font-semibold">
          ¡Vamos, {session.firstName}!
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
        expiresAt={state.attempt.expiresAt}
        attemptsLeft={state.attempt.attemptsLeft}
        resultHref={`/discover/evaluaciones/${assessmentId}`}
      />
    </>
  );
}
