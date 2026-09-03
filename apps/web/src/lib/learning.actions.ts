'use server';

import { revalidatePath } from 'next/cache';
import { api } from './api';

/**
 * Marcar una leccion como vista.
 *
 * **Lo marca el alumno, no lo deduce el sistema.** Se penso en darlo por
 * completado al abrir el recurso, y se descarto: abrir un PDF no es haberlo
 * leido, y un progreso que se rellena solo deja de significar nada -ni para el
 * alumno, que ve barras llenas sin haber hecho nada, ni para el docente, que
 * pierde la unica senal de quien se descolgo-.
 *
 * El `studentId` sale del token en el backend. Nunca viaja en la peticion.
 */

export interface LessonState {
  error?: string;
  completed?: boolean;
  xpAwarded?: number;
  levelUp?: string | null;
  newBadges?: { code: string; name: string; description: string }[];
  courseCompleted?: boolean;
  /** `false` cuando ya estaba completada. No es un error: el resultado es el que
   *  el alumno queria, pero decirle "+25 XP" otra vez seria mentirle. */
  alreadyDone?: boolean;
}

interface CompleteResponse {
  firstCompletion: boolean;
  xpAwarded: number;
  totalXp: number;
  explorerLevel: number;
  levelName: string;
  levelUp: string | null;
  newBadges: { code: string; name: string; description: string }[];
  courseCompleted: boolean;
}

export async function completeLesson(
  _previous: LessonState,
  formData: FormData,
): Promise<LessonState> {
  const lessonId = String(formData.get('lessonId') ?? '');
  const portal = String(formData.get('portal') ?? 'discover');
  const seconds = Number.parseInt(String(formData.get('secondsSpent') ?? '0'), 10);

  if (!lessonId) return { error: 'No sabemos qué lección marcar.' };

  const result = await api<CompleteResponse>(
    `/learning/lessons/${encodeURIComponent(lessonId)}/complete`,
    {
      method: 'POST',
      body: { secondsSpent: Number.isFinite(seconds) && seconds > 0 ? seconds : 0 },
    },
  );

  if (!result.ok) {
    return { error: result.error.message };
  }

  // El progreso y la portada leen esto; sin invalidarlas el alumno marca una
  // leccion y vuelve a ver el contador antiguo, que se lee como que no se
  // guardo.
  revalidatePath(`/${portal}`);
  revalidatePath(`/${portal}/progreso`);

  return {
    completed: true,
    alreadyDone: !result.data.firstCompletion,
    xpAwarded: result.data.xpAwarded,
    levelUp: result.data.levelUp,
    newBadges: result.data.newBadges,
    courseCompleted: result.data.courseCompleted,
  };
}

/**
 * Abre la leccion.
 *
 * Se llama al renderizar la pantalla del recurso, no al pulsar nada: el hecho
 * que interesa es "la abrio", y exigir un clic extra para registrarlo mediria
 * quien pulsa botones y no quien entra al contenido.
 *
 * Nunca lanza: registrar que se abrio algo no puede impedir verlo.
 */
export async function startLesson(input: {
  lessonId: string;
  classroomId?: string | null;
}): Promise<{ alreadyCompleted: boolean }> {
  // El curso y el kit NO se envian: los resuelve learning desde su propio
  // directorio. Mandarlos desde aqui permitiria a un alumno atribuirse progreso
  // en un curso que no es el suyo, y con el, los puntos de completarlo.
  const result = await api<{ alreadyCompleted: boolean }>(
    `/learning/lessons/${encodeURIComponent(input.lessonId)}/start`,
    { method: 'POST', body: { classroomId: input.classroomId ?? null } },
  );

  if (!result.ok) {
    console.error('No se pudo registrar la apertura de la leccion', {
      lessonId: input.lessonId,
      code: result.error.code,
      correlationId: result.error.correlationId,
    });
    // Registrar que se abrio algo no puede impedir verlo: se sigue adelante y
    // el boton de "ya lo vi" aparece igualmente.
    return { alreadyCompleted: false };
  }

  return result.data;
}
