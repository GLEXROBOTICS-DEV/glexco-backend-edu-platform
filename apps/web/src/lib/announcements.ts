import 'server-only';
import { api } from './api';

/** Anuncio tal y como lo devuelve engagement. */
export interface Announcement {
  announcementId: string;
  classroomId: string;
  title: string;
  body: string;
  pinned: boolean;
  publishedAt: string;
  authorId: string;
}

/**
 * Los anuncios que le tocan a quien mira.
 *
 * El alcance lo decide el TOKEN en el backend, no un parametro de esta llamada:
 * un alumno recibe los de sus salones y un docente los de los que da. Dejar que
 * el frontend pidiera un alcance permitiria leer los anuncios del salon de
 * cualquiera cambiando un identificador.
 *
 * Devuelve lista vacia -y no un error- cuando falla. Es la misma decision que en
 * la portada: la pantalla se pinta igual, y el detalle del fallo va al log del
 * servidor, que es donde sirve.
 */
export async function fetchAnnouncements(classroomId?: string): Promise<Announcement[]> {
  const path = classroomId
    ? `/announcements?classroomId=${encodeURIComponent(classroomId)}`
    : '/announcements';

  const result = await api<{ items: Announcement[] }>(path);

  if (!result.ok) {
    console.error('No se pudieron leer los anuncios', {
      code: result.error.code,
      correlationId: result.error.correlationId,
    });
    return [];
  }

  return result.data.items ?? [];
}

/**
 * Fecha en palabras, relativa a hoy.
 *
 * "Hace 2 horas" le dice a un alumno si el anuncio es de esta clase o de la
 * semana pasada, que es lo unico que necesita saber. Una fecha completa le
 * obliga a calcularlo. Se pasa a fecha absoluta a partir de una semana, donde lo
 * relativo deja de ser util ("hace 23 dias" no le dice nada a nadie).
 */
export function relativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const minutes = Math.round((Date.now() - then) / 60_000);

  if (minutes < 1) return 'ahora mismo';
  if (minutes < 60) return `hace ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} ${hours === 1 ? 'hora' : 'horas'}`;

  const days = Math.round(hours / 24);
  if (days === 1) return 'ayer';
  if (days < 7) return `hace ${days} días`;

  return new Date(iso).toLocaleDateString('es-PE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
