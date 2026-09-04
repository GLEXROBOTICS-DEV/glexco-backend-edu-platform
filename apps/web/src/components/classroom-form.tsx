'use client';

import { useActionState } from 'react';
import { GRADES } from '@glexco/contracts';
import { createClassroom, type NewClassroomState } from '../lib/classrooms.actions';

const GRADE_LABELS: Record<string, string> = {
  [GRADES.PRIMARY_1]: '1.º de primaria',
  [GRADES.PRIMARY_2]: '2.º de primaria',
  [GRADES.PRIMARY_3]: '3.º de primaria',
  [GRADES.PRIMARY_4]: '4.º de primaria',
  [GRADES.PRIMARY_5]: '5.º de primaria',
  [GRADES.PRIMARY_6]: '6.º de primaria',
  [GRADES.SECONDARY_1]: '1.º de secundaria',
  [GRADES.SECONDARY_2]: '2.º de secundaria',
  [GRADES.SECONDARY_3]: '3.º de secundaria',
  [GRADES.SECONDARY_4]: '4.º de secundaria',
  [GRADES.SECONDARY_5]: '5.º de secundaria',
  [GRADES.TECHNICAL_PROGRAM]: 'Programa técnico',
  [GRADES.HIGHER_PROGRAM]: 'Programa superior',
};

/**
 * Alta de salon.
 *
 * El selector de docente **solo aparece si hay a quien elegir**, es decir, si
 * quien mira es direccion. Un docente crea el salon a su propio nombre y no
 * necesita decidir nada: ensenarle un desplegable con un solo valor -el suyo- es
 * pedirle que confirme lo unico posible.
 */
export function ClassroomForm({
  teachers,
}: {
  teachers: ReadonlyArray<{ userId: string; fullName: string }>;
}) {
  const [state, formAction, pending] = useActionState<NewClassroomState, FormData>(
    createClassroom,
    {},
  );

  return (
    <form action={formAction} className="grid max-w-lg gap-4">
      {state.error ? (
        <p
          role="alert"
          className="rounded-[var(--portal-radius)] border border-danger/25 bg-state-late-bg px-4 py-3 text-sm text-danger"
        >
          {state.error}
        </p>
      ) : null}

      <label className="block">
        <span className="text-sm font-medium text-ink-700">Nombre del salón</span>
        <input
          type="text"
          name="name"
          required
          maxLength={60}
          placeholder="4.º A"
          aria-invalid={state.field === 'name' ? true : undefined}
          className="field mt-1.5"
        />
        <span className="mt-1.5 block text-xs text-ink-500">
          Como lo llamáis en el colegio. Es lo que verán tus alumnos al registrarse.
        </span>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-ink-700">Grado</span>
        <select
          name="grade"
          required
          defaultValue=""
          aria-invalid={state.field === 'grade' ? true : undefined}
          className="field mt-1.5"
        >
          <option value="" disabled>
            Elige un grado
          </option>
          {Object.entries(GRADE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {/* El grado NO es decorativo: decide qué kit puede activar un alumno de
            este salón, y el registro rechaza a quien declare otro. Se dice aquí
            para que no se elija a la ligera. */}
        <span className="mt-1.5 block text-xs text-ink-500">
          Decide qué kit pueden activar sus alumnos. No se puede cambiar después.
        </span>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-ink-700">Plazas</span>
        <input
          type="number"
          name="capacity"
          min={1}
          max={60}
          defaultValue={30}
          className="field mt-1.5"
        />
        <span className="mt-1.5 block text-xs text-ink-500">
          Cuando se llenan, nadie más puede matricularse en este salón.
        </span>
      </label>

      {teachers.length > 0 ? (
        <label className="block">
          <span className="text-sm font-medium text-ink-700">Docente</span>
          <select name="teacherId" defaultValue="" className="field mt-1.5">
            <option value="">Yo</option>
            {teachers.map((teacher) => (
              <option key={teacher.userId} value={teacher.userId}>
                {teacher.fullName}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <button type="submit" disabled={pending} className="btn btn-primary justify-self-start">
        {pending ? 'Creando…' : 'Crear salón'}
      </button>
    </form>
  );
}
