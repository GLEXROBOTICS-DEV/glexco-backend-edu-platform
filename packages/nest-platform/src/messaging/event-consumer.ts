import type { Pool, PoolClient } from 'pg';
import { AckPolicy, DeliverPolicy, type JetStreamClient, type JsMsg } from 'nats';
import type { NatsConnection } from 'nats';
import type { DomainEventMetadata, IntegrationEvent } from '@glexco/kernel';
import { runWithContext, type Logger } from '@glexco/observability';

/**
 * Manejador de un evento de integracion.
 *
 * Recibe el cliente de la transaccion en la que ya se registro la marca de
 * deduplicacion, para que el efecto del evento y esa marca se confirmen juntos.
 */
export type EventHandler<P = unknown> = (
  event: IntegrationEvent<P>,
  tx: { client: PoolClient },
) => Promise<void>;

export interface EventConsumerOptions {
  connection: NatsConnection;
  pool: Pool;
  /** Schema del servicio; ahi vive su tabla `processed_events`. */
  schema: string;
  serviceName: string;
  streamName: string;
  /** Asuntos a los que se suscribe, por ejemplo `identity.user.registered.v1`. */
  subjects: string[];
  logger: Logger;
  /** Entregas antes de dar el mensaje por veneno y apartarlo. */
  maxDeliveries?: number;
}

/**
 * Consumidor de eventos de integracion.
 *
 * Resuelve los tres problemas que tiene cualquier consumidor y que, si se dejan
 * al criterio de cada servicio, se resuelven mal en al menos uno:
 *
 * 1. **Duplicados.** JetStream garantiza at-least-once, asi que el mismo evento
 *    puede llegar dos veces (un ACK perdido, un reinicio a destiempo). La marca
 *    en `processed_events` se inserta EN LA MISMA TRANSACCION que el efecto del
 *    evento: o se aplican los dos, o ninguno. Sin esa atomicidad, marcar antes
 *    perderia eventos y marcar despues los aplicaria dos veces.
 *
 * 2. **Mensajes veneno.** Un evento que siempre falla -por un dato corrupto o un
 *    error nuestro- se reintentaria para siempre y bloquearia la cola detras de
 *    el. Tras `maxDeliveries` se aparta con `term()` y se registra en alto. Es
 *    preferible perder visibilidad de UN evento a detener el flujo entero.
 *
 * 3. **Reintentos que agravan el problema.** El backoff es creciente: si el
 *    fallo viene de una base saturada, reintentar de inmediato la hunde mas.
 */
export class EventConsumer {
  private running = false;
  private readonly maxDeliveries: number;

  constructor(private readonly options: EventConsumerOptions) {
    this.maxDeliveries = options.maxDeliveries ?? 5;
  }

  /** Backoff creciente entre reintentos, en milisegundos. */
  private static readonly BACKOFF_MS = [1_000, 5_000, 15_000, 60_000, 300_000];

  private readonly handlers = new Map<string, EventHandler<never>>();

  /** Registra el manejador de un nombre de evento concreto. */
  on<P>(eventName: string, handler: EventHandler<P>): this {
    this.handlers.set(eventName, handler as EventHandler<never>);
    return this;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const jetstream: JetStreamClient = this.options.connection.jetstream();
    const manager = await this.options.connection.jetstreamManager();

    // Un consumidor duradero por servicio: si el servicio se reinicia, retoma
    // donde iba en vez de volver al principio del stream o saltarse lo perdido.
    const durableName = `${this.options.serviceName}-consumer`;

    const configuration = {
      durable_name: durableName,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      filter_subjects: this.options.subjects,
      max_deliver: this.maxDeliveries,
      // Tiempo que JetStream espera el ACK antes de reentregar. Debe superar con
      // holgura lo que tarda el manejador mas lento, o se reentregaria un evento
      // que en realidad se esta procesando bien.
      ack_wait: 60_000_000_000,
      max_ack_pending: 100,
    };

    // `add` sobre un consumidor duradero que YA existe con otra configuracion
    // falla con "consumer already exists", y ese fallo tumba el arranque entero
    // del consumidor. El caso que lo dispara es el mas normal del mundo: alguien
    // anade un asunto nuevo a `subjects` y despliega.
    //
    // El resultado era especialmente traicionero. El servicio arrancaba, el
    // health check pasaba, y el aviso decia que los dashboards seguirian
    // sirviendo lo ya proyectado "hasta que el bus vuelva" -pero el bus estaba
    // perfectamente-. La proyeccion quedaba muerta hasta que alguien se fijara
    // en que los datos nuevos no aparecian.
    //
    // Se actualiza en su lugar. Actualizar conserva la POSICION del consumidor,
    // asi que no se reprocesa el stream entero ni se pierde lo pendiente; solo
    // cambia el filtro. Borrar y recrear haria una de esas dos cosas segun la
    // politica de entrega, y las dos son peores.
    try {
      await manager.consumers.add(this.options.streamName, configuration);
    } catch (error) {
      if (!isConsumerExists(error)) throw error;

      await manager.consumers.update(this.options.streamName, durableName, configuration);

      this.options.logger.info(
        { durableName, subjects: this.options.subjects },
        'Consumidor ya existente: se actualiza su filtro de asuntos',
      );
    }

    const consumer = await jetstream.consumers.get(this.options.streamName, durableName);
    const messages = await consumer.consume();

    this.options.logger.info(
      { durableName, subjects: this.options.subjects },
      'Consumidor de eventos iniciado',
    );

    void (async () => {
      for await (const message of messages) {
        if (!this.running) break;
        await this.handleMessage(message);
      }
    })();
  }

  private async handleMessage(message: JsMsg): Promise<void> {
    let event: IntegrationEvent;

    try {
      event = JSON.parse(new TextDecoder().decode(message.data)) as IntegrationEvent;
    } catch (error) {
      // Un mensaje que ni siquiera es JSON no va a mejorar con reintentos.
      this.options.logger.error(
        { err: error, subject: message.subject },
        'Evento ilegible; se descarta',
      );
      message.term();
      return;
    }

    const metadata = event.metadata as DomainEventMetadata;
    const handler = this.handlers.get(metadata.eventName);

    if (!handler) {
      // Suscrito por patron a algo que no manejamos: se confirma para no
      // acumular pendientes.
      message.ack();
      return;
    }

    // El identificador de correlacion del evento se propaga al procesarlo, de
    // modo que los logs del consumidor se pueden enlazar con los de la peticion
    // HTTP original que lo provoco.
    await runWithContext(
      { correlationId: metadata.correlationId ?? metadata.eventId },
      async () => {
        try {
          const applied = await this.applyOnce(metadata, event, handler);

          message.ack();

          if (applied) {
            this.options.logger.debug(
              { eventName: metadata.eventName, eventId: metadata.eventId },
              'Evento procesado',
            );
          }
        } catch (error) {
          await this.handleFailure(message, metadata, error);
        }
      },
    );
  }

  /**
   * Aplica el evento exactamente una vez.
   *
   * La insercion en `processed_events` va primero DENTRO de la transaccion: si
   * el evento ya estaba, `ON CONFLICT DO NOTHING` no afecta filas y se sale sin
   * ejecutar el manejador. Como todo comparte transaccion, un fallo del
   * manejador deshace tambien la marca y el evento se reintentara.
   */
  private async applyOnce(
    metadata: DomainEventMetadata,
    event: IntegrationEvent,
    handler: EventHandler<never>,
  ): Promise<boolean> {
    const client = await this.options.pool.connect();

    try {
      await client.query('BEGIN');

      const { rowCount } = await client.query(
        `INSERT INTO ${this.options.schema}.processed_events (event_id, event_name)
         VALUES ($1, $2)
         ON CONFLICT (event_id) DO NOTHING`,
        [metadata.eventId, metadata.eventName],
      );

      if (rowCount === 0) {
        // Ya procesado. Se confirma sin volver a aplicar el efecto.
        await client.query('ROLLBACK');
        return false;
      }

      await handler(event as never, { client });
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async handleFailure(
    message: JsMsg,
    metadata: DomainEventMetadata,
    error: unknown,
  ): Promise<void> {
    const deliveries = message.info.redeliveryCount;

    if (deliveries >= this.maxDeliveries) {
      // Mensaje veneno: se aparta para que no bloquee la cola. Se registra en
      // nivel error porque exige intervencion humana.
      this.options.logger.error(
        {
          err: error,
          eventId: metadata.eventId,
          eventName: metadata.eventName,
          deliveries,
        },
        'Evento apartado tras agotar los reintentos; requiere revision manual',
      );
      message.term();
      return;
    }

    const delay =
      EventConsumer.BACKOFF_MS[Math.min(deliveries, EventConsumer.BACKOFF_MS.length - 1)]!;

    this.options.logger.warn(
      { err: error, eventId: metadata.eventId, eventName: metadata.eventName, deliveries, delay },
      'Fallo al procesar evento; se reintentara',
    );

    message.nak(delay);
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  /**
   * Purga marcas de deduplicacion antiguas.
   *
   * Pasado el periodo de retencion del stream, un evento ya no puede volver a
   * entregarse y su marca solo ocupa espacio. Sin esta limpieza la tabla crece
   * sin limite: es una fila por evento procesado, para siempre.
   */
  async purgeProcessedEvents(olderThanDays = 30): Promise<number> {
    const { rowCount } = await this.options.pool.query(
      `DELETE FROM ${this.options.schema}.processed_events
        WHERE processed_at < now() - ($1 || ' days')::interval`,
      [String(olderThanDays)],
    );
    return rowCount ?? 0;
  }
}

/**
 * Distingue "ese consumidor ya existe" de cualquier otro fallo de NATS.
 *
 * Se compara por el codigo de la API de JetStream (10148) y, como respaldo, por
 * el texto. El codigo es lo estable; el texto cambia entre versiones del
 * servidor, pero comprobar solo el codigo dejaria de funcionar con un cliente
 * que no lo propague, y este es un camino que solo se recorre en un despliegue.
 */
function isConsumerExists(error: unknown): boolean {
  const asRecord = error as { api_error?: { err_code?: number }; message?: string };
  if (asRecord?.api_error?.err_code === 10148) return true;
  return /consumer already exists/i.test(asRecord?.message ?? '');
}
