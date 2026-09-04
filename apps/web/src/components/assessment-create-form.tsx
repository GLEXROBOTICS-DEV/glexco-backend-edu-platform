'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createAssessment, type CreateState } from '../lib/teacher-assessments.actions';
import type { KitOption } from '../lib/teacher-assessments';

const KINDS = [
  { value: 'quiz', label: 'Cuestionario', hint: 'De marcar. Se corrige al instante y admite reintentos.' },
  { value: 'practical', label: 'Práctica', hint: 'Con el kit delante. La corriges tú.' },
  { value: 'project', label: 'Proyecto', hint: 'Una entrega: archivo, foto o enlace.' },
  { value: 'stem_activity', label: 'Actividad STEM', hint: 'Reto abierto de aula.' },
] as const;

/**
 * Crear una evaluación.
 *
 * Pide lo mínimo para que exista y nada más: el kit, el título y el tipo. Todo
 * lo demás —preguntas, nota de aprobación, límite de tiempo— se ajusta en el
 * editor, con la evaluación ya delante. Un formulario largo antes de ver nada es
 * la forma más segura de que nadie llegue a crear la primera.
 */
export function AssessmentCreateForm({
  kits,
  classrooms,
}: {
  kits: KitOption[];
  classrooms: { classroomId: string; name: string; grade: string }[];
}) {
  const [state, formAction] = useActionState<CreateState, FormData>(createAssessment, {});

  return (
    <form
      action={formAction}
      className="grid gap-4 border border-line-200 bg-white"
      style={{ borderRadius: 'var(--portal-radius)', padding: 'var(--portal-card-padding)' }}
    >
      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger"
        >
          {state.error}
        </p>
      ) : null}

      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-ink-700">Título</span>
        <input
          type="text"
          name="title"
          required
          minLength={3}
          maxLength={200}
          placeholder="Repaso de sensores"
          className="field"
        />
      </label>

      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-ink-700">Kit</span>
        {kits.length > 0 ? (
          <select
            name="kitId"
            required
            className="field"
          >
            {kits.map((kit) => (
              <option key={kit.kitId} value={kit.kitId}>
                {kit.name} · {kit.grade}
              </option>
            ))}
          </select>
        ) : (
          <p className="rounded-lg border border-line-200 bg-surface-100 px-4 py-3 text-sm text-ink-700">
            No hay kits publicados para tus grados. Habla con GLEXCO: una
            evaluación cuelga siempre de un kit.
          </p>
        )}
      </label>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium text-ink-700">Tipo</legend>
        {KINDS.map((kind, index) => (
          <label
            key={kind.value}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-line-200 px-4 py-3 text-sm transition hover:border-brand-400 has-checked:border-brand-600 has-checked:bg-brand-600/5"
          >
            <input
              type="radio"
              name="kind"
              value={kind.value}
              defaultChecked={index === 0}
              className="mt-0.5 size-4 shrink-0 border-line-300 text-brand-600"
            />
            <span>
              <span className="font-medium text-ink-900">{kind.label}</span>
              <span className="block text-xs text-ink-500">{kind.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-ink-700">
          Salón <span className="text-ink-400">(opcional)</span>
        </span>
        <select
          name="classroomId"
          className="field"
        >
          {/* Vacío por defecto: quien da el mismo grado en dos aulas quiere una
              sola evaluación para las dos, y limitarla a un salón es la
              excepción, no la norma. */}
          <option value="">Todos mis salones</option>
          {classrooms.map((classroom) => (
            <option key={classroom.classroomId} value={classroom.classroomId}>
              {classroom.name}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">Se aprueba con</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              name="passingScore"
              min={0}
              max={100}
              defaultValue={60}
              className="field"
            />
            <span className="text-sm text-ink-500">%</span>
          </div>
        </label>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">
            Minutos por intento <span className="text-ink-400">(opcional)</span>
          </span>
          <input
            type="number"
            name="timeLimitMinutes"
            min={1}
            max={480}
            placeholder="Sin límite"
            className="field"
          />
        </label>
      </div>

      <SubmitButton disabled={kits.length === 0} />
    </form>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="submit"
        disabled={pending || disabled}
        className="btn btn-primary"
      >
        {pending ? 'Creando…' : 'Crear y añadir preguntas'}
      </button>
      <p className="text-sm text-ink-500">Nace en borrador: nadie la ve hasta que la publiques.</p>
    </div>
  );
}
