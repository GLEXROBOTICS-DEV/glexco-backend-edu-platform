import type { Redis } from 'ioredis';
import type { Session, SessionStore } from '../../domain/session/session';

/**
 * Almacen de sesiones en Redis.
 *
 * Estructura de claves:
 *   session:<sessionId>        HASH con la sesion serializada, con TTL
 *   session:user:<userId>      SET de sesiones del usuario, para cerrarlas todas
 *   session:family:<familyId>  SET de sesiones de una familia de rotacion
 *   revoked:session:<sessionId> marca leida por los guards en sesiones criticas
 *
 * Todo indexado: no hay una sola operacion que necesite `SCAN`, que a escala
 * bloquea Redis.
 */
export class RedisSessionStore implements SessionStore {
  constructor(private readonly redis: Redis) {}

  private static key(sessionId: string): string {
    return `session:${sessionId}`;
  }
  private static userKey(userId: string): string {
    return `session:user:${userId}`;
  }
  private static familyKey(familyId: string): string {
    return `session:family:${familyId}`;
  }
  private static revokedKey(sessionId: string): string {
    return `revoked:session:${sessionId}`;
  }

  async create(session: Session): Promise<void> {
    const ttlSeconds = Math.max(1, Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000));

    const pipeline = this.redis.pipeline();
    pipeline.set(RedisSessionStore.key(session.id), JSON.stringify(session), 'EX', ttlSeconds);
    pipeline.sadd(RedisSessionStore.userKey(session.userId), session.id);
    // El indice por usuario caduca algo despues que la sesion mas larga, para
    // que no quede un conjunto huerfano ocupando memoria indefinidamente.
    pipeline.expire(RedisSessionStore.userKey(session.userId), ttlSeconds + 86_400);
    pipeline.sadd(RedisSessionStore.familyKey(session.familyId), session.id);
    pipeline.expire(RedisSessionStore.familyKey(session.familyId), ttlSeconds + 86_400);
    await pipeline.exec();
  }

  async findById(sessionId: string): Promise<Session | null> {
    const raw = await this.redis.get(RedisSessionStore.key(sessionId));
    return raw ? (JSON.parse(raw) as Session) : null;
  }

  /**
   * Rotacion ATOMICA del refresh token.
   *
   * Debe ser atomica porque dos pestanas del mismo navegador refrescan a la vez
   * con mucha frecuencia. Si esto fuese leer-comparar-escribir en el cliente,
   * ambas leerian el mismo token vigente, ambas escribirian, y la segunda
   * parecerria una reutilizacion: al usuario se le cerraria la sesion sin que
   * nadie le haya robado nada.
   *
   * El script compara y escribe en un solo paso, de modo que la segunda pestana
   * obtiene un `reused` limpio... que seguiria siendo un falso positivo. Por eso
   * ademas se admite el token INMEDIATAMENTE anterior durante una ventana de
   * gracia corta: la carrera legitima ocurre en milisegundos, mientras que un
   * token robado se usa horas o dias despues.
   */
  private static readonly ROTATE_SCRIPT = `
local key            = KEYS[1]
local presented      = ARGV[1]
local next_session   = ARGV[2]
local ttl            = tonumber(ARGV[3])
local grace_ms       = tonumber(ARGV[4])
local now_ms         = tonumber(ARGV[5])

local raw = redis.call('GET', key)
if not raw then return 'not_found' end

local current = cjson.decode(raw)

if current.currentTokenId == presented then
  redis.call('SET', key, next_session, 'EX', ttl)
  return 'rotated'
end

-- Ventana de gracia: se acepta el token anterior si la rotacion acaba de
-- ocurrir. Cubre la carrera entre pestanas sin abrir la puerta a un token
-- robado, que nunca llega dentro de esa ventana.
if current.previousTokenId == presented and current.rotatedAtMs then
  if (now_ms - tonumber(current.rotatedAtMs)) <= grace_ms then
    return 'rotated_grace'
  end
end

return 'reused'
`;

  /** Ventana de gracia para la carrera entre pestanas. */
  private static readonly ROTATION_GRACE_MS = 10_000;

  async rotate(
    sessionId: string,
    presentedTokenId: string,
    next: Session,
  ): Promise<'rotated' | 'reused' | 'not_found'> {
    const ttlSeconds = Math.max(1, Math.floor((Date.parse(next.expiresAt) - Date.now()) / 1000));

    const enriched = {
      ...next,
      previousTokenId: presentedTokenId,
      rotatedAtMs: Date.now(),
    };

    const result = (await this.redis.eval(
      RedisSessionStore.ROTATE_SCRIPT,
      1,
      RedisSessionStore.key(sessionId),
      presentedTokenId,
      JSON.stringify(enriched),
      String(ttlSeconds),
      String(RedisSessionStore.ROTATION_GRACE_MS),
      String(Date.now()),
    )) as string;

    // `rotated_grace` no reescribe la sesion (la pestana ganadora ya lo hizo),
    // pero se trata como exito para no expulsar al usuario.
    if (result === 'rotated' || result === 'rotated_grace') return 'rotated';
    if (result === 'not_found') return 'not_found';
    return 'reused';
  }

  async revoke(sessionId: string): Promise<void> {
    const session = await this.findById(sessionId);

    const pipeline = this.redis.pipeline();
    pipeline.del(RedisSessionStore.key(sessionId));

    if (session) {
      pipeline.srem(RedisSessionStore.userKey(session.userId), sessionId);
      pipeline.srem(RedisSessionStore.familyKey(session.familyId), sessionId);

      // La marca de revocacion sobrevive a la sesion: un access token ya emitido
      // sigue siendo criptograficamente valido hasta 15 minutos despues, y los
      // guards de sesiones criticas consultan esta marca.
      if (session.critical) {
        pipeline.set(RedisSessionStore.revokedKey(sessionId), '1', 'EX', 900);
      }
    }

    await pipeline.exec();
  }

  async revokeFamily(familyId: string): Promise<void> {
    const sessionIds = await this.redis.smembers(RedisSessionStore.familyKey(familyId));
    await Promise.all(sessionIds.map((id) => this.revoke(id)));
    await this.redis.del(RedisSessionStore.familyKey(familyId));
  }

  async revokeAllForUser(userId: string): Promise<void> {
    const sessionIds = await this.redis.smembers(RedisSessionStore.userKey(userId));
    await Promise.all(sessionIds.map((id) => this.revoke(id)));
    await this.redis.del(RedisSessionStore.userKey(userId));
  }

  async listForUser(userId: string): Promise<Session[]> {
    const sessionIds = await this.redis.smembers(RedisSessionStore.userKey(userId));
    if (sessionIds.length === 0) return [];

    const raw = await this.redis.mget(...sessionIds.map((id) => RedisSessionStore.key(id)));

    const sessions: Session[] = [];
    const stale: string[] = [];

    raw.forEach((value, index) => {
      if (value) {
        sessions.push(JSON.parse(value) as Session);
      } else {
        // La sesion caduco sola pero su id sigue en el indice: se limpia de paso.
        stale.push(sessionIds[index]!);
      }
    });

    if (stale.length > 0) {
      await this.redis.srem(RedisSessionStore.userKey(userId), ...stale);
    }

    return sessions;
  }

  async isRevoked(sessionId: string): Promise<boolean> {
    return (await this.redis.exists(RedisSessionStore.revokedKey(sessionId))) === 1;
  }
}
