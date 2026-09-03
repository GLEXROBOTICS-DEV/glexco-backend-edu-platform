import type { Pool } from 'pg';
import {
  ConcurrencyError,
  encodeCursor,
  decodeCursor,
  normalizeLimit,
  type CursorPage,
  type CursorQuery,
  type TransactionContext,
} from '@glexco/kernel';
import type {
  ContentType,
  Program,
  PublicationStatus,
  RobotPlatform,
} from '@glexco/contracts';
import type { PgTransaction } from '@glexco/nest-platform';
import { Entitlement, EntitlementId } from '../../domain/entitlement/entitlement.aggregate';
import type {
  ContentAsset,
  ContentRepository,
  Course,
  EntitlementRepository,
  Kit,
  KitRepository,
  Lesson,
} from '../../domain/repositories';

// ---------------------------------------------------------------------------
// Kits
// ---------------------------------------------------------------------------

interface KitRow {
  id: string;
  code: string;
  name: string;
  description: string;
  program: 'discover' | 'academy';
  grade: string;
  robot_platforms: string[];
  cover_image_key: string | null;
  status: PublicationStatus;
  created_at: Date;
  updated_at: Date;
}

const KIT_COLUMNS = `
  id, code, name, description, program, grade, robot_platforms,
  cover_image_key, status, created_at, updated_at
`;

export class PgKitRepository implements KitRepository {
  constructor(private readonly readPool: Pool) {}

  async findById(kitId: string): Promise<Kit | null> {
    const { rows } = await this.readPool.query<KitRow>(
      `SELECT ${KIT_COLUMNS} FROM catalog.kits WHERE id = $1`,
      [kitId],
    );
    return rows[0] ? toKit(rows[0]) : null;
  }

  async findByCode(code: string): Promise<Kit | null> {
    const { rows } = await this.readPool.query<KitRow>(
      `SELECT ${KIT_COLUMNS} FROM catalog.kits WHERE code = $1`,
      [code],
    );
    return rows[0] ? toKit(rows[0]) : null;
  }

  async list(
    filters: { program?: Program; grade?: string; status?: PublicationStatus },
    page: CursorQuery,
  ): Promise<CursorPage<Kit>> {
    const limit = normalizeLimit(page.limit);
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];

    if (filters.program) {
      params.push(filters.program);
      conditions.push(`program = $${params.length}`);
    }
    if (filters.grade) {
      params.push(filters.grade);
      conditions.push(`grade = $${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      conditions.push(`status = $${params.length}`);
    }

    const cursor = page.cursor ? decodeCursor<{ createdAt: string; id: string }>(page.cursor) : null;
    if (cursor) {
      params.push(cursor.createdAt, cursor.id);
      conditions.push(
        `(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
      );
    }

    params.push(limit + 1);

    const { rows } = await this.readPool.query<KitRow>(
      `SELECT ${KIT_COLUMNS} FROM catalog.kits
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.length}`,
      params,
    );

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];

    return {
      items: items.map(toKit),
      nextCursor:
        hasMore && last
          ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id })
          : null,
    };
  }

  async save(kit: Kit, tx: TransactionContext): Promise<void> {
    const client = (tx as PgTransaction).client;
    await client.query(
      `INSERT INTO catalog.kits
         (id, code, name, description, program, grade, robot_platforms, cover_image_key, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE
          SET name = EXCLUDED.name,
              description = EXCLUDED.description,
              robot_platforms = EXCLUDED.robot_platforms,
              cover_image_key = EXCLUDED.cover_image_key,
              status = EXCLUDED.status,
              version = catalog.kits.version + 1`,
      [
        kit.id,
        kit.code,
        kit.name,
        kit.description,
        kit.program,
        kit.grade,
        kit.robotPlatforms,
        kit.coverImageKey,
        kit.status,
      ],
    );
  }
}

function toKit(row: KitRow): Kit {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    program: row.program,
    grade: row.grade,
    robotPlatforms: row.robot_platforms as RobotPlatform[],
    coverImageKey: row.cover_image_key,
    status: row.status,
    courseIds: [],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Derechos de acceso
// ---------------------------------------------------------------------------

interface EntitlementRow {
  id: string;
  student_id: string;
  kit_id: string;
  grade: string;
  institution_id: string | null;
  source_activation_code_id: string;
  active: boolean;
  revoked_reason: string | null;
  granted_at: Date;
  revoked_at: Date | null;
  version: number;
}

const ENT_COLUMNS = `
  id, student_id, kit_id, grade, institution_id, source_activation_code_id,
  active, revoked_reason, granted_at, revoked_at, version
`;

export class PgEntitlementRepository implements EntitlementRepository {
  constructor(private readonly readPool: Pool) {}

  async save(entitlement: Entitlement, tx: TransactionContext): Promise<void> {
    // Sin cambios no se escribe. Un `UPDATE ... WHERE version < :nueva` con la
    // misma version no encontraria fila y se interpretaria como conflicto de
    // concurrencia: ver `AggregateRoot.hasChanges`.
    if (!entitlement.hasChanges) return;
    const client = (tx as PgTransaction).client;
    const state = entitlement.snapshot();

    const result = await client.query(
      `INSERT INTO catalog.entitlements
         (id, student_id, kit_id, grade, institution_id, source_activation_code_id,
          active, revoked_reason, granted_at, revoked_at, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE
          SET active = EXCLUDED.active,
              revoked_reason = EXCLUDED.revoked_reason,
              revoked_at = EXCLUDED.revoked_at,
              version = EXCLUDED.version
        WHERE catalog.entitlements.version < EXCLUDED.version`,
      [
        entitlement.id.value,
        state.studentId,
        state.kitId,
        state.grade,
        state.institutionId,
        state.sourceActivationCodeId,
        state.active,
        state.revokedReason,
        state.grantedAt,
        state.revokedAt,
        entitlement.version,
      ],
    );

    // rowCount 0 en un UPDATE significa que otra escritura gano la carrera.
    // En un INSERT nuevo siempre es 1, asi que solo puede ocurrir al actualizar.
    if (result.rowCount === 0 && entitlement.version > 1) {
      throw new ConcurrencyError('Entitlement', entitlement.id.value, entitlement.version, -1);
    }
  }

  async findById(id: string): Promise<Entitlement | null> {
    const { rows } = await this.readPool.query<EntitlementRow>(
      `SELECT ${ENT_COLUMNS} FROM catalog.entitlements WHERE id = $1`,
      [id],
    );
    return rows[0] ? toEntitlement(rows[0]) : null;
  }

  /**
   * Kits a los que el alumno tiene acceso.
   *
   * Va contra el pool de ESCRITURA a proposito: se consulta justo despues de
   * canjear el codigo, y el alumno no puede toparse con que su contenido "aun no
   * esta ahi" porque la replica va un segundo por detras. Es el momento en que
   * mas expectativa hay y menos tolerancia a un fallo aparente.
   */
  async listActiveByStudent(studentId: string): Promise<Entitlement[]> {
    const { rows } = await this.readPool.query<EntitlementRow>(
      `SELECT ${ENT_COLUMNS} FROM catalog.entitlements
        WHERE student_id = $1 AND active
        ORDER BY granted_at DESC`,
      [studentId],
    );
    return rows.map(toEntitlement);
  }

  /**
   * Comprobacion puntual de acceso a un kit.
   *
   * Es la consulta mas repetida del servicio: se ejecuta en cada peticion de
   * contenido y en cada URL prefirmada que se emite. Devuelve un booleano y no
   * el agregado para no rehidratar nada: el indice parcial
   * `entitlements_student_kit_uq` la resuelve sin tocar la tabla.
   */
  async hasActiveForKit(studentId: string, kitId: string): Promise<boolean> {
    const { rows } = await this.readPool.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM catalog.entitlements
          WHERE student_id = $1 AND kit_id = $2 AND active
       ) AS exists`,
      [studentId, kitId],
    );
    return rows[0]?.exists ?? false;
  }

  async findByActivationCode(activationCodeId: string): Promise<Entitlement | null> {
    const { rows } = await this.readPool.query<EntitlementRow>(
      `SELECT ${ENT_COLUMNS} FROM catalog.entitlements
        WHERE source_activation_code_id = $1`,
      [activationCodeId],
    );
    return rows[0] ? toEntitlement(rows[0]) : null;
  }
}

function toEntitlement(row: EntitlementRow): Entitlement {
  return Entitlement.rehydrate(
    EntitlementId.create(row.id),
    {
      studentId: row.student_id,
      kitId: row.kit_id,
      grade: row.grade,
      institutionId: row.institution_id,
      sourceActivationCodeId: row.source_activation_code_id,
      active: row.active,
      revokedReason: row.revoked_reason,
      grantedAt: row.granted_at,
      revokedAt: row.revoked_at,
    },
    row.version,
  );
}

// ---------------------------------------------------------------------------
// Contenido academico
// ---------------------------------------------------------------------------

export class PgContentRepository implements ContentRepository {
  constructor(private readonly readPool: Pool) {}

  async listCoursesByKit(kitId: string, onlyPublished: boolean): Promise<Course[]> {
    const { rows } = await this.readPool.query(
      `SELECT c.id, c.kit_id, c.title, c.description, c.robot_platform, c.order_index,
              c.status, c.estimated_minutes, c.created_at, c.updated_at,
              (SELECT count(*)::int FROM catalog.modules m WHERE m.course_id = c.id) AS module_count,
              (SELECT count(*)::int FROM catalog.lessons l WHERE l.course_id = c.id) AS lesson_count
         FROM catalog.courses c
        WHERE c.kit_id = $1 ${onlyPublished ? `AND c.status = 'published'` : ''}
        ORDER BY c.order_index, c.title`,
      [kitId],
    );

    return rows.map((row) => ({
      id: row.id,
      kitId: row.kit_id,
      title: row.title,
      description: row.description,
      robotPlatform: row.robot_platform as RobotPlatform,
      orderIndex: row.order_index,
      status: row.status as PublicationStatus,
      estimatedMinutes: row.estimated_minutes,
      moduleCount: row.module_count,
      lessonCount: row.lesson_count,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }));
  }

  async findCourse(courseId: string): Promise<Course | null> {
    const { rows } = await this.readPool.query(
      `SELECT id, kit_id, title, description, robot_platform, order_index, status,
              estimated_minutes, created_at, updated_at
         FROM catalog.courses WHERE id = $1`,
      [courseId],
    );
    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      kitId: row.kit_id,
      title: row.title,
      description: row.description,
      robotPlatform: row.robot_platform as RobotPlatform,
      orderIndex: row.order_index,
      status: row.status as PublicationStatus,
      estimatedMinutes: row.estimated_minutes,
      moduleCount: 0,
      lessonCount: 0,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  async listLessonsByCourse(courseId: string, onlyPublished: boolean): Promise<Lesson[]> {
    const { rows } = await this.readPool.query(
      `SELECT l.id, l.course_id, l.module_id, l.title, l.description, l.order_index,
              l.status, l.estimated_minutes,
              COALESCE(
                array_agg(a.id ORDER BY a.order_index) FILTER (WHERE a.id IS NOT NULL),
                '{}'
              ) AS asset_ids
         FROM catalog.lessons l
         LEFT JOIN catalog.content_assets a
                ON a.lesson_id = l.id AND a.status = 'published'
        WHERE l.course_id = $1 ${onlyPublished ? `AND l.status = 'published'` : ''}
        GROUP BY l.id
        ORDER BY l.order_index`,
      [courseId],
    );

    return rows.map((row) => ({
      id: row.id,
      courseId: row.course_id,
      moduleId: row.module_id,
      title: row.title,
      description: row.description,
      orderIndex: row.order_index,
      status: row.status as PublicationStatus,
      estimatedMinutes: row.estimated_minutes,
      assetIds: row.asset_ids,
    }));
  }

  async findAsset(assetId: string): Promise<ContentAsset | null> {
    const { rows } = await this.readPool.query(
      `SELECT * FROM catalog.content_assets WHERE id = $1`,
      [assetId],
    );
    return rows[0] ? toAsset(rows[0]) : null;
  }

  async listAssetsByLesson(lessonId: string, locale: 'es' | 'en'): Promise<ContentAsset[]> {
    // Se pide el idioma solicitado y, si no existe, el español: un recurso sin
    // traducir debe seguir siendo accesible en vez de desaparecer del listado.
    const { rows } = await this.readPool.query(
      `SELECT DISTINCT ON (title) *
         FROM catalog.content_assets
        WHERE lesson_id = $1
          AND status = 'published'
          AND locale IN ($2, 'es')
        ORDER BY title, (locale = $2) DESC, order_index`,
      [lessonId, locale],
    );
    return rows.map(toAsset);
  }

  /**
   * Biblioteca multimedia de un kit.
   *
   * `kitId` es obligatorio y no existe una version sin el: seria el atajo por el
   * que se filtraria material de kits no comprados. Quien llama tiene que haber
   * resuelto antes a que kit tiene derecho el alumno.
   */
  async listLibrary(
    kitId: string,
    filters: { type?: ContentType; locale: 'es' | 'en'; search?: string },
    page: CursorQuery,
  ): Promise<CursorPage<ContentAsset>> {
    const limit = normalizeLimit(page.limit);
    const conditions = [`kit_id = $1`, `status = 'published'`, `locale = $2`];
    const params: unknown[] = [kitId, filters.locale];

    if (filters.type) {
      params.push(filters.type);
      conditions.push(`type = $${params.length}`);
    }
    if (filters.search) {
      params.push(`%${filters.search}%`);
      conditions.push(`unaccent(title) ILIKE unaccent($${params.length})`);
    }

    const cursor = page.cursor ? decodeCursor<{ order: number; id: string }>(page.cursor) : null;
    if (cursor) {
      params.push(cursor.order, cursor.id);
      conditions.push(
        `(order_index, id) > ($${params.length - 1}::int, $${params.length}::uuid)`,
      );
    }

    params.push(limit + 1);

    const { rows } = await this.readPool.query(
      `SELECT * FROM catalog.content_assets
        WHERE ${conditions.join(' AND ')}
        ORDER BY order_index, id
        LIMIT $${params.length}`,
      params,
    );

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];

    return {
      items: items.map(toAsset),
      nextCursor: hasMore && last ? encodeCursor({ order: last.order_index, id: last.id }) : null,
    };
  }

  async saveCourse(course: Course, tx: TransactionContext): Promise<void> {
    const client = (tx as PgTransaction).client;
    await client.query(
      `INSERT INTO catalog.courses
         (id, kit_id, title, description, robot_platform, order_index, status, estimated_minutes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE
          SET title = EXCLUDED.title, description = EXCLUDED.description,
              order_index = EXCLUDED.order_index, status = EXCLUDED.status,
              estimated_minutes = EXCLUDED.estimated_minutes,
              version = catalog.courses.version + 1`,
      [
        course.id,
        course.kitId,
        course.title,
        course.description,
        course.robotPlatform,
        course.orderIndex,
        course.status,
        course.estimatedMinutes,
      ],
    );
  }

  async saveLesson(lesson: Lesson, tx: TransactionContext): Promise<void> {
    const client = (tx as PgTransaction).client;
    await client.query(
      `INSERT INTO catalog.lessons
         (id, course_id, module_id, title, description, order_index, status, estimated_minutes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE
          SET title = EXCLUDED.title, description = EXCLUDED.description,
              order_index = EXCLUDED.order_index, status = EXCLUDED.status,
              estimated_minutes = EXCLUDED.estimated_minutes`,
      [
        lesson.id,
        lesson.courseId,
        lesson.moduleId,
        lesson.title,
        lesson.description,
        lesson.orderIndex,
        lesson.status,
        lesson.estimatedMinutes,
      ],
    );
  }

  async saveAsset(asset: ContentAsset, tx: TransactionContext): Promise<void> {
    const client = (tx as PgTransaction).client;
    await client.query(
      `INSERT INTO catalog.content_assets
         (id, kit_id, lesson_id, title, description, type, storage_kind, storage_ref,
          bucket, size_bytes, duration_seconds, locale, status, order_index, downloadable)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (id) DO UPDATE
          SET title = EXCLUDED.title, description = EXCLUDED.description,
              storage_ref = EXCLUDED.storage_ref, bucket = EXCLUDED.bucket,
              size_bytes = EXCLUDED.size_bytes, duration_seconds = EXCLUDED.duration_seconds,
              status = EXCLUDED.status, order_index = EXCLUDED.order_index,
              downloadable = EXCLUDED.downloadable,
              version = catalog.content_assets.version + 1`,
      [
        asset.id,
        asset.kitId,
        asset.lessonId,
        asset.title,
        asset.description,
        asset.type,
        asset.storageKind,
        asset.storageRef,
        asset.bucket,
        asset.sizeBytes,
        asset.durationSeconds,
        asset.locale,
        asset.status,
        asset.orderIndex,
        asset.downloadable,
      ],
    );
  }
}

function toAsset(row: Record<string, unknown>): ContentAsset {
  return {
    id: row.id as string,
    kitId: row.kit_id as string,
    lessonId: (row.lesson_id as string | null) ?? null,
    title: row.title as string,
    description: row.description as string,
    type: row.type as ContentType,
    storageKind: row.storage_kind as ContentAsset['storageKind'],
    storageRef: row.storage_ref as string,
    bucket: (row.bucket as string | null) ?? null,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    durationSeconds: (row.duration_seconds as number | null) ?? null,
    locale: row.locale as 'es' | 'en',
    status: row.status as PublicationStatus,
    orderIndex: row.order_index as number,
    downloadable: row.downloadable as boolean,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}
