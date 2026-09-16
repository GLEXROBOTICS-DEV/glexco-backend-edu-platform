'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { startGroupAttempt, type AttemptState } from '../lib/assessment.actions';
import type { Classmate } from '../lib/assessments';

/**
 * Elegir con quien se hace una actividad en grupo.
 *
 * **Se pide ANTES de abrir el intento, y por eso existe esta pantalla.** El
 * resto de evaluaciones abren el intento al cargar la pagina —el cronometro
 * empieza cuando el alumno ve las preguntas—, pero un grupo no se puede formar
 * despues: la entrega ya seria de uno solo, y rehacerla significaria borrar
 * respuestas ya escritas.
 *
 * **Funciona sin JavaScript.** Es un `<form action>` con casillas normales
 * dentro de un `<details>`: sin JavaScript el bloque se abre igual —es HTML— y
 * el envio es el del navegador. Con JavaScript solo se gana el contador en vivo
 * y el boton deshabilitado mientras el grupo no cuadra.
 *
 * Quien ya empezo con otro grupo NO aparece. Se dice cuantos son en vez de
 * esconderlo: un alumno que busca a su amigo y no lo encuentra piensa que la
 * pantalla esta rota, y acaba llamando al docente.
 */
export function GroupPicker({
  assessmentId,
  classroomId,
  classmates,
  takenCount,
  minSize,
  maxSize,
  studentName,
}: {
  assessmentId: string;
  classroomId: string | null;
  classmates: Classmate[];
  takenCount: number;
  minSize: number;
  maxSize: number;
  studentName: string;
}) {
  const t = useTranslations('evaluacion');
  const [state, formAction] = useActionState<AttemptState, FormData>(startGroupAttempt, {});

  // Quien forma el grupo cuenta, asi que se eligen como mucho `maxSize - 1`
  // companeros. Contarlo aparte es la via mas rapida a un grupo de un integrante
  // mas de los que la actividad admite.
  const maxCompaneros = maxSize - 1;
  const minCompaneros = minSize - 1;

  if (classmates.length < minCompaneros) {
    return (
      <div
        role="alert"
        data-group="impossible"
        className="rounded-lg border border-achievement/40 bg-achievement/5 px-4 py-4 text-sm"
      >
        <p className="font-semibold text-ink-900">{t('aunNoPuedesFormarGrupo')}</p>
        <p className="mt-1 text-ink-700">
          {takenCount > 0
            ? t('libresNoLleganAlMinimo', { cuantos: takenCount })
            : t('sinSuficientesCompaneros')}{' '}
          {t('avisaleATuDocente')}
        </p>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="grid gap-4 border border-line-200 bg-white"
      style={{ borderRadius: 'var(--portal-radius)', padding: 'var(--portal-card-padding)' }}
    >
      <input type="hidden" name="assessmentId" value={assessmentId} />
      {classroomId ? <input type="hidden" name="classroomId" value={classroomId} /> : null}

      <div>
        <h2 className="font-display text-lg font-semibold">{t('seHaceEnGrupo')}</h2>
        <p className="mt-1 text-sm text-ink-500">
          {minSize === maxSize
            ? t('soisTantos', { cuantos: minSize })
            : t('soisDeTantosATantos', { minimo: minSize, maximo: maxSize })}{' '}
          {t('mismaNotaParaElGrupo')}
        </p>
      </div>

      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger"
        >
          {state.error}
        </p>
      ) : null}

      <details data-group="picker" className="rounded-lg border border-line-200 bg-surface-50">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink-700">
          {t('elegirCompaneros')}
          <span className="ml-1 font-normal text-ink-500">
            {t('cuantosDisponibles', { cuantos: classmates.length })}
          </span>
        </summary>

        <fieldset className="grid gap-1 px-4 pb-4">
          <legend className="sr-only">{t('companerosDeTuGrupo')}</legend>

          {/* Quien forma el grupo, fijo y sin casilla: no es una eleccion, y una
              casilla marcada que no se puede desmarcar confunde mas que ayuda. */}
          <p className="border-b border-line-200 py-2 text-sm text-ink-500">
            {studentName} <span className="text-ink-400">— {t('tu')}</span>
          </p>

          {classmates.map((classmate) => (
            <label
              key={classmate.studentId}
              className="flex cursor-pointer items-center gap-2.5 border-b border-line-200 py-2 text-sm last:border-0"
            >
              <input
                type="checkbox"
                name="groupmateIds"
                value={classmate.studentId}
                className="size-4 shrink-0 rounded border-line-300 text-brand-600"
              />
              <span className="text-ink-900">{classmate.fullName ?? t('unCompanero')}</span>
            </label>
          ))}
        </fieldset>
      </details>

      <p className="text-xs text-ink-500">
        {minCompaneros === maxCompaneros
          ? t('puedesElegirExacto', { cuantos: minCompaneros })
          : t('puedesElegirEntre', { minimo: minCompaneros, maximo: maxCompaneros })}{' '}
        {takenCount > 0 ? t('noSalenLosQueYaEmpezaron', { cuantos: takenCount }) : ''}
      </p>

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const t = useTranslations('evaluacion');
  const { pending } = useFormStatus();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="submit" disabled={pending} className="btn btn-primary">
        {/* Cambia el texto y no solo un icono: el cambio de texto lo anuncia un
            lector de pantalla y un spinner girando no dice nada. */}
        {pending ? t('abriendoLaActividad') : t('empezarConMiGrupo')}
      </button>
      <p className="text-sm text-ink-500">{t('nombresDejanDeSalir')}</p>
    </div>
  );
}
