import 'server-only';
import { api } from './api';

/** Kit al que el alumno tiene derecho. Es la regla central del negocio: solo ve
 *  el contenido del libro que compro. */
export interface MyKit {
  kitId: string;
  name: string;
  program: 'discover' | 'academy';
  grade: string;
  robotPlatforms: string[];
  coverImageKey: string | null;
  grantedAt: string;
}

export interface LibraryItem {
  id: string;
  title: string;
  type: string;
  locale: 'es' | 'en';
  downloadable: boolean;
}

/**
 * Kits del alumno.
 *
 * Devuelve lista vacia -y no un error- cuando la peticion falla. Es deliberado:
 * la portada tiene que pintarse igualmente y decirle al alumno que algo no fue
 * bien, en vez de mostrarle una pantalla de error completa por un fallo
 * temporal de un servicio. El detalle del fallo va al log del servidor, que es
 * donde sirve.
 */
export async function fetchMyKits(): Promise<{ kits: MyKit[]; failed: boolean }> {
  const result = await api<{ kits: MyKit[] }>('/catalog/my-kits');

  if (!result.ok) {
    console.error('No se pudieron leer los kits del alumno', {
      status: result.status,
      code: result.error.code,
      correlationId: result.error.correlationId,
    });
    return { kits: [], failed: true };
  }

  return { kits: result.data.kits ?? [], failed: false };
}

export async function fetchLibrary(kitId: string): Promise<LibraryItem[]> {
  const result = await api<{ items: LibraryItem[] }>(
    `/catalog/library?kitId=${encodeURIComponent(kitId)}`,
  );

  if (!result.ok) {
    console.error('No se pudo leer la biblioteca del kit', {
      kitId,
      code: result.error.code,
      correlationId: result.error.correlationId,
    });
    return [];
  }

  return result.data.items ?? [];
}

/** Grados peruanos en texto legible. El backend guarda la clave estable. */
const GRADE_LABELS: Record<string, string> = {
  primary_1: '1.º de primaria',
  primary_2: '2.º de primaria',
  primary_3: '3.º de primaria',
  primary_4: '4.º de primaria',
  primary_5: '5.º de primaria',
  primary_6: '6.º de primaria',
  secondary_1: '1.º de secundaria',
  secondary_2: '2.º de secundaria',
  secondary_3: '3.º de secundaria',
  secondary_4: '4.º de secundaria',
  secondary_5: '5.º de secundaria',
  technical_program: 'Programa técnico',
  higher_program: 'Programa superior',
};

export function gradeLabel(grade: string): string {
  return GRADE_LABELS[grade] ?? grade;
}
