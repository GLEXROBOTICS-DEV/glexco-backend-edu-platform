import type { Pool, PoolClient } from 'pg';
import type { DomainEvent, TransactionContext, UnitOfWork } from '@glexco/kernel';
import { ConcurrencyError } from '@glexco/kernel';
import type { Logger } from '@glexco/observability';
import { getRequestContext } from '@glexco/observability';

/**
 * Contexto de transaccion: envuelve el cliente de PostgreSQL prestado por el
 * pool durante toda la unidad de trabajo.
 *
 * Es importante que los repositorios reciban ESTE cliente y no el pool: si cada
 * repositorio pidiera su propia conexion, las escrituras de un mismo caso de uso
 * caerian en transacciones distintas y un fallo a mitad dejaria el sistema en un
 * estado imposible (por ejemplo, el codigo de activacion consumido pero el
 * alumno sin acceso al kit).
 */
export interface PgTransaction extends TransactionContext {
  readonly client: PoolClient;
  /** Eventos a publicar; se vuelcan a la outbox justo antes del COMMIT. */
  enqueue(...events: DomainEvent[]): void;
}

/** Reintentos ante conflictos de serializacion, que en un sistema concurrente
 *  son normales y no un fallo. */
const MAX_RETRIES = 3;
const RETRYABLE_PG_CODES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
]);

export class PgUnitOfWork implements UnitOfWork {
  constructor(
    private readonly pool: Pool,
    private readonly schema: string,
    private readonly logger?: Logger,
  ) {}

  /**
   * Ejecuta el trabajo dentro de una transaccion, escribe los eventos generados
   * en la outbox y confirma. Todo o nada.
   *
   * El patron outbox es lo que hace fiable la mensajeria entre microservicios:
   * el cambio de estado y el evento se guardan en la MISMA transaccion, asi que
   * es imposible que uno exista sin el otro. Un proceso aparte los publica a
   * NATS despues. La alternativa ingenua -escribir en la base y luego publicar-
   * pierde eventos cada vez que el proceso muere entre ambos pasos, y esos
   * fallos son silenciosos y muy dificiles de diagnosticar.
   */
  async run<T>(work: (tx: PgTransaction) => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      const client = await this.pool.connect();
      const pending: DomainEvent[] = [];

      const tx: PgTransaction = {
        client,
        enqueue: (...events: DomainEvent[]) => {
          pending.push(...events);
        },
      };

      try {
        await client.query('BEGIN');
        const result = await work(tx);

        if (pending.length > 0) await this.writeOutbox(client, pending);

        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        lastError = error;

        if (!isRetryable(error) || attempt === MAX_RETRIES) throw translate(error);

        // Espera con jitter: sin el, las transacciones en conflicto reintentan a
        // la vez y vuelven a chocar.
        const backoffMs = 20 * 2 ** (attempt - 1) + Math.random() * 30;
        this.logger?.warn(
          { attempt, backoffMs },
          'Conflicto de concurrencia en PostgreSQL; se reintenta',
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      } finally {
        client.release();
      }
    }

    throw translate(lastError);
  }

  /**
   * Inserta los eventos en la outbox del servicio.
   *
   * Se guarda el contexto de correlacion para que la traza sobreviva al salto
   * asincrono: el consumidor al otro lado del bus podra enlazar sus logs con la
   * peticion HTTP que origino todo.
   */
  private async writeOutbox(client: PoolClient, events: DomainEvent[]): Promise<void> {
    const correlationId = getRequestContext()?.correlationId ?? null;

    const values: unknown[] = [];
    const rows: string[] = [];

    events.forEach((event, index) => {
      const base = index * 8;
      rows.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`,
      );
      values.push(
        event.metadata.eventId,
        event.metadata.eventName,
        event.metadata.aggregateType,
        event.metadata.aggregateId,
        event.metadata.aggregateVersion,
        JSON.stringify(event.payload),
        JSON.stringify(event.metadata),
        event.metadata.correlationId ?? correlationId,
      );
    });

    await client.query(
      `INSERT INTO ${this.schema}.outbox
         (event_id, event_name, aggregate_type, aggregate_id, aggregate_version,
          payload, metadata, correlation_id)
       VALUES ${rows.join(', ')}
       ON CONFLICT (event_id) DO NOTHING`,
      values,
    );
  }
}

function isRetryable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return typeof code === 'string' && RETRYABLE_PG_CODES.has(code);
}

/**
 * Convierte errores de PostgreSQL en errores de dominio.
 *
 * Se hace aqui, en el borde de la infraestructura, para que ninguna capa
 * superior tenga que conocer codigos SQLSTATE.
 */
function translate(error: unknown): unknown {
  const code = (error as { code?: string } | null)?.code;
  if (code === '40001' || code === '40P01') {
    return new ConcurrencyError('unknown', 'unknown', -1, -1);
  }
  return error;
}
