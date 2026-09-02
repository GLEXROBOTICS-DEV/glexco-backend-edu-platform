import type { Redis } from 'ioredis';
import type { CacheStore } from '@glexco/kernel';
import type { Logger } from '@glexco/observability';

/**
 * Cache distribuida sobre Redis, patron cache-aside con invalidacion por
 * etiquetas.
 *
 * Por que etiquetas y no solo claves: cuando un administrador GLEXCO edita un
 * video del curso "uKit AI - Zoologico Fantastico", hay que tirar todas las
 * entradas derivadas (la ficha del curso, el listado del kit, el arbol de
 * lecciones, en dos idiomas). Recorrer claves con `KEYS`/`SCAN` en produccion es
 * caro y bloqueante; una etiqueta `course:<id>` resuelve la invalidacion en dos
 * comandos.
 *
 * Regla de uso: la cache guarda proyecciones de LECTURA. Nunca es la fuente de
 * verdad, y todo lo que hay aqui debe poder reconstruirse desde Postgres.
 */
export class RedisCacheStore implements CacheStore {
  /** Cerrojos de estampida: cortos a proposito, solo cubren el hueco de recalculo. */
  private static readonly STAMPEDE_LOCK_TTL_MS = 10_000;
  private static readonly STAMPEDE_WAIT_MS = 50;
  private static readonly STAMPEDE_MAX_WAITS = 40; // 2 segundos como maximo

  constructor(
    private readonly redis: Redis,
    private readonly defaultTtlSeconds: number,
    private readonly logger?: Logger,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch (error) {
      // Un fallo de cache no debe romper la peticion: se degrada a la base.
      this.logger?.warn({ err: error, key }, 'Lectura de cache fallida; se ignora');
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number, tags?: readonly string[]): Promise<void> {
    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    try {
      const pipeline = this.redis.pipeline();
      pipeline.set(key, JSON.stringify(value), 'EX', ttl);

      for (const tag of tags ?? []) {
        const tagKey = RedisCacheStore.tagKey(tag);
        pipeline.sadd(tagKey, key);
        // La etiqueta caduca algo despues que sus entradas, para que el conjunto
        // no crezca indefinidamente si nadie la invalida nunca.
        pipeline.expire(tagKey, ttl + 3600);
      }

      await pipeline.exec();
    } catch (error) {
      this.logger?.warn({ err: error, key }, 'Escritura de cache fallida; se ignora');
    }
  }

  async delete(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.redis.del(...keys);
    } catch (error) {
      this.logger?.warn({ err: error, keys }, 'Borrado de cache fallido');
    }
  }

  /**
   * Invalida todas las entradas etiquetadas.
   *
   * A diferencia de `get`/`set`, un fallo aqui SI se propaga: si no logramos
   * invalidar, los usuarios seguirian viendo contenido retirado, y en esta
   * plataforma eso puede significar mostrar material que un administrador
   * elimino a proposito.
   */
  async invalidateTag(tag: string): Promise<void> {
    const tagKey = RedisCacheStore.tagKey(tag);
    const members = await this.redis.smembers(tagKey);
    if (members.length === 0) {
      await this.redis.del(tagKey);
      return;
    }

    // `keyPrefix` de ioredis se aplica al escribir, pero los miembros del
    // conjunto ya se guardaron sin prefijo, asi que DEL los prefija otra vez
    // correctamente. Se borra por lotes para no bloquear a Redis con un DEL
    // de miles de claves.
    const BATCH = 500;
    for (let i = 0; i < members.length; i += BATCH) {
      await this.redis.del(...members.slice(i, i + BATCH));
    }
    await this.redis.del(tagKey);

    this.logger?.debug({ tag, invalidated: members.length }, 'Etiqueta de cache invalidada');
  }

  /**
   * Cache-aside con proteccion contra estampida.
   *
   * Sin proteccion, cuando caduca la entrada de un curso popular a las 8:00 de
   * la manana, las 300 peticiones simultaneas que llegan van todas a Postgres a
   * calcular lo mismo. Aqui solo una toma el cerrojo y recalcula; las demas
   * esperan brevemente y leen el valor ya escrito.
   */
  async wrap<T>(
    key: string,
    ttlSeconds: number,
    producer: () => Promise<T>,
    tags?: readonly string[],
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const lockKey = `lock:cache:${key}`;
    const acquired = await this.tryAcquire(lockKey);

    if (!acquired) {
      const waited = await this.waitForValue<T>(key);
      if (waited !== null) return waited;
      // El titular del cerrojo fallo o tardo demasiado: calculamos igual, porque
      // devolver un error al usuario seria peor que una consulta duplicada.
      return producer();
    }

    try {
      const value = await producer();
      await this.set(key, value, ttlSeconds, tags);
      return value;
    } finally {
      await this.redis.del(lockKey).catch(() => undefined);
    }
  }

  private async tryAcquire(lockKey: string): Promise<boolean> {
    try {
      const result = await this.redis.set(lockKey, '1', 'PX', RedisCacheStore.STAMPEDE_LOCK_TTL_MS, 'NX');
      return result === 'OK';
    } catch {
      // Si Redis no responde, seguimos adelante sin cerrojo.
      return true;
    }
  }

  private async waitForValue<T>(key: string): Promise<T | null> {
    for (let attempt = 0; attempt < RedisCacheStore.STAMPEDE_MAX_WAITS; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, RedisCacheStore.STAMPEDE_WAIT_MS));
      const value = await this.get<T>(key);
      if (value !== null) return value;
    }
    return null;
  }

  private static tagKey(tag: string): string {
    return `tag:${tag}`;
  }
}

/**
 * Constructores de claves de cache.
 *
 * Centralizarlos evita el error clasico de dos servicios escribiendo la misma
 * clave con formas distintas, y deja documentado que hay cacheado y con que
 * granularidad.
 */
export const CacheKeys = {
  userPermissions: (userId: string) => `perm:user:${userId}`,
  session: (sessionId: string) => `session:${sessionId}`,
  institutionPublic: (institutionId: string) => `inst:pub:${institutionId}`,
  institutionByCode: (code: string) => `inst:code:${code.toUpperCase()}`,
  classroomRoster: (classroomId: string) => `classroom:roster:${classroomId}`,
  courseTree: (courseId: string, locale: string) => `course:tree:${courseId}:${locale}`,
  kitContents: (kitId: string, locale: string) => `kit:contents:${kitId}:${locale}`,
  studentEntitlements: (studentId: string) => `entitlement:student:${studentId}`,
  studentProgress: (studentId: string, courseId: string) => `progress:${studentId}:${courseId}`,
  dashboardInstitution: (institutionId: string, range: string) =>
    `dash:inst:${institutionId}:${range}`,
} as const;

export const CacheTags = {
  user: (userId: string) => `user:${userId}`,
  institution: (institutionId: string) => `institution:${institutionId}`,
  classroom: (classroomId: string) => `classroom:${classroomId}`,
  course: (courseId: string) => `course:${courseId}`,
  kit: (kitId: string) => `kit:${kitId}`,
  content: (contentId: string) => `content:${contentId}`,
} as const;
