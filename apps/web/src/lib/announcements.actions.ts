'use server';

import { revalidatePath } from 'next/cache';
import { api } from './api';

/**
 * Publicar y archivar anuncios.
 *
 * El alcance NO se comprueba aqui. El backend decide si quien escribe es el
 * docente de ese salon o un administrador de esa institucion, y esta accion se
 * limita a llevar el formulario. Repetir la regla en el cliente daria la falsa
 * impresion de que este lado la sostiene, y la primera vez que las dos copias se
 * separen ganaria la equivocada.
 */

export interface AnnouncementState {
  error?: string;
  published?: boolean;
}

export async function publishAnnouncement(
  _previous: AnnouncementState,
  formData: FormData,
): Promise<AnnouncementState> {
  const classroomId = String(formData.get('classroomId') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const pinned = formData.get('pinned') === 'on';

  if (!classroomId) return { error: 'Elige el salón al que va el anuncio.' };
  if (title.length < 3) return { error: 'El título es demasiado corto.' };
  if (body.length < 1) return { error: 'Escribe el mensaje del anuncio.' };

  const result = await api<{ announcementId: string }>('/announcements', {
    method: 'POST',
    body: { classroomId, title, body, pinned },
  });

  if (!result.ok) {
    return { error: result.error.message };
  }

  // Sin esto, el docente publica y vuelve a una lista que no lo incluye: parece
  // que no se guardo y lo escribe otra vez.
  revalidatePath('/docentes/anuncios');
  revalidatePath('/discover');
  revalidatePath('/academy');

  return { published: true };
}

export async function archiveAnnouncement(formData: FormData): Promise<void> {
  const announcementId = String(formData.get('announcementId') ?? '');
  if (!announcementId) return;

  const result = await api<void>(`/announcements/${encodeURIComponent(announcementId)}`, {
    method: 'DELETE',
  });

  if (!result.ok) {
    console.error('No se pudo archivar el anuncio', {
      announcementId,
      code: result.error.code,
      correlationId: result.error.correlationId,
    });
  }

  revalidatePath('/docentes/anuncios');
}
