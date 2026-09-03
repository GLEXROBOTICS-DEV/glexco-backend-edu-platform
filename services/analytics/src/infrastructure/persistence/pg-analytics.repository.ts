import type { Pool } from 'pg';
import type { TransactionContext } from '@glexco/kernel';
import type { PgTransaction } from '@glexco/nest-platform';
import {
  MEANINGFUL_SAMPLE_SIZE,
  type AnalyticsProjectionRepository,
  type AnalyticsQueryRepository,
  type ClassroomDashboard,
  type GradedSubmissionFact,
  type InstitutionDashboard,
  type QuestionOutcome,
  type StudentDashboard,
  type TeacherEffectivenessRow,
} from '../../application/projections';

export class PgAnalyticsProjectionRepository implements AnalyticsProjectionRepository {
  /**
   * Registra la entrega, resolviendo "mejor intento" y "primer intento".
   *
   * El `ON CONFLICT` hace tres cosas en una sentencia y las tres importan:
   *
   * - `best_score` se queda con el MAYOR, con `GREATEST`. Un segundo intento
   *   peor no debe empeorar la nota que el alumno ya demostro.
   * - `first_percentage` se queda con el del intento con `attempt_number` mas
   *   bajo, que es la referencia contra la que se mide el progreso. Si se
   *   sobreescribiera, el progreso saldria cero para todo el mundo.
   * - `attempts` toma el MAXIMO del numero de intento, no una suma. Sumar haria
   *   que un evento repetido -y JetStream los repite- inflara la cifra sin que
   *   nada fallara.
   */
  async upsertSubmissionFact(fact: GradedSubmissionFact, tx: TransactionContext): Promise<void> {
    const client = (tx as PgTransaction).client;
    const percentage = fact.maxScore === 0 ? 100 : (fact.score / fact.maxScore) * 100;

    await client.query(
      `INSERT INTO analytics.student_assessment_facts
         (student_id, assessment_id, institution_id, classroom_id, kit_id, origin,
          kind, best_score, max_score, best_percentage, passed, first_percentage,
          attempts, first_graded_at, last_graded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
       ON CONFLICT (student_id, assessment_id) DO UPDATE SET
         institution_id   = EXCLUDED.institution_id,
         classroom_id     = EXCLUDED.classroom_id,
         best_score       = GREATEST(analytics.student_assessment_facts.best_score,
                                     EXCLUDED.best_score),
         max_score        = EXCLUDED.max_score,
         best_percentage  = GREATEST(analytics.student_assessment_facts.best_percentage,
                                     EXCLUDED.best_percentage),
         passed           = analytics.student_assessment_facts.passed OR EXCLUDED.passed,
         first_percentage = CASE
                              WHEN $13 < analytics.student_assessment_facts.attempts
                                THEN EXCLUDED.first_percentage
                              ELSE analytics.student_assessment_facts.first_percentage
                            END,
         attempts         = GREATEST(analytics.student_assessment_facts.attempts, $13),
         first_graded_at  = LEAST(analytics.student_assessment_facts.first_graded_at, $14),
         last_graded_at   = GREATEST(analytics.student_assessment_facts.last_graded_at, $14)`,
      [
        fact.studentId,
        fact.assessmentId,
        fact.institutionId,
        fact.classroomId,
        fact.kitId,
        fact.origin,
        fact.kind,
        fact.score,
        fact.maxScore,
        percentage.toFixed(2),
        fact.passed,
        percentage.toFixed(2),
        fact.attemptNumber,
        fact.gradedAt,
      ],
    );
  }

  async recordQuestionOutcomes(
    outcomes: readonly QuestionOutcome[],
    tx: TransactionContext,
  ): Promise<void> {
    if (outcomes.length === 0) return;

    const client = (tx as PgTransaction).client;
    const values: unknown[] = [];
    const tuples: string[] = [];

    outcomes.forEach((outcome, index) => {
      const base = index * 4;
      tuples.push(`($${base + 1},$${base + 2},$${base + 3},1,$${base + 4})`);
      values.push(
        outcome.assessmentId,
        outcome.questionId,
        outcome.classroomId,
        outcome.missed ? 1 : 0,
      );
    });

    await client.query(
      `INSERT INTO analytics.question_miss_facts
         (assessment_id, question_id, classroom_id, answered, missed)
       VALUES ${tuples.join(',')}
       ON CONFLICT (assessment_id, question_id, classroom_id) DO UPDATE SET
         answered   = analytics.question_miss_facts.answered + 1,
         missed     = analytics.question_miss_facts.missed + EXCLUDED.missed,
         updated_at = now()`,
      values,
    );
  }

  /**
   * Recalcula los resumenes ENTEROS desde los hechos.
   *
   * No se ajustan por incrementos a proposito: un contador incremental se
   * desvia con el primer evento perdido o repetido, y nadie lo nota hasta que
   * alguien cuestiona una cifra. Recalcular desde los hechos garantiza que el
   * resumen sea siempre coherente con ellos, y el coste es una agregacion sobre
   * las decenas de filas de un salon.
   *
   * **Solo cuenta las evaluaciones de GLEXCO.** Son las unicas comparables entre
   * salones y colegios: con las del propio docente, la media se sube bajando la
   * dificultad.
   */
  async refreshRollups(
    input: {
      classroomId: string | null;
      institutionId: string | null;
      teacherId?: string | null;
      grade?: string | null;
    },
    tx: TransactionContext,
  ): Promise<void> {
    const client = (tx as PgTransaction).client;

    if (input.classroomId) {
      await client.query(
        `INSERT INTO analytics.classroom_rollups
           (classroom_id, institution_id, teacher_id, grade, students_measured,
            assessments_taken, avg_percentage, stddev_percentage, avg_gain,
            pass_rate, last_activity_at, updated_at)
         SELECT
           $1::uuid,
           -- PostgreSQL no tiene min(uuid). Se toma el primero del agregado:
           -- todas las filas de un salon comparten institucion, asi que cual
           -- sea es indiferente. Solo actua como respaldo si quien llama no la
           -- pasa, que en la practica siempre lo hace.
           COALESCE($2::uuid, (array_agg(f.institution_id))[1]),
           $3::uuid,
           $4::text,
           count(DISTINCT f.student_id),
           count(*),
           round(avg(f.best_percentage), 2),
           round(COALESCE(stddev_samp(f.best_percentage), 0), 2),
           round(avg(f.best_percentage - f.first_percentage), 2),
           round(100.0 * count(*) FILTER (WHERE f.passed) / NULLIF(count(*), 0), 2),
           max(f.last_graded_at),
           now()
         FROM analytics.student_assessment_facts f
         WHERE f.classroom_id = $1 AND f.origin = 'glexco'
         ON CONFLICT (classroom_id) DO UPDATE SET
           institution_id    = COALESCE(EXCLUDED.institution_id,
                                        analytics.classroom_rollups.institution_id),
           teacher_id        = COALESCE(EXCLUDED.teacher_id,
                                        analytics.classroom_rollups.teacher_id),
           grade             = COALESCE(EXCLUDED.grade, analytics.classroom_rollups.grade),
           students_measured = EXCLUDED.students_measured,
           assessments_taken = EXCLUDED.assessments_taken,
           avg_percentage    = EXCLUDED.avg_percentage,
           stddev_percentage = EXCLUDED.stddev_percentage,
           avg_gain          = EXCLUDED.avg_gain,
           pass_rate         = EXCLUDED.pass_rate,
           last_activity_at  = EXCLUDED.last_activity_at,
           updated_at        = now()`,
        [input.classroomId, input.institutionId, input.teacherId ?? null, input.grade ?? null],
      );
    }

    if (input.institutionId) {
      await client.query(
        `INSERT INTO analytics.institution_rollups
           (institution_id, classrooms, students_measured, avg_percentage,
            avg_gain, pass_rate, last_activity_at, updated_at)
         SELECT
           $1::uuid,
           count(DISTINCT f.classroom_id),
           count(DISTINCT f.student_id),
           round(avg(f.best_percentage), 2),
           round(avg(f.best_percentage - f.first_percentage), 2),
           round(100.0 * count(*) FILTER (WHERE f.passed) / NULLIF(count(*), 0), 2),
           max(f.last_graded_at),
           now()
         FROM analytics.student_assessment_facts f
         WHERE f.institution_id = $1 AND f.origin = 'glexco'
         ON CONFLICT (institution_id) DO UPDATE SET
           classrooms        = EXCLUDED.classrooms,
           students_measured = EXCLUDED.students_measured,
           avg_percentage    = EXCLUDED.avg_percentage,
           avg_gain          = EXCLUDED.avg_gain,
           pass_rate         = EXCLUDED.pass_rate,
           last_activity_at  = EXCLUDED.last_activity_at,
           updated_at        = now()`,
        [input.institutionId],
      );
    }
  }

  async markProjected(projection: string, eventAt: Date, tx: TransactionContext): Promise<void> {
    const client = (tx as PgTransaction).client;
    await client.query(
      `INSERT INTO analytics.projection_state (projection, last_event_at, events_applied)
       VALUES ($1, $2, 1)
       ON CONFLICT (projection) DO UPDATE SET
         last_event_at  = GREATEST(analytics.projection_state.last_event_at, EXCLUDED.last_event_at),
         events_applied = analytics.projection_state.events_applied + 1,
         updated_at     = now()`,
      [projection, eventAt],
    );
  }
}

// ---------------------------------------------------------------------------

export class PgAnalyticsQueryRepository implements AnalyticsQueryRepository {
  /** Solo pool de LECTURA: todo esto es, por definicion, lectura pesada, y es
   *  exactamente el trafico que la separacion de pools existe para desviar. */
  constructor(private readonly readPool: Pool) {}

  async studentDashboard(studentId: string): Promise<StudentDashboard> {
    const { rows: summary } = await this.readPool.query<{
      taken: string;
      avg_glexco: string | null;
      avg_institution: string | null;
      pass_rate: string | null;
      avg_gain: string | null;
    }>(
      `SELECT
         count(*) AS taken,
         round(avg(best_percentage) FILTER (WHERE origin = 'glexco'), 2) AS avg_glexco,
         round(avg(best_percentage) FILTER (WHERE origin = 'institution'), 2) AS avg_institution,
         round(100.0 * count(*) FILTER (WHERE passed) / NULLIF(count(*), 0), 2) AS pass_rate,
         round(avg(best_percentage - first_percentage), 2) AS avg_gain
       FROM analytics.student_assessment_facts
       WHERE student_id = $1`,
      [studentId],
    );

    const { rows: timeline } = await this.readPool.query<{
      assessment_id: string;
      origin: string;
      best_percentage: string;
      passed: boolean;
      last_graded_at: Date;
    }>(
      `SELECT assessment_id, origin, best_percentage, passed, last_graded_at
       FROM analytics.student_assessment_facts
       WHERE student_id = $1
       ORDER BY last_graded_at
       LIMIT 100`,
      [studentId],
    );

    const row = summary[0];

    return {
      studentId,
      assessmentsTaken: Number(row?.taken ?? 0),
      averageGlexco: numberOrNull(row?.avg_glexco),
      averageInstitution: numberOrNull(row?.avg_institution),
      passRate: numberOrNull(row?.pass_rate),
      averageGain: numberOrNull(row?.avg_gain),
      timeline: timeline.map((entry) => ({
        assessmentId: entry.assessment_id,
        origin: entry.origin,
        percentage: Number(entry.best_percentage),
        passed: entry.passed,
        gradedAt: entry.last_graded_at.toISOString(),
      })),
    };
  }

  async classroomDashboard(classroomId: string): Promise<ClassroomDashboard> {
    const { rows } = await this.readPool.query<{
      students_measured: number;
      assessments_taken: number;
      avg_percentage: string | null;
      stddev_percentage: string | null;
      avg_gain: string | null;
      pass_rate: string | null;
      last_activity_at: Date | null;
    }>(
      `SELECT students_measured, assessments_taken, avg_percentage,
              stddev_percentage, avg_gain, pass_rate, last_activity_at
       FROM analytics.classroom_rollups WHERE classroom_id = $1`,
      [classroomId],
    );

    // Las preguntas mas falladas, que es el dato accionable. Se exige un minimo
    // de tres respuestas: con una sola, "100% de fallo" no significa nada.
    const { rows: hardest } = await this.readPool.query<{
      assessment_id: string;
      question_id: string;
      answered: number;
      missed: number;
    }>(
      `SELECT assessment_id, question_id, answered, missed
       FROM analytics.question_miss_facts
       WHERE classroom_id = $1 AND answered >= 3
       ORDER BY (missed::numeric / answered) DESC, missed DESC
       LIMIT 10`,
      [classroomId],
    );

    const row = rows[0];

    return {
      classroomId,
      studentsMeasured: row?.students_measured ?? 0,
      assessmentsTaken: row?.assessments_taken ?? 0,
      averagePercentage: numberOrNull(row?.avg_percentage),
      stddevPercentage: numberOrNull(row?.stddev_percentage),
      averageGain: numberOrNull(row?.avg_gain),
      passRate: numberOrNull(row?.pass_rate),
      lastActivityAt: row?.last_activity_at?.toISOString() ?? null,
      hardestQuestions: hardest.map((entry) => ({
        assessmentId: entry.assessment_id,
        questionId: entry.question_id,
        answered: entry.answered,
        missed: entry.missed,
        missRate: Number(((entry.missed / entry.answered) * 100).toFixed(2)),
      })),
    };
  }

  async institutionDashboard(institutionId: string): Promise<InstitutionDashboard> {
    const { rows } = await this.readPool.query<{
      classrooms: number;
      students_measured: number;
      avg_percentage: string | null;
      avg_gain: string | null;
      pass_rate: string | null;
      codes_issued: number;
      codes_redeemed: number;
    }>(
      `SELECT classrooms, students_measured, avg_percentage, avg_gain, pass_rate,
              codes_issued, codes_redeemed
       FROM analytics.institution_rollups WHERE institution_id = $1`,
      [institutionId],
    );

    // Por grado, no global: comparar 1.º de primaria con 5.º de secundaria no
    // dice nada de ninguno de los dos.
    const { rows: byGrade } = await this.readPool.query<{
      grade: string | null;
      classrooms: string;
      avg_percentage: string | null;
      avg_gain: string | null;
    }>(
      `SELECT grade, count(*) AS classrooms,
              round(avg(avg_percentage), 2) AS avg_percentage,
              round(avg(avg_gain), 2) AS avg_gain
       FROM analytics.classroom_rollups
       WHERE institution_id = $1 AND grade IS NOT NULL
       GROUP BY grade
       ORDER BY grade`,
      [institutionId],
    );

    const row = rows[0];

    return {
      institutionId,
      classrooms: row?.classrooms ?? 0,
      studentsMeasured: row?.students_measured ?? 0,
      averagePercentage: numberOrNull(row?.avg_percentage),
      averageGain: numberOrNull(row?.avg_gain),
      passRate: numberOrNull(row?.pass_rate),
      codesIssued: row?.codes_issued ?? 0,
      codesRedeemed: row?.codes_redeemed ?? 0,
      byGrade: byGrade.map((entry) => ({
        grade: entry.grade ?? '',
        classrooms: Number(entry.classrooms),
        averagePercentage: numberOrNull(entry.avg_percentage),
        averageGain: numberOrNull(entry.avg_gain),
      })),
    };
  }

  /**
   * Eficacia docente, ordenada por PROGRESO.
   *
   * Se ordena por `avg_gain` y no por `avg_percentage`, y eso es toda la
   * diferencia: la nota media mide sobre todo con que alumnado empieza cada
   * profesor, y ordenar por ella pone arriba a quien recibio el grupo avanzado.
   * El progreso mide cuanto avanzo su salon desde donde estaba.
   *
   * `statisticallyMeaningful` viaja en cada fila. Con menos de quince alumnos
   * medidos, la diferencia entre dos salones es ruido: presentarla sin ese aviso
   * es dar por dato lo que es azar.
   */
  async teacherEffectiveness(institutionId: string): Promise<TeacherEffectivenessRow[]> {
    const { rows } = await this.readPool.query<{
      teacher_id: string | null;
      classroom_id: string;
      grade: string | null;
      avg_gain: string | null;
      avg_percentage: string | null;
      students_measured: number;
    }>(
      `SELECT teacher_id, classroom_id, grade, avg_gain, avg_percentage, students_measured
       FROM analytics.classroom_rollups
       WHERE institution_id = $1 AND teacher_id IS NOT NULL
       ORDER BY avg_gain DESC NULLS LAST, students_measured DESC`,
      [institutionId],
    );

    return rows.map((row) => ({
      teacherId: row.teacher_id ?? '',
      classroomId: row.classroom_id,
      grade: row.grade,
      averageGain: numberOrNull(row.avg_gain),
      averagePercentage: numberOrNull(row.avg_percentage),
      sampleSize: row.students_measured,
      statisticallyMeaningful: row.students_measured >= MEANINGFUL_SAMPLE_SIZE,
    }));
  }

  async weakestKits(
    limit: number,
  ): Promise<{ kitId: string; studentsMeasured: number; averagePercentage: number | null }[]> {
    const { rows } = await this.readPool.query<{
      kit_id: string;
      students: string;
      avg_percentage: string | null;
    }>(
      `SELECT kit_id,
              count(DISTINCT student_id) AS students,
              round(avg(best_percentage), 2) AS avg_percentage
       FROM analytics.student_assessment_facts
       WHERE origin = 'glexco'
       GROUP BY kit_id
       HAVING count(DISTINCT student_id) >= $2
       ORDER BY avg_percentage ASC NULLS LAST
       LIMIT $1`,
      [limit, MEANINGFUL_SAMPLE_SIZE],
    );

    return rows.map((row) => ({
      kitId: row.kit_id,
      studentsMeasured: Number(row.students),
      averagePercentage: numberOrNull(row.avg_percentage),
    }));
  }

  async institutionsOverview(): Promise<InstitutionDashboard[]> {
    // Las DOS fuentes, unidas: el directorio -que llega por evento de alta- y los
    // resumenes -que llegan por actividad-. Ninguna de las dos basta sola.
    //
    // Partiendo solo de los resumenes, un colegio recien firmado que todavia no
    // ha activado ningun codigo NO aparece. Y ese es precisamente el que GLEXCO
    // necesita ver: libros comprados que nadie activa son dinero pagado y sin
    // usar, y la señal mas temprana de que un centro no va a renovar. Un panel
    // comercial que oculta al cliente que no arranca es un panel que informa de
    // todo menos de lo unico accionable.
    //
    // Partiendo solo del directorio se perderia el camino contrario: un colegio
    // con actividad cuyo evento de alta es anterior a esta proyeccion. Sale sin
    // nombre, y sin nombre es mejor que ausente.
    //
    // Las dos tablas son de ESTE schema. Sigue sin haber ningun JOIN contra el
    // schema de instituciones, que es lo que la regla prohibe.
    const { rows } = await this.readPool.query<{
      institution_id: string;
      name: string | null;
      short_name: string | null;
      city: string | null;
      status: string | null;
    }>(
      `WITH conocidas AS (
         SELECT institution_id, last_activity_at FROM analytics.institution_rollups
         UNION
         SELECT institution_id, NULL::timestamptz FROM analytics.institution_directory
       ),
       unicas AS (
         SELECT institution_id, max(last_activity_at) AS last_activity_at
           FROM conocidas
          GROUP BY institution_id
       )
       SELECT u.institution_id,
              d.name,
              d.short_name,
              d.city,
              d.status
         FROM unicas u
         LEFT JOIN analytics.institution_directory d
                ON d.institution_id = u.institution_id
        ORDER BY u.last_activity_at DESC NULLS LAST, d.name ASC
        LIMIT 200`,
    );

    // Se resuelve una consulta por institucion en vez de una gigante con
    // agrupaciones anidadas: son doscientas como maximo, van a la replica, y el
    // SQL resultante es legible. Una consulta ilegible que nadie se atreve a
    // tocar es peor que doscientas rapidas.
    return Promise.all(
      rows.map(async (row) => ({
        ...(await this.institutionDashboard(row.institution_id)),
        name: row.name,
        shortName: row.short_name,
        city: row.city,
        status: row.status ?? 'active',
      })),
    );
  }
}

/** `numeric` de PostgreSQL llega como cadena para no perder precision. */
function numberOrNull(value: string | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}
