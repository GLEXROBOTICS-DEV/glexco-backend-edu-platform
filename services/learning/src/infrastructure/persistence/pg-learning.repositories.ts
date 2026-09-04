import type { Pool, PoolClient } from 'pg';
import type { TransactionContext } from '@glexco/kernel';
import { BADGE_RULES, isStale, levelFor } from '../../domain/gamification';
import type { Mission, StudentFacts } from '../../domain/mission';
import type {
  CertificateRepository,
  CertificateRow,
  ClassroomProgressRow,
  GamificationRepository,
  LearningRepository,
  MissionRepository,
  StudentProgressView,
} from '../../domain/repositories';

interface PgTransaction extends TransactionContext {
  client: PoolClient;
}

const clientOf = (tx?: TransactionContext): PoolClient | null =>
  tx ? ((tx as PgTransaction).client ?? null) : null;

export class PgLearningRepository implements LearningRepository {
  constructor(
    private readonly writePool: Pool,
    private readonly readPool: Pool,
  ) {}

  async startLesson(input: {
    studentId: string;
    lessonId: string;
    courseId: string;
    kitId: string;
    classroomId: string | null;
    institutionId: string | null;
    now: Date;
  }): Promise<{ alreadyCompleted: boolean }> {
    // `DO UPDATE` que NO toca `started_at` ni `completed_at`: reabrir una
    // leccion no reinicia su comienzo ni deshace su finalizacion. Volver a
    // consultar algo ya aprendido es normal, y un contador que retrocede al
    // repasar castiga justo el habito que se quiere fomentar.
    //
    // El salon si se rellena si estaba vacio: un intento abierto antes de que la
    // matricula estuviera proyectada quedaria sin salon para siempre, y su
    // progreso no aparecerria en la lista de ningun docente. Es el mismo hueco
    // que ya aparecio con las entregas.
    const { rows } = await this.writePool.query(
      `INSERT INTO learning.lesson_progress
         (student_id, lesson_id, course_id, kit_id, classroom_id, institution_id, started_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
       ON CONFLICT (student_id, lesson_id) DO UPDATE SET
         classroom_id   = COALESCE(learning.lesson_progress.classroom_id, EXCLUDED.classroom_id),
         institution_id = COALESCE(learning.lesson_progress.institution_id, EXCLUDED.institution_id),
         updated_at     = EXCLUDED.updated_at
       RETURNING completed_at`,
      [
        input.studentId,
        input.lessonId,
        input.courseId,
        input.kitId,
        input.classroomId,
        input.institutionId,
        input.now,
      ],
    );

    return { alreadyCompleted: rows[0]?.completed_at !== null };
  }

  async completeLesson(input: {
    studentId: string;
    lessonId: string;
    secondsSpent: number;
    now: Date;
    tx: TransactionContext;
  }): Promise<{ firstCompletion: boolean; courseId: string; kitId: string }> {
    const client = clientOf(input.tx)!;

    // `WHERE completed_at IS NULL` hace la operacion idempotente EN LA BASE y no
    // en el codigo: dos peticiones simultaneas -un doble clic, un reintento de
    // red- solo pueden actualizar una, y la segunda no devuelve fila. Sin eso,
    // comprobar antes y escribir despues deja la carrera abierta.
    const { rows: updated } = await client.query(
      `UPDATE learning.lesson_progress
          SET completed_at  = $3,
              seconds_spent = seconds_spent + $4,
              version       = version + 1,
              updated_at    = $3
        WHERE student_id = $1 AND lesson_id = $2 AND completed_at IS NULL
        RETURNING course_id, kit_id`,
      [input.studentId, input.lessonId, input.now, input.secondsSpent],
    );

    if (updated[0]) {
      return {
        firstCompletion: true,
        courseId: updated[0].course_id,
        kitId: updated[0].kit_id,
      };
    }

    const { rows } = await client.query(
      `SELECT course_id, kit_id FROM learning.lesson_progress
        WHERE student_id = $1 AND lesson_id = $2`,
      [input.studentId, input.lessonId],
    );

    // Hay fila: estaba completada de antes. Es un reintento y no paga.
    if (rows[0]) {
      return { firstCompletion: false, courseId: rows[0].course_id, kitId: rows[0].kit_id };
    }

    // NO hay fila: se marca completada una leccion que nunca se abrio. Pasa
    // cuando el registro de apertura fallo -no puede impedir ver el contenido,
    // asi que se ignora- y el alumno pulsa "ya lo vi" igualmente. Se abre y se
    // completa de una vez: devolver "ya estaba hecha" seria mentirle sobre un
    // hito que si es nuevo, y ademas le negaria su XP para siempre.
    const located = await client.query(
      `SELECT course_id, kit_id FROM learning.lesson_directory WHERE lesson_id = $1`,
      [input.lessonId],
    );

    if (!located.rows[0]) {
      // La leccion no existe en el directorio. No se inventa una fila.
      return { firstCompletion: false, courseId: '', kitId: '' };
    }

    await client.query(
      `INSERT INTO learning.lesson_progress
         (student_id, lesson_id, course_id, kit_id, started_at, completed_at, seconds_spent, updated_at)
       VALUES ($1,$2,$3,$4,$5,$5,$6,$5)
       ON CONFLICT (student_id, lesson_id) DO NOTHING`,
      [
        input.studentId,
        input.lessonId,
        located.rows[0].course_id,
        located.rows[0].kit_id,
        input.now,
        input.secondsSpent,
      ],
    );

    return {
      firstCompletion: true,
      courseId: located.rows[0].course_id,
      kitId: located.rows[0].kit_id,
    };
  }

  async courseCompletion(
    studentId: string,
    courseId: string,
    tx?: TransactionContext,
  ): Promise<{ completed: number; total: number }> {
    // Dentro de la transaccion cuando la hay: dos lecciones terminadas a la vez
    // -que pasa en clase- tienen que ver el estado de la otra, o ninguna
    // detectaria que el curso quedo completo.
    const executor = clientOf(tx) ?? this.readPool;

    const { rows } = await executor.query(
      `SELECT
         (SELECT count(*) FROM learning.lesson_progress
           WHERE student_id = $1 AND course_id = $2 AND completed_at IS NOT NULL) AS completed,
         (SELECT lesson_count FROM learning.course_directory WHERE course_id = $2) AS total`,
      [studentId, courseId],
    );

    return {
      completed: Number(rows[0]?.completed ?? 0),
      total: Number(rows[0]?.total ?? 0),
    };
  }

  async progressFor(studentId: string): Promise<StudentProgressView> {
    const [summary, badges, courses] = await Promise.all([
      this.readPool.query(
        `SELECT total_xp, explorer_level, lessons_completed, courses_completed
           FROM learning.student_gamification WHERE student_id = $1`,
        [studentId],
      ),
      this.readPool.query(
        `SELECT badge_code, category, awarded_at FROM learning.badges
          WHERE student_id = $1 ORDER BY awarded_at DESC`,
        [studentId],
      ),
      this.readPool.query(
        `SELECT d.course_id,
                d.kit_id,
                d.title,
                d.lesson_count,
                count(*) FILTER (WHERE p.completed_at IS NOT NULL) AS completed,
                count(*)                                            AS started,
                max(p.updated_at)                                   AS last_activity
           FROM learning.lesson_progress p
           JOIN learning.course_directory d ON d.course_id = p.course_id
          WHERE p.student_id = $1
          GROUP BY d.course_id, d.kit_id, d.title, d.lesson_count
          ORDER BY max(p.updated_at) DESC`,
        [studentId],
      ),
    ]);

    const totalXp = Number(summary.rows[0]?.total_xp ?? 0);
    const level = levelFor(totalXp);

    // El nombre y la descripcion de la insignia salen del dominio y NO de la
    // base: son texto de producto, cambian, y guardarlos en cada fila obligaria
    // a una migracion para corregir una errata.
    const catalogue = new Map(BADGE_RULES.map((rule) => [rule.code, rule]));

    return {
      studentId,
      totalXp,
      explorerLevel: level.level,
      levelName: level.name,
      xpToNext: level.xpToNext,
      nextLevelName: level.nextName,
      lessonsCompleted: Number(summary.rows[0]?.lessons_completed ?? 0),
      coursesCompleted: Number(summary.rows[0]?.courses_completed ?? 0),
      badges: badges.rows.map((row) => ({
        code: row.badge_code,
        name: catalogue.get(row.badge_code)?.name ?? row.badge_code,
        category: row.category,
        awardedAt: (row.awarded_at as Date).toISOString(),
      })),
      courses: courses.rows.map((row) => ({
        courseId: row.course_id,
        kitId: row.kit_id,
        title: row.title,
        lessonCount: Number(row.lesson_count),
        lessonsCompleted: Number(row.completed),
        lessonsStarted: Number(row.started),
        lastActivityAt: row.last_activity ? (row.last_activity as Date).toISOString() : null,
      })),
    };
  }

  async classroomProgress(classroomId: string, now: Date): Promise<ClassroomProgressRow[]> {
    // Se parte de las MATRICULAS y no del progreso: un alumno que nunca abrio
    // nada no tiene ninguna fila de progreso, y es justo el que hay que ver.
    // Partiendo del progreso, el que peor va es el unico que no aparece.
    const { rows } = await this.readPool.query(
      `SELECT m.student_id,
              m.full_name,
              count(p.lesson_id) FILTER (WHERE p.completed_at IS NOT NULL) AS completed,
              count(p.lesson_id)                                            AS started,
              max(p.updated_at)                                             AS last_activity
         FROM learning.classroom_members m
         LEFT JOIN learning.lesson_progress p
                ON p.student_id = m.student_id AND p.classroom_id = m.classroom_id
        WHERE m.classroom_id = $1 AND m.active
        GROUP BY m.student_id, m.full_name
        ORDER BY m.full_name`,
      [classroomId],
    );

    return rows.map((row) => {
      const lastActivity = row.last_activity ? (row.last_activity as Date) : null;
      return {
        studentId: row.student_id,
        fullName: row.full_name,
        lessonsCompleted: Number(row.completed),
        lessonsStarted: Number(row.started),
        lastActivityAt: lastActivity ? lastActivity.toISOString() : null,
        // La regla vive en el dominio y no en el SQL: cambiar el umbral no puede
        // exigir tocar una consulta, y ademas asi se puede probar en memoria.
        stale: isStale(lastActivity, now),
      };
    });
  }

  async locateLesson(lessonId: string): Promise<{ courseId: string; kitId: string } | null> {
    const { rows } = await this.readPool.query(
      `SELECT course_id, kit_id FROM learning.lesson_directory WHERE lesson_id = $1`,
      [lessonId],
    );
    return rows[0] ? { courseId: rows[0].course_id, kitId: rows[0].kit_id } : null;
  }

  async classroomsFor(userId: string): Promise<{ classroomId: string; teacherId: string | null }[]> {
    const { rows } = await this.readPool.query(
      `SELECT classroom_id, teacher_id FROM learning.classroom_members
        WHERE student_id = $1 AND active
       UNION
       SELECT DISTINCT classroom_id, teacher_id FROM learning.classroom_members
        WHERE teacher_id = $1 AND active`,
      [userId],
    );

    return rows.map((row) => ({ classroomId: row.classroom_id, teacherId: row.teacher_id }));
  }
}

export class PgGamificationRepository implements GamificationRepository {
  constructor(private readonly readPool: Pool) {}

  async award(input: {
    id: string;
    studentId: string;
    reason: string;
    reference: string;
    points: number;
    now: Date;
    tx: TransactionContext;
  }): Promise<boolean> {
    // `ON CONFLICT DO NOTHING` sobre el indice unico (alumno, motivo,
    // referencia). Es la garantia de un solo cobro, y vive en la BASE: dos
    // peticiones simultaneas no pueden pagar dos veces, mientras que comprobar
    // antes y escribir despues deja la carrera abierta. Un contador de puntos
    // que se puede inflar deja de significar nada para quien se lo gano.
    const { rowCount } = await clientOf(input.tx)!.query(
      `INSERT INTO learning.xp_awards (id, student_id, reason, reference, points, awarded_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (student_id, reason, reference) DO NOTHING`,
      [input.id, input.studentId, input.reason, input.reference, input.points, input.now],
    );

    return (rowCount ?? 0) > 0;
  }

  async refreshSummary(
    studentId: string,
    tx: TransactionContext,
  ): Promise<{
    totalXp: number;
    explorerLevel: number;
    lessonsCompleted: number;
    coursesCompleted: number;
    assessmentsPassed: number;
  }> {
    const client = clientOf(tx)!;

    // Se recalcula ENTERO desde los hechos, nunca sumando incrementos. Es la
    // misma decision que en analytics y por lo mismo: un evento entregado dos
    // veces -que JetStream garantiza *al menos* una vez- no puede inflar un
    // total que se reconstruye desde su origen.
    const { rows } = await client.query(
      `SELECT
         COALESCE(sum(points), 0)::int                                          AS total_xp,
         count(*) FILTER (WHERE reason = 'lesson_completed')::int               AS lessons,
         count(*) FILTER (WHERE reason = 'course_completed')::int               AS courses,
         count(*) FILTER (WHERE reason = 'assessment_passed')::int              AS assessments
       FROM learning.xp_awards WHERE student_id = $1`,
      [studentId],
    );

    const totalXp = Number(rows[0]?.total_xp ?? 0);
    const level = levelFor(totalXp);

    await client.query(
      `INSERT INTO learning.student_gamification
         (student_id, total_xp, explorer_level, lessons_completed, courses_completed, updated_at)
       VALUES ($1,$2,$3,$4,$5, now())
       ON CONFLICT (student_id) DO UPDATE SET
         total_xp          = EXCLUDED.total_xp,
         explorer_level    = EXCLUDED.explorer_level,
         lessons_completed = EXCLUDED.lessons_completed,
         courses_completed = EXCLUDED.courses_completed,
         updated_at        = now()`,
      [
        studentId,
        totalXp,
        level.level,
        Number(rows[0]?.lessons ?? 0),
        Number(rows[0]?.courses ?? 0),
      ],
    );

    return {
      totalXp,
      explorerLevel: level.level,
      lessonsCompleted: Number(rows[0]?.lessons ?? 0),
      coursesCompleted: Number(rows[0]?.courses ?? 0),
      assessmentsPassed: Number(rows[0]?.assessments ?? 0),
    };
  }

  async badgesOf(studentId: string, tx?: TransactionContext): Promise<string[]> {
    const executor = clientOf(tx) ?? this.readPool;
    const { rows } = await executor.query(
      `SELECT badge_code FROM learning.badges WHERE student_id = $1`,
      [studentId],
    );
    return rows.map((row) => row.badge_code as string);
  }

  async grantBadges(
    studentId: string,
    badges: { code: string; category: string }[],
    tx: TransactionContext,
  ): Promise<void> {
    if (badges.length === 0) return;

    const client = clientOf(tx)!;
    for (const badge of badges) {
      // `DO NOTHING`: una insignia se concede una vez y no se retira nunca.
      // Una que aparece y desaparece convierte un reconocimiento en un castigo.
      await client.query(
        `INSERT INTO learning.badges (student_id, badge_code, category)
         VALUES ($1,$2,$3) ON CONFLICT (student_id, badge_code) DO NOTHING`,
        [studentId, badge.code, badge.category],
      );
    }
  }
}

/**
 * Certificados.
 *
 * Todas las lecturas van al pool de REPLICAS salvo dos: la que decide si emitir
 * y la de "ya tengo uno", que se hacen contra el pool de escritura. No es
 * simetria rota por descuido: emitir es una escritura que depende de lo que
 * acaba de leer, y una replica unos milisegundos por detras basta para emitir un
 * segundo certificado del mismo curso.
 */
export class PgCertificateRepository implements CertificateRepository {
  constructor(
    private readonly writePool: Pool,
    private readonly readPool: Pool,
  ) {}

  async findActive(studentId: string, courseId: string): Promise<CertificateRow | null> {
    const { rows } = await this.writePool.query<CertificateDbRow>(
      `SELECT ${C_COLUMNS} FROM learning.certificates
        WHERE student_id = $1 AND course_id = $2 AND revoked_at IS NULL
        LIMIT 1`,
      [studentId, courseId],
    );
    return rows[0] ? toCertificate(rows[0]) : null;
  }

  async findBySerial(serial: string): Promise<CertificateRow | null> {
    // Se comparan las dos series SIN guiones. El caso de uso ya normaliza
    // espacios y mayusculas, pero los guiones no los podia quitar: forman parte
    // de la serie guardada. Resultado: quien tecleaba "GLXPU3WQ4NZXYKV" -que es
    // lo que hace media la gente al copiar de un papel- recibia "no encontramos
    // este certificado" sobre uno perfectamente valido.
    const { rows } = await this.readPool.query<CertificateDbRow>(
      `SELECT ${C_COLUMNS} FROM learning.certificates
        WHERE replace(serial, '-', '') = replace($1, '-', '')
        LIMIT 1`,
      [serial],
    );
    return rows[0] ? toCertificate(rows[0]) : null;
  }

  async listByStudent(studentId: string): Promise<CertificateRow[]> {
    const { rows } = await this.readPool.query<CertificateDbRow>(
      `SELECT ${C_COLUMNS} FROM learning.certificates
        WHERE student_id = $1
        ORDER BY issued_at DESC`,
      [studentId],
    );
    return rows.map(toCertificate);
  }

  async insert(row: CertificateRow): Promise<void> {
    await this.writePool.query(
      `INSERT INTO learning.certificates
         (id, serial, student_id, student_name, course_id, course_title, kit_id,
          institution_name, completion, signature, key_fingerprint, issued_at, issued_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        row.id,
        row.serial,
        row.studentId,
        row.studentName,
        row.courseId,
        row.courseTitle,
        row.kitId,
        row.institutionName,
        row.completion,
        row.signature,
        row.keyFingerprint,
        row.issuedAt,
        row.issuedBy,
      ],
    );
  }

  async eligibility(studentId: string, courseId: string) {
    // Una sola consulta con todo lo que hace falta. Emitir en masa recorre
    // treinta alumnos, y a cuatro consultas por alumno serian ciento veinte
    // viajes a la base para una operacion que se lanza con un boton.
    const { rows } = await this.writePool.query<{
      student_name: string | null;
      course_title: string;
      kit_id: string;
      institution_name: string | null;
      lessons_completed: string;
      lesson_count: number;
    }>(
      `SELECT
         -- El directorio manda sobre la matricula: se alimenta de los eventos
         -- de identidad y sigue los cambios de nombre, mientras que la matricula
         -- se emite una sola vez. La matricula queda como respaldo.
         COALESCE(
           (SELECT sd.full_name FROM learning.student_directory sd WHERE sd.user_id = $1),
           (SELECT m.full_name FROM learning.classroom_members m
             WHERE m.student_id = $1 AND m.active AND m.full_name <> ''
             LIMIT 1)
         )                                                     AS student_name,
         d.title                                               AS course_title,
         d.kit_id                                              AS kit_id,
         (SELECT i.name FROM learning.institution_directory i
            JOIN learning.classroom_members m2 ON m2.institution_id = i.institution_id
           WHERE m2.student_id = $1 AND m2.active
           LIMIT 1)                                            AS institution_name,
         (SELECT count(*) FROM learning.lesson_progress p
           WHERE p.student_id = $1 AND p.course_id = $2 AND p.completed_at IS NOT NULL)
                                                               AS lessons_completed,
         d.lesson_count                                        AS lesson_count
       FROM learning.course_directory d
      WHERE d.course_id = $2`,
      [studentId, courseId],
    );

    const row = rows[0];
    if (!row) return null;

    return {
      // Puede venir vacio, y el caso de uso lo RECHAZA. Aqui no se inventa un
      // valor por defecto: hacerlo dejaria pasar el certificado a nombre de
      // nadie, que es exactamente lo que se quiere impedir.
      studentName: row.student_name ?? '',
      courseTitle: row.course_title,
      kitId: row.kit_id,
      institutionName: row.institution_name,
      lessonsCompleted: Number(row.lessons_completed),
      lessonCount: row.lesson_count,
    };
  }

  async classroomStudents(classroomId: string): Promise<string[]> {
    const { rows } = await this.readPool.query<{ student_id: string }>(
      `SELECT student_id FROM learning.classroom_members
        WHERE classroom_id = $1 AND active
        ORDER BY full_name`,
      [classroomId],
    );
    return rows.map((row) => row.student_id);
  }
}

const C_COLUMNS = `id, serial, student_id, student_name, course_id, course_title, kit_id,
  institution_name, completion, signature, key_fingerprint, issued_at, issued_by,
  revoked_at, revoked_reason`;

interface CertificateDbRow {
  id: string;
  serial: string;
  student_id: string;
  student_name: string;
  course_id: string;
  course_title: string;
  kit_id: string;
  institution_name: string | null;
  completion: number;
  signature: string;
  key_fingerprint: string;
  issued_at: Date;
  issued_by: string | null;
  revoked_at: Date | null;
  revoked_reason: string | null;
}

function toCertificate(row: CertificateDbRow): CertificateRow {
  return {
    id: row.id,
    serial: row.serial,
    studentId: row.student_id,
    studentName: row.student_name,
    courseId: row.course_id,
    courseTitle: row.course_title,
    kitId: row.kit_id,
    institutionName: row.institution_name,
    completion: row.completion,
    // ISO y no `Date`: es lo que se firma, y una fecha formateada por el driver
    // produciria una cadena distinta a la del dia de la emision. La firma
    // dejaria de validar sin que nada estuviera mal.
    issuedAt: row.issued_at.toISOString(),
    signature: row.signature,
    keyFingerprint: row.key_fingerprint,
    issuedBy: row.issued_by,
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
    revokedReason: row.revoked_reason,
  };
}

/**
 * Misiones: el catalogo se lee, el avance se CALCULA.
 *
 * No hay tabla de progreso de misiones y este archivo es donde se ve por que no
 * hace falta: las tres consultas de `factsFor` salen de tablas que ya existen y
 * que ya se mantienen solas. Una tabla mas seria una copia que hay que
 * sincronizar con cada leccion completada.
 */
export class PgMissionRepository implements MissionRepository {
  constructor(
    private readonly readPool: Pool,
  ) {}

  async publishedForKit(kitId: string, institutionId: string | null): Promise<Mission[]> {
    // Las de GLEXCO -que son de todos- mas las de la institucion del alumno.
    // Hoy solo hay de GLEXCO; la condicion esta desde el principio porque
    // anadir el alcance despues significa repasar cada pantalla que ya lee.
    const { rows } = await this.readPool.query<{
      id: string;
      kit_id: string;
      origin: 'glexco' | 'institution';
      institution_id: string | null;
      week_number: number;
      title: string;
      description: string;
      objectives: unknown;
      xp_reward: number;
    }>(
      `SELECT id, kit_id, origin, institution_id, week_number, title, description,
              objectives, xp_reward
         FROM learning.missions
        WHERE kit_id = $1
          AND status = 'published'
          AND (origin = 'glexco' OR institution_id = $2)
        ORDER BY week_number, created_at`,
      [kitId, institutionId],
    );

    return rows.map((row) => ({
      id: row.id,
      kitId: row.kit_id,
      origin: row.origin,
      institutionId: row.institution_id,
      weekNumber: row.week_number,
      title: row.title,
      description: row.description,
      objectives: Array.isArray(row.objectives) ? (row.objectives as Mission['objectives']) : [],
      xpReward: row.xp_reward,
    }));
  }

  async factsFor(studentId: string, kitId: string): Promise<StudentFacts> {
    const [porCurso, aprobadas, resumen] = await Promise.all([
      // Lecciones completadas del kit, agrupadas por curso. Una sola consulta
      // da el total y el desglose: el total es la suma, y pedirlo aparte seria
      // un segundo recorrido de las mismas filas.
      this.readPool.query<{ course_id: string; completadas: string }>(
        `SELECT course_id, count(*)::text AS completadas
           FROM learning.lesson_progress
          WHERE student_id = $1 AND kit_id = $2 AND completed_at IS NOT NULL
          GROUP BY course_id`,
        [studentId, kitId],
      ),

      // Las evaluaciones aprobadas salen de `xp_awards` y no de una llamada al
      // servicio de evaluacion: el hecho "aprobo" ya llego aqui por evento y
      // esta escrito. Preguntarlo por red convertiria la portada en una cadena
      // de llamadas, y la portada es la pantalla que mas se abre.
      this.readPool.query<{ reference: string }>(
        `SELECT reference
           FROM learning.xp_awards
          WHERE student_id = $1 AND reason = 'assessment_passed'`,
        [studentId],
      ),

      this.readPool.query<{ total_xp: number }>(
        `SELECT total_xp FROM learning.student_gamification WHERE student_id = $1`,
        [studentId],
      ),
    ]);

    const lessonsCompletedByCourse: Record<string, number> = {};
    let lessonsCompletedInKit = 0;

    for (const row of porCurso.rows) {
      const cuenta = Number(row.completadas);
      lessonsCompletedByCourse[row.course_id] = cuenta;
      lessonsCompletedInKit += cuenta;
    }

    // Cuando empezo: la PRIMERA actividad del kit, completada o no. Abrir una
    // leccion ya es empezar, y anclar en la primera COMPLETADA castigaria a
    // quien tarda una semana en terminar la primera.
    const { rows: inicio } = await this.readPool.query<{ started_at: Date | null }>(
      `SELECT min(started_at) AS started_at
         FROM learning.lesson_progress
        WHERE student_id = $1 AND kit_id = $2`,
      [studentId, kitId],
    );

    return {
      lessonsCompletedInKit,
      lessonsCompletedByCourse,
      passedAssessmentIds: aprobadas.rows.map((row) => row.reference),
      totalXp: resumen.rows[0]?.total_xp ?? 0,
      startedAt: inicio[0]?.started_at ?? null,
    };
  }

  async completionsFor(studentId: string): Promise<Map<string, Date>> {
    // La fecha de cobro ES la de completado: no hay dos sitios donde vivir.
    const { rows } = await this.readPool.query<{ reference: string; awarded_at: Date }>(
      `SELECT reference, awarded_at
         FROM learning.xp_awards
        WHERE student_id = $1 AND reason = 'mission_completed'`,
      [studentId],
    );

    return new Map(rows.map((row) => [row.reference, row.awarded_at]));
  }
}
