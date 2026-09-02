import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { DistributedLock, LockHandle } from '@glexco/kernel';

/**
 * Cerrojo distribuido para operaciones que solo una replica debe ejecutar.
 *
 * Casos reales en esta plataforma: drenar la outbox, generar un lote de codigos
 * de activacion, emitir certificados masivos, recalcular el ranking semanal.
 * Sin cerrojo, con seis replicas activas, esas tareas se ejecutarian seis veces.
 *
 * Es un cerrojo sobre una sola instancia de Redis: correcto para coordinar
 * trabajo (evitar duplicados), NO para garantizar exclusion mutua ante un
 * failover. Por eso toda tarea protegida es ademas idempotente: si el cerrojo
 * fallara y se ejecutase dos veces, el resultado seria el mismo.
 */
const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const EXTEND_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

export class RedisDistributedLock implements DistributedLock {
  constructor(private readonly redis: Redis) {}

  async acquire(key: string, ttlMs: number): Promise<LockHandle | null> {
    const lockKey = `lock:${key}`;
    // El token identifica al duenio: sin el, un proceso lento cuyo cerrojo ya
    // caduco liberaria el cerrojo que mientras tanto tomo otro.
    const token = randomUUID();

    const result = await this.redis.set(lockKey, token, 'PX', ttlMs, 'NX');
    if (result !== 'OK') return null;

    return {
      release: async () => {
        await this.redis.eval(RELEASE_SCRIPT, 1, lockKey, token);
      },
      extend: async (extraMs: number) => {
        const extended = await this.redis.eval(EXTEND_SCRIPT, 1, lockKey, token, String(extraMs));
        return extended === 1;
      },
    };
  }

  /** Ejecuta el trabajo solo si consigue el cerrojo. Devuelve `null` si otro lo tiene. */
  async withLock<T>(key: string, ttlMs: number, work: () => Promise<T>): Promise<T | null> {
    const handle = await this.acquire(key, ttlMs);
    if (!handle) return null;
    try {
      return await work();
    } finally {
      await handle.release().catch(() => undefined);
    }
  }
}
