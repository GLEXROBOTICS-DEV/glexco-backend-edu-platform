'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { completeLesson, type LessonState } from '../lib/learning.actions';

/**
 * "Ya lo vi": el alumno marca la leccion como completada.
 *
 * Lo marca el, no lo deduce el sistema. Abrir un PDF no es haberlo leido, y un
 * progreso que se rellena solo deja de significar nada: ni para el alumno, que
 * ve barras llenas sin haber hecho nada, ni para el docente, que pierde la unica
 * senal de quien se descolgo.
 *
 * Funciona sin JavaScript, como el resto del portal.
 */
export function LessonComplete({
  lessonId,
  portal,
  alreadyCompleted,
}: {
  lessonId: string;
  portal: 'discover' | 'academy';
  alreadyCompleted: boolean;
}) {
  const [state, formAction] = useActionState<LessonState, FormData>(completeLesson, {});

  if (alreadyCompleted && !state.completed) {
    return (
      <p
        data-lesson="done"
        className="rounded-lg border border-success/25 bg-success/5 px-4 py-3 text-sm text-ink-700"
      >
        Ya completaste esta lección. Puedes volver a verla cuando quieras.
      </p>
    );
  }

  if (state.completed) {
    return (
      <div
        role="status"
        data-lesson={state.alreadyDone ? 'repeated' : 'done'}
        className="rounded-lg border border-success/25 bg-success/5 px-4 py-4"
      >
        <p className="font-display text-base font-semibold">
          {state.alreadyDone ? 'Ya la tenías completada' : '¡Lección completada!'}
        </p>

        {/* Solo se anuncian los puntos si de verdad se ganaron. Decir "+25 XP"
            en un reintento seria mentirle al alumno sobre un contador que
            despues no sube. */}
        {!state.alreadyDone && state.xpAwarded ? (
          <p className="mt-1 text-sm text-ink-700">
            Ganaste <strong className="font-semibold">{state.xpAwarded}</strong> puntos de
            experiencia.
          </p>
        ) : null}

        {state.courseCompleted ? (
          <p className="mt-1 text-sm font-medium text-brand-700">
            Y terminaste el curso entero.
          </p>
        ) : null}

        {state.levelUp ? (
          <p className="mt-2 rounded-lg bg-brand-600/10 px-3 py-2 text-sm font-semibold text-brand-700">
            ¡Subiste de nivel! Ahora eres {state.levelUp}.
          </p>
        ) : null}

        {state.newBadges && state.newBadges.length > 0 ? (
          <ul className="mt-2 space-y-1" data-new-badges={state.newBadges.length}>
            {state.newBadges.map((badge) => (
              <li key={badge.code} className="text-sm text-ink-700">
                <strong className="font-semibold">Insignia nueva: {badge.name}</strong> ·{' '}
                {badge.description}
              </li>
            ))}
          </ul>
        ) : null}

        <a
          href={`/${portal}/progreso`}
          className="mt-3 inline-block text-sm font-medium text-brand-600 hover:underline"
        >
          Ver mi progreso
        </a>
      </div>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="lessonId" value={lessonId} />
      <input type="hidden" name="portal" value={portal} />

      {state.error ? (
        <p role="alert" className="mb-3 text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-submit="completar"
      className="rounded-lg border border-brand-600 px-4 py-2.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-600/5 disabled:opacity-60"
    >
      {pending ? 'Guardando…' : 'Ya lo vi'}
    </button>
  );
}
