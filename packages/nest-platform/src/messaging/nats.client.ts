import {
  connect,
  type NatsConnection,
  type JetStreamClient,
  type JetStreamManager,
  RetentionPolicy,
  StorageType,
  DiscardPolicy,
  AckPolicy,
  DeliverPolicy,
  type ConsumerConfig,
} from 'nats';
import type { Logger } from '@glexco/observability';
import { STREAM_SUBJECTS } from '@glexco/contracts';

export const NATS_CONNECTION = Symbol('NATS_CONNECTION');
export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');

/**
 * Bus de eventos: NATS con JetStream.
 *
 * Por que NATS y no Kafka: para nuestro volumen (eventos de dominio, no
 * telemetria masiva) JetStream da persistencia, reintentos y at-least-once con
 * una fraccion del coste operativo. Kafka exige ZooKeeper/KRaft, particiones y
 * ajuste fino; a este tamano seria pagar complejidad sin recibir nada a cambio.
 * Si algun dia la analitica requiere reprocesar meses de eventos, la migracion
 * es sustituir el adaptador, porque los casos de uso solo conocen el puerto
 * `EventPublisher`.
 *
 * Por que JetStream y no NATS core: NATS core es fire-and-forget. Si el
 * consumidor esta reiniciando cuando se publica "codigo canjeado", ese evento se
 * pierde para siempre y el alumno se queda sin acceso al kit. JetStream persiste
 * y reintenta.
 */
export interface NatsOptions {
  url: string;
  streamName: string;
  serviceName: string;
  logger?: Logger;
}

export async function createNatsConnection(options: NatsOptions): Promise<NatsConnection> {
  const connection = await connect({
    servers: options.url,
    name: options.serviceName,
    // Reconexion indefinida: preferimos que el servicio siga en pie publicando a
    // la outbox mientras el bus vuelve, a que muera y deje de atender HTTP.
    maxReconnectAttempts: -1,
    reconnectTimeWait: 1_000,
    // Con jitter, para que 20 replicas no reconecten en el mismo milisegundo y
    // tumben el bus justo cuando se recupera.
    reconnectJitter: 500,
    pingInterval: 20_000,
    timeout: 5_000,
  });

  void (async () => {
    for await (const status of connection.status()) {
      options.logger?.info({ natsStatus: status.type, data: status.data }, 'Estado de NATS');
    }
  })();

  return connection;
}

/**
 * Crea (o actualiza) el stream de eventos.
 *
 * Es idempotente y lo ejecuta cada servicio al arrancar: asi no existe un paso
 * manual de provisionamiento que alguien pueda olvidar al desplegar en un
 * entorno nuevo.
 */
export async function ensureStream(
  connection: NatsConnection,
  streamName: string,
  logger?: Logger,
): Promise<JetStreamManager> {
  const manager = await connection.jetstreamManager();

  const config = {
    name: streamName,
    subjects: [...STREAM_SUBJECTS],
    // Limits: retenemos por tiempo/tamano, no hasta que todos consuman. Un
    // consumidor roto no debe poder llenar el disco del bus.
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    discard: DiscardPolicy.Old,
    // 14 dias da margen de sobra para reprocesar tras un incidente sin que el
    // almacenamiento crezca sin control.
    max_age: 14 * 24 * 60 * 60 * 1_000_000_000, // nanosegundos
    max_bytes: 8 * 1024 * 1024 * 1024,
    max_msg_size: 1 * 1024 * 1024,
    num_replicas: 1, // en produccion, 3 sobre un cluster NATS multi-zona
    // Deduplicacion por `Nats-Msg-Id`: si el relay de la outbox reintenta tras
    // un fallo de red, el evento no se duplica dentro de esta ventana.
    duplicate_window: 2 * 60 * 1_000_000_000,
  };

  try {
    await manager.streams.add(config);
    logger?.info({ stream: streamName }, 'Stream de JetStream creado');
  } catch {
    await manager.streams.update(streamName, config).catch((error) => {
      logger?.warn({ err: error }, 'No se pudo actualizar el stream; se usa el existente');
    });
  }

  return manager;
}

/**
 * Consumidor duradero por servicio y por asunto.
 *
 * Duradero (no efimero) para que al reiniciar una replica se retome donde se
 * quedo. Con cola compartida entre replicas del mismo servicio, cada evento lo
 * procesa UNA sola replica: es lo que permite escalar horizontalmente sin
 * duplicar efectos.
 */
export function durableConsumerConfig(
  serviceName: string,
  filterSubject: string,
): Partial<ConsumerConfig> {
  return {
    durable_name: `${serviceName}-${filterSubject.replace(/[.>*]/g, '_')}`,
    filter_subject: filterSubject,
    ack_policy: AckPolicy.Explicit,
    deliver_policy: DeliverPolicy.All,
    // Ventana amplia: procesar un evento puede implicar varias escrituras.
    ack_wait: 30 * 1_000_000_000,
    // Tras 5 entregas fallidas el mensaje va a la cola de descartados en vez de
    // reintentarse eternamente y bloquear al resto (efecto "poison message").
    max_deliver: 5,
    // Backoff creciente entre reintentos.
    backoff: [1, 5, 15, 60, 300].map((s) => s * 1_000_000_000),
    max_ack_pending: 100,
  };
}

export type { JetStreamClient, NatsConnection };
