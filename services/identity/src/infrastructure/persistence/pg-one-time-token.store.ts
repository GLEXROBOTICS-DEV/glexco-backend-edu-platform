import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import type { OneTimeTokenStore } from '../../application/ports';

/**
 * Tokens de un solo uso para verificacion de correo y recuperacion de contrasena.
 *
 * Tres decisiones que importan:
 *
 * 1. **Se guarda el hash, no el token.** El token en claro solo existe en el
 *    correo del usuario. Si alguien obtiene un volcado de la base no puede
 *    reutilizar los enlaces pendientes para tomar cuentas ajenas. Es el mismo
 *    razonamiento que con las contrasenas.
 *
 * 2. **SHA-256 y no Argon2.** Aqui no hace falta un hash lento: el token es
 *    aleatorio de 256 bits, no adivinable por diccionario. Un hash lento solo
 *    anadiria latencia al abrir un enlace de correo.
 *
 * 3. **El consumo es atomico** (`UPDATE ... WHERE consumed_at IS NULL
 *    RETURNING`). Sin eso, dos peticiones simultaneas con el mismo enlace -algo
 *    normal cuando un cliente de correo pre-carga los enlaces- consumirian el
 *    token dos veces.
 */
export class PgOneTimeTokenStore implements OneTimeTokenStore {
  constructor(
    private readonly writePool: Pool,
    private readonly readPool: Pool,
  ) {}

  async issue(input: {
    purpose: 'email_verification' | 'password_reset' | 'guardian_consent';
    userId: string;
    ttlSeconds: number;
  }): Promise<{ token: string }> {
    // 32 bytes = 256 bits de entropia, en base64url para que quepa en una URL
    // sin escapes. Adivinarlo es inviable, asi que no hace falta limitar
    // intentos sobre este endpoint mas alla del limite general.
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);

    // Emitir uno nuevo invalida los anteriores del mismo proposito: si el
    // usuario pide tres veces "recuperar contrasena", solo el ultimo enlace debe
    // funcionar. Dejar varios vivos multiplica la ventana de exposicion.
    await this.writePool.query(
      `UPDATE identity.one_time_tokens
          SET consumed_at = now()
        WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [input.userId, input.purpose],
    );

    await this.writePool.query(
      `INSERT INTO identity.one_time_tokens (user_id, purpose, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + ($4 || ' seconds')::interval)`,
      [input.userId, input.purpose, tokenHash, String(input.ttlSeconds)],
    );

    return { token };
  }

  async consume(purpose: string, token: string): Promise<{ userId: string } | null> {
    const tokenHash = hashToken(token);

    const { rows } = await this.writePool.query<{ user_id: string }>(
      `UPDATE identity.one_time_tokens
          SET consumed_at = now()
        WHERE token_hash = $1
          AND purpose = $2
          AND consumed_at IS NULL
          AND expires_at > now()
        RETURNING user_id`,
      [tokenHash, purpose],
    );

    return rows[0] ? { userId: rows[0].user_id } : null;
  }

  async invalidateAll(purpose: string, userId: string): Promise<void> {
    await this.writePool.query(
      `UPDATE identity.one_time_tokens
          SET consumed_at = now()
        WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [userId, purpose],
    );
  }

  /**
   * Elimina tokens caducados o consumidos hace tiempo.
   *
   * Sin esta limpieza la tabla crece indefinidamente: cada alta genera un token
   * de verificacion y cada olvido de contrasena otro. Se ejecuta de forma
   * periodica bajo cerrojo distribuido.
   */
  async purgeExpired(olderThanDays = 30): Promise<number> {
    const { rowCount } = await this.writePool.query(
      `DELETE FROM identity.one_time_tokens
        WHERE (consumed_at IS NOT NULL AND consumed_at < now() - ($1 || ' days')::interval)
           OR expires_at < now() - ($1 || ' days')::interval`,
      [String(olderThanDays)],
    );
    return rowCount ?? 0;
  }

  /** Comprobacion sin consumir, para previsualizar si un enlace sigue vivo. */
  async peek(purpose: string, token: string): Promise<boolean> {
    const { rows } = await this.readPool.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM identity.one_time_tokens
          WHERE token_hash = $1 AND purpose = $2
            AND consumed_at IS NULL AND expires_at > now()
       ) AS exists`,
      [hashToken(token), purpose],
    );
    return rows[0]?.exists ?? false;
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Comparacion en tiempo constante, por si en el futuro hiciera falta comparar
 * tokens en memoria. La comparacion con `===` filtra informacion por el tiempo
 * que tarda en encontrar la primera diferencia.
 */
export function safeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
