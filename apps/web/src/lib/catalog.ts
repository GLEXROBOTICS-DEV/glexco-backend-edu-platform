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
  lessonId: string | null;
  title: string;
  description: string;
  type: string;
  locale: 'es' | 'en';
  durationSeconds: number | null;
  sizeBytes: number | null;
  downloadable: boolean;
  /** Como se entrega. El backend lo decide; la pantalla solo elige el icono y,
   *  al abrirlo, el reproductor. */
  delivery: 'stream' | 'embed' | 'external' | 'download';
}

/** Un recurso ya abierto, con su URL firmada de vida corta. */
export interface OpenedAsset extends LibraryItem {
  assetId: string;
  url: string;
  expiresInSeconds: number;
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
    `/catalog/library?kitId=${encodeURIComponent(kitId)}&limit=100`,
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

/**
 * Abre un recurso y devuelve su URL firmada.
 *
 * **Se pide en cada visita y nunca se guarda.** La firma dura quince minutos: si
 * la pagina la incrustara y el alumno la dejara abierta durante una clase, al
 * pulsar descargar recibiria un error de firma caducada sin ninguna explicacion.
 * Pedirla al renderizar cuesta una llamada y hace que el enlace siempre sirva.
 *
 * Devuelve `null` en cualquier fallo -no existe, no es de su kit, el servicio no
 * responde-. La pantalla no distingue los casos hacia el alumno, igual que el
 * backend: separarlos permitiria recorrer el catalogo probando identificadores.
 */
export async function openLibraryAsset(assetId: string): Promise<OpenedAsset | null> {
  const result = await api<OpenedAsset>(
    `/catalog/library/${encodeURIComponent(assetId)}/url`,
  );

  if (!result.ok) {
    console.error('No se pudo abrir el recurso de la biblioteca', {
      assetId,
      status: result.status,
      code: result.error.code,
      correlationId: result.error.correlationId,
    });
    return null;
  }

  return result.data;
}

/** Nombre en pantalla de cada tipo de recurso. El backend guarda la clave. */
const CONTENT_TYPE_LABELS: Record<string, string> = {
  video: 'Vídeo',
  document: 'Documento',
  presentation: 'Presentación',
  worksheet: 'Ficha',
  guide: 'Guía',
  manual: 'Manual',
  tutorial: 'Tutorial',
  webinar: 'Webinar',
  masterclass: 'Clase magistral',
  code_sample: 'Código de ejemplo',
  build_instruction: 'Instrucciones de montaje',
  external_link: 'Enlace',
};

export function contentTypeLabel(type: string): string {
  return CONTENT_TYPE_LABELS[type] ?? type;
}

/** Duracion en minutos y segundos. `null` cuando el recurso no dura nada -un
 *  PDF-, que no es lo mismo que durar cero. */
export function durationLabel(seconds: number | null): string | null {
  if (seconds === null || seconds <= 0) return null;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** Tamano legible. Se usa base 1024 porque es lo que informa el sistema
 *  operativo al descargar, y una cifra distinta genera dudas. */
export function sizeLabel(bytes: number | null): string | null {
  if (bytes === null || bytes <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
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
