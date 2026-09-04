'use server';

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
  const classroomId = String(formData.get('classroomId') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();

  if (title.length < 3) return { error: 'Ponle un título a tu pregunta.' };
  if (body.length < 1) return { error: 'Escribe tu pregunta.' };
  if (!classroomId) return { error: 'No encontramos tu salón. Vuelve a cargar la página.' };

  const result = await api('/announcements/questions', {
    method: 'POST',
    body: { classroomId, title, body },
  });

  if (!result.ok) {
    return { error: 'No pudimos publicar tu pregunta. Vuelve a intentarlo en un momento.' };
  }

  revalidatePath('/', 'layout');
  return { done: true };
}

/** Responder en el muro. Lo hace el docente y tambien los companeros. */
export async function replyToPost(
  _previous: WallState,
  formData: FormData,
): Promise<WallState> {
  const announcementId = String(formData.get('announcementId') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();

  if (body.length < 1) return { error: 'Escribe tu respuesta.' };

  const result = await api(`/announcements/${encodeURIComponent(announcementId)}/replies`, {
    method: 'POST',
    body: { body },
  });

  if (!result.ok) {
    return { error: 'No pudimos publicar tu respuesta. Vuelve a intentarlo en un momento.' };
  }

  revalidatePath('/', 'layout');
  return { done: true };
}
