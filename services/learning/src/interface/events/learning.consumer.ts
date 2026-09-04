import type { Pool, PoolClient } from 'pg';
import type { NatsConnection } from 'nats';
import { EventConsumer } from '@glexco/nest-platform';
import { EVENTS } from '@glexco/contracts';
import { XP_VALUES, levelFor } from '../../domain/gamification';
import type { LoggerPort } from '@glexco/kernel';
import type { Logger } from '@glexco/observability';

/**
 * Consumidor de learning.
 *
 * Alimenta dos cosas: los directorios que permiten decir "3 de 12" sin
 * preguntarle a catalogo en cada carga, y el XP de las evaluaciones aprobadas.
 *
 * **El XP por evaluacion entra por EVENTO y no por llamada.** Assessment no
 * conoce a learning ni tiene por que: publica que una entrega se corrigio, y
 * quien quiera reaccionar se suscribe. Si assessment llamara a learning al
 * corregir, corregir dejaria de funcionar cuando learning estuviera caido, y
 * corregir es lo que sostiene toda la evaluacion.
 */
export interface LearningConsumerDeps {
  connection: NatsConnection;
  pool: Pool;
  streamName: string;
  serviceName: string;
  logger: LoggerPort;
  natsLogger: Logger;
  uuid(): string;
}

interface SubmissionGradedPayload {
  submissionId: string;
  assessmentId: string;
  studentId: string;
  passed: boolean;
}

interface CoursePublishedPayload {
  courseId: string;
  kitId: string;
  title?: string;
  lessonCount?: number;
  /** Las lecciones vienen DENTRO del evento del curso. Ver la nota del manejador. */
  lessons?: { lessonId: string; title: string; orderIndex: number }[];
}

interface LessonPublishedPayload {
  lessonId: string;
  courseId: string;
  kitId?: string;
  title?: string;
  orderIndex?: number;
}

interface ClassroomCreatedPayload {
  classroomId: string;
  institutionId: string;
  teacherId: string;
}

interface InstitutionCreatedPayload {
  institutionId: string;
  name: string;
}

interface EnrollmentPayload {
  classroomId: string;
  studentId: string;
  fullName?: string;
}

export function buildLearningConsumer(deps: LearningConsumerDeps): EventConsumer {
  const consumer = new EventConsumer({
    connection: deps.connection,
    pool: deps.pool,
    schema: 'learning',
    serviceName: deps.serviceName,
    streamName: deps.streamName,
    subjects: [
      EVENTS.SUBMISSION_GRADED,
      EVENTS.COURSE_PUBLISHED,
      EVENTS.LESSON_PUBLISHED,
      EVENTS.CLASSROOM_CREATED,
      EVENTS.STUDENT_ENROLLED,
      EVENTS.STUDENT_WITHDRAWN,
      EVENTS.INSTITUTION_CREATED,
    ],
    logger: deps.natsLogger,
  });

  // -------------------------------------------------------------------------
  // XP por evaluacion aprobada
  // -------------------------------------------------------------------------
  consumer.on<SubmissionGradedPayload>(EVENTS.SUBMISSION_GRADED, async (event, tx) => {
    const payload = event.payload;

    // Solo al APROBAR. Pagar por entregar premiaria entregar en blanco, que es
    // exactamente el comportamiento que no se quiere fomentar.
    if (!payload.passed) return;

    const client = tx.client as PoolClient;

    // La referencia es la EVALUACION y no la entrega: un alumno con tres
    // intentos aprobados de la misma evaluacion cobra una vez. Con la entrega
    // como referencia, el camino mas rapido para subir de nivel seria reenviar
    // el mismo examen, que no ensena nada.
    const { rowCount } = await client.query(
      `INSERT INTO learning.xp_awards (id, student_id, reason, reference, points)
       VALUES ($1,$2,'assessment_passed',$3,$4)
       ON CONFLICT (student_id, reason, reference) DO NOTHING`,
      [deps.uuid(), payload.studentId, payload.assessmentId, XP_VALUES.assessment_passed],
    );

    if (rowCount === 0) return;

    await refreshSummary(client, payload.studentId);
  });

  // -------------------------------------------------------------------------
  // Directorios de contenido
  // -------------------------------------------------------------------------
  // Sin esto no se puede decir "3 de 12" sin llamar a catalogo en cada carga de
  // la portada, que es la pantalla que mas se abre.
  consumer.on<CoursePublishedPayload>(EVENTS.COURSE_PUBLISHED, async (event, tx) => {
    const payload = event.payload;
    const client = tx.client as PoolClient;
    const lessons = payload.lessons ?? [];

    await client.query(
      `INSERT INTO learning.course_directory (course_id, kit_id, title, lesson_count)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (course_id) DO UPDATE SET
         kit_id       = EXCLUDED.kit_id,
         title        = EXCLUDED.title,
         lesson_count = EXCLUDED.lesson_count,
         updated_at   = now()`,
      [payload.courseId, payload.kitId, payload.title ?? '', payload.lessonCount ?? lessons.length],
    );

    // Las lecciones llegan DENTRO del evento del curso, no como eventos sueltos.
    // Publicar un curso es un solo hecho del negocio, y trocearlo dejaria a este
    // consumidor sin saber cuando termino la tanda: el total de lecciones -que es
    // lo que permite decir "3 de 12"- estaria mal hasta que llegase el ultimo.
    for (const lesson of lessons) {
      await client.query(
        `INSERT INTO learning.lesson_directory (lesson_id, course_id, kit_id, title, order_index)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (lesson_id) DO UPDATE SET
           course_id   = EXCLUDED.course_id,
           kit_id      = EXCLUDED.kit_id,
           title       = EXCLUDED.title,
           order_index = EXCLUDED.order_index,
           updated_at  = now()`,
        [lesson.lessonId, payload.courseId, payload.kitId, lesson.title ?? '', lesson.orderIndex ?? 0],
      );
    }
  });

  consumer.on<LessonPublishedPayload>(EVENTS.LESSON_PUBLISHED, async (event, tx) => {
    const payload = event.payload;
    const client = tx.client as PoolClient;

    await client.query(
      `INSERT INTO learning.lesson_directory (lesson_id, course_id, kit_id, title, order_index)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (lesson_id) DO UPDATE SET
         course_id   = EXCLUDED.course_id,
         title       = EXCLUDED.title,
         order_index = EXCLUDED.order_index,
         updated_at  = now()`,
      [
        payload.lessonId,
        payload.courseId,
        payload.kitId ?? null,
        payload.title ?? '',
        payload.orderIndex ?? 0,
      ],
    );

    // El conteo del curso se DERIVA de las lecciones publicadas, no se toma del
    // evento del curso: es el unico numero que no puede quedarse atras cuando se
    // publica una leccion suelta despues del curso.
    await client.query(
      `UPDATE learning.course_directory
          SET lesson_count = (SELECT count(*) FROM learning.lesson_directory WHERE course_id = $1),
              updated_at   = now()
        WHERE course_id = $1`,
      [payload.courseId],
    );
  });

  // -------------------------------------------------------------------------
  // Salones y matriculas
  // -------------------------------------------------------------------------
  consumer.on<ClassroomCreatedPayload>(EVENTS.CLASSROOM_CREATED, async (event, tx) => {
    // El docente se guarda en las filas de matricula, no en una tabla aparte:
    // la consulta "mis salones" lo necesita en la misma fila y asi se resuelve
    // sin un JOIN mas en la pantalla que abre el docente cada clase.
    await (tx.client as PoolClient).query(
      `UPDATE learning.classroom_members
          SET teacher_id = $2, institution_id = $3, updated_at = now()
        WHERE classroom_id = $1`,
      [event.payload.classroomId, event.payload.teacherId, event.payload.institutionId],
    );
  });

  consumer.on<EnrollmentPayload>(EVENTS.STUDENT_ENROLLED, async (event, tx) => {
    const payload = event.payload;
    await (tx.client as PoolClient).query(
      `INSERT INTO learning.classroom_members (classroom_id, student_id, full_name, active)
       VALUES ($1,$2,$3,true)
       ON CONFLICT (classroom_id, student_id) DO UPDATE SET
         active     = true,
         -- El nombre solo se pisa si el evento trae uno: un evento sin nombre no
         -- puede dejar la lista del docente llena de filas en blanco.
         full_name  = COALESCE(NULLIF(EXCLUDED.full_name, ''), learning.classroom_members.full_name),
         updated_at = now()`,
      [payload.classroomId, payload.studentId, payload.fullName ?? ''],
    );
  });

  consumer.on<EnrollmentPayload>(EVENTS.STUDENT_WITHDRAWN, async (event, tx) => {
    // Baja logica: su progreso sigue siendo cierto y el historico del salon
    // tambien. Solo deja de aparecer en la lista de quien va al dia.
    await (tx.client as PoolClient).query(
      `UPDATE learning.classroom_members
          SET active = false, updated_at = now()
        WHERE classroom_id = $1 AND student_id = $2`,
      [event.payload.classroomId, event.payload.studentId],
    );
  });

  // -------------------------------------------------------------------------
  // Nombre del colegio, para el certificado
  // -------------------------------------------------------------------------
  // `classroom_members` guarda el identificador pero no el nombre, y un
  // certificado que dice "colegio 7d3ab3a7-..." no lo ensena nadie. Llega por
  // evento y no preguntandoselo a instituciones al emitir: eso ataria los dos
  // servicios justo en la operacion que menos puede fallar.
  consumer.on<InstitutionCreatedPayload>(EVENTS.INSTITUTION_CREATED, async (event, tx) => {
    await (tx.client as PoolClient).query(
      `INSERT INTO learning.institution_directory (institution_id, name)
       VALUES ($1,$2)
       ON CONFLICT (institution_id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
      [event.payload.institutionId, event.payload.name],
    );
  });

  return consumer;
}

/**
 * Recalcula el resumen desde los hechos.
 *
 * Duplicado a proposito respecto al repositorio: el consumidor escribe dentro de
 * la transaccion que abrio el propio `EventConsumer` para su marca de
 * deduplicacion, y meter aqui el repositorio obligaria a pasarle esa transaccion
 * a traves de tres capas para una sola consulta.
 */
async function refreshSummary(client: PoolClient, studentId: string): Promise<void> {
  const { rows } = await client.query(
    `SELECT COALESCE(sum(points), 0)::int                             AS total_xp,
            count(*) FILTER (WHERE reason = 'lesson_completed')::int  AS lessons,
            count(*) FILTER (WHERE reason = 'course_completed')::int  AS courses
       FROM learning.xp_awards WHERE student_id = $1`,
    [studentId],
  );

  const totalXp = Number(rows[0]?.total_xp ?? 0);

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
      levelFor(totalXp).level,
      Number(rows[0]?.lessons ?? 0),
      Number(rows[0]?.courses ?? 0),
    ],
  );
}
