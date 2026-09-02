import type { Pool } from 'pg';
import { headers, type JetStreamClient } from 'nats';
import type { DistributedLock } from '@glexco/kernel';
import type { Logger } from '@glexco/observability';

/**
 * Publicador de la outbox transaccional.
 *
 * Lee los eventos que los casos de uso dejaron en `<schema>.outbox` dentro de su
 * transaccion y los envia a JetStream. Es la segunda mitad del patron outbox: la
 * primera (escribir dato y evento juntos) garantiza que no se pierda nada; esta
 * garantiza que todo acabe publicado, aunque el bus haya estado caido.
 *
 * Decisiones que importan:
 *
 * - `SELECT ... FOR UPDATE SKIP LOCKED`: varias replicas pueden drenar la misma
 *   outbox en paralelo sin procesar la misma fila dos veces y sin esperarse.
 * - `Nats-Msg-Id`: JetStream deduplica dentro de su ventana, asi que un
 *   reintento tras un fallo de red no genera un evento duplicado.
 * - Se publica ANTES de marcar como publicado. El orden inverso perderia
 *   eventos; este orden, en el peor caso, los entrega dos veces, y los
 *   consumidores ya deduplican por `eventId`. Entre perder y duplicar, siempre
 *   duplicar.
 */
export interface OutboxRelayOptions {
  pool: Pool;
  jetstream: JetStreamClient;
  schema: string;
  serviceName: string;
  lock: DistributedLock;
  logger?: Logger;
  /** Cada cuanto se drena la outbox. */
  intervalMs?: number;
  /** Filas por pasada. */
  batchSize?: number;
}

interface OutboxRow {
  id: string;
  event_id: string;
  event_name: string;
  payload: unknown;
  metadata: Record<string, unknown>;
  attempts: number;
}

export class OutboxRelay {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  private readonly intervalMs: number;
  private readonly batchSize: number;

  constructor(private readonly options: OutboxRelayOptions) {
    this.intervalMs = options.intervalMs ?? 1_000;
    this.batchSize = options.batchSize ?? 100;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    // No debe impedir que el proceso termine durante un apagado ordenado.
    this.timer.unref();
    this.options.logger?.info({ schema: this.options.schema }, 'Relay de outbox iniciado');
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Ultimo drenaje antes de cerrar: reduce el retardo de los eventos que se
    // generaron en los ultimos milisegundos de vida de la replica.
    await this.drain().catch(() => undefined);
  }

  private async tick(): Promise<void> {
    // Evita solapes si un drenaje tarda mas que el intervalo.
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      await this.drain();
    } catch (error) {
      this.options.logger?.error({ err: error }, 'Fallo al drenar la outbox');
    } finally {
      this.running = false;
    }
  }

  private async drain(): Promise<void> {
    const { pool, jetstream, schema, logger } = this.options;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { rows } = await client.query<OutboxRow>(
        `SELECT id, event_id, event_name, payload, metadata, attempts
           FROM ${schema}.outbox
          WHERE published_at IS NULL
            AND (next_attempt_at IS NULL OR next_attempt_at <= now())
          ORDER BY created_at
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [this.batchSize],
      );

      if (rows.length === 0) {
        await client.query('COMMIT');
        return;
      }

      const published: string[] = [];
      const failed: Array<{ id: string; attempts: number; error: string }> = [];

      for (const row of rows) {
        try {
          const messageHeaders = headers();
          messageHeaders.set('Nats-Msg-Id', row.event_id);
          const correlationId = row.metadata?.['correlationId'];
          if (typeof correlationId === 'string') {
            messageHeaders.set('X-Correlation-Id', correlationId);
          }

          await jetstream.publish(
            row.event_name,
            Buffer.from(JSON.stringify({ metadata: row.metadata, payload: row.payload })),
            { headers: messageHeaders, timeout: 5_000 },
          );

          published.push(row.id);
        } catch (error) {
          failed.push({
            id: row.id,
            attempts: row.attempts + 1,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (published.length > 0) {
        await client.query(
          `UPDATE ${schema}.outbox SET published_at = now() WHERE id = ANY($1::uuid[])`,
          [published],
        );
      }

      for (const failure of failed) {
        // Backoff exponencial con techo de 5 minutos: un bus caido no debe
        // producir un bucle de reintentos a mil por segundo.
        const delaySeconds = Math.min(2 ** failure.attempts, 300);
        await client.query(
          `UPDATE ${schema}.outbox
              SET attempts = $2,
                  last_error = $3,
                  next_attempt_at = now() + ($4 || ' seconds')::interval
            WHERE id = $1`,
          [failure.id, failure.attempts, failure.error.slice(0, 500), String(delaySeconds)],
        );
      }

      await client.query('COMMIT');

      if (published.length > 0) {
        logger?.debug({ published: published.length, failed: failed.length }, 'Outbox drenada');
      }
      if (failed.length > 0) {
        logger?.warn({ failed: failed.length }, 'Eventos de outbox pendientes de reintento');
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Elimina eventos ya publicados y antiguos.
   *
   * Sin esta limpieza la outbox crece indefinidamente y termina siendo la tabla
   * mas grande de la base. Se ejecuta bajo cerrojo distribuido para que solo una
   * replica borre.
   */
  async purgePublished(olderThanDays = 7): Promise<number> {
    const { pool, schema, lock, logger } = this.options;

    const deleted = await lock.withLock(`outbox:purge:${schema}`, 60_000, async () => {
      const { rowCount } = await pool.query(
        `DELETE FROM ${schema}.outbox
          WHERE published_at IS NOT NULL
            AND published_at < now() - ($1 || ' days')::interval`,
        [String(olderThanDays)],
      );
      return rowCount ?? 0;
    });

    if (deleted && deleted > 0) logger?.info({ deleted }, 'Eventos antiguos de outbox eliminados');
    return deleted ?? 0;
  }
}
