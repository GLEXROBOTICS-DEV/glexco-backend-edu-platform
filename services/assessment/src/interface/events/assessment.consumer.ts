import type { Pool, PoolClient } from 'pg';
import type { NatsConnection } from 'nats';
import { EventConsumer } from '@glexco/nest-platform';
import { EVENTS } from '@glexco/contracts';
import type { Logger } from '@glexco/observability';
import type { ClassroomDirectory } from '../../application/directory';

/**
 * Consumidor del servicio de evaluacion.
 *
 * Solo alimenta el directorio de salones, que es lo unico que este servicio
 * necesita saber de fuera: de quien es cada salon, para comprobar el ambito de
 * la bandeja de correccion.
 *
 * Se suscribe a dos asuntos y no a todo el flujo de instituciones. La creacion
 * trae el salon; la actualizacion importa porque un cambio de titular -que
 * ocurre cada curso- dejaria la correccion en manos del docente anterior si no
 * se reflejara aqui.
 *
 * El manejador escribe DENTRO de la transaccion que abrio el consumidor para su
 * marca de deduplicacion. Es lo que hace que un evento entregado dos veces no
 * deje la marca sin la fila ni la fila sin la marca.
 */
export interface AssessmentConsumerDeps {
  connection: NatsConnection;
  pool: Pool;
  streamName: string;
  serviceName: string;
  directory: ClassroomDirectory;
  natsLogger: Logger;
}

interface ClassroomPayload {
  classroomId: string;
  institutionId: string;
  teacherId?: string | null;
  grade?: string | null;
}

export function buildAssessmentConsumer(deps: AssessmentConsumerDeps): EventConsumer {
  const consumer = new EventConsumer({
    connection: deps.connection,
    pool: deps.pool,
    schema: 'assessment',
    serviceName: deps.serviceName,
    streamName: deps.streamName,
    subjects: [EVENTS.CLASSROOM_CREATED, EVENTS.CLASSROOM_UPDATED],
    logger: deps.natsLogger,
  });

  const upsert = async (
    payload: ClassroomPayload,
    tx: { client: unknown },
  ): Promise<void> => {
    await deps.directory.upsert(
      {
        classroomId: payload.classroomId,
        institutionId: payload.institutionId,
        teacherId: payload.teacherId ?? null,
        grade: payload.grade ?? null,
      },
      tx.client as PoolClient,
    );
  };

  consumer.on<ClassroomPayload>(EVENTS.CLASSROOM_CREATED, async (event, tx) => {
    await upsert(event.payload, tx);
  });

  consumer.on<ClassroomPayload>(EVENTS.CLASSROOM_UPDATED, async (event, tx) => {
    // El evento de actualizacion puede no traer titular -si lo que cambio fue
    // el nombre o el aforo-, y el `COALESCE` del upsert conserva el que ya
    // habia. Sobrescribir con `null` dejaria el salon sin docente y su bandeja
    // de correccion inaccesible.
    await upsert(event.payload, tx);
  });

  return consumer;
}
