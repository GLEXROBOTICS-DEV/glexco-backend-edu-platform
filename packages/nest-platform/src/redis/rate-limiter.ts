import type { Redis } from 'ioredis';

/**
 * Limitacion de peticiones distribuida, con ventana deslizante.
 *
 * Debe vivir en Redis y no en memoria del proceso: con N replicas detras de un
 * balanceador, un contador local permitiria N veces el limite real, y ademas se
 * perderia en cada despliegue.
 *
 * Se usa ventana deslizante en vez de ventana fija porque la fija permite el
 * doble del limite en la frontera: con "10 por minuto", un atacante manda 10 a
 * las 12:00:59 y 10 mas a las 12:01:00.
 *
 * Implementado como script Lua para que la comprobacion y el incremento sean
 * atomicos. Con dos comandos separados, dos replicas que evaluan a la vez leen
 * el mismo contador y ambas dejan pasar.
 */
const SLIDING_WINDOW_SCRIPT = `
local key        = KEYS[1]
local now_ms     = tonumber(ARGV[1])
local window_ms  = tonumber(ARGV[2])
local limit      = tonumber(ARGV[3])
local member     = ARGV[4]

-- Descarta lo que ya salio de la ventana.
redis.call('ZREMRANGEBYSCORE', key, 0, now_ms - window_ms)

local used = redis.call('ZCARD', key)
if used >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry_after_ms = window_ms
  if oldest[2] then
    retry_after_ms = (tonumber(oldest[2]) + window_ms) - now_ms
  end
  return { 0, used, math.max(retry_after_ms, 0) }
end

redis.call('ZADD', key, now_ms, member)
-- El TTL evita que una clave sin trafico quede para siempre ocupando memoria.
redis.call('PEXPIRE', key, window_ms)
return { 1, used + 1, 0 }
`;

export interface RateLimitResult {
  allowed: boolean;
  used: number;
  limit: number;
  retryAfterSeconds: number;
}

export class RateLimiter {
  private scriptSha: string | null = null;

  constructor(private readonly redis: Redis) {}

  /**
   * @param key       Identidad del sujeto limitado (ip, usuario, codigo).
   * @param limit     Peticiones permitidas dentro de la ventana.
   * @param windowMs  Tamano de la ventana.
   */
  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;

    try {
      const raw = (await this.evaluate(`rl:${key}`, [
        String(now),
        String(windowMs),
        String(limit),
        member,
      ])) as [number, number, number];

      return {
        allowed: raw[0] === 1,
        used: raw[1],
        limit,
        retryAfterSeconds: Math.ceil(raw[2] / 1000),
      };
    } catch {
      // Fail-open deliberado. Si Redis cae, bloquear todo el trafico convertiria
      // una degradacion de cache en una caida total del servicio. Los limites
      // duros de verdad (WAF y balanceador) siguen delante nuestro.
      return { allowed: true, used: 0, limit, retryAfterSeconds: 0 };
    }
  }

  private async evaluate(key: string, args: string[]): Promise<unknown> {
    // EVALSHA ahorra reenviar el script en cada llamada; si Redis reinicio y ya
    // no lo tiene cargado, lo reenviamos una vez.
    if (!this.scriptSha) {
      this.scriptSha = (await this.redis.script('LOAD', SLIDING_WINDOW_SCRIPT)) as string;
    }
    try {
      return await this.redis.evalsha(this.scriptSha, 1, key, ...args);
    } catch (error) {
      if (error instanceof Error && error.message.includes('NOSCRIPT')) {
        this.scriptSha = (await this.redis.script('LOAD', SLIDING_WINDOW_SCRIPT)) as string;
        return this.redis.evalsha(this.scriptSha, 1, key, ...args);
      }
      throw error;
    }
  }
}

/**
 * Politicas de limitacion por tipo de operacion.
 *
 * Los limites de autenticacion son mucho mas estrictos que los de lectura porque
 * ahi el ataque no es saturar, es adivinar: credenciales, codigos de activacion
 * o tokens de recuperacion.
 */
export const RATE_LIMITS = {
  /** Lectura general autenticada. */
  READ: { limit: 300, windowMs: 60_000 },
  /** Escritura general autenticada. */
  WRITE: { limit: 60, windowMs: 60_000 },
  /** Inicio de sesion, por IP. */
  LOGIN_BY_IP: { limit: 20, windowMs: 60_000 },
  /** Inicio de sesion, por cuenta. Frena el rociado de contrasenas, que reparte
   *  los intentos entre muchas IPs para esquivar el limite anterior. */
  LOGIN_BY_ACCOUNT: { limit: 5, windowMs: 900_000 },
  /** Canje de codigo de libro. Muy estricto: es el vector de fuerza bruta
   *  economicamente interesante, porque un codigo valido vale dinero. */
  ACTIVATION_REDEEM_BY_IP: { limit: 5, windowMs: 3_600_000 },
  ACTIVATION_REDEEM_BY_ACCOUNT: { limit: 10, windowMs: 86_400_000 },
  /** Solicitud de recuperacion de contrasena. */
  PASSWORD_RESET: { limit: 3, windowMs: 3_600_000 },
  /** Registro de cuentas nuevas por IP, contra el alta masiva automatizada. */
  REGISTRATION_BY_IP: { limit: 10, windowMs: 3_600_000 },
  /** Generacion de URLs prefirmadas de subida. */
  UPLOAD_PRESIGN: { limit: 30, windowMs: 60_000 },
  /** Exportacion de reportes: cada una cuesta CPU y memoria de verdad. */
  REPORT_EXPORT: { limit: 5, windowMs: 300_000 },
} as const;
