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

export interface CatalogKit {
  kitId: string;
  code: string;
  name: string;
  program: string;
  grade: string;
  /** Solo lo trae la ruta de gestión. */
  status?: string;
}

/**
 * El catálogo de kits.
 *
 * Dos rutas y no una, porque son dos preguntas distintas: `GET /catalog/kits` es
 * el índice de lo publicado -lo puede leer cualquier docente- y
 * `GET /catalog/kits/manage` trae también los borradores y exige el permiso de
 * quien decide qué llega a un aula. Una pantalla que solo lista lo publicado no
 * puede publicar nada.
 */
export async function fetchAllKits(
  options: { includeUnpublished?: boolean } = {},
): Promise<{ items: CatalogKit[]; failed: boolean }> {
  const ruta = options.includeUnpublished ? '/catalog/kits/manage' : '/catalog/kits';
  const result = await api<{ items: CatalogKit[] }>(`${ruta}?limit=100`);

  if (!result.ok) {
    // Lista vacía y no un error: la pantalla se pinta y dice que no hay nada que
    // gestionar, en vez de dejar al operador con un error sin acción.
    console.error('No se pudo leer el catálogo de kits', {
      status: result.status,
      code: result.error.code,
      correlationId: result.error.correlationId,
    });
    return { items: [], failed: true };
  }

  return { items: result.data.items ?? [], failed: false };
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

/**
 * Nombre en pantalla de cada tipo de recurso.
 *
 * Recibe el traductor en vez de tener el mapa dentro. El mapa vivia aqui en
 * espanol, asi que al cambiar a ingles la biblioteca seguia diciendo "Vídeo" y
 * "Instrucciones de montaje" rodeados de texto en ingles: media pantalla
 * traducida se lee peor que ninguna.
 *
 * El vocabulario vive en `messages/*.json` bajo `tiposContenido`, con la MISMA
 * clave que guarda el backend. Si llega un tipo nuevo que nadie ha traducido, se
 * devuelve la clave cruda -"code_sample"- y eso se ve; con un `??` a un mapa en
 * espanol no se veria nada raro y se quedaria asi para siempre.
 */
export function contentTypeLabel(
  t: (key: string) => string,
  type: string,
): string {
  return safeLabel(t, 'tiposContenido', type);
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

/**
 * Grado en texto legible.
 *
 * El backend guarda la clave estable (`primary_3`) y la pantalla la traduce, por
 * lo mismo que los tipos de contenido: son vocabulario visible y cambian con el
 * idioma del usuario, no con el del dominio.
 */
export function gradeLabel(t: (key: string) => string, grade: string): string {
  return safeLabel(t, 'grados', grade);
}

/**
 * Traduce una clave de vocabulario sin reventar si no existe.
 *
 * `t()` de next-intl LANZA cuando la clave falta, asi que un tipo de contenido
 * nuevo en el backend tumbaria la pantalla entera de la biblioteca en vez de
 * mostrar una etiqueta fea. Aqui se prefiere la etiqueta fea: el alumno ve su
 * material y quien mantenga esto ve la clave sin traducir.
 */
function safeLabel(t: (key: string) => string, space: string, key: string): string {
  if (!key) return '';
  try {
    return t(space + '.' + key);
  } catch {
    return key;
  }
}
