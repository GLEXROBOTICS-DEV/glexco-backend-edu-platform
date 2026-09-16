'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { QUESTION_TYPES } from '@glexco/contracts';
import { safeLabel } from '../lib/vocabulary';
import { addQuestion, type QuestionState } from '../lib/teacher-assessments.actions';
import { RubricEditor } from './rubric-editor';

/**
 * Los tipos que ESTE editor sabe construir.
 *
 * Es una lista propia y no `Object.values(QUESTION_TYPES)` a proposito:
 * `true_false` esta en el contrato y el backend lo acepta, pero aqui no hay
 * formulario para sus dos opciones, asi que caeria en la rama de "esta la
 * corriges tu" —que seria mentira— y el docente acabaria con una pregunta que
 * nunca se autocorrige. Lo que si sale del catalogo es el NOMBRE de cada tipo:
 * antes estaba escrito en espanol dentro de este fichero y el desplegable seguia
 * en espanol dentro de una pantalla en ingles.
 */
const TYPES = [
  QUESTION_TYPES.SINGLE_CHOICE,
  QUESTION_TYPES.MULTIPLE_CHOICE,
  QUESTION_TYPES.ORDERING,
  QUESTION_TYPES.MATCHING,
  QUESTION_TYPES.SHORT_ANSWER,
  QUESTION_TYPES.FILE_UPLOAD,
] as const;

/** Cuantas filas en blanco se ofrecen. Se exporta porque la pantalla que monta
 *  este editor prepara una etiqueta por fila (ver `ClaveEnPantalla`). */
export const BLANK_OPTIONS = 4;

/**
 * Los textos que NOMBRAN la clave de correccion.
 *
 * Llegan como propiedad en vez de salir de `useTranslations`, y la razon es
 * concreta: el catalogo de traducciones se serializa dentro de un `<script>` en
 * **todas** las paginas de la seccion, incluida la de una evaluacion del banco
 * de GLEXCO, y de esa pagina se exige que la palabra "correcta" no aparezca en
 * ningun sitio —son las mismas preguntas que van a responder los alumnos, y el
 * docente que las mira tampoco debe ver la clave—.
 *
 * Como propiedad solo viajan cuando este editor se pinta, y este editor no se
 * pinta en una evaluacion ajena. Si mas adelante hace falta un texto nuevo que
 * nombre la clave, va aqui y al espacio `docenteServidor`; todo lo demas va al
 * espacio `docente`, como el resto del portal.
 */
export interface ClaveEnPantalla {
  pasosEnOrden: string;
  opcionesMarcaUna: string;
  opcionesMarcaVarias: string;
  /** Una etiqueta por casilla, ya numerada: este componente no puede leer el
   *  espacio que las contiene, asi que llegan hechas. */
  marcarOpcion: readonly string[];
}

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
export function AssessmentEditor({
  assessmentId,
  clave,
}: {
  assessmentId: string;
  clave: ClaveEnPantalla;
}) {
  const t = useTranslations('docente');
  const vocab = useTranslations();
  const [state, formAction] = useActionState<QuestionState, FormData>(addQuestion, {});
  const [type, setType] = useState<string>('single_choice');

  const ordering = type === 'ordering';
  const matching = type === 'matching';
  // Los puntos se llevan en estado porque la rúbrica tiene que cuadrar con
  // ellos, y el aviso se da mientras se escribe y no al enviar.
  const [puntos, setPuntos] = useState(10);
  // Emparejar tiene su propio bloque: son DOS columnas y la clave es la fila,
  // no una opcion marcada.
  const needsOptions = type === 'single_choice' || type === 'multiple_choice' || ordering;
  const multiple = type === 'multiple_choice';

  return (
    <form
      action={formAction}
      className="grid gap-4 border border-line-200 bg-white"
      style={{ borderRadius: 'var(--portal-radius)', padding: 'var(--portal-card-padding)' }}
    >
      <input type="hidden" name="assessmentId" value={assessmentId} />

      <h2 className="font-display text-base font-semibold">{t('anadirPregunta')}</h2>

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
          {t('preguntaAnadida')}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">{t('tipoDePregunta')}</span>
          <select
            name="type"
            value={type}
            onChange={(event) => setType(event.target.value)}
            className="field"
          >
            {TYPES.map((value) => (
              <option key={value} value={value}>
                {safeLabel(vocab, 'tiposPregunta', value)}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">{t('puntos')}</span>
          <input
            type="number"
            name="points"
            min={1}
            max={100}
            value={puntos}
            onChange={(event) => setPuntos(Number(event.target.value) || 0)}
            required
            className="field"
          />
        </label>
      </div>

      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-ink-700">{t('enunciado')}</span>
        <textarea
          name="prompt"
          rows={2}
          required
          minLength={3}
          placeholder={t('ejemploEnunciado')}
          className="field"
        />
      </label>

      {matching ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium text-ink-700">{t('parejas')}</legend>
          {/* La regla se dice ANTES de escribir y no en un error después: cada
              fila ES una pareja, y eso no se adivina mirando ocho campos
              vacíos. */}
          <p className="mb-1 text-xs text-ink-400">{t('parejasAyuda')}</p>

          {Array.from({ length: BLANK_OPTIONS }, (_, index) => (
            <div key={index} className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
              <input
                type="text"
                name="matchLeft"
                aria-label={t('elementoIzquierdo', { numero: index + 1 })}
                placeholder={t('ejemploIzquierda', { numero: index + 1 })}
                className="field"
              />
              <span className="hidden text-ink-400 sm:block" aria-hidden="true">
                ↔
              </span>
              <input
                type="text"
                name="matchRight"
                aria-label={t('suPareja', { numero: index + 1 })}
                placeholder={t('suPareja', { numero: index + 1 })}
                className="field"
              />
            </div>
          ))}
        </fieldset>
      ) : needsOptions ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium text-ink-700">
            {ordering
              ? clave.pasosEnOrden
              : multiple
                ? clave.opcionesMarcaVarias
                : clave.opcionesMarcaUna}
          </legend>
          <p className="mb-1 text-xs text-ink-400">
            {ordering
              ? // Se dice la regla ANTES de escribir, no después en un error: el
                // orden en que el docente los teclea ES la respuesta, y eso no
                // se adivina mirando cuatro campos de texto vacíos.
                t('pasosAyuda')
              : t('opcionesAyuda')}
          </p>

          {Array.from({ length: BLANK_OPTIONS }, (_, index) => (
            <div key={index} className="flex items-center gap-3">
              {ordering ? (
                // El número del paso, no un control de "cuál es la respuesta":
                // en una secuencia no hay una opción buena, la respuesta es el
                // orden entero.
                <span
                  className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-200 text-xs font-semibold tabular-nums text-ink-500"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
              ) : (
                <input
                  type={multiple ? 'checkbox' : 'radio'}
                  name="correctOption"
                  value={index}
                  aria-label={clave.marcarOpcion[index]}
                  className="size-4 shrink-0 border-line-300 text-brand-600"
                />
              )}
              <input
                type="text"
                name="optionText"
                aria-label={
                  ordering
                    ? t('pasoNumero', { numero: index + 1 })
                    : t('textoDeLaOpcion', { numero: index + 1 })
                }
                placeholder={
                  ordering
                    ? t('pasoNumero', { numero: index + 1 })
                    : t('opcionNumero', { numero: index + 1 })
                }
                className="field"
              />
            </div>
          ))}
        </fieldset>
      ) : (
        <>
          <p className="rounded-lg border border-line-200 bg-surface-100 px-4 py-3 text-sm text-ink-700">
            {/* Decirlo aquí evita la pregunta obvia: "¿y dónde pongo la respuesta?" */}
            {t('laCorrigesTuAyuda')}
          </p>

          {/* La rúbrica solo tiene sentido donde corrige una persona: en las de
              marcar, la máquina compara con la clave y no hay criterios que
              valorar. */}
          <RubricEditor questionPoints={puntos} />
        </>
      )}

      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-ink-700">
          {t('explicacion')} <span className="text-ink-400">({t('opcional').toLowerCase()})</span>
        </span>
        <input
          type="text"
          name="explanation"
          placeholder={t('explicacionAyuda')}
          className="field"
        />
      </label>

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const t = useTranslations('docente');
  const { pending } = useFormStatus();

  return (
    <div>
      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary"
      >
        {pending ? t('anadiendoPregunta') : t('anadirPregunta')}
      </button>
    </div>
  );
}
