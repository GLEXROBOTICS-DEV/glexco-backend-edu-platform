import { cache } from 'react';
import { api } from './api';

/**
 * Las misiones semanales del alumno.
 *
 * Se piden POR KIT porque las misiones son del kit: quien tiene dos libros tiene
 * dos series de misiones, y mezclarlas en una lista dejaría dos "misiones de
 * esta semana" sin decir de cuál robot es cada una.
 */

export type MissionState = 'locked' | 'current' | 'completed' | 'overdue';

export interface MissionObjectiveProgress {
  kind: string;
  target: number;
  current: number;
  done: boolean;
}

export interface MissionItem {
  missionId: string;
  weekNumber: number;
  title: string;
  description: string;
  xpReward: number;
  state: MissionState;
  met: number;
  total: number;
  objectives: MissionObjectiveProgress[];
  opensAt: string | null;
  closesAt: string | null;
  completedAt: string | null;
  onTime: boolean | null;
  /** `true` si esta carga acaba de completarla. Permite celebrarlo una vez. */
  justCompleted: boolean;
}

/**
 * Las misiones de un kit.
 *
 * `cache()` por petición: la portada las pide para el bloque de la semana y la
 * pantalla de retos para su lista, y sin esto serían dos llamadas idénticas en
 * el mismo render.
 *
 * **Ojo: esta lectura puede ESCRIBIR en el servidor.** Si los objetivos de una
 * misión ya están cumplidos, la llamada anota su XP. Es idempotente por
 * construcción —la garantía está en la base— pero conviene saberlo antes de
 * ponerla en un bucle.
 */
export const fetchMissions = cache(
  async (kitId: string): Promise<{ items: MissionItem[]; awardedXp: number; failed: boolean }> => {
    const result = await api<{ items: MissionItem[]; awardedXp: number }>(
      `/learning/missions/${encodeURIComponent(kitId)}`,
    );

    if (!result.ok) {
      // Lista vacía y no un error: sin misiones la portada se pinta igual, y un
      // fallo del servicio de aprendizaje no puede dejar al alumno sin su curso
      // a medias ni sin sus próximas actividades.
      console.error('No se pudieron leer las misiones', {
        kitId,
        status: result.status,
        code: result.error.code,
        correlationId: result.error.correlationId,
      });
      return { items: [], awardedXp: 0, failed: true };
    }

    return { items: result.data.items ?? [], awardedXp: result.data.awardedXp ?? 0, failed: false };
  },
);

/**
 * La misión que toca ahora.
 *
 * La de esta semana si hay una; si no, la más vieja que quedó pendiente. **Una
 * misión vencida sigue siendo hacible** —el cliente decidió que no se toca el
 * calendario—, así que enseñar la vencida antes que la bloqueada es lo que
 * convierte un "llegas tarde" en un "todavía puedes".
 */
export function currentMission(items: readonly MissionItem[]): MissionItem | null {
  const enCurso = items.filter((item) => item.state === 'current');
  if (enCurso.length > 0) {
    return [...enCurso].sort((a, b) => a.weekNumber - b.weekNumber)[0]!;
  }

  const vencidas = items.filter((item) => item.state === 'overdue');
  if (vencidas.length > 0) {
    return [...vencidas].sort((a, b) => a.weekNumber - b.weekNumber)[0]!;
  }

  // Todo hecho, o nada empezado: la siguiente que llega.
  const bloqueadas = items.filter((item) => item.state === 'locked');
  return bloqueadas.length > 0
    ? [...bloqueadas].sort((a, b) => a.weekNumber - b.weekNumber)[0]!
    : null;
}
