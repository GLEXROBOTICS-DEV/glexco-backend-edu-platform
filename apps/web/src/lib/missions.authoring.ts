import 'server-only';
import { api } from './api';

/**
 * Las misiones de un kit, para quien las escribe.
 *
 * No es lo que ve el alumno. Aquella lectura **evalua objetivos y paga XP** al
 * abrirse; esta solo enumera lo que hay, y existe para una cosa concreta:
 * ensenar las semanas que ya tienen mision ANTES de crear otra.
 *
 * Esa diferencia no es un detalle de implementacion. Al sembrar los retos en
 * produccion, la comprobacion de "si ya existe, no lo repitas" pregunto a un
 * listado que devuelve cero para el personal de plataforma -filtra por
 * institucion, y GLEXCO no tiene-, y acabaron tres duplicados publicados. La
 * pantalla tiene que ver lo mismo que va a ver el alumno, o repite el error.
 */

export interface AuthoredMission {
  missionId: string;
  weekNumber: number;
  title: string;
  description: string;
  xpReward: number;
  origin: 'glexco' | 'institution';
  objectives: { kind: string; target: number }[];
  /** Lo decide el SERVIDOR. Una mision de GLEXCO se ve desde un colegio -sus
   *  alumnos la cumplen- pero no se edita: es la misma para todo el pais. */
  editable: boolean;
}

export async function fetchAuthoredMissions(kitId: string): Promise<{
  items: AuthoredMission[];
  failed: boolean;
}> {
  const result = await api<{ items: AuthoredMission[] }>(
    `/learning/missions/kit/${encodeURIComponent(kitId)}`,
  );

  if (!result.ok) {
    console.error('No se pudieron leer las misiones del kit', {
      kitId,
      code: result.error.code,
      correlationId: result.error.correlationId,
    });
    return { items: [], failed: true };
  }

  // Por semana y no por fecha de creacion: quien escribe la semana 5 quiere ver
  // que hay en la 4 y en la 6, no que se publico antes.
  const items = [...(result.data.items ?? [])].sort((a, b) => a.weekNumber - b.weekNumber);

  return { items, failed: false };
}

/** Las semanas que ya tienen mision. La pantalla las marca en el desplegable
 *  para que no se cree una segunda sin querer. */
export function occupiedWeeks(items: AuthoredMission[]): Set<number> {
  return new Set(items.map((item) => item.weekNumber));
}
