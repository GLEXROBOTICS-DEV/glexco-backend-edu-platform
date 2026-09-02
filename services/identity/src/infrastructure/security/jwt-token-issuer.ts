import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { durationToMs, durationToSeconds } from '@glexco/config';
import type { AccessTokenClaims, RefreshTokenClaims } from '@glexco/nest-platform';
import type {
  AccessTokenInput,
  RefreshTokenInput,
  RefreshTokenPayload,
  TokenIssuer,
} from '../../application/ports';

export interface JwtIssuerOptions {
  accessSecret: string;
  refreshSecret: string;
  accessTtl: string;
  refreshTtl: string;
  /** Vida del refresh cuando el usuario NO marca "recordarme". En un aula el
   *  equipo es compartido: una sesion de 30 dias en el ordenador del laboratorio
   *  es un riesgo real, no teorico. */
  shortRefreshTtl: string;
  issuer: string;
  audience: string;
}

/**
 * Emision y verificacion de tokens JWT.
 *
 * Decisiones:
 *
 * - **Secretos distintos** para access y refresh. Con un secreto compartido, un
 *   access token filtrado podria reutilizarse como refresh cambiando su
 *   contenido si en algun momento se relajara la validacion.
 * - **HS256**, no RS256. Todos los servicios son nuestros y comparten red
 *   privada, asi que la ventaja de RS256 (verificar sin poder firmar) no aplica
 *   todavia. Cuando existan integraciones de terceros habra que pasar a RS256 o
 *   EdDSA con JWKS; el puerto `TokenIssuer` aisla ese cambio.
 * - **`algorithms` fijado al verificar**: sin ello, un token con
 *   `"alg": "none"` o firmado con HMAC usando la clave publica seria aceptado.
 *   Es una de las vulnerabilidades clasicas de JWT.
 */
export class JwtTokenIssuer implements TokenIssuer {
  constructor(private readonly options: JwtIssuerOptions) {}

  issueAccessToken(input: AccessTokenInput): { token: string; expiresInSeconds: number } {
    const expiresInSeconds = durationToSeconds(this.options.accessTtl);

    const claims: Omit<AccessTokenClaims, 'iat' | 'exp' | 'iss' | 'aud'> = {
      sub: input.userId,
      sid: input.sessionId,
      roles: input.roles,
      perms: input.permissions,
      loc: input.locale,
      jti: randomUUID(),
      ...(input.institutionId ? { inst: input.institutionId } : {}),
      // Solo se marca cuando corresponde: la ausencia del campo ahorra bytes en
      // los millones de tokens de alumnos, que son la mayoria del trafico.
      ...(input.critical ? { crit: true } : {}),
    };

    const token = jwt.sign(claims, this.options.accessSecret, {
      algorithm: 'HS256',
      expiresIn: expiresInSeconds,
      issuer: this.options.issuer,
      audience: this.options.audience,
    });

    return { token, expiresInSeconds };
  }

  issueRefreshToken(input: RefreshTokenInput): {
    token: string;
    tokenId: string;
    expiresAt: Date;
  } {
    const ttl = input.longLived ? this.options.refreshTtl : this.options.shortRefreshTtl;
    const ttlMs = durationToMs(ttl);
    const tokenId = randomUUID();

    const claims: Omit<RefreshTokenClaims, 'iat' | 'exp' | 'iss' | 'aud'> = {
      sub: input.userId,
      sid: input.sessionId,
      fam: input.familyId,
      jti: tokenId,
    };

    const token = jwt.sign(claims, this.options.refreshSecret, {
      algorithm: 'HS256',
      expiresIn: Math.floor(ttlMs / 1000),
      issuer: this.options.issuer,
      audience: this.options.audience,
    });

    return { token, tokenId, expiresAt: new Date(Date.now() + ttlMs) };
  }

  verifyRefreshToken(token: string): RefreshTokenPayload {
    const claims = jwt.verify(token, this.options.refreshSecret, {
      algorithms: ['HS256'],
      issuer: this.options.issuer,
      audience: this.options.audience,
    }) as RefreshTokenClaims;

    return {
      userId: claims.sub,
      sessionId: claims.sid,
      familyId: claims.fam,
      tokenId: claims.jti,
      expiresAt: new Date(claims.exp * 1000),
    };
  }
}
