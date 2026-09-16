'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { ASSESSMENT_TYPES } from '@glexco/contracts';
import { safeLabel } from '../lib/vocabulary';
import { createAssessment, type CreateState } from '../lib/teacher-assessments.actions';
import type { KitOption } from '../lib/teacher-assessments';

/** Los cuatro tipos, del contrato. El nombre sale del espacio
 *  `tiposEvaluacion` -el mismo que ya usaba la lista del docente- y la
 *  frase que lo explica de `tiposEvaluacionAyuda`. */
const KINDS = Object.values(ASSESSMENT_TYPES);

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
  const vocab = useTranslations();
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
            key={kind}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-line-200 px-4 py-3 text-sm transition hover:border-brand-400 has-checked:border-brand-600 has-checked:bg-brand-600/5"
          >
            <input
              type="radio"
              name="kind"
              value={kind}
              defaultChecked={index === 0}
              className="mt-0.5 size-4 shrink-0 border-line-300 text-brand-600"
            />
            <span>
              <span className="font-medium text-ink-900">
                {safeLabel(vocab, 'tiposEvaluacion', kind)}
              </span>
              <span className="block text-xs text-ink-500">
                {safeLabel(vocab, 'tiposEvaluacionAyuda', kind)}
              </span>
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
          <span className="text-xs text-ink-500">
            El alumno ve un cronómetro y se entrega solo al acabarse.
          </span>
        </label>

        {/*
          Fecha límite. El campo estaba en el contrato desde el principio y no
          había forma de ponerla desde ninguna pantalla, así que ninguna
          evaluación cerraba nunca.
        */}
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">
            Cierra el <span className="text-ink-400">(opcional)</span>
          </span>
          <input type="datetime-local" name="dueAt" className="field" />
          <span className="text-xs text-ink-500">
            Después de esa fecha nadie puede empezar. Quien ya la tenía abierta la termina.
          </span>
        </label>
      </div>

      <GroupWorkFields />

      <SubmitButton disabled={kits.length === 0} />
    </form>
  );
}

/**
 * Trabajo en grupo: la casilla y el rango de integrantes.
 *
 * Los dos numeros se muestran SIEMPRE, no solo al marcar la casilla. Mostrarlos
 * al marcar exigiria JavaScript, y este formulario tiene que poder enviarse sin
 * el: sin JavaScript los campos no apareceria y el docente marcaria "en grupo"
 * sin poder decir de cuantos. Lo que hace `details` es plegarlos, que es una
 * ayuda visual y no un requisito.
 *
 * El rango va de 2 a 10 en los dos campos porque el limite real lo comprueba el
 * servidor -el navegador solo puede sugerir-, y el dominio rechaza igual un
 * maximo menor que el minimo.
 */
function GroupWorkFields() {
  return (
    <details className="rounded-lg border border-line-200 bg-surface-50 px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium text-ink-700">
        Trabajo en grupo <span className="font-normal text-ink-500">(opcional)</span>
      </summary>

      <label className="mt-3 flex items-start gap-2.5 text-sm text-ink-700">
        <input
          type="checkbox"
          name="isGroupWork"
          value="1"
          className="mt-0.5 size-4 shrink-0 rounded border-line-300 text-brand-600"
        />
        <span>
          <span className="font-medium text-ink-900">Se hace en grupo</span>
          <span className="block text-xs text-ink-500">
            El alumno elige a sus compañeros al empezar, y la nota es la misma para
            todos. Quien ya empezó con un grupo deja de aparecer en la lista de los
            demás.
          </span>
        </span>
      </label>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">Mínimo de integrantes</span>
          <input
            type="number"
            name="groupMinSize"
            min={2}
            max={10}
            defaultValue={2}
            className="field"
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">Máximo de integrantes</span>
          <input
            type="number"
            name="groupMaxSize"
            min={2}
            max={10}
            defaultValue={4}
            className="field"
          />
        </label>
      </div>

      <p className="mt-2 text-xs text-ink-500">
        Se cuenta al alumno que forma el grupo. Un rango —y no un número fijo—
        porque una clase rara vez se divide exacta: con 23 alumnos y grupos de 4,
        tres se quedarían sin poder entregar.
      </p>
    </details>
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
