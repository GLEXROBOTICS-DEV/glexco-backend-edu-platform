'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { addQuestion, type QuestionState } from '../lib/teacher-assessments.actions';

const TYPES = [
  { value: 'single_choice', label: 'Una sola respuesta' },
  { value: 'multiple_choice', label: 'Varias respuestas' },
  { value: 'short_answer', label: 'Respuesta escrita' },
  { value: 'file_upload', label: 'Entrega de archivo o enlace' },
] as const;

const BLANK_OPTIONS = 4;

/**
 * Añadir una pregunta.
 *
 * El tipo se elige primero porque decide la forma del resto del formulario, y
 * eso es lo único de esta pantalla que necesita estado en el cliente: con las
 * opciones siempre visibles, una pregunta escrita se pide con cuatro campos que
 * no van a ninguna parte.
 *
 * Las respuestas correctas se marcan con los mismos controles nativos que usa
 * el alumno para responder —radio o casilla según el tipo—, así que el docente
 * ve el cuestionario tal y como lo va a ver su clase.
 */
export function AssessmentEditor({ assessmentId }: { assessmentId: string }) {
  const [state, formAction] = useActionState<QuestionState, FormData>(addQuestion, {});
  const [type, setType] = useState<string>('single_choice');

  const needsOptions = type === 'single_choice' || type === 'multiple_choice';
  const multiple = type === 'multiple_choice';

  return (
    <form
      action={formAction}
      className="grid gap-4 border border-line-200 bg-white"
      style={{ borderRadius: 'var(--portal-radius)', padding: 'var(--portal-card-padding)' }}
    >
      <input type="hidden" name="assessmentId" value={assessmentId} />

      <h2 className="font-display text-base font-semibold">Añadir una pregunta</h2>

      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger"
        >
          {state.error}
        </p>
      ) : null}

      {state.ok ? (
        <p
          role="status"
          className="rounded-lg border border-line-200 bg-surface-100 px-4 py-3 text-sm text-ink-700"
        >
          Pregunta añadida. Puedes seguir añadiendo más.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">Tipo de pregunta</span>
          <select
            name="type"
            value={type}
            onChange={(event) => setType(event.target.value)}
            className="w-full rounded-lg border border-line-300 bg-white px-3 py-2.5 text-ink-900 outline-none transition focus:border-brand-400"
          >
            {TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">Puntos</span>
          <input
            type="number"
            name="points"
            min={1}
            max={100}
            defaultValue={10}
            required
            className="w-full rounded-lg border border-line-300 px-3 py-2.5 text-ink-900 outline-none transition focus:border-brand-400"
          />
        </label>
      </div>

      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-ink-700">Enunciado</span>
        <textarea
          name="prompt"
          rows={2}
          required
          minLength={3}
          placeholder="¿Cuál de estas piezas es un servomotor?"
          className="w-full rounded-lg border border-line-300 px-3 py-2.5 text-ink-900 outline-none transition focus:border-brand-400"
        />
      </label>

      {needsOptions ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium text-ink-700">
            Opciones {multiple ? '(marca todas las correctas)' : '(marca la correcta)'}
          </legend>
          <p className="mb-1 text-xs text-ink-400">
            Deja en blanco las que no uses. Hacen falta al menos dos.
          </p>

          {Array.from({ length: BLANK_OPTIONS }, (_, index) => (
            <div key={index} className="flex items-center gap-3">
              <input
                type={multiple ? 'checkbox' : 'radio'}
                name="correctOption"
                value={index}
                aria-label={`La opción ${index + 1} es correcta`}
                className="size-4 shrink-0 border-line-300 text-brand-600"
              />
              <input
                type="text"
                name="optionText"
                aria-label={`Texto de la opción ${index + 1}`}
                placeholder={`Opción ${index + 1}`}
                className="w-full rounded-lg border border-line-300 px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-brand-400"
              />
            </div>
          ))}
        </fieldset>
      ) : (
        <p className="rounded-lg border border-line-200 bg-surface-100 px-4 py-3 text-sm text-ink-700">
          {/* Decirlo aquí evita la pregunta obvia: "¿y dónde pongo la respuesta?" */}
          Esta pregunta la corriges tú: aparecerá en tu bandeja cuando el alumno
          la entregue.
        </p>
      )}

      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-ink-700">
          Explicación <span className="text-ink-400">(opcional)</span>
        </span>
        <input
          type="text"
          name="explanation"
          placeholder="Se muestra al alumno DESPUÉS de corregir, nunca antes."
          className="w-full rounded-lg border border-line-300 px-3 py-2.5 text-ink-900 outline-none transition focus:border-brand-400"
        />
      </label>

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-brand-600 px-5 py-2.5 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
      >
        {pending ? 'Añadiendo…' : 'Añadir pregunta'}
      </button>
    </div>
  );
}
