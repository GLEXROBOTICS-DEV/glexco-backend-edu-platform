/**
 * Punto de entrada del servicio de catalogo.
 *
 * La instrumentacion va antes de importar cualquier libreria instrumentada: si
 * se hiciera despues, las trazas saldrian vacias sin dar ningun error.
 */
import { startTracing, stopTracing } from '@glexco/observability';
import { loadCatalogConfig } from './catalog.module';

const config = loadCatalogConfig();

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
import type { Clock, LoggerPort, SecureRandom } from '@glexco/kernel';
import type { Logger } from '@glexco/observability';
import {
  ACTIVATION_CODE_REPOSITORY,
  CatalogModule,
  CLOCK,
  CODE_PEPPER,
  ENTITLEMENT_REPOSITORY,
  KIT_REPOSITORY,
  LOGGER,
  LOGGER_PORT,
  SECURE_RANDOM,
} from './catalog.module';
import { buildCatalogIdentityConsumer } from './interface/events/identity.consumer';
import type {
  ActivationCodeRepository,
  EntitlementRepository,
  KitRepository,
} from './domain/repositories';
/* eslint-enable import/first */

async function main(): Promise<void> {
  let nats: NatsConnection | null = null;
  let outboxRelay: OutboxRelay | null = null;
  let identityConsumer: ReturnType<typeof buildCatalogIdentityConsumer> | null = null;

  const app = await bootstrapService({
    module: CatalogModule,
    serviceName: config.SERVICE_NAME,
    port: config.PORT,
    corsOrigins: config.CORS_ORIGINS,
    globalPrefix: 'api',
    shutdownTimeoutMs: config.SHUTDOWN_TIMEOUT_MS,

    onReady: async (instance) => {
      const writePool = instance.get<Pool>(DB_WRITE_POOL);
      const redis = instance.get<Redis>(REDIS_CLIENT);

      // Si NATS esta caido el servicio sigue atendiendo: los eventos de canje se
      // acumulan en la outbox y salen cuando el bus vuelva. Un alumno que activa
      // su libro no puede quedarse sin acceso porque el bus tenga un mal dia.
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
          schema: 'catalog',
          serviceName: config.SERVICE_NAME,
          lock: new RedisDistributedLock(redis),
        });
        outboxRelay.start();

        // Cierra el flujo del registro: identidad solo COMPRUEBA el codigo -no
        // puede canjearlo sin una transaccion distribuida-, y el canje real
        // ocurre aqui al consumir el alta del alumno.
        identityConsumer = buildCatalogIdentityConsumer({
          connection: nats,
          pool: writePool,
          streamName: config.NATS_STREAM,
          serviceName: config.SERVICE_NAME,
          codes: instance.get<ActivationCodeRepository>(ACTIVATION_CODE_REPOSITORY),
          kits: instance.get<KitRepository>(KIT_REPOSITORY),
          entitlements: instance.get<EntitlementRepository>(ENTITLEMENT_REPOSITORY),
          clock: instance.get<Clock>(CLOCK),
          logger: instance.get<LoggerPort>(LOGGER_PORT),
          pepper: instance.get<string>(CODE_PEPPER),
          ids: instance.get<SecureRandom>(SECURE_RANDOM),
          natsLogger: instance.get<Logger>(LOGGER),
        });
        await identityConsumer.start();
      } catch (error) {
        process.stderr.write(
          `Aviso: no se pudo conectar con NATS al arrancar. Los eventos se acumularan ` +
            `en la outbox y se publicaran cuando el bus vuelva. Detalle: ${String(error)}
`,
        );
      }

      instance.get(HealthController).markReady();
    },

    onShutdown: async () => {
      app.get(HealthController, { strict: false })?.markDraining();

      await identityConsumer?.stop().catch(() => undefined);
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
