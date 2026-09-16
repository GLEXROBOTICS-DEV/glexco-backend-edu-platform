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

// El vocabulario visible vive en `vocabulary.ts`, que NO es `server-only`: son
// funciones puras y el formulario de alta de salon, que es de cliente, tambien
// las necesita. Se reexportan para que las pantallas de servidor que ya las
// importaban de aqui no tengan que cambiar.
export {
  contentTypeLabel,
  durationLabel,
  gradeLabel,
  safeLabel,
  sizeLabel,
} from './vocabulary';
