import type { Pool, PoolClient } from 'pg';
import type { NatsConnection } from 'nats';
import { EventConsumer } from '@glexco/nest-platform';
import { EVENTS } from '@glexco/contracts';
import type { LoggerPort } from '@glexco/kernel';
import type { Logger } from '@glexco/observability';
import type { AnalyticsProjectionRepository } from '../../application/projections';

/**
 * Consumidor que alimenta las proyecciones de los dashboards.
 *
 * **Todo lo que este servicio sabe entra por aqui.** No consulta ningun otro
 * schema, ni llama a ningun otro servicio: si lo hiciera, un dashboard ataria
 * evaluacion, catalogo e instituciones con un JOIN cruzado y ninguno de los tres
 * podria cambiar su esquema sin romper los informes.
 *
 * Los eventos ya traen lo que hace falta —`kitId`, `origin`, `institutionId` y
 * los fallos por pregunta viajan en `submission.graded`— precisamente para que
 * esa independencia sea posible.
 *
 * El manejador escribe DENTRO de la transaccion que abrio el consumidor para su
 * marca de deduplicacion. Es lo que hace que un evento entregado dos veces no
 * cuente dos veces: la marca y el efecto se confirman juntos o no se confirman.
 */
export interface AnalyticsConsumerDeps {
  connection: NatsConnection;
  pool: Pool;
  streamName: string;
  serviceName: string;
  projections: AnalyticsProjectionRepository;
  logger: LoggerPort;
  natsLogger: Logger;
}

interface SubmissionGradedPayload {
  submissionId: string;
  assessmentId: string;
  studentId: string;
  classroomId: string | null;
  institutionId: string | null;
  kitId: string;
  origin: 'glexco' | 'institution';
  kind: string;
  score: number;
  maxScore: number;
  passed: boolean;
  attemptNumber: number;
  gradedAt: string;
  questionOutcomes?: { questionId: string; missed: boolean }[];
}

interface ClassroomCreatedPayload {
  classroomId: string;
  institutionId: string;
  teacherId: string;
  grade: string;
}

interface ActivationCodeBatchPayload {
  kitId: string;
  total: number;
  distributedTo: string | null;
}

interface ActivationCodeRedeemedPayload {
  kitId: string;
  institutionId?: string;
}

interface InstitutionCreatedPayload {
  institutionId: string;
  code: string;
  name: string;
  shortName: string;
  city: string;
}

interface InstitutionSuspendedPayload {
  institutionId: string;
}

export function buildAnalyticsConsumer(deps: AnalyticsConsumerDeps): EventConsumer {
  const consumer = new EventConsumer({
    connection: deps.connection,
    pool: deps.pool,
    schema: 'analytics',
    serviceName: deps.serviceName,
    streamName: deps.streamName,
    // Solo estos asuntos. La analitica es la tentacion clasica de suscribirse a
    // todo "por si acaso": eso trae millones de eventos de sesion para
    // descartarlos aqui, y convierte el consumidor mas pesado del sistema en el
    // que mas trabajo desperdicia.
    subjects: [
      EVENTS.SUBMISSION_GRADED,
      EVENTS.CLASSROOM_CREATED,
      EVENTS.ACTIVATION_CODE_BATCH_GENERATED,
      EVENTS.ACTIVATION_CODE_REDEEMED,
      EVENTS.INSTITUTION_CREATED,
      EVENTS.INSTITUTION_SUSPENDED,
    ],
    logger: deps.natsLogger,
  });

  // -------------------------------------------------------------------------
  // Entrega corregida -> hechos del alumno, fallos por pregunta y resumenes
  // -------------------------------------------------------------------------
  consumer.on<SubmissionGradedPayload>(EVENTS.SUBMISSION_GRADED, async (event, tx) => {
    const payload = event.payload;
    const gradedAt = new Date(payload.gradedAt);
    const client = tx.client as PoolClient;
    const joined = { client } as unknown as Parameters<
      AnalyticsProjectionRepository['upsertSubmissionFact']
    >[1];

    await deps.projections.upsertSubmissionFact(
      {
        studentId: payload.studentId,
        assessmentId: payload.assessmentId,
        institutionId: payload.institutionId ?? null,
        classroomId: payload.classroomId ?? null,
        kitId: payload.kitId,
        origin: payload.origin,
        kind: payload.kind,
        score: payload.score,
        maxScore: payload.maxScore,
        passed: payload.passed,
        attemptNumber: payload.attemptNumber,
        gradedAt,
      },
      joined,
    );

    // Los fallos por pregunta solo tienen sentido dentro de un salon: es el
    // docente quien pregunta "que falla MI clase". Un alumno independiente no
    // pertenece a ninguno y su respuesta no entra en esta cuenta.
    if (payload.classroomId && payload.questionOutcomes?.length) {
      await deps.projections.recordQuestionOutcomes(
        payload.questionOutcomes.map((outcome) => ({
          assessmentId: payload.assessmentId,
          questionId: outcome.questionId,
          classroomId: payload.classroomId!,
          missed: outcome.missed,
        })),
        joined,
      );
    }

    await deps.projections.refreshRollups(
      { classroomId: payload.classroomId ?? null, institutionId: payload.institutionId ?? null },
      joined,
    );

    await deps.projections.markProjected('submission_graded', gradedAt, joined);
  });

  // -------------------------------------------------------------------------
  // Salon creado -> se aprende quien es su docente y de que grado es
  // -------------------------------------------------------------------------
  // Sin esto, el dashboard de eficacia docente no tendria a quien atribuir cada
  // salon. Es la unica via: el evento de correccion no lleva el docente porque
  // el servicio de evaluacion no lo conoce.
  consumer.on<ClassroomCreatedPayload>(EVENTS.CLASSROOM_CREATED, async (event, tx) => {
    const payload = event.payload;
    const joined = { client: tx.client as PoolClient } as unknown as Parameters<
      AnalyticsProjectionRepository['refreshRollups']
    >[1];

    await deps.projections.refreshRollups(
      {
        classroomId: payload.classroomId,
        institutionId: payload.institutionId,
        teacherId: payload.teacherId,
        grade: payload.grade,
      },
      joined,
    );
  });

  // -------------------------------------------------------------------------
  // Codigos: la metrica comercial
  // -------------------------------------------------------------------------
  // Libros comprados que nadie activo son dinero que el colegio pago y no usa, y
  // la señal mas temprana de que no va a renovar. Se cuenta aqui porque es la
  // unica proyeccion que cruza lo comercial con lo academico.
  consumer.on<ActivationCodeBatchPayload>(
    EVENTS.ACTIVATION_CODE_BATCH_GENERATED,
    async (event, tx) => {
      if (!event.payload.distributedTo) return;

      await (tx.client as PoolClient).query(
        `INSERT INTO analytics.institution_rollups (institution_id, codes_issued)
         VALUES ($1, $2)
         ON CONFLICT (institution_id) DO UPDATE SET
           codes_issued = analytics.institution_rollups.codes_issued + EXCLUDED.codes_issued,
           updated_at   = now()`,
        [event.payload.distributedTo, event.payload.total],
      );
    },
  );

  // -------------------------------------------------------------------------
  // Directorio de instituciones: para que el panel de GLEXCO diga nombres
  // -------------------------------------------------------------------------
  // Sin esto, la vista de plataforma lista la cartera de clientes por UUID. El
  // nombre entra por evento y NO consultando el schema de instituciones: es la
  // regla que sostiene este servicio entero, y ademas el rol de base de datos de
  // analitica no tiene permiso sobre ese schema.
  consumer.on<InstitutionCreatedPayload>(EVENTS.INSTITUTION_CREATED, async (event, tx) => {
    const payload = event.payload;

    await (tx.client as PoolClient).query(
      `INSERT INTO analytics.institution_directory
         (institution_id, code, name, short_name, city)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (institution_id) DO UPDATE SET
         code       = EXCLUDED.code,
         name       = EXCLUDED.name,
         short_name = EXCLUDED.short_name,
         city       = EXCLUDED.city,
         updated_at = now()`,
      [payload.institutionId, payload.code, payload.name, payload.shortName, payload.city ?? ''],
    );
  });

  // Un colegio suspendido NO se borra del directorio: su historico academico
  // sigue existiendo y el panel tiene que poder decir de quien es. Solo cambia
  // de estado, para que la pantalla pueda distinguirlo de un cliente activo.
  consumer.on<InstitutionSuspendedPayload>(EVENTS.INSTITUTION_SUSPENDED, async (event, tx) => {
    await (tx.client as PoolClient).query(
      `UPDATE analytics.institution_directory
          SET status = 'suspended', updated_at = now()
        WHERE institution_id = $1`,
      [event.payload.institutionId],
    );
  });

  consumer.on<ActivationCodeRedeemedPayload>(
    EVENTS.ACTIVATION_CODE_REDEEMED,
    async (event, tx) => {
      if (!event.payload.institutionId) return;

      await (tx.client as PoolClient).query(
        `INSERT INTO analytics.institution_rollups (institution_id, codes_redeemed)
         VALUES ($1, 1)
         ON CONFLICT (institution_id) DO UPDATE SET
           codes_redeemed = analytics.institution_rollups.codes_redeemed + 1,
           updated_at     = now()`,
        [event.payload.institutionId],
      );
    },
  );

  return consumer;
}
