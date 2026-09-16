'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { GRADES } from '@glexco/contracts';
import { gradeLabel } from '../lib/vocabulary';
import { createClassroom, type NewClassroomState } from '../lib/classrooms.actions';

/**
 * Alta de salon.
 *
 * El selector de docente **solo aparece si hay a quien elegir**, es decir, si
 * quien mira es direccion. Un docente crea el salon a su propio nombre y no
 * necesita decidir nada: ensenarle un desplegable con un solo valor -el suyo- es
 * pedirle que confirme lo unico posible.
 *
 * Los grados salen de `GRADES` y su etiqueta del espacio `grados`, el mismo que
 * usa la biblioteca del alumno. Antes habia aqui una tabla propia con los trece
 * nombres escritos a mano: un grado nuevo en el contrato no aparecia en este
 * desplegable, y el colegio no podia abrir el salon aunque el backend lo
 * aceptara.
 */
export function ClassroomForm({
  teachers,
}: {
  teachers: ReadonlyArray<{ userId: string; fullName: string }>;
}) {
  const t = useTranslations('docente');
  const vocab = useTranslations();
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
        <span className="text-sm font-medium text-ink-700">{t('nombreDelSalon')}</span>
        <input
          type="text"
          name="name"
          required
          maxLength={60}
          placeholder={t('ejemploNombreSalon')}
          aria-invalid={state.field === 'name' ? true : undefined}
          className="field mt-1.5"
        />
        <span className="mt-1.5 block text-xs text-ink-500">{t('nombreDelSalonAyuda')}</span>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-ink-700">{t('grado')}</span>
        <select
          name="grade"
          required
          defaultValue=""
          aria-invalid={state.field === 'grade' ? true : undefined}
          className="field mt-1.5"
        >
          <option value="" disabled>
            {t('eligeUnGrado')}
          </option>
          {Object.values(GRADES).map((grade) => (
            <option key={grade} value={grade}>
              {gradeLabel(vocab, grade)}
            </option>
          ))}
        </select>
        {/* El grado NO es decorativo: decide qué kit puede activar un alumno de
            este salón, y el registro rechaza a quien declare otro. Se dice aquí
            para que no se elija a la ligera. */}
        <span className="mt-1.5 block text-xs text-ink-500">{t('gradoAyuda')}</span>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-ink-700">{t('plazas')}</span>
        <input
          type="number"
          name="capacity"
          min={1}
          max={60}
          defaultValue={30}
          className="field mt-1.5"
        />
        <span className="mt-1.5 block text-xs text-ink-500">{t('plazasAyuda')}</span>
      </label>

      {teachers.length > 0 ? (
        <label className="block">
          <span className="text-sm font-medium text-ink-700">{t('docenteACargo')}</span>
          <select name="teacherId" defaultValue="" className="field mt-1.5">
            <option value="">{t('yoMismo')}</option>
            {teachers.map((teacher) => (
              <option key={teacher.userId} value={teacher.userId}>
                {teacher.fullName}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <button type="submit" disabled={pending} className="btn btn-primary justify-self-start">
        {pending ? t('creandoSalon') : t('crearSalon')}
      </button>
    </form>
  );
}
