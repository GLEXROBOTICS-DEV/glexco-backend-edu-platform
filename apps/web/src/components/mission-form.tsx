'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { MISSION_OBJECTIVE_KINDS } from '@glexco/contracts';
import { safeLabel } from '../lib/vocabulary';
import { publishMission, type MissionState } from '../lib/missions.actions';

/** Cuantas filas de objetivo se ofrecen en blanco. Tres cubre el caso real
 *  -lecciones, evaluacion y XP- sin pedir nada que nadie va a rellenar. */
const FILAS_OBJETIVO = 3;

/** Semanas que se ofrecen. El contrato admite hasta 52; un kit escolar cabe
 *  de sobra en ese rango y ensenar 52 opciones no cuesta nada. */
const SEMANAS = 52;

/**
 * Escribir una mision semanal.
 *
 * **Las semanas ya ocupadas salen marcadas en el desplegable.** Es lo unico que
 * esta pantalla hace de mas y es la razon de que exista: sin ese aviso, la
 * unica forma de saber que la semana 3 ya tenia mision era publicar una segunda
 * y verlas duplicadas en la Zona de retos del alumno. Paso en produccion con
 * los retos sembrados, y no se descubrio hasta que se miro el portal.
 *
 * No se BLOQUEA la semana ocupada, solo se avisa: una mision se guarda por
 * identificador, asi que dos en la misma semana es una decision legitima -un
 * kit puede tener dos retos esa semana- y prohibirlo seria inventar una regla
 * que el dominio no tiene.
 *
 * Funciona sin JavaScript, como el resto del portal: los objetivos viajan como
 * dos listas paralelas de campos con el mismo nombre, que es lo que manda un
 * formulario nativo, y la Server Action los empareja por posicion.
 */
export function MissionForm({
  kitId,
  occupied,
}: {
  kitId: string;
  /** Las semanas que ya tienen mision en este kit. */
  occupied: number[];
}) {
  const t = useTranslations('admin');
  const vocab = useTranslations();
  const [state, formAction] = useActionState<MissionState, FormData>(publishMission, {});

  const ocupadas = new Set(occupied);

  return (
    <form
      action={formAction}
      className="grid gap-4 border border-line-200 bg-white"
      style={{ borderRadius: 'var(--portal-radius)', padding: 'var(--portal-card-padding)' }}
    >
      <input type="hidden" name="kitId" value={kitId} />

      <h2 className="font-display text-base font-semibold">{t('nuevaMision')}</h2>

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
          data-mission="published"
          className="rounded-lg border border-state-done-fg/25 bg-state-done-bg px-4 py-3 text-sm text-state-done-fg"
        >
          {t('misionPublicada')}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">{t('tituloDeLaMision')}</span>
          <input
            type="text"
            name="title"
            required
            minLength={3}
            maxLength={200}
            placeholder={t('ejemploTituloMision')}
            aria-invalid={state.field === 'title' ? true : undefined}
            className="field"
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">{t('semana')}</span>
          <select
            name="weekNumber"
            required
            defaultValue=""
            aria-invalid={state.field === 'weekNumber' ? true : undefined}
            className="field"
          >
            <option value="" disabled>
              —
            </option>
            {Array.from({ length: SEMANAS }, (_, index) => index + 1).map((semana) => (
              <option key={semana} value={semana}>
                {ocupadas.has(semana)
                  ? t('semanaOcupada', { numero: semana })
                  : t('semanaNumero', { numero: semana })}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-ink-700">{t('descripcionDeLaMision')}</span>
        <textarea name="description" rows={2} maxLength={2000} className="field" />
        <span className="text-xs text-ink-500">{t('descripcionAyuda')}</span>
      </label>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium text-ink-700">{t('objetivos')}</legend>
        <p className="mb-1 text-xs text-ink-400">{t('objetivosAyuda')}</p>

        {Array.from({ length: FILAS_OBJETIVO }, (_, index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-[1fr_8rem]">
            <label className="grid gap-1">
              <span className="sr-only">{t('queConseguir')}</span>
              <select name="objectiveKind" defaultValue="" className="field">
                {/* La fila vacia es la primera opcion: las tres filas estan
                    siempre, y sin un valor neutro la mision saldria con tres
                    objetivos aunque solo se rellenara uno. */}
                <option value="">—</option>
                {MISSION_OBJECTIVE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {safeLabel(vocab, 'objetivosMision', kind)}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1">
              <span className="sr-only">{t('cuantos')}</span>
              <input
                type="number"
                name="objectiveTarget"
                min={1}
                max={1000}
                placeholder={t('cuantos')}
                className="field"
              />
            </label>
          </div>
        ))}
      </fieldset>

      <label className="grid max-w-[12rem] gap-1.5">
        <span className="text-sm font-medium text-ink-700">{t('recompensa')}</span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            name="xpReward"
            min={1}
            max={10000}
            defaultValue={50}
            required
            aria-invalid={state.field === 'xpReward' ? true : undefined}
            className="field"
          />
          <span className="text-sm text-ink-500">XP</span>
        </div>
      </label>

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const t = useTranslations('admin');
  const { pending } = useFormStatus();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="submit" disabled={pending} className="btn btn-primary">
        {/* Texto que cambia y no un icono girando: el cambio lo anuncia el
            lector de pantalla, el icono no. */}
        {pending ? t('publicandoMision') : t('publicarMision')}
      </button>
      <p className="text-sm text-ink-500">{t('naceePublicada')}</p>
    </div>
  );
}
