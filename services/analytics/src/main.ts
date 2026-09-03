/**
 * Punto de entrada del servicio de analitica.
 *
 * La instrumentacion va antes de importar cualquier libreria instrumentada: si
 * se hiciera despues, las trazas saldrian vacias sin dar ningun error.
 */
import { startTracing, stopTracing } from '@glexco/observability';
import { loadAnalyticsConfig } from './analytics.module';

const config = loadAnalyticsConfig();

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
  REDIS_CLIENT,
  createNatsConnection,
  ensureStream,
} from '@glexco/nest-platform';
import type { NatsConnection } from 'nats';
import type { LoggerPort } from '@glexco/kernel';
import type { Logger } from '@glexco/observability';
import {
  AnalyticsModule,
  LOGGER,
  LOGGER_PORT,
  PROJECTION_REPOSITORY,
} from './analytics.module';
import { buildAnalyticsConsumer } from './interface/events/analytics.consumer';
import type { AnalyticsProjectionRepository } from './application/projections';
/* eslint-enable import/first */

async function main(): Promise<void> {
  let nats: NatsConnection | null = null;
  let consumer: ReturnType<typeof buildAnalyticsConsumer> | null = null;

  const app = await bootstrapService({
    module: AnalyticsModule,
    serviceName: config.SERVICE_NAME,
    port: config.PORT,
    corsOrigins: config.CORS_ORIGINS,
    globalPrefix: 'api',
    shutdownTimeoutMs: config.SHUTDOWN_TIMEOUT_MS,

    onReady: async (instance) => {
      const writePool = instance.get<Pool>(DB_WRITE_POOL);

      // Este servicio NO publica eventos, solo los consume: no hay outbox que
      // drenar. Y si NATS esta caido, los dashboards se quedan con los datos
      // que ya tenian en vez de dejar de responder: son proyecciones, y una
      // cifra de hace diez minutos sigue siendo util.
      try {
        nats = await createNatsConnection({
          url: config.NATS_URL,
          streamName: config.NATS_STREAM,
          serviceName: config.SERVICE_NAME,
        });
        await ensureStream(nats, config.NATS_STREAM);

        consumer = buildAnalyticsConsumer({
          connection: nats,
          pool: writePool,
          streamName: config.NATS_STREAM,
          serviceName: config.SERVICE_NAME,
          projections: instance.get<AnalyticsProjectionRepository>(PROJECTION_REPOSITORY),
          logger: instance.get<LoggerPort>(LOGGER_PORT),
          natsLogger: instance.get<Logger>(LOGGER),
        });
        await consumer.start();
      } catch (error) {
        process.stderr.write(
          `Aviso: no se pudo conectar con NATS al arrancar. Los dashboards seguiran ` +
            `sirviendo los datos ya proyectados y se pondran al dia cuando el bus ` +
            `vuelva. Detalle: ${String(error)}\n`,
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
