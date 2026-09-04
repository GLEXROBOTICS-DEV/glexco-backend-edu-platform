'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { askQuestion, replyToPost, type WallState } from '../lib/wall.actions';

/**
 * Preguntar al salon.
 *
 * El texto de ayuda dice con todas las letras **quien lo va a ver**. No es
 * decoracion: un alumno que cree estar escribiendo en privado escribe cosas
 * distintas, y descubrirlo despues es la peor forma de enterarse.
 */
export function AskForm({ classroomId }: { classroomId: string }) {
  const [state, formAction, pending] = useActionState<WallState, FormData>(askQuestion, {});
  const t = useTranslations('muro');

  return (
    <form
      action={formAction}
      className="grid gap-3 rounded-[var(--portal-radius)] border border-line-200 bg-white p-[var(--portal-card-padding)]"
    >
      <input type="hidden" name="classroomId" value={classroomId} />

      <div>
        <h2 className="font-display text-lg font-semibold">{t('preguntaATuClase')}</h2>
        <p className="mt-1 text-sm text-ink-500">{t('loVeranTodos')}</p>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      {state.done ? (
        <p role="status" className="text-sm text-state-done-fg">
          {t('publicada')}
        </p>
      ) : null}

      {/* Etiqueta de verdad y no solo un `placeholder`: el placeholder
          desaparece al escribir -así que quien se distrae ya no sabe qué iba en
          el campo- y varios lectores de pantalla no lo anuncian. Va en
          `sr-only` porque el título del bloque ya explica de qué va. */}
      <label>
        <span className="sr-only">{t('etiquetaTitulo')}</span>
        <input
          type="text"
          name="title"
          required
          maxLength={120}
          placeholder={t('tituloDeLaPregunta')}
          className="field"
        />
      </label>

      <label>
        <span className="sr-only">{t('etiquetaCuerpo')}</span>
        <textarea
          name="body"
          required
          maxLength={4000}
          placeholder={t('pistaCuerpo')}
          className="field"
        />
      </label>

      <button type="submit" disabled={pending} className="btn btn-primary justify-self-start">
        {pending ? t('publicando') : t('publicar')}
      </button>
    </form>
  );
}

/**
 * Responder en un hilo.
 *
 * Un formulario por publicación y no uno global con un selector: con el selector
 * hay que elegir a qué se responde, y ahí es donde la gente responde a la
 * publicación equivocada.
 */
export function ReplyForm({ announcementId }: { announcementId: string }) {
  const [state, formAction, pending] = useActionState<WallState, FormData>(replyToPost, {});
  const t = useTranslations('muro');

  return (
    <form action={formAction} className="mt-3 flex flex-wrap items-start gap-2">
      <input type="hidden" name="announcementId" value={announcementId} />

      <label className="min-w-0 flex-1">
        <span className="sr-only">{t('tuRespuesta')}</span>
        <input
          type="text"
          name="body"
          required
          maxLength={4000}
          placeholder={t('pistaRespuesta')}
          className="field"
        />
      </label>

      <button type="submit" disabled={pending} className="btn btn-secondary">
        {pending ? t('enviando') : t('responder')}
      </button>

      {state.error ? (
        <p role="alert" className="w-full text-sm text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
