'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { gradeSubmission, type GradeState } from '../lib/grading.actions';
import type { GradableQuestion, SubmissionForGrading } from '../lib/grading';

/**
 * Corregir una entrega.
 *
 * La pantalla está ordenada por lo que el docente tiene que **hacer**, no por el
 * orden del cuestionario: primero lo que espera puntuación, después lo que ya
 * corrigió la máquina como referencia. Un examen de veinte preguntas de las que
 * dos son abiertas no debe obligar a bajar veinte tarjetas para encontrarlas.
 *
 * Funciona sin JavaScript, como el cuestionario del alumno: `useActionState`
 * sobre `<form action>` degrada a un envío normal del navegador.
 */
export function GradingForm({
  submission,
  studentName,
}: {
  submission: SubmissionForGrading;
  studentName: string;
}) {
  const [state, formAction] = useActionState<GradeState, FormData>(gradeSubmission, {});

  const manual = submission.questions.filter((question) => question.needsManualGrading);
  const automatic = submission.questions.filter((question) => !question.needsManualGrading);

  if (state.ok) {
    const percentage =
      state.score !== null && state.score !== undefined && submission.maxScore
        ? Math.round((state.score / submission.maxScore) * 100)
        : null;

    return (
      <div
        className="border border-line-200 bg-white text-center"
        style={{ borderRadius: 'var(--portal-radius)', padding: '2.5rem 1.5rem' }}
        role="status"
      >
        <h2 className="font-display text-xl font-semibold">Corregida</h2>
        <p className="mt-2 text-sm text-ink-500">
          {studentName} · {state.score} de {submission.maxScore} puntos
          {percentage !== null ? ` (${percentage}%)` : ''}
        </p>
        <p className="mt-1 text-sm font-medium" style={{ color: state.passed ? '#0A7D57' : '#A61B1B' }}>
          <span aria-hidden="true">● </span>
          {state.passed ? 'Aprobado' : 'No aprobado'}
        </p>
        <a
          href="../correccion"
          className="mt-6 inline-flex rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          Volver a la bandeja
        </a>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-[var(--portal-gap)]">
      <input type="hidden" name="submissionId" value={submission.submissionId} />
      <input type="hidden" name="classroomId" value={submission.classroomId ?? ''} />

      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger"
        >
          {state.error}
        </p>
      ) : null}

      {manual.length > 0 ? (
        <section className="grid gap-[var(--portal-gap)]">
          <h2 className="font-display text-base font-semibold">
            Para puntuar ({manual.length})
          </h2>
          {manual.map((question, index) => (
            <ManualQuestion key={question.id} question={question} index={index} />
          ))}
        </section>
      ) : (
        <p className="rounded-lg border border-line-200 bg-white px-4 py-3 text-sm text-ink-700">
          No hay nada abierto que puntuar: la máquina ya corrigió todo. Puedes
          cerrar la nota y añadir un comentario si quieres.
        </p>
      )}

      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-ink-700">Comentario para el alumno</span>
        <textarea
          name="feedback"
          rows={3}
          placeholder="Opcional. Lo verá junto a su nota."
          className="w-full rounded-lg border border-line-300 px-3 py-2.5 text-ink-900 outline-none transition focus:border-brand-400"
        />
      </label>

      <SubmitButton />

      {automatic.length > 0 ? (
        <details className="rounded-lg border border-line-200 bg-white px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-ink-700">
            Ver lo que corrigió la máquina ({automatic.length})
          </summary>
          <ol className="mt-4 grid list-none gap-4">
            {automatic.map((question, index) => (
              <li key={question.id}>
                <AutomaticQuestion question={question} index={index} />
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </form>
  );
}

function ManualQuestion({ question, index }: { question: GradableQuestion; index: number }) {
  return (
    <div
      className="border border-line-200 bg-white"
      style={{ borderRadius: 'var(--portal-radius)', padding: 'var(--portal-card-padding)' }}
    >
      <input type="hidden" name="gradableQuestionId" value={question.id} />

      <p className="font-display text-base font-semibold">
        <span className="text-ink-400">{index + 1}. </span>
        {question.prompt}
      </p>

      <div className="mt-4 rounded-lg bg-surface-100 px-4 py-3 text-sm text-ink-700">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-400">
          Lo que respondió
        </p>
        {question.answer?.text ? (
          <p className="whitespace-pre-wrap">{question.answer.text}</p>
        ) : question.answer?.mediaAssetId ? (
          <p>Entregó un archivo o un enlace.</p>
        ) : (
          <p className="text-ink-400">Sin respuesta.</p>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[10rem_1fr]">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">
            Puntos <span className="text-ink-400">/ {question.points}</span>
          </span>
          {/*
            `type="number"` con `max`: el dominio rechaza pasarse del máximo, y
            que el navegador lo diga antes ahorra un viaje. La validación real
            sigue estando en el servidor.
          */}
          <input
            type="number"
            name={`points:${question.id}`}
            min={0}
            max={question.points}
            step="0.5"
            required
            defaultValue={question.answer?.awardedPoints ?? ''}
            className="w-full rounded-lg border border-line-300 px-3 py-2.5 text-ink-900 outline-none transition focus:border-brand-400"
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">Comentario</span>
          <input
            type="text"
            name={`feedback:${question.id}`}
            defaultValue={question.answer?.feedback ?? ''}
            placeholder="Opcional"
            className="w-full rounded-lg border border-line-300 px-3 py-2.5 text-ink-900 outline-none transition focus:border-brand-400"
          />
        </label>
      </div>
    </div>
  );
}

/**
 * Lo ya corregido, de solo lectura.
 *
 * Muestra la respuesta correcta al lado de la del alumno porque el docente la
 * necesita para responder "por qué me has puesto esto" sin salir de la pantalla.
 * Esta información nunca llega a un portal de alumno: viene de un endpoint
 * distinto, protegido por el permiso de corrección.
 */
function AutomaticQuestion({ question, index }: { question: GradableQuestion; index: number }) {
  const selected = new Set(question.answer?.selectedOptionIds ?? []);
  const correct = new Set(question.correctOptionIds);
  const right = question.answer !== null && (question.answer.awardedPoints ?? 0) === question.points;

  return (
    <div>
      <p className="text-sm font-medium">
        <span className="text-ink-400">{index + 1}. </span>
        {question.prompt}
      </p>
      <p className="mt-1 text-xs font-medium" style={{ color: right ? '#0A7D57' : '#A61B1B' }}>
        {/* El punto de color va con texto siempre: quien no distingue el verde
            del rojo lee igual el resultado. */}
        <span aria-hidden="true">● </span>
        {right ? 'Acertó' : 'Falló'} · {question.answer?.awardedPoints ?? 0} de {question.points}
      </p>

      <ul className="mt-2 grid list-none gap-1 text-sm">
        {question.options.map((option) => {
          const isCorrect = correct.has(option.id);
          const wasSelected = selected.has(option.id);

          return (
            <li
              key={option.id}
              className={isCorrect ? 'font-medium text-ink-900' : 'text-ink-500'}
            >
              {wasSelected ? '◉ ' : '○ '}
              {option.text}
              {isCorrect ? <span className="text-ink-400"> — correcta</span> : null}
            </li>
          );
        })}
      </ul>
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
        className="rounded-lg bg-brand-600 px-5 py-2.5 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
      >
        {pending ? 'Guardando…' : 'Cerrar la nota'}
      </button>
      <p className="text-sm text-ink-500">El alumno verá su nota en cuanto la cierres.</p>
    </div>
  );
}
