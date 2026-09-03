/**
 * Punto de entrada de learning.
 *
 * La instrumentacion va antes de importar cualquier libreria instrumentada: si
 * se hiciera despues, las trazas saldrian vacias sin dar ningun error.
 */
import { startTracing, stopTracing } from '@glexco/observability';
import { loadLearningConfig } from './learning.module';

const config = loadLearningConfig();

startTracing({
  serviceName: config.SERVICE_NAME,
  namespace: config.OTEL_SERVICE_NAMESPACE,
  endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
  enabled: config.OTEL_ENABLED,
});

/* eslint-disable import/first */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import {
  bootstrapService,
  DB_READ_POOL,
  DB_WRITE_POOL,
  HealthController,
  REDIS_CLIENT,
  createNatsConnection,
  ensureStream,
} from '@glexco/nest-platform';
import type { NatsConnection } from 'nats';
import type { LoggerPort } from '@glexco/kernel';
import type { Logger } from '@glexco/observability';
import { LearningModule, LOGGER, LOGGER_PORT } from './learning.module';
import { buildLearningConsumer } from './interface/events/learning.consumer';
/* eslint-enable import/first */

async function main(): Promise<void> {
  let nats: NatsConnection | null = null;
  let consumer: ReturnType<typeof buildLearningConsumer> | null = null;

  const app = await bootstrapService({
    module: LearningModule,
    serviceName: config.SERVICE_NAME,
    port: config.PORT,
    corsOrigins: config.CORS_ORIGINS,
    globalPrefix: 'api',
    shutdownTimeoutMs: config.SHUTDOWN_TIMEOUT_MS,

    onReady: async (instance) => {
      const writePool = instance.get<Pool>(DB_WRITE_POOL);

      // Este servicio consume y NO publica: el progreso lo escribe quien lo
      // vive, no se anuncia a nadie mas. Por eso no hay outbox que drenar.
      try {
        nats = await createNatsConnection({
          url: config.NATS_URL,
          streamName: config.NATS_STREAM,
          serviceName: config.SERVICE_NAME,
        });
        await ensureStream(nats, config.NATS_STREAM);

        consumer = buildLearningConsumer({
          connection: nats,
          pool: writePool,
          streamName: config.NATS_STREAM,
          serviceName: config.SERVICE_NAME,
          logger: instance.get<LoggerPort>(LOGGER_PORT),
          natsLogger: instance.get<Logger>(LOGGER),
          uuid: () => randomUUID(),
        });
        await consumer.start();
      } catch (error) {
        // El progreso que el alumno escribe -abrir y completar lecciones- sigue
        // funcionando: va por HTTP a la base y no depende de NATS. Lo que se
        // detiene es el XP por evaluacion aprobada, y se pone al dia solo cuando
        // el bus vuelve, porque JetStream conserva lo no confirmado.
        process.stderr.write(
          `Aviso: no se pudo conectar con NATS al arrancar. El progreso por ` +
            `contenido sigue funcionando; el XP de las evaluaciones se pondra al ` +
            `dia cuando vuelva el bus. Detalle: ${String(error)}\n`,
        );
      }

      instance.get(HealthController).markReady();
    },

    onShutdown: async () => {
      app.get(HealthController, { strict: false })?.markDraining();

      await consumer?.stop().catch(() => undefined);
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
