import type { Pool } from 'pg';
import {
  ConcurrencyError,
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
  version: number;
  created_at: Date;
  updated_at: Date;
}

const A_COLUMNS = `
  id, kit_id, course_id, origin, institution_id, classroom_id, author_id, kind,
  title, description, questions, passing_score, max_attempts, time_limit_minutes,
  due_at, status, submission_count, version, created_at, updated_at
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
          time_limit_minutes, due_at, status, submission_count, version,
          created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,$20)
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
  version: number;
}

const S_COLUMNS = `
  id, assessment_id, student_id, institution_id, classroom_id, attempt_number, answers, status,
  score, max_score, passed, graded_by, feedback, started_at, submitted_at,
  graded_at, version
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
