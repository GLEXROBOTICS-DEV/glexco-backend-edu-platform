/**
 * Punto de entrada de engagement.
 *
 * La instrumentacion va antes de importar cualquier libreria instrumentada: si
 * se hiciera despues, las trazas saldrian vacias sin dar ningun error.
 */
import { startTracing, stopTracing } from '@glexco/observability';
import { loadEngagementConfig } from './engagement.module';

const config = loadEngagementConfig();

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
  REDIS_CLIENT,
  RedisDistributedLock,
  createNatsConnection,
  ensureStream,
} from '@glexco/nest-platform';
import type { NatsConnection } from 'nats';
import type { LoggerPort } from '@glexco/kernel';
import type { Logger } from '@glexco/observability';
import { EngagementModule, LOGGER, LOGGER_PORT } from './engagement.module';
import { buildEngagementConsumer } from './interface/events/engagement.consumer';
import { SendAccountEmailUseCase } from './application/send-account-email.usecase';
/* eslint-enable import/first */

async function main(): Promise<void> {
  let nats: NatsConnection | null = null;
  let consumer: ReturnType<typeof buildEngagementConsumer> | null = null;
  let relay: OutboxRelay | null = null;

  const app = await bootstrapService({
    module: EngagementModule,
    serviceName: config.SERVICE_NAME,
    port: config.PORT,
    corsOrigins: config.CORS_ORIGINS,
    globalPrefix: 'api',
    shutdownTimeoutMs: config.SHUTDOWN_TIMEOUT_MS,

    onReady: async (instance) => {
      const writePool = instance.get<Pool>(DB_WRITE_POOL);
      const logger = instance.get<Logger>(LOGGER);

      // Este servicio consume Y publica: consume los eventos de correo y de
      // salon, y publica los suyos de anuncio. Por eso necesita las dos piezas.
      try {
        nats = await createNatsConnection({
          url: config.NATS_URL,
          streamName: config.NATS_STREAM,
          serviceName: config.SERVICE_NAME,
        });
        await ensureStream(nats, config.NATS_STREAM);

        relay = new OutboxRelay({
          pool: writePool,
          jetstream: nats.jetstream(),
          schema: 'engagement',
          serviceName: config.SERVICE_NAME,
          // El cerrojo distribuido evita que N replicas draguen la misma outbox
          // a la vez y publiquen cada fila varias veces.
          lock: new RedisDistributedLock(instance.get<Redis>(REDIS_CLIENT)),
          logger,
        });
        relay.start();

        consumer = buildEngagementConsumer({
          connection: nats,
          pool: writePool,
          streamName: config.NATS_STREAM,
          serviceName: config.SERVICE_NAME,
          sendEmail: instance.get(SendAccountEmailUseCase),
          logger: instance.get<LoggerPort>(LOGGER_PORT),
          natsLogger: logger,
        });
        await consumer.start();
      } catch (error) {
        // Los anuncios se siguen leyendo y publicando: van a la base y a la
        // outbox, que no dependen de NATS. Lo que se detiene es el correo, y se
        // reanuda solo cuando el bus vuelve, porque JetStream conserva lo no
        // confirmado. Nada se pierde; solo se retrasa.
        process.stderr.write(
          `Aviso: no se pudo conectar con NATS al arrancar. Los anuncios siguen ` +
            `funcionando y el correo saldra en cuanto vuelva el bus. ` +
            `Detalle: ${String(error)}\n`,
        );
      }

      instance.get(HealthController).markReady();
    },

    onShutdown: async () => {
      app.get(HealthController, { strict: false })?.markDraining();

      await consumer?.stop().catch(() => undefined);
      await relay?.stop().catch(() => undefined);
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
