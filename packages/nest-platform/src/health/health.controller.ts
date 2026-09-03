import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Optional,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import type { NatsConnection } from 'nats';
import { DB_READ_POOL, DB_WRITE_POOL, poolStats } from '../database/database.provider';
import { REDIS_CLIENT } from '../redis/redis.provider';
import { NATS_CONNECTION } from '../messaging/nats.client';
import { Public } from '../auth/guards';

/**
 * Sondas de salud para el balanceador y el orquestador.
 *
 * La distincion entre las tres es la que hace posible un despliegue sin caida:
 *
 * - `/health/live`   (liveness):  el proceso responde. Si falla, hay que
 *                                 REINICIAR el contenedor. Nunca toca
 *                                 dependencias: si lo hiciera, una caida de
 *                                 Redis provocaria reinicios en bucle de todas
 *                                 las replicas, que es exactamente lo contrario
 *                                 de lo que se quiere.
 *
 * - `/health/ready`  (readiness): el proceso puede atender trafico util. SI
 *                                 comprueba dependencias. Si falla, el
 *                                 balanceador RETIRA la replica sin matarla, y
 *                                 la devuelve cuando se recupera.
 *
 * - `/health/startup`(startup):   el arranque termino. Da margen a migraciones y
 *                                 primeras conexiones sin que liveness mate al
 *                                 proceso por tardar.
 */
/**
 * `VERSION_NEUTRAL` y `@Public()` no son detalles: sin ellos las sondas no
 * sirven para lo que existen.
 *
 * El `exclude` del prefijo global en `bootstrapService` quita el `/api`, pero NO
 * el segmento de version, asi que la ruta quedaba en `/v1/health/live`, que no
 * es la que se configura en el balanceador. Y con los guards globales activos
 * respondia 401: un orquestador no lleva token, de modo que interpretaria cada
 * sonda como replica muerta y reiniciaria el servicio en bucle.
 */
@Controller({ path: 'health', version: VERSION_NEUTRAL })
@Public()
export class HealthController {
  private readonly startedAt = Date.now();
  private ready = false;

  constructor(
    @Optional() @Inject(DB_WRITE_POOL) private readonly writePool?: Pool,
    @Optional() @Inject(DB_READ_POOL) private readonly readPool?: Pool,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
    @Optional() @Inject(NATS_CONNECTION) private readonly nats?: NatsConnection,
  ) {}

  /** Lo marca el bootstrap cuando el arranque completo. */
  markReady(): void {
    this.ready = true;
  }

  /** Lo marca el manejador de SIGTERM: deja de aceptar trafico nuevo mientras
   *  termina el que ya tiene en curso. */
  markDraining(): void {
    this.ready = false;
  }

  @Get('live')
  @HttpCode(HttpStatus.OK)
  live(): { status: 'ok'; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000) };
  }

  @Get('startup')
  async startup(): Promise<{ status: string }> {
    return { status: this.ready ? 'ok' : 'starting' };
  }

  @Get('ready')
  async readiness(): Promise<ReadinessReport> {
    const checks: ReadinessReport['checks'] = {};

    // Las comprobaciones van en paralelo y con timeout propio: una dependencia
    // colgada no debe dejar colgada tambien la sonda, o el balanceador
    // interpretaria un timeout como caida.
    const [db, cache, bus] = await Promise.all([
      this.check('postgres', () => this.writePool?.query('SELECT 1')),
      this.check('redis', () => this.redis?.ping()),
      this.check('nats', async () => {
        if (!this.nats) return undefined;
        if (this.nats.isClosed()) throw new Error('conexion cerrada');
        return undefined;
      }),
    ]);

    checks.postgres = db;
    checks.redis = cache;
    checks.nats = bus;

    if (this.writePool) checks.writePool = { status: 'up', details: poolStats(this.writePool) };
    if (this.readPool) checks.readPool = { status: 'up', details: poolStats(this.readPool) };

    // Postgres es imprescindible. Redis y NATS degradan pero no invalidan: sin
    // cache respondemos mas lento, y sin bus los eventos se acumulan en la
    // outbox y salen despues. Retirar la replica en esos casos solo empeoraria
    // la disponibilidad.
    const healthy = this.ready && checks.postgres?.status !== 'down';

    return {
      status: healthy ? 'ok' : 'unavailable',
      draining: !this.ready,
      checks,
    };
  }

  private async check(
    name: string,
    probe: () => Promise<unknown> | undefined,
  ): Promise<HealthCheck> {
    const started = Date.now();
    try {
      const result = probe();
      if (result === undefined) return { status: 'skipped' };
      await Promise.race([
        result,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2_000)),
      ]);
      return { status: 'up', latencyMs: Date.now() - started };
    } catch (error) {
      return {
        status: 'down',
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
        name,
      };
    }
  }
}

interface HealthCheck {
  status: 'up' | 'down' | 'skipped';
  latencyMs?: number;
  error?: string;
  name?: string;
  details?: Record<string, number>;
}

interface ReadinessReport {
  status: 'ok' | 'unavailable';
  draining: boolean;
  checks: Record<string, HealthCheck | undefined>;
}
