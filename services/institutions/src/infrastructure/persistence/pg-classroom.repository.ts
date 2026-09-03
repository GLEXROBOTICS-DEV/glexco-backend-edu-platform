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
import type { EnrollmentStatus, Grade } from '@glexco/contracts';
import type { PgTransaction } from '@glexco/nest-platform';
import {
  Capacity,
  Classroom,
  ClassroomId,
  ClassroomName,
  type ClassroomStatus,
  type Enrollment,
} from '../../domain/classroom/classroom.aggregate';
import type {
  ClassroomRepository,
  ClassroomSummary,
  SelectableClassroom,
} from '../../domain/repositories';

interface ClassroomRow {
  id: string;
  institution_id: string;
  teacher_id: string;
  name: string;
  grade: string;
  capacity: number;
  academic_year: number;
  status: ClassroomStatus;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface EnrollmentRow {
  classroom_id: string;
  student_id: string;
  status: EnrollmentStatus;
  kit_id: string | null;
  enrolled_at: Date;
  left_at: Date | null;
}

const CLASSROOM_COLUMNS = `
  id, institution_id, teacher_id, name, grade, capacity, academic_year,
  status, version, created_at, updated_at
`;

export class PgClassroomRepository implements ClassroomRepository {
  /**
   * Solo recibe el pool de LECTURA.
   *
   * Todas las escrituras pasan por el cliente de la transaccion que entrega la
   * unidad de trabajo, nunca por un pool: una consulta lanzada al pool tomaria
   * otra conexion, quedaria fuera de la transaccion y no veria ni respetaria el
   * bloqueo de fila del que depende el tope de plazas. No tener aqui un pool de
   * escritura hace que ese error sea imposible de cometer.
   */
  constructor(private readonly readPool: Pool) {}

  async findById(id: ClassroomId): Promise<Classroom | null> {
    const { rows } = await this.readPool.query<ClassroomRow>(
      `SELECT ${CLASSROOM_COLUMNS} FROM institutions.classrooms WHERE id = $1`,
      [id.value],
    );
    if (!rows[0]) return null;

    const enrollments = await this.loadEnrollments(this.readPool, id.value);
    return toDomain(rows[0], enrollments);
  }

  /**
   * Carga el salon BLOQUEANDO su fila dentro de la transaccion.
   *
   * Es la pieza que hace real el tope de plazas. Detalles que importan:
   *
   * - `FOR UPDATE` sobre `classrooms`, no sobre `enrollments`. Bloquear las
   *   matriculas existentes no serviria: el problema es la fila que TODAVIA no
   *   existe, y una fila inexistente no se puede bloquear. Al bloquear el salon
   *   -que si existe- se serializan todas las matriculas que compiten por el.
   *
   * - Las matriculas se leen DESPUES de tomar el bloqueo y desde el mismo
   *   cliente de la transaccion. Leerlas antes, o desde otro pool, devolveria un
   *   conteo obsoleto y la comprobacion de cupo se haria sobre datos viejos.
   *
   * - Se usa el cliente de la transaccion (`tx.client`), que es la unica via de
   *   escritura que esta clase tiene: ver la nota del constructor.
   */
  async findByIdForUpdate(id: ClassroomId, tx: TransactionContext): Promise<Classroom | null> {
    const client = (tx as PgTransaction).client;

    const { rows } = await client.query<ClassroomRow>(
      `SELECT ${CLASSROOM_COLUMNS} FROM institutions.classrooms WHERE id = $1 FOR UPDATE`,
      [id.value],
    );
    if (!rows[0]) return null;

    const { rows: enrollmentRows } = await client.query<EnrollmentRow>(
      `SELECT classroom_id, student_id, status, kit_id, enrolled_at, left_at
         FROM institutions.enrollments WHERE classroom_id = $1`,
      [id.value],
    );

    return toDomain(rows[0], enrollmentRows.map(toEnrollment));
  }

  /**
   * Persiste el salon y sincroniza sus matriculas.
   *
   * Las matriculas se escriben con `ON CONFLICT ... DO UPDATE` sobre la clave
   * compuesta `(classroom_id, student_id)`. Asi un alumno que regresa reactiva
   * su fila en vez de crear una segunda, que es lo que partiria su historial.
   */
  async save(classroom: Classroom, tx: TransactionContext): Promise<void> {
    // Sin cambios no se escribe. Un `UPDATE ... WHERE version < :nueva` con la
    // misma version no encontraria fila y se interpretaria como conflicto de
    // concurrencia: ver `AggregateRoot.hasChanges`.
    if (!classroom.hasChanges) return;
    const client = (tx as PgTransaction).client;
    const state = classroom.snapshot();
    const isNew = classroom.version === 1 && state.createdAt.getTime() === state.updatedAt.getTime();

    if (isNew) {
      await client.query(
        `INSERT INTO institutions.classrooms
           (id, institution_id, teacher_id, name, grade, capacity, academic_year, status, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          classroom.id.value,
          state.institutionId,
          state.teacherId,
          state.name.value,
          state.grade,
          state.capacity.value,
          state.academicYear,
          state.status,
          classroom.version,
        ],
      );
    } else {
      const result = await client.query(
        `UPDATE institutions.classrooms
            SET teacher_id = $2, name = $3, capacity = $4, status = $5, version = $6
          WHERE id = $1 AND version < $6`,
        [
          classroom.id.value,
          state.teacherId,
          state.name.value,
          state.capacity.value,
          state.status,
          classroom.version,
        ],
      );

      if (result.rowCount === 0) {
        const { rows } = await client.query<{ version: number }>(
          `SELECT version FROM institutions.classrooms WHERE id = $1`,
          [classroom.id.value],
        );
        throw new ConcurrencyError(
          'Classroom',
          classroom.id.value,
          classroom.version,
          rows[0]?.version ?? -1,
        );
      }
    }

    for (const enrollment of state.enrollments) {
      await client.query(
        `INSERT INTO institutions.enrollments
           (classroom_id, student_id, status, kit_id, enrolled_at, left_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (classroom_id, student_id) DO UPDATE
            SET status = EXCLUDED.status,
                kit_id = COALESCE(EXCLUDED.kit_id, institutions.enrollments.kit_id),
                enrolled_at = EXCLUDED.enrolled_at,
                left_at = EXCLUDED.left_at`,
        [
          classroom.id.value,
          enrollment.studentId,
          enrollment.status,
          enrollment.kitId,
          enrollment.enrolledAt,
          enrollment.leftAt,
        ],
      );
    }
  }

  async listByTeacher(
    teacherId: string,
    filters: { academicYear?: number; includeArchived?: boolean },
  ): Promise<ClassroomSummary[]> {
    const conditions = ['c.teacher_id = $1'];
    const params: unknown[] = [teacherId];

    if (!filters.includeArchived) conditions.push(`c.status = 'active'`);
    if (filters.academicYear) {
      params.push(filters.academicYear);
      conditions.push(`c.academic_year = $${params.length}`);
    }

    const { rows } = await this.readPool.query<SummaryRow>(
      `${SUMMARY_SELECT} WHERE ${conditions.join(' AND ')}
        ORDER BY c.academic_year DESC, c.name ASC`,
      params,
    );

    return rows.map(toSummary);
  }

  async listByInstitution(
    institutionId: string,
    filters: {
      academicYear?: number;
      grade?: Grade;
      teacherId?: string;
      includeArchived?: boolean;
    },
    page: CursorQuery,
  ): Promise<CursorPage<ClassroomSummary>> {
    const limit = normalizeLimit(page.limit);
    const conditions = ['c.institution_id = $1'];
    const params: unknown[] = [institutionId];

    if (!filters.includeArchived) conditions.push(`c.status = 'active'`);
    if (filters.academicYear) {
      params.push(filters.academicYear);
      conditions.push(`c.academic_year = $${params.length}`);
    }
    if (filters.grade) {
      params.push(filters.grade);
      conditions.push(`c.grade = $${params.length}`);
    }
    if (filters.teacherId) {
      params.push(filters.teacherId);
      conditions.push(`c.teacher_id = $${params.length}`);
    }

    const cursor = page.cursor ? decodeCursor<{ createdAt: string; id: string }>(page.cursor) : null;
    if (cursor) {
      params.push(cursor.createdAt, cursor.id);
      conditions.push(
        `(c.created_at, c.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
      );
    }

    params.push(limit + 1);

    const { rows } = await this.readPool.query<SummaryRow>(
      `${SUMMARY_SELECT} WHERE ${conditions.join(' AND ')}
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT $${params.length}`,
      params,
    );

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];

    return {
      items: items.map(toSummary),
      nextCursor:
        hasMore && last
          ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id })
          : null,
    };
  }

  /**
   * Salones elegibles en el formulario de registro. Consulta PUBLICA.
   *
   * Devuelve `has_capacity` como booleano y NO el conteo exacto. El numero
   * permitiria a un tercero medir la matricula de un colegio sondeando el
   * endpoint sin autenticarse, que es informacion comercial que no le
   * corresponde.
   */
  async listSelectableForRegistration(input: {
    institutionId: string;
    grade: Grade;
    academicYear: number;
  }): Promise<SelectableClassroom[]> {
    const { rows } = await this.readPool.query<{
      id: string;
      name: string;
      teacher_name: string | null;
      has_capacity: boolean;
    }>(
      `SELECT c.id,
              c.name,
              t.full_name AS teacher_name,
              (c.capacity > COALESCE(e.active_count, 0)) AS has_capacity
         FROM institutions.classrooms c
         LEFT JOIN institutions.teacher_directory t ON t.user_id = c.teacher_id
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS active_count
             FROM institutions.enrollments en
            WHERE en.classroom_id = c.id AND en.status = 'active'
         ) e ON true
        WHERE c.institution_id = $1
          AND c.grade = $2
          AND c.academic_year = $3
          AND c.status = 'active'
        ORDER BY c.name ASC`,
      [input.institutionId, input.grade, input.academicYear],
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      teacherName: row.teacher_name,
      hasCapacity: row.has_capacity,
    }));
  }

  async listByStudent(studentId: string): Promise<ClassroomSummary[]> {
    const { rows } = await this.readPool.query<SummaryRow>(
      `${SUMMARY_SELECT}
        WHERE EXISTS (
          SELECT 1 FROM institutions.enrollments en
           WHERE en.classroom_id = c.id AND en.student_id = $1 AND en.status = 'active'
        )
        ORDER BY c.academic_year DESC`,
      [studentId],
    );
    return rows.map(toSummary);
  }

  private async loadEnrollments(pool: Pool, classroomId: string): Promise<Enrollment[]> {
    const { rows } = await pool.query<EnrollmentRow>(
      `SELECT classroom_id, student_id, status, kit_id, enrolled_at, left_at
         FROM institutions.enrollments WHERE classroom_id = $1`,
      [classroomId],
    );
    return rows.map(toEnrollment);
  }
}

/**
 * El conteo de matriculas activas se calcula con LATERAL en vez de con un GROUP
 * BY global: asi PostgreSQL solo cuenta las filas de los salones que ya paso el
 * filtro, en lugar de agregar toda la tabla y descartar despues.
 */
const SUMMARY_SELECT = `
  SELECT c.id, c.institution_id, c.teacher_id, c.name, c.grade, c.capacity,
         c.academic_year, c.status, c.created_at,
         t.full_name AS teacher_name,
         COALESCE(e.active_count, 0) AS enrolled_count
    FROM institutions.classrooms c
    LEFT JOIN institutions.teacher_directory t ON t.user_id = c.teacher_id
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS active_count
        FROM institutions.enrollments en
       WHERE en.classroom_id = c.id AND en.status = 'active'
    ) e ON true
`;

interface SummaryRow {
  id: string;
  institution_id: string;
  teacher_id: string;
  teacher_name: string | null;
  name: string;
  grade: string;
  capacity: number;
  academic_year: number;
  status: string;
  enrolled_count: number;
  created_at: Date;
}

function toSummary(row: SummaryRow): ClassroomSummary {
  return {
    id: row.id,
    institutionId: row.institution_id,
    teacherId: row.teacher_id,
    teacherName: row.teacher_name,
    name: row.name,
    grade: row.grade as Grade,
    capacity: row.capacity,
    enrolledCount: row.enrolled_count,
    availableSeats: Math.max(0, row.capacity - row.enrolled_count),
    academicYear: row.academic_year,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

function toEnrollment(row: EnrollmentRow): Enrollment {
  return {
    studentId: row.student_id,
    status: row.status,
    enrolledAt: row.enrolled_at,
    kitId: row.kit_id,
    leftAt: row.left_at,
  };
}

function toDomain(row: ClassroomRow, enrollments: Enrollment[]): Classroom {
  return Classroom.rehydrate(
    ClassroomId.create(row.id),
    {
      institutionId: row.institution_id,
      teacherId: row.teacher_id,
      name: ClassroomName.create(row.name),
      grade: row.grade as Grade,
      capacity: Capacity.create(row.capacity),
      academicYear: row.academic_year,
      status: row.status,
      enrollments,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    row.version,
  );
}
