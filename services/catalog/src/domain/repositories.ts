import type { CursorPage, CursorQuery, TransactionContext } from '@glexco/kernel';
import type { ContentType, Program, PublicationStatus, RobotPlatform } from '@glexco/contracts';
import type { ActivationCode } from './activation-code/activation-code.aggregate';
import type { Entitlement } from './entitlement/entitlement.aggregate';

/**
 * Kit: el libro de un grado, con el contenido que desbloquea.
 *
 * Es dato de catalogo, editado por el equipo de GLEXCO y leido por todos. Se
 * modela como registro plano y no como agregado con comportamiento porque no
 * tiene invariantes propias: su ciclo de vida es "lo crea un administrador, lo
 * publica, lo archiva".
 */
export interface Kit {
  id: string;
  code: string;
  name: string;
  description: string;
  program: 'discover' | 'academy';
  grade: string;
  robotPlatforms: RobotPlatform[];
  coverImageKey: string | null;
  status: PublicationStatus;
  courseIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface KitRepository {
  findById(kitId: string): Promise<Kit | null>;
  findByCode(code: string): Promise<Kit | null>;
  list(
    filters: { program?: Program; grade?: string; status?: PublicationStatus },
    page: CursorQuery,
  ): Promise<CursorPage<Kit>>;
  save(kit: Kit, tx: TransactionContext): Promise<void>;
}

export interface ActivationCodeRepository {
  /**
   * Carga el codigo por su hash BLOQUEANDO la fila.
   *
   * Es la pieza sin la cual la garantia de un solo uso no existe. Dos peticiones
   * simultaneas con el mismo codigo leerian ambas "disponible" y ambas pasarian
   * la comprobacion del agregado; con `FOR UPDATE` la segunda espera a que la
   * primera confirme y entonces ve el estado real.
   *
   * Se busca por HASH y no por el codigo: en la base nunca hay codigos en claro.
   */
  findByHashForUpdate(codeHash: string, tx: TransactionContext): Promise<ActivationCode | null>;

  /** Lectura sin bloqueo, para la comprobacion previa del formulario. */
  findByHash(codeHash: string): Promise<ActivationCode | null>;

  findById(id: string): Promise<ActivationCode | null>;
  save(code: ActivationCode, tx: TransactionContext): Promise<void>;

  /**
   * Inserta un lote completo.
   *
   * Se escribe en una sola sentencia por bloques y no fila a fila: un lote de
   * imprenta son decenas de miles de codigos, y cien mil INSERT individuales
   * tardarian minutos y mantendrian una transaccion abierta todo ese tiempo.
   */
  insertBatch(
    batchId: string,
    codes: ReadonlyArray<{
      id: string;
      codeHash: string;
      codeSuffix: string;
      kitId: string;
      grade: string;
      expiresAt: Date | null;
    }>,
    tx: TransactionContext,
  ): Promise<void>;

  /** Resumen de un lote para el panel de GLEXCO. */
  batchSummary(batchId: string): Promise<CodeBatchSummary | null>;

  listBatches(page: CursorQuery): Promise<CursorPage<CodeBatchSummary>>;

  /** Marca como caducados los codigos que pasaron su fecha limite. Tarea periodica. */
  expireOverdue(now: Date): Promise<number>;
}

export interface CodeBatchSummary {
  batchId: string;
  kitId: string;
  kitName: string | null;
  grade: string;
  total: number;
  issued: number;
  distributed: number;
  redeemed: number;
  revoked: number;
  expired: number;
  distributedTo: string | null;
  createdBy: string;
  createdAt: string;
}

export interface EntitlementRepository {
  save(entitlement: Entitlement, tx: TransactionContext): Promise<void>;
  findById(id: string): Promise<Entitlement | null>;

  /** Kits a los que un alumno tiene acceso. Es la consulta que responde a la
   *  regla central: el alumno solo ve el contenido de SU kit. */
  listActiveByStudent(studentId: string): Promise<Entitlement[]>;

  /** Comprobacion puntual, para autorizar el acceso a un recurso concreto. */
  hasActiveForKit(studentId: string, kitId: string): Promise<boolean>;

  findByActivationCode(activationCodeId: string): Promise<Entitlement | null>;
}

// ---------------------------------------------------------------------------
// Contenido academico
// ---------------------------------------------------------------------------

export interface Course {
  id: string;
  kitId: string;
  title: string;
  description: string;
  robotPlatform: RobotPlatform;
  orderIndex: number;
  status: PublicationStatus;
  estimatedMinutes: number;
  moduleCount: number;
  lessonCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Lesson {
  id: string;
  courseId: string;
  moduleId: string;
  title: string;
  description: string;
  orderIndex: number;
  status: PublicationStatus;
  estimatedMinutes: number;
  assetIds: string[];
}

/**
 * Recurso de contenido: video, documento, presentacion, ficha, guia.
 *
 * `storageKind` decide como se sirve, y es la aplicacion de la estrategia
 * hibrida acordada: los videos largos viven en un proveedor externo con
 * restriccion de dominio, y los documentos en almacenamiento propio con URL
 * prefirmada de vida corta. Servir video desde nuestro ancho de banda es lo
 * primero que dispara la factura.
 */
export interface ContentAsset {
  id: string;
  kitId: string;
  lessonId: string | null;
  title: string;
  description: string;
  type: ContentType;
  storageKind: 'object_storage' | 'video_provider' | 'external_link';
  /** Clave en el bucket, id en el proveedor de video, o URL externa. */
  storageRef: string;
  bucket: string | null;
  sizeBytes: number | null;
  durationSeconds: number | null;
  /** Idioma del recurso. Un mismo contenido puede existir en es y en. */
  locale: 'es' | 'en';
  status: PublicationStatus;
  orderIndex: number;
  downloadable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ContentRepository {
  listCoursesByKit(kitId: string, onlyPublished: boolean): Promise<Course[]>;
  findCourse(courseId: string): Promise<Course | null>;
  listLessonsByCourse(courseId: string, onlyPublished: boolean): Promise<Lesson[]>;
  findAsset(assetId: string): Promise<ContentAsset | null>;
  listAssetsByLesson(lessonId: string, locale: 'es' | 'en'): Promise<ContentAsset[]>;

  /**
   * Biblioteca multimedia de un kit.
   *
   * Recibe el `kitId` de forma obligatoria y no opcional: obliga a quien llama a
   * haber resuelto antes a que kit tiene derecho el alumno. Un listado global de
   * contenido no existe en esta interfaz a proposito, porque seria el atajo por
   * el que se filtraria material de kits no comprados.
   */
  listLibrary(
    kitId: string,
    filters: { type?: ContentType; locale: 'es' | 'en'; search?: string },
    page: CursorQuery,
  ): Promise<CursorPage<ContentAsset>>;

  saveCourse(course: Course, tx: TransactionContext): Promise<void>;
  saveLesson(lesson: Lesson, tx: TransactionContext): Promise<void>;
  saveAsset(asset: ContentAsset, tx: TransactionContext): Promise<void>;
}
