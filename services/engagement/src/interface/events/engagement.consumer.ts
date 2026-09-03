import type { Pool, PoolClient } from 'pg';
import type { NatsConnection } from 'nats';
import { EventConsumer } from '@glexco/nest-platform';
import { EVENTS } from '@glexco/contracts';
import type { LoggerPort } from '@glexco/kernel';
import type { Logger } from '@glexco/observability';
import type { SendAccountEmailUseCase } from '../../application/send-account-email.usecase';

/**
 * Consumidor de engagement.
 *
 * Dos trabajos: enviar los correos de cuenta, y mantener el directorio de
 * salones y matriculas que decide quien puede escribir un anuncio y quien lo lee.
 *
 * **El envio de correo NO es transaccional, y no puede serlo.** Un SMTP no
 * participa en una transaccion de PostgreSQL: si el mensaje sale y despues falla
 * la confirmacion del evento, JetStream lo reentrega y el usuario recibe dos
 * correos. Se elige a conciencia el lado seguro de ese dilema: **es preferible
 * un correo duplicado a uno que no llega**. Un duplicado molesta; una cuenta que
 * nadie puede verificar deja al alumno fuera de la plataforma y sin saber por
 * que. Cada enlace nuevo invalida el anterior, asi que el segundo mensaje es el
 * que funciona y el primero deja de servir: el duplicado tampoco confunde.
 */
export interface EngagementConsumerDeps {
  connection: NatsConnection;
  pool: Pool;
  streamName: string;
  serviceName: string;
  sendEmail: SendAccountEmailUseCase;
  logger: LoggerPort;
  natsLogger: Logger;
}

interface EmailDeliveryPayload {
  userId: string;
  email: string;
  firstName: string;
  locale: 'es' | 'en';
  guardianEmail?: string | null;
}

interface ClassroomCreatedPayload {
  classroomId: string;
  institutionId: string;
  teacherId: string;
  grade?: string;
  name?: string;
}

interface ClassroomArchivedPayload {
  classroomId: string;
}

interface TeacherAssignedPayload {
  classroomId: string;
  teacherId: string;
}

interface EnrollmentPayload {
  classroomId: string;
  studentId: string;
}

export function buildEngagementConsumer(deps: EngagementConsumerDeps): EventConsumer {
  const consumer = new EventConsumer({
    connection: deps.connection,
    pool: deps.pool,
    schema: 'engagement',
    serviceName: deps.serviceName,
    streamName: deps.streamName,
    subjects: [
      EVENTS.EMAIL_VERIFICATION_REQUESTED,
      EVENTS.PASSWORD_RESET_REQUESTED,
      EVENTS.CLASSROOM_CREATED,
      EVENTS.CLASSROOM_ARCHIVED,
      EVENTS.TEACHER_ASSIGNED,
      EVENTS.STUDENT_ENROLLED,
      EVENTS.STUDENT_WITHDRAWN,
    ],
    logger: deps.natsLogger,
  });

  // -------------------------------------------------------------------------
  // Correos de cuenta
  // -------------------------------------------------------------------------
  consumer.on<EmailDeliveryPayload>(EVENTS.EMAIL_VERIFICATION_REQUESTED, async (event) => {
    await deps.sendEmail.execute({ kind: 'email_verification', ...event.payload });
  });

  consumer.on<EmailDeliveryPayload>(EVENTS.PASSWORD_RESET_REQUESTED, async (event) => {
    await deps.sendEmail.execute({ kind: 'password_reset', ...event.payload });
  });

  // -------------------------------------------------------------------------
  // Directorio de salones y matriculas
  // -------------------------------------------------------------------------
  // Sin esto habria que llamar a instituciones en cada publicacion y en cada
  // carga del portal, y las dos cosas ocurren en mitad de una clase.
  consumer.on<ClassroomCreatedPayload>(EVENTS.CLASSROOM_CREATED, async (event, tx) => {
    const payload = event.payload;
    await (tx.client as PoolClient).query(
      `INSERT INTO engagement.classroom_directory
         (classroom_id, institution_id, teacher_id, name, grade)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (classroom_id) DO UPDATE SET
         institution_id = EXCLUDED.institution_id,
         teacher_id     = EXCLUDED.teacher_id,
         name           = EXCLUDED.name,
         grade          = EXCLUDED.grade,
         updated_at     = now()`,
      [
        payload.classroomId,
        payload.institutionId,
        payload.teacherId,
        payload.name ?? '',
        payload.grade ?? null,
      ],
    );
  });

  consumer.on<ClassroomArchivedPayload>(EVENTS.CLASSROOM_ARCHIVED, async (event, tx) => {
    // Se marca, no se borra: los anuncios del curso pasado siguen existiendo y
    // tienen que poder atribuirse a su salon.
    await (tx.client as PoolClient).query(
      `UPDATE engagement.classroom_directory
          SET archived = true, updated_at = now()
        WHERE classroom_id = $1`,
      [event.payload.classroomId],
    );
  });

  consumer.on<TeacherAssignedPayload>(EVENTS.TEACHER_ASSIGNED, async (event, tx) => {
    await (tx.client as PoolClient).query(
      `UPDATE engagement.classroom_directory
          SET teacher_id = $2, updated_at = now()
        WHERE classroom_id = $1`,
      [event.payload.classroomId, event.payload.teacherId],
    );
  });

  consumer.on<EnrollmentPayload>(EVENTS.STUDENT_ENROLLED, async (event, tx) => {
    await (tx.client as PoolClient).query(
      `INSERT INTO engagement.classroom_members (classroom_id, student_id, active)
       VALUES ($1,$2,true)
       ON CONFLICT (classroom_id, student_id)
       DO UPDATE SET active = true, updated_at = now()`,
      [event.payload.classroomId, event.payload.studentId],
    );
  });

  consumer.on<EnrollmentPayload>(EVENTS.STUDENT_WITHDRAWN, async (event, tx) => {
    // Baja logica: un alumno que se va deja de ver los anuncios nuevos, pero la
    // fila se conserva porque el historico del salon sigue siendo cierto.
    await (tx.client as PoolClient).query(
      `UPDATE engagement.classroom_members
          SET active = false, updated_at = now()
        WHERE classroom_id = $1 AND student_id = $2`,
      [event.payload.classroomId, event.payload.studentId],
    );
  });

  return consumer;
}
