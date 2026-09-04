'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { submitAttempt, type SubmitState } from '../lib/assessment.actions';
import type { StudentQuestion } from '../lib/assessments';

/**
 * El cuestionario que responde el alumno.
 *
 * Es un `<form>` normal con `<input type="radio">` y `<input type="checkbox">`,
 * y eso no es una simplificación: los controles nativos traen gratis la
 * navegación por teclado, el anuncio correcto en un lector de pantalla y el
 * agrupado por `name`. Un componente propio a base de `div` con `onClick`
 * tendría que reimplementar las tres cosas, y normalmente reimplementa mal las
 * tres.
 *
 * **Funciona sin JavaScript.** `useActionState` sobre `<form action>` degrada a
 * un envío normal del navegador: en un laboratorio con equipos viejos o una
 * conexión que corta el bundle a mitad, el alumno sigue pudiendo entregar.
 *
 * El cliente no conoce ni puede conocer las respuestas correctas: solo envía lo
 * que se marcó. La corrección ocurre en el servidor.
 */
export function QuizForm({
  submissionId,
  questions,
  timeLimitMinutes,
  attemptsLeft,
}: {
  submissionId: string;
  questions: StudentQuestion[];
  timeLimitMinutes: number | null;
  attemptsLeft: number;
}) {
  const [state, formAction] = useActionState<SubmitState, FormData>(submitAttempt, {});

  if (state.status) {
    return <Result state={state} attemptsLeft={attemptsLeft} />;
  }

  return (
    <form action={formAction} className="grid gap-[var(--portal-gap)]">
      <input type="hidden" name="submissionId" value={submissionId} />

      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger"
        >
          {state.error}
        </p>
      ) : null}

      {timeLimitMinutes ? (
        <p className="rounded-lg border border-line-200 bg-white px-4 py-3 text-sm text-ink-700">
          {/* No hay cronómetro en pantalla a propósito: el tiempo lo cuenta el
              reloj del servidor, y un contador en el cliente daría a entender
              que ese es el que manda -además de meterle prisa a un niño con un
              número rojo bajando-. */}
          Tienes <strong>{timeLimitMinutes} minutos</strong> desde que abriste el
          intento. El tiempo lo cuenta el servidor.
        </p>
      ) : null}

      <ol className="grid list-none gap-[var(--portal-gap)]">
        {questions.map((question, index) => (
          <li key={question.id}>
            <QuestionCard question={question} index={index} />
          </li>
        ))}
      </ol>

      <SubmitButton />
    </form>
  );
}

function QuestionCard({ question, index }: { question: StudentQuestion; index: number }) {
  const multiple = question.type === 'multiple_choice';
  const legendId = `pregunta-${question.id}`;

  return (
    <div
      className="border border-line-200 bg-white"
      style={{ borderRadius: 'var(--portal-radius)', padding: 'var(--portal-card-padding)' }}
    >
      <input type="hidden" name="questionId" value={question.id} />

      {/* `fieldset` + `legend` es lo que agrupa las opciones para un lector de
          pantalla: sin ellos, las opciones se leen como casillas sueltas sin
          saber a qué pregunta pertenecen. */}
      <fieldset>
        <legend id={legendId} className="mb-1 font-display text-base font-semibold">
          <span className="text-ink-400">{index + 1}. </span>
          {question.prompt}
        </legend>

        <p className="mb-4 text-xs text-ink-400">
          {question.points} {question.points === 1 ? 'punto' : 'puntos'}
          {multiple ? ' · marca todas las que correspondan' : ''}
        </p>

        {question.options.length > 0 ? (
          <div className="grid gap-2">
            {question.options.map((option) => (
              <label
                key={option.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-line-200 px-4 py-3 text-sm text-ink-700 transition hover:border-brand-400 hover:bg-surface-100 has-checked:border-brand-600 has-checked:bg-brand-600/5"
              >
                <input
                  type={multiple ? 'checkbox' : 'radio'}
                  name={`answer:${question.id}`}
                  value={option.id}
                  className="size-4 shrink-0 border-line-300 text-brand-600"
                />
                {option.text}
              </label>
            ))}
          </div>
        ) : (
          <textarea
            name={`text:${question.id}`}
            rows={5}
            aria-labelledby={legendId}
            placeholder="Escribe tu respuesta"
            className="field"
          />
        )}
      </fieldset>
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary"
      >
        {/* Texto que cambia y no solo un spinner: un cambio de texto lo anuncia
            el lector de pantalla, un icono girando no. */}
        {pending ? 'Entregando…' : 'Entregar'}
      </button>
      <p className="text-sm text-ink-500">Al entregar no podrás cambiar tus respuestas.</p>
    </div>
  );
}

/**
 * El resultado, en la misma pantalla.
 *
 * Lo de marcar ya está corregido cuando esto se pinta, y eso es lo que hace útil
 * un cuestionario para aprender: si la nota llegara tres días después, el alumno
 * ya no la conecta con lo que estaba pensando.
 *
 * Cuando queda parte por corregir a mano, **no se dice si aprobó**. Decirle que
 * suspendió con la mitad de los puntos sin puntuar sería mentirle.
 */
function Result({ state, attemptsLeft }: { state: SubmitState; attemptsLeft: number }) {
  const percentage =
    state.score !== null && state.score !== undefined && state.maxScore
      ? Math.round((state.score / state.maxScore) * 100)
      : null;

  return (
    <div
      className="border border-line-200 bg-white text-center"
      style={{ borderRadius: 'var(--portal-radius)', padding: '2.5rem 1.5rem' }}
      role="status"
    >
      {state.awaitingManualGrading ? (
        <>
          <h2 className="font-display text-xl font-semibold">Entregado</h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-ink-500">
            Tu docente tiene que revisar algunas respuestas. Cuando termine verás
            tu nota completa en tu progreso.
          </p>
          {percentage !== null ? (
            <p className="mt-4 text-sm text-ink-700">
              De lo que se corrige solo llevas{' '}
              <strong className="tabular-nums">
                {state.score} de {state.maxScore}
              </strong>{' '}
              puntos.
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p className="font-display text-4xl font-semibold tabular-nums text-brand-700">
            {percentage}%
          </p>
          <h2
            className="mt-2 font-display text-xl font-semibold"
            style={{ color: state.passed ? '#0A7D57' : '#A61B1B' }}
          >
            <span aria-hidden="true">● </span>
            {state.passed ? 'Aprobado' : 'No aprobado'}
          </h2>
          <p className="mt-2 text-sm text-ink-500">
            {state.score} de {state.maxScore} puntos
          </p>
          {!state.passed && attemptsLeft > 0 ? (
            <p className="mt-4 text-sm text-ink-700">
              Te quedan {attemptsLeft} {attemptsLeft === 1 ? 'intento' : 'intentos'}. Repasa y
              vuelve a intentarlo.
            </p>
          ) : null}
        </>
      )}

      <a
        href="../progreso"
        className="btn btn-primary mt-6"
      >
        Ver mi progreso
      </a>
    </div>
  );
}
