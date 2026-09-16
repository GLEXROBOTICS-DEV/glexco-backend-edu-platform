'use server';

import { getTranslations } from 'next-intl/server';

import { revalidatePath } from 'next/cache';
import { api } from './api';

export interface WallState {
  error?: string;
  done?: boolean;
}

/**
 * Un alumno pregunta a su salon.
 *
 * **Lo ve la clase entera, no es un mensaje privado.** Es lo que pidio el
 * cliente y ademas lo mas seguro: no se abre ningun canal privado entre un
 * adulto y un menor, y todo lo que se escribe queda a la vista de su docente.
 */
export async function askQuestion(
  _previous: WallState,
  formData: FormData,
): Promise<WallState> {
  const t = await getTranslations('errores');
  const classroomId = String(formData.get('classroomId') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();

  if (title.length < 3) return { error: t('ponleTituloALaPregunta') };
  if (body.length < 1) return { error: t('escribeTuPregunta') };
  if (!classroomId) return { error: t('noEncontramosTuSalon') };

  const result = await api('/announcements/questions', {
    method: 'POST',
    body: { classroomId, title, body },
  });

  if (!result.ok) {
    return { error: t('noPudimosPublicarPregunta') };
  }

  revalidatePath('/', 'layout');
  return { done: true };
}

/** Responder en el muro. Lo hace el docente y tambien los companeros. */
export async function replyToPost(
  _previous: WallState,
  formData: FormData,
): Promise<WallState> {
  const t = await getTranslations('errores');
  const announcementId = String(formData.get('announcementId') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();

  if (body.length < 1) return { error: t('escribeTuRespuesta') };

  const result = await api(`/announcements/${encodeURIComponent(announcementId)}/replies`, {
    method: 'POST',
    body: { body },
  });

  if (!result.ok) {
    return { error: t('noPudimosPublicarRespuesta') };
  }

  revalidatePath('/', 'layout');
  return { done: true };
}
