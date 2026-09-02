/**
 * Punto de entrada del servicio de identidad.
 *
 * El ORDEN de este archivo importa: la instrumentacion de OpenTelemetry debe
 * inicializarse ANTES de que se importe cualquier libreria instrumentada
 * (Express, pg, ioredis). Si se hiciera despues, esas librerias ya estarian
 * cargadas y no se les podria enganchar nada: las trazas saldrian vacias sin dar
 * ningun error, que es el peor modo de fallo posible.
 */
import { startTracing, stopTracing } from '@glexco/observability';
import { loadIdentityConfig } from './config';

const config = loadIdentityConfig();

startTracing({
  serviceName: config.SERVICE_NAME,
  namespace: config.OTEL_SERVICE_NAMESPACE,
  endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
  enabled: config.OTEL_ENABLED,
});

// A partir de aqui ya se puede importar lo demas.
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
import { assertProductionSafety } from '@glexco/config';
import type { NatsConnection } from 'nats';
import { AUDIT_LOG, IdentityModule } from './identity.module';
import type { PgAuditLog } from './infrastructure/persistence/pg-audit-log';
/* eslint-enable import/first */

async function main(): Promise<void> {
  // Rechaza secretos de ejemplo y cookies inseguras en produccion.
  assertProductionSafety(config);

  let nats: NatsConnection | null = null;
  let outboxRelay: OutboxRelay | null = null;

  const app = await bootstrapService({
    module: IdentityModule,
    serviceName: config.SERVICE_NAME,
    port: config.PORT,
    corsOrigins: config.CORS_ORIGINS,
    globalPrefix: 'api',
    shutdownTimeoutMs: config.SHUTDOWN_TIMEOUT_MS,

    onReady: async (instance) => {
      const writePool = instance.get<Pool>(DB_WRITE_POOL);
      const redis = instance.get<Redis>(REDIS_CLIENT);

      // La conexion con NATS no bloquea el arranque. Si el bus esta caido, el
      // servicio sigue atendiendo peticiones y los eventos se acumulan en la
      // outbox hasta que vuelva. Abortar el arranque por esto convertiria una
      // caida del bus en una caida total de la autenticacion.
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
          schema: 'identity',
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

      // La sonda de readiness solo empieza a responder OK cuando todo lo
      // imprescindible esta listo. Antes de este punto, el balanceador no debe
      // enviar trafico a esta replica.
      instance.get(HealthController).markReady();
    },

    onShutdown: async () => {
      const health = app.get(HealthController, { strict: false });
      health?.markDraining();

      // Ultimo volcado de auditoria: son escrituras en lote diferido y sin esto
      // se perderian las entradas de los ultimos segundos de vida de la replica.
      const auditLog = app.get<PgAuditLog>(AUDIT_LOG, { strict: false });
      await auditLog?.stop().catch(() => undefined);

      await outboxRelay?.stop().catch(() => undefined);
      await nats?.drain().catch(() => undefined);

      // Los pools se cierran al final: la auditoria y la outbox los necesitan
      // durante su propio cierre.
      await app.get<Pool>(DB_WRITE_POOL, { strict: false })?.end().catch(() => undefined);
      await app.get<Pool>(DB_READ_POOL, { strict: false })?.end().catch(() => undefined);
      app.get<Redis>(REDIS_CLIENT, { strict: false })?.disconnect();

      await stopTracing().catch(() => undefined);
    },
  });

  return void app;
}

void main();
