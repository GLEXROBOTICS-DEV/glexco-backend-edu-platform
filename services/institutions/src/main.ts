/**
 * Punto de entrada del servicio de instituciones.
 *
 * Igual que en identidad, la instrumentacion de OpenTelemetry se inicializa
 * ANTES de importar cualquier libreria instrumentada. Si se hiciera despues, las
 * trazas saldrian vacias sin dar ningun error: el peor modo de fallo posible.
 */
import { startTracing, stopTracing } from '@glexco/observability';
import { loadInstitutionsConfig } from './institutions.module';

const config = loadInstitutionsConfig();

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
import type { Logger } from '@glexco/observability';
import type { Clock, LoggerPort } from '@glexco/kernel';
import {
  CLASSROOM_REPOSITORY,
  CLOCK,
  INSTITUTION_REPOSITORY,
  InstitutionsModule,
  LOGGER,
  LOGGER_PORT,
  STUDENT_DIRECTORY,
  TEACHER_DIRECTORY,
  UNIT_OF_WORK,
} from './institutions.module';
import { buildIdentityConsumer } from './interface/events/identity.consumer';
import { LicenseMaintenanceTask } from './application/license-maintenance.task';
import type {
  ClassroomRepository,
  InstitutionRepository,
  StudentDirectory,
  TeacherDirectory,
} from './domain/repositories';
/* eslint-enable import/first */

async function main(): Promise<void> {
  let nats: NatsConnection | null = null;
  let outboxRelay: OutboxRelay | null = null;
  let identityConsumer: Awaited<ReturnType<typeof buildIdentityConsumer>> | null = null;
  let licenseTask: LicenseMaintenanceTask | null = null;

  const app = await bootstrapService({
    module: InstitutionsModule,
    serviceName: config.SERVICE_NAME,
    port: config.PORT,
    corsOrigins: config.CORS_ORIGINS,
    globalPrefix: 'api',
    shutdownTimeoutMs: config.SHUTDOWN_TIMEOUT_MS,

    onReady: async (instance) => {
      const writePool = instance.get<Pool>(DB_WRITE_POOL);
      const redis = instance.get<Redis>(REDIS_CLIENT);

      // NATS no bloquea el arranque: si el bus esta caido, los eventos se
      // acumulan en la outbox y salen cuando vuelva. Abortar por esto convertiria
      // una caida del bus en una caida del servicio.
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
          schema: 'institutions',
          serviceName: config.SERVICE_NAME,
          lock: new RedisDistributedLock(redis),
        });
        outboxRelay.start();

        // Consumidor de los eventos de identidad: es lo que hace que un alumno
        // que se registra aparezca matriculado en su salon sin que ninguno de
        // los dos servicios llame al otro de forma sincrona.
        identityConsumer = buildIdentityConsumer({
          connection: nats,
          pool: writePool,
          streamName: config.NATS_STREAM,
          serviceName: config.SERVICE_NAME,
          classrooms: instance.get<ClassroomRepository>(CLASSROOM_REPOSITORY),
          institutions: instance.get<InstitutionRepository>(INSTITUTION_REPOSITORY),
          teachers: instance.get<TeacherDirectory>(TEACHER_DIRECTORY),
          students: instance.get<StudentDirectory>(STUDENT_DIRECTORY),
          clock: instance.get<Clock>(CLOCK),
          logger: instance.get<LoggerPort>(LOGGER_PORT),
          natsLogger: instance.get<Logger>(LOGGER),
        });
        await identityConsumer.start();
      } catch (error) {
        process.stderr.write(
          `Aviso: no se pudo conectar con NATS al arrancar. Los eventos se acumularan ` +
            `en la outbox y se publicaran cuando el bus vuelva. Detalle: ${String(error)}\n`,
        );
      }

      // Mantenimiento de licencias. El cerrojo distribuido garantiza que solo
      // una replica la ejecute: sin el, N replicas emitirian N avisos de
      // vencimiento por licencia, es decir, N correos al mismo cliente.
      licenseTask = new LicenseMaintenanceTask(
        instance.get<InstitutionRepository>(INSTITUTION_REPOSITORY),
        instance.get(UNIT_OF_WORK),
        new RedisDistributedLock(redis),
        instance.get<Clock>(CLOCK),
        instance.get<LoggerPort>(LOGGER_PORT),
      );
      licenseTask.start();

      instance.get(HealthController).markReady();
    },

    onShutdown: async () => {
      app.get(HealthController, { strict: false })?.markDraining();

      licenseTask?.stop();
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
