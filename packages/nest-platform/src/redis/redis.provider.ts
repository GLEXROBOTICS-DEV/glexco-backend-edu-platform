import { Redis, type RedisOptions } from 'ioredis';
import type { Logger } from '@glexco/observability';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
export const CACHE_STORE = Symbol('CACHE_STORE');
export const DISTRIBUTED_LOCK = Symbol('DISTRIBUTED_LOCK');

/**
 * Cliente Redis compartido por servicio.
 *
 * Opciones elegidas pensando en varias replicas detras de un balanceador:
 *
 * - `maxRetriesPerRequest: 3` evita que una peticion HTTP quede colgada
 *   indefinidamente cuando Redis no responde; preferimos degradar (ir a la base
 *   de datos) a acumular peticiones y agotar el pool.
 * - `enableOfflineQueue: false` en produccion, para no encolar en memoria
 *   comandos que quizas nunca se envien: esa cola crece sin limite durante un
 *   corte y termina en un OOM justo cuando Redis vuelve.
 * - `keyPrefix` aisla entornos que compartan instancia (util en Railway).
 */
export function createRedisClient(url: string, keyPrefix: string, logger?: Logger): Redis {
  const options: RedisOptions = {
    keyPrefix: `${keyPrefix}:`,
    maxRetriesPerRequest: 3,
    enableOfflineQueue: process.env.NODE_ENV !== 'production',
    connectTimeout: 5_000,
    // Backoff exponencial con techo: reconecta rapido en un parpadeo de red y
    // deja de martillear si el corte es largo.
    retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
    reconnectOnError: (error) => {
      // READONLY llega cuando una replica es promovida durante un failover:
      // conviene reconectar para hablar con el nuevo primario.
      if (error.message.includes('READONLY')) return 2;
      return false;
    },
    lazyConnect: false,
  };

  const client = new Redis(url, options);

  client.on('error', (error) => {
    // No relanzamos: un fallo de cache degrada el rendimiento, no la correccion.
    logger?.warn({ err: error }, 'Fallo de conexion con Redis');
  });
  client.on('reconnecting', () => logger?.info('Reconectando con Redis'));
  client.on('ready', () => logger?.info('Redis listo'));

  return client;
}
