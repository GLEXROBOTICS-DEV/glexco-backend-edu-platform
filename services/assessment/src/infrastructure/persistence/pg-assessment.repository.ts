import type { Pool } from 'pg';
import {
  ConcurrencyError,
  ConflictError,
  decodeCursor,
  encodeCursor,
  normalizeLimit,
  type CursorPage,
  type CursorQuery,
  type TransactionContext,
} from '@glexco/kernel';
import type { PublicationStatus } from '@glexco/contracts';
import type { PgTransaction } from '@glexco/nest-platform';
import {
  Assessment,
  AssessmentId,
  type AssessmentKind,
  type AssessmentOrigin,
  type Question,
} from '../../domain/assessment.aggregate';
import {
  Submission,
  SubmissionId,
  type Answer,
  type SubmissionStatus,
} from '../../domain/submission.aggregate';
import type { AssessmentRepository, SubmissionRepository } from '../../application/ports';

interface AssessmentRow {
  id: string;
  kit_id: string;
  course_id: string | null;
  origin: AssessmentOrigin;
  institution_id: string | null;
  classroom_id: string | null;
  author_id: string;
  kind: AssessmentKind;
  title: string;
  description: string;
  questions: Question[];
  passing_score: number;
  max_attempts: number;
  time_limit_minutes: number | null;
  due_at: Date | null;
  status: PublicationStatus;
  submission_count: number;
  group_min_size: number | null;
  group_max_size: number | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const A_COLUMNS = `
  id, kit_id, course_id, origin, institution_id, classroom_id, author_id, kind,
  title, description, questions, passing_score, max_attempts, time_limit_minutes,
  due_at, status, submission_count, group_min_size, group_max_size,
  version, created_at, updated_at
`;

export class PgAssessmentRepository implements AssessmentRepository {
  /** Solo el pool de LECTURA: toda escritura pasa por el cliente de la
   *  transaccion, que es la unica forma de ver el bloqueo de fila del que
   *  depende el tope de intentos. */
  constructor(private readonly readPool: Pool) {}

  async findById(id: AssessmentId): Promise<Assessment | null> {
    const { rows } = await this.readPool.query<AssessmentRow>(
      `SELECT ${A_COLUMNS} FROM assessment.assessments WHERE id = $1`,
      [id.value],
    );
    return rows[0] ? toAssessment(rows[0]) : null;
  }

  /**
   * Carga bloqueando la fila.
   *
   * Es lo que hace valer el tope de intentos: al bloquear la evaluacion, dos
   * peticiones simultaneas del mismo alumno se serializan y la segunda ve el
   * intento que creo la primera.
   */
  async findByIdForUpdate(id: AssessmentId, tx: TransactionContext): Promise<Assessment | null> {
    const client = (tx as PgTransaction).client;
    const { rows } = await client.query<AssessmentRow>(
      `SELECT ${A_COLUMNS} FROM assessment.assessments WHERE id = $1 FOR UPDATE`,
      [id.value],
    );
    return rows[0] ? toAssessment(rows[0]) : null;
  }

  async save(assessment: Assessment, tx: TransactionContext): Promise<void> {
    // Sin cambios no se escribe. Un `UPDATE ... WHERE version < :nueva` con la
    // misma version no encontraria fila y se interpretaria como conflicto de
    // concurrencia: ver `AggregateRoot.hasChanges`.
    if (!assessment.hasChanges) return;
    const client = (tx as PgTransaction).client;
    const state = assessment.snapshot();

    const result = await client.query(
      `INSERT INTO assessment.assessments
         (id, kit_id, course_id, origin, institution_id, classroom_id, author_id,
          kind, title, description, questions, passing_score, max_attempts,
          time_limit_minutes, due_at, status, submission_count,
          group_min_size, group_max_size, version,
          created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       ON CONFLICT (id) DO UPDATE
          SET title              = EXCLUDED.title,
              description        = EXCLUDED.description,
              classroom_id       = EXCLUDED.classroom_id,
              questions          = EXCLUDED.questions,
              passing_score      = EXCLUDED.passing_score,
              max_attempts       = EXCLUDED.max_attempts,
              time_limit_minutes = EXCLUDED.time_limit_minutes,
              due_at             = EXCLUDED.due_at,
              status             = EXCLUDED.status,
              submission_count   = EXCLUDED.submission_count,
              group_min_size     = EXCLUDED.group_min_size,
              group_max_size     = EXCLUDED.group_max_size,
              version            = EXCLUDED.version,
              updated_at         = EXCLUDED.updated_at
        WHERE assessment.assessments.version < EXCLUDED.version`,
      [
        assessment.id.value,
        state.kitId,
        state.courseId,
        state.origin,
        state.institutionId,
        state.classroomId,
        state.authorId,
        state.kind,
        state.title,
        state.description,
        JSON.stringify(state.questions),
        state.passingScore,
        state.maxAttempts,
        state.timeLimitMinutes,
        state.dueAt,
        state.status,
        state.submissionCount,
        state.groupWork?.minSize ?? null,
        state.groupWork?.maxSize ?? null,
        assessment.version,
        state.createdAt,
        state.updatedAt,
      ],
    );

    if (result.rowCount === 0 && assessment.version > 1) {
      throw new ConcurrencyError('Assessment', assessment.id.value, assessment.version, -1);
    }
  }

  /**
   * Lo que un alumno puede ver.
   *
   * La condicion es la regla de negocio escrita en SQL: el banco comun de
   * GLEXCO, mas lo de SU institucion, y de eso solo lo general o lo de SU salon.
   * Sin la comprobacion de institucion, un alumno veria los examenes de otros
   * colegios; sin la de salon, los de otras clases del suyo.
   */
  async listForStudent(input: {
    kitId: string;
    institutionId: string | null;
    classroomId: string | null;
  }): Promise<Assessment[]> {
    const { rows } = await this.readPool.query<AssessmentRow>(
      `SELECT ${A_COLUMNS} FROM assessment.assessments
        WHERE kit_id = $1
          AND status = 'published'
          AND (
            origin = 'glexco'
            OR (
              institution_id = $2
              AND (classroom_id IS NULL OR classroom_id = $3)
            )
          )
        ORDER BY created_at`,
      [input.kitId, input.institutionId, input.classroomId],
    );
    return rows.map(toAssessment);
  }

  async findManyByIds(ids: string[]): Promise<Assessment[]> {
    if (ids.length === 0) return [];

    // `= ANY($1::uuid[])` y no un `IN` construido a mano: la consulta queda
    // siempre igual, asi que Postgres reutiliza su plan en vez de preparar uno
    // distinto por cada tamano de listado.
    const { rows } = await this.readPool.query<AssessmentRow>(
      `SELECT ${A_COLUMNS} FROM assessment.assessments WHERE id = ANY($1::uuid[])`,
      [ids],
    );

    return rows.map(toAssessment);
  }

  async listForTeacher(input: {
    kitId?: string | undefined;
    institutionId: string;
    classroomId?: string | undefined;
    page: CursorQuery;
  }): Promise<CursorPage<Assessment>> {
    const limit = normalizeLimit(input.page.limit);
    const params: unknown[] = [input.institutionId];
    const conditions: string[] = ["(origin = 'glexco' OR institution_id = $1)"];

    if (input.kitId) {
      params.push(input.kitId);
      conditions.push(`kit_id = $${params.length}`);
    }
    if (input.classroomId) {
      params.push(input.classroomId);
      conditions.push(`(classroom_id IS NULL OR classroom_id = $${params.length})`);
    }

    const cursor = input.page.cursor
      ? decodeCursor<{ createdAt: string; id: string }>(input.page.cursor)
      : null;

    if (cursor) {
      params.push(cursor.createdAt, cursor.id);
      conditions.push(
        `(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
      );
    }

    params.push(limit + 1);

    const { rows } = await this.readPool.query<AssessmentRow>(
      `SELECT ${A_COLUMNS} FROM assessment.assessments
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.length}`,
      params,
    );

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];

    return {
      items: items.map(toAssessment),
      nextCursor:
        hasMore && last
          ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id })
          : null,
    };
  }
}

// ---------------------------------------------------------------------------

interface SubmissionRow {
  id: string;
  assessment_id: string;
  student_id: string;
  institution_id: string | null;
  classroom_id: string | null;
  attempt_number: number;
  answers: Answer[];
  status: SubmissionStatus;
  score: number | null;
  max_score: number;
  passed: boolean | null;
  graded_by: string | null;
  feedback: string | null;
  started_at: Date;
  submitted_at: Date | null;
  graded_at: Date | null;
  member_ids: string[] | null;
  version: number;
}

/**
 * Los integrantes llegan con la entrega, en la misma consulta.
 *
 * Con una segunda llamada, cada sitio que carga una entrega tendria que
 * acordarse de pedirlos, y el que se olvidara veria un grupo VACIO -o sea, una
 * entrega individual- sin ningun error: la nota se repartiria solo a quien
 * entrego y los demas se quedarian sin ella.
 *
 * El subselect nombra la tabla sin alias porque todas las consultas de aqui la
 * usan asi.
 */
const S_COLUMNS = `
  id, assessment_id, student_id, institution_id, classroom_id, attempt_number, answers, status,
  score, max_score, passed, graded_by, feedback, started_at, submitted_at,
  graded_at, version,
  (
    SELECT coalesce(array_agg(m.student_id::text ORDER BY m.created_at), ARRAY[]::text[])
    FROM assessment.submission_members m
    WHERE m.submission_id = submissions.id
  ) AS member_ids
`;

export class PgSubmissionRepository implements SubmissionRepository {
  constructor(private readonly readPool: Pool) {}

  async findById(id: SubmissionId): Promise<Submission | null> {
    const { rows } = await this.readPool.query<SubmissionRow>(
      `SELECT ${S_COLUMNS} FROM assessment.submissions WHERE id = $1`,
      [id.value],
    );
    return rows[0] ? toSubmission(rows[0]) : null;
  }

  async findByIdForUpdate(id: SubmissionId, tx: TransactionContext): Promise<Submission | null> {
    const client = (tx as PgTransaction).client;
    const { rows } = await client.query<SubmissionRow>(
      `SELECT ${S_COLUMNS} FROM assessment.submissions WHERE id = $1 FOR UPDATE`,
      [id.value],
    );
    return rows[0] ? toSubmission(rows[0]) : null;
  }

  async save(submission: Submission, tx: TransactionContext): Promise<void> {
    // Sin cambios no se escribe. Un `UPDATE ... WHERE version < :nueva` con la
    // misma version no encontraria fila y se interpretaria como conflicto de
    // concurrencia: ver `AggregateRoot.hasChanges`.
    if (!submission.hasChanges) return;
    const client = (tx as PgTransaction).client;
    const state = submission.snapshot();

    const result = await client.query(
      `INSERT INTO assessment.submissions
         (id, assessment_id, student_id, institution_id, classroom_id,
          attempt_number, answers, status, score, max_score, passed, graded_by,
          feedback, started_at, submitted_at, graded_at, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (id) DO UPDATE
          SET answers      = EXCLUDED.answers,
              status       = EXCLUDED.status,
              score        = EXCLUDED.score,
              max_score    = EXCLUDED.max_score,
              passed       = EXCLUDED.passed,
              graded_by    = EXCLUDED.graded_by,
              feedback     = EXCLUDED.feedback,
              submitted_at = EXCLUDED.submitted_at,
              graded_at    = EXCLUDED.graded_at,
              version      = EXCLUDED.version
        WHERE assessment.submissions.version < EXCLUDED.version`,
      [
        submission.id.value,
        state.assessmentId,
        state.studentId,
        state.institutionId,
        state.classroomId,
        state.attemptNumber,
        JSON.stringify(state.answers),
        state.status,
        state.score,
        state.maxScore,
        state.passed,
        state.gradedBy,
        state.feedback,
        state.startedAt,
        state.submittedAt,
        state.gradedAt,
        submission.version,
      ],
    );

    if (result.rowCount === 0 && submission.version > 1) {
      throw new ConcurrencyError('Submission', submission.id.value, submission.version, -1);
    }

    // Los integrantes se escriben UNA vez, al crear el grupo.
    //
    // `ON CONFLICT DO NOTHING` sobre la clave primaria (entrega, alumno) y no
    // sobre la unica de (actividad, alumno, intento): la primera absorbe el
    // reintento inocente -guardar la misma entrega dos veces- y la segunda,
    // que es la que dice "este alumno ya esta en otro grupo", tiene que
    // REVENTAR. Silenciarla convertiria el fichaje doble en una entrega que se
    // guarda a medias: el alumno aparece en un grupo y no en el otro, y el que
    // se quedo sin el no se entera hasta que le falta la nota.
    if (state.memberIds.length > 0) {
      const valores = state.memberIds
        .map((_, indice) => `($1, $2, $${indice + 4}, $3)`)
        .join(', ');

      try {
        await client.query(
          `INSERT INTO assessment.submission_members
             (submission_id, assessment_id, student_id, attempt_number)
           VALUES ${valores}
           ON CONFLICT (submission_id, student_id) DO NOTHING`,
          [
            submission.id.value,
            state.assessmentId,
            state.attemptNumber,
            ...state.memberIds,
          ],
        );
      } catch (error) {
        // 23505 = unique_violation. Aqui solo puede venir de la restriccion
        // `submission_members_one_group_per_attempt`, porque la de la clave
        // primaria la absorbe el `ON CONFLICT` de arriba.
        //
        // Es la carrera real de un aula: dos grupos eligen al mismo companero
        // en el mismo minuto y los dos vieron la lista cuando aun estaba libre.
        // Gana el primero que escribe, y el segundo recibe un mensaje que dice
        // QUE hacer -volver a mirar la lista- en vez de un 500.
        if ((error as { code?: string }).code === '23505') {
          throw new ConflictError(
            'GROUP_MEMBER_TAKEN',
            'Alguno de tus companeros ya empezo esta actividad con otro grupo. Vuelve a abrir la lista para ver quien sigue libre.',
            { assessmentId: state.assessmentId },
          );
        }
        throw error;
      }
    }
  }

  async listGroupedStudents(assessmentId: string, attemptNumber: number): Promise<string[]> {
    // Del pool de LECTURA: alimenta una pantalla y no decide nada. Quien decide
    // es el indice unico al insertar.
    const { rows } = await this.readPool.query<{ student_id: string }>(
      `SELECT student_id
         FROM assessment.submission_members
        WHERE assessment_id = $1 AND attempt_number = $2`,
      [assessmentId, attemptNumber],
    );
    return rows.map((row) => row.student_id);
  }

  /**
   * Cuenta los intentos DENTRO de la transaccion.
   *
   * Va por el cliente de la transaccion y no por el pool a proposito: una
   * consulta lanzada al pool tomaria otra conexion, quedaria fuera de la
   * transaccion y no veria el bloqueo de la evaluacion, que es justo lo que
   * serializa las peticiones simultaneas.
   */
  async countAttempts(
    assessmentId: string,
    studentId: string,
    tx: TransactionContext,
  ): Promise<number> {
    const client = (tx as PgTransaction).client;
    const { rows } = await client.query<{ total: string }>(
      `SELECT count(*) AS total FROM assessment.submissions
        WHERE assessment_id = $1 AND student_id = $2`,
      [assessmentId, studentId],
    );
    return Number(rows[0]?.total ?? 0);
  }

  async findInProgress(assessmentId: string, studentId: string): Promise<Submission | null> {
    const { rows } = await this.readPool.query<SubmissionRow>(
      `SELECT ${S_COLUMNS} FROM assessment.submissions
        WHERE assessment_id = $1 AND student_id = $2 AND status = 'in_progress'
        ORDER BY attempt_number DESC
        LIMIT 1`,
      [assessmentId, studentId],
    );
    return rows[0] ? toSubmission(rows[0]) : null;
  }

  async listByStudent(assessmentId: string, studentId: string): Promise<Submission[]> {
    const { rows } = await this.readPool.query<SubmissionRow>(
      `SELECT ${S_COLUMNS} FROM assessment.submissions
        WHERE assessment_id = $1 AND student_id = $2
        ORDER BY attempt_number`,
      [assessmentId, studentId],
    );
    return rows.map(toSubmission);
  }

  async listPendingForClassroom(
    classroomId: string,
    page: CursorQuery,
  ): Promise<CursorPage<Submission>> {
    const limit = normalizeLimit(page.limit);
    const params: unknown[] = [classroomId];
    let condition = "classroom_id = $1 AND status = 'submitted'";

    const cursor = page.cursor
      ? decodeCursor<{ submittedAt: string; id: string }>(page.cursor)
      : null;

    if (cursor) {
      params.push(cursor.submittedAt, cursor.id);
      condition += ` AND (submitted_at, id) > ($2::timestamptz, $3::uuid)`;
    }

    params.push(limit + 1);

    const { rows } = await this.readPool.query<SubmissionRow>(
      `SELECT ${S_COLUMNS} FROM assessment.submissions
        WHERE ${condition}
        ORDER BY submitted_at, id
        LIMIT $${params.length}`,
      params,
    );

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];

    return {
      items: items.map(toSubmission),
      nextCursor:
        hasMore && last && last.submitted_at
          ? encodeCursor({ submittedAt: last.submitted_at.toISOString(), id: last.id })
          : null,
    };
  }
}

function toAssessment(row: AssessmentRow): Assessment {
  return Assessment.rehydrate(
    AssessmentId.create(row.id),
    {
      kitId: row.kit_id,
      courseId: row.course_id,
      origin: row.origin,
      institutionId: row.institution_id,
      classroomId: row.classroom_id,
      authorId: row.author_id,
      kind: row.kind,
      title: row.title,
      description: row.description,
      // `jsonb` llega ya deserializado desde pg; no hace falta JSON.parse.
      questions: row.questions ?? [],
      passingScore: row.passing_score,
      maxAttempts: row.max_attempts,
      timeLimitMinutes: row.time_limit_minutes,
      dueAt: row.due_at,
      status: row.status,
      submissionCount: row.submission_count,
      // Las dos columnas van juntas por restriccion `CHECK`, asi que basta
      // mirar una para saber si la actividad es grupal.
      groupWork:
        row.group_min_size === null || row.group_min_size === undefined
          ? null
          : { minSize: row.group_min_size, maxSize: row.group_max_size! },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    row.version,
  );
}

function toSubmission(row: SubmissionRow): Submission {
  return Submission.rehydrate(
    SubmissionId.create(row.id),
    {
      assessmentId: row.assessment_id,
      studentId: row.student_id,
      institutionId: row.institution_id,
      classroomId: row.classroom_id,
      attemptNumber: row.attempt_number,
      // Llega de `submission_members` por la consulta que carga la entrega. Sin
      // integrantes es individual, que es lo que son todas las anteriores a
      // esta migracion.
      memberIds: row.member_ids ?? [],
      answers: row.answers ?? [],
      status: row.status,
      score: row.score,
      maxScore: row.max_score,
      passed: row.passed,
      gradedBy: row.graded_by,
      feedback: row.feedback,
      startedAt: row.started_at,
      submittedAt: row.submitted_at,
      gradedAt: row.graded_at,
    },
    row.version,
  );
}
