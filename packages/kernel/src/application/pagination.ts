/**
 * Paginacion por cursor.
 *
 * Deliberadamente NO usamos OFFSET: con listados grandes (todos los alumnos de
 * una red de colegios, la biblioteca multimedia completa) el coste de OFFSET
 * crece con la profundidad de la pagina y los resultados se duplican o se saltan
 * cuando alguien inserta mientras el usuario navega. El cursor es un puntero
 * estable a la ultima fila entregada.
 */
export interface CursorPage<T> {
  items: T[];
  /** Cursor opaco para pedir la siguiente pagina. `null` si ya no hay mas. */
  nextCursor: string | null;
  /** Total aproximado; solo se calcula cuando el cliente lo pide, porque un
   *  COUNT exacto sobre millones de filas es caro. */
  estimatedTotal?: number;
}

export interface CursorQuery {
  cursor?: string;
  limit: number;
  order?: 'asc' | 'desc';
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export function normalizeLimit(limit?: number): number {
  if (!limit || !Number.isFinite(limit) || limit <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.trunc(limit), MAX_PAGE_SIZE);
}

/**
 * Codifica el cursor en base64url. Es opaco a proposito: el cliente no debe
 * construirlo ni depender de su forma, para que podamos cambiar la estrategia
 * de ordenacion sin romper integraciones.
 */
export function encodeCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor<T extends Record<string, unknown>>(cursor: string): T | null {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}
