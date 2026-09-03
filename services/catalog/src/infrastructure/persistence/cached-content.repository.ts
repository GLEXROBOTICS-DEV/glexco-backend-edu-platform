import type { CacheStore, CursorPage, CursorQuery, TransactionContext } from '@glexco/kernel';
import type { ContentType } from '@glexco/contracts';
import type {
  ContentAsset,
  ContentRepository,
  Course,
  Lesson,
} from '../../domain/repositories';

/**
 * Caché de las lecturas de contenido, con invalidación por etiqueta.
 *
 * Es un decorador del repositorio y no una capa en el controlador: así el caché
 * cubre a *todo* el que lea contenido —HTTP hoy, un consumidor de eventos
 * mañana— sin que nadie tenga que acordarse de envolverlo.
 *
 * **Por qué hace falta.** La biblioteca de un kit es la consulta más repetida de
 * la plataforma: cada alumno la abre en cada sesión, el contenido cambia una vez
 * al trimestre, y en hora punta son cientos de miles de lecturas idénticas
 * pegándole a la misma consulta con `gin_trgm` y `unaccent`. Es exactamente el
 * caso para el que existe un caché.
 *
 * **Por qué por etiqueta y no por TTL.** Con solo TTL, publicar una lección
 * nueva tarda en verse lo que dure el TTL, y bajar el TTL para arreglarlo anula
 * el beneficio del caché. La etiqueta `kit:<id>` agrupa todas las entradas de un
 * kit —biblioteca, cursos, sus filtros y sus páginas— de modo que publicar
 * invalida el kit entero de una vez y sin conocer las claves.
 *
 * **Lo que NO se cachea:** nada que decida un permiso. Los derechos de acceso
 * (`EntitlementRepository`) se consultan siempre contra la base. Un caché en esa
 * ruta convertiría un acceso retirado en un acceso que sigue funcionando hasta
 * que expire, y esa es justamente la clase de error que no se puede permitir
 * aquí.
 */
export class CachedContentRepository implements ContentRepository {
  /** Diez minutos. Con invalidación por etiqueta, el TTL solo es la red de
   *  seguridad para una invalidación que se pierda, no el mecanismo principal. */
  private static readonly TTL_SECONDS = 600;

  constructor(
    private readonly inner: ContentRepository,
    private readonly cache: CacheStore,
  ) {}

  /** Etiqueta que agrupa TODAS las entradas de un kit. */
  static kitTag(kitId: string): string {
    return `catalog:kit:${kitId}`;
  }

  async listLibrary(
    kitId: string,
    filters: { type?: ContentType; locale: 'es' | 'en'; search?: string },
    page: CursorQuery,
  ): Promise<CursorPage<ContentAsset>> {
    // La búsqueda libre NO se cachea. Es de cola larga -cada alumno teclea algo
    // distinto- así que el acierto sería casi nulo y a cambio llenaría Redis de
    // entradas que nadie vuelve a pedir.
    if (filters.search) return this.inner.listLibrary(kitId, filters, page);

    const key = [
      'catalog:library',
      kitId,
      filters.locale,
      filters.type ?? 'all',
      String(page.limit ?? 20),
      page.cursor ?? 'first',
    ].join(':');

    return this.cache.wrap(
      key,
      CachedContentRepository.TTL_SECONDS,
      () => this.inner.listLibrary(kitId, filters, page),
      [CachedContentRepository.kitTag(kitId)],
    );
  }

  async listCoursesByKit(kitId: string, onlyPublished: boolean): Promise<Course[]> {
    // Solo se cachea la vista publicada. La del editor tiene que enseñar el
    // borrador tal cual está en este instante: quien acaba de guardar un cambio
    // y no lo ve asume que se perdió.
    if (!onlyPublished) return this.inner.listCoursesByKit(kitId, false);

    return this.cache.wrap(
      `catalog:courses:${kitId}`,
      CachedContentRepository.TTL_SECONDS,
      () => this.inner.listCoursesByKit(kitId, true),
      [CachedContentRepository.kitTag(kitId)],
    );
  }

  async listLessonsByCourse(courseId: string, onlyPublished: boolean): Promise<Lesson[]> {
    if (!onlyPublished) return this.inner.listLessonsByCourse(courseId, false);

    // Se etiqueta por curso además de cachearse: al publicar se invalida el kit
    // entero, que arrastra a sus cursos.
    return this.cache.wrap(
      `catalog:lessons:${courseId}`,
      CachedContentRepository.TTL_SECONDS,
      () => this.inner.listLessonsByCourse(courseId, true),
      [`catalog:course:${courseId}`],
    );
  }

  // Las lecturas de un elemento suelto no se cachean: son puntuales, van por
  // clave primaria y el coste de la consulta ya es mínimo.
  findCourse(courseId: string): Promise<Course | null> {
    return this.inner.findCourse(courseId);
  }

  findAsset(assetId: string): Promise<ContentAsset | null> {
    return this.inner.findAsset(assetId);
  }

  listAssetsByLesson(lessonId: string, locale: 'es' | 'en'): Promise<ContentAsset[]> {
    return this.inner.listAssetsByLesson(lessonId, locale);
  }

  // Las escrituras pasan tal cual. La invalidación NO se hace aquí: ocurre en el
  // caso de uso, DESPUES de que la transacción confirme. Invalidar dentro de la
  // transaccion dejaria el cache vacio y la base sin cambiar si esa transaccion
  // acabara en rollback, y el siguiente lector recargaria el contenido viejo y
  // lo volveria a cachear.
  saveCourse(course: Course, tx: TransactionContext): Promise<void> {
    return this.inner.saveCourse(course, tx);
  }

  saveLesson(lesson: Lesson, tx: TransactionContext): Promise<void> {
    return this.inner.saveLesson(lesson, tx);
  }

  saveAsset(asset: ContentAsset, tx: TransactionContext): Promise<void> {
    return this.inner.saveAsset(asset, tx);
  }
}
