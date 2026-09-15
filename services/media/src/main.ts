/**
 * Punto de entrada del servicio de medios.
 *
 * La instrumentacion va antes de importar cualquier libreria instrumentada: si
 * se hiciera despues, las trazas saldrian vacias sin dar ningun error.
 */
import { startTracing, stopTracing } from '@glexco/observability';
import { loadMediaConfig } from './media.module';

const config = loadMediaConfig();

startTracing({
  serviceName: config.SERVICE_NAME,
  namespace: config.OTEL_SERVICE_NAMESPACE,
  endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
  enabled: config.OTEL_ENABLED,
});

/* eslint-disable import/first */
import 'reflect-metadata';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import {
  bootstrapService,
  DB_READ_POOL,
  DB_WRITE_POOL,
  HealthController,
  OutboxRelay,
  RedisDistributedLock,
  REDIS_CLIENT,
  createNatsConnection,
  ensureStream,
} from '@glexco/nest-platform';
import type { NatsConnection } from 'nats';
import { AbandonedUploadsTask } from './application/abandoned-uploads.task';
import type { MediaAssetRepository } from './application/ports';
import { MediaModule } from './media.module';
import {
  CLOCK,
  LOGGER_PORT,
  MEDIA_REPOSITORY,
  OBJECT_STORAGE,
  UNIT_OF_WORK,
} from './tokens';
import type { Clock, LoggerPort, ObjectStorage } from '@glexco/kernel';
/* eslint-enable import/first */

async function main(): Promise<void> {
  let nats: NatsConnection | null = null;
  let outboxRelay: OutboxRelay | null = null;
  let cleanupTask: AbandonedUploadsTask | null = null;

  const app = await bootstrapService({
    module: MediaModule,
    serviceName: config.SERVICE_NAME,
    port: config.PORT,
    corsOrigins: config.CORS_ORIGINS,
    globalPrefix: 'api',
    shutdownTimeoutMs: config.SHUTDOWN_TIMEOUT_MS,

    onReady: async (instance) => {
      const writePool = instance.get<Pool>(DB_WRITE_POOL);
      const redis = instance.get<Redis>(REDIS_CLIENT);

      // Si NATS esta caido el servicio sigue aceptando subidas: los eventos se
      // acumulan en la outbox y salen cuando el bus vuelva. Un alumno que
      // entrega su evidencia no puede quedarse sin entregarla porque el bus
      // tenga un mal dia.
      try {
        nats = await createNatsConnection({
          url: config.NATS_URL,
          streamName: config.NATS_STREAM,
          serviceName: config.SERVICE_NAME,
        });
        await ensureStream(nats, config.NATS_STREAM);

        outboxRelay = new OutboxRelay({
          pool: writePool,
          jetstream: nats.jetstream(),
          schema: 'media',
          serviceName: config.SERVICE_NAME,
          lock: new RedisDistributedLock(redis),
        });
        outboxRelay.start();
      } catch (error) {
        process.stderr.write(
          `Aviso: no se pudo conectar con NATS al arrancar. Los eventos se acumularan ` +
            `en la outbox y se publicaran cuando el bus vuelva. Detalle: ${String(error)}\n`,
        );
      }

      // Limpieza de subidas abandonadas. `listAbandoned` llevaba fases escrito
      // sin que lo llamara nadie, asi que las filas en `pending` -y los objetos
      // que si llegaron al bucket- se acumulaban indefinidamente. El cerrojo
      // distribuido garantiza que solo una replica la ejecute.
      cleanupTask = new AbandonedUploadsTask(
        instance.get<MediaAssetRepository>(MEDIA_REPOSITORY),
        instance.get<ObjectStorage>(OBJECT_STORAGE),
        instance.get(UNIT_OF_WORK),
        new RedisDistributedLock(redis),
        instance.get<Clock>(CLOCK),
        instance.get<LoggerPort>(LOGGER_PORT),
      );
      cleanupTask.start();

      instance.get(HealthController).markReady();
    },

    onShutdown: async () => {
      app.get(HealthController, { strict: false })?.markDraining();

      cleanupTask?.stop();
      await outboxRelay?.stop().catch(() => undefined);
      await nats?.drain().catch(() => undefined);

      await app.get<Pool>(DB_WRITE_POOL, { strict: false })?.end().catch(() => undefined);
      await app.get<Pool>(DB_READ_POOL, { strict: false })?.end().catch(() => undefined);
      app.get<Redis>(REDIS_CLIENT, { strict: false })?.disconnect();

      await stopTracing().catch(() => undefined);
    },
  });

  return void app;
}

void main();
