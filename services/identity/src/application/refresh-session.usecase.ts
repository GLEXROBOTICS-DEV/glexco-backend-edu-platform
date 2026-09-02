import {
  UnauthorizedError,
  type Clock,
  type ExecutionContext,
  type LoggerPort,
  type UseCase,
} from '@glexco/kernel';
import type { AuthResult } from '@glexco/contracts';
import type { UserRepository } from '../domain/user/user.repository';
import { UserId } from '../domain/user/value-objects';
import type { Session, SessionStore } from '../domain/session/session';
import type { AuditLog, TokenIssuer } from './ports';
import { resolvePortal } from './resolve-portal';

export interface RefreshSessionInput {
  refreshToken: string;
}

export interface RefreshSessionOutput {
  auth: AuthResult;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

/**
 * Renueva el access token rotando el refresh token.
 *
 * ROTACION CON DETECCION DE REUTILIZACION (OAuth 2.1):
 *
 * Cada refresco emite un token nuevo e invalida el anterior. Si llega un token
 * que YA fue rotado, solo hay dos explicaciones:
 *
 *   a) alguien copio el token (malware, historial compartido, proxy hostil), o
 *   b) hay una condicion de carrera legitima entre dos pestanas.
 *
 * No podemos distinguirlas, asi que se asume lo peor y se revoca la FAMILIA
 * entera: tanto el atacante como el usuario legitimo quedan fuera, y el usuario
 * vuelve a autenticarse. Es incomodo, pero la alternativa -confiar- deja una
 * sesion robada activa durante 30 dias.
 *
 * El caso (b) se mitiga en el almacen: `rotate` es atomico, de modo que dos
 * pestanas que refrescan a la vez producen una rotacion y un rechazo limpio, no
 * una falsa alarma de robo.
 *
 * Ademas se recargan roles y permisos del usuario en cada refresco. Es lo que
 * hace que un cambio de rol se propague en 15 minutos como maximo sin que
 * ningun otro servicio tenga que consultar a identidad en cada peticion.
 */
export class RefreshSessionUseCase implements UseCase<RefreshSessionInput, RefreshSessionOutput> {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionStore,
    private readonly tokens: TokenIssuer,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
    private readonly logger: LoggerPort,
  ) {}

  async execute(
    input: RefreshSessionInput,
    context: ExecutionContext,
  ): Promise<RefreshSessionOutput> {
    const now = this.clock.now();

    let payload: Awaited<ReturnType<TokenIssuer['verifyRefreshToken']>>;
    try {
      payload = this.tokens.verifyRefreshToken(input.refreshToken);
    } catch {
      throw sessionExpired();
    }

    const nextRefresh = this.tokens.issueRefreshToken({
      userId: payload.userId,
      sessionId: payload.sessionId,
      familyId: payload.familyId,
      // Se conserva la vida original de la sesion: rotar no debe alargarla
      // indefinidamente, o una sesion "recordarme" de 30 dias se volveria eterna
      // mientras alguien la refresque.
      longLived: false,
    });

    const existing = await this.sessions.findById(payload.sessionId);
    if (!existing) throw sessionExpired();

    const rotated: Session = {
      ...existing,
      currentTokenId: nextRefresh.tokenId,
      generation: existing.generation + 1,
      lastUsedAt: now.toISOString(),
      // La caducidad no se extiende: se mantiene la de la sesion original.
      expiresAt: existing.expiresAt,
      ipAddress: context.ipAddress ?? existing.ipAddress,
      userAgent: context.userAgent ?? existing.userAgent,
    };

    const result = await this.sessions.rotate(payload.sessionId, payload.tokenId, rotated);

    if (result === 'reused') {
      // Robo probable. Se revoca la familia completa.
      await this.sessions.revokeFamily(payload.familyId);

      this.logger.error('Reutilizacion de refresh token detectada; familia revocada', undefined, {
        userId: payload.userId,
        sessionId: payload.sessionId,
        familyId: payload.familyId,
        ip: context.ipAddress,
      });

      await this.audit
        .record({
          actorId: payload.userId,
          action: 'auth.refresh_reuse_detected',
          targetType: 'Session',
          targetId: payload.sessionId,
          outcome: 'failure',
          reason: 'token_reuse',
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          correlationId: context.correlationId,
          metadata: { familyId: payload.familyId, generation: existing.generation },
        })
        .catch(() => undefined);

      throw new UnauthorizedError(
        'SESSION_COMPROMISED',
        'Por seguridad se cerraron tus sesiones. Vuelve a iniciar sesion.',
      );
    }

    if (result === 'not_found') throw sessionExpired();

    // Se recarga el usuario para reflejar cambios de rol, desactivaciones y
    // suspensiones ocurridos desde el ultimo refresco.
    const user = await this.users.findById(UserId.create(payload.userId));
    if (!user) throw sessionExpired();

    try {
      user.assertCanAuthenticate(now);
    } catch (error) {
      // La cuenta ya no puede autenticarse: la sesion muere aqui, no espera a
      // que caduque el token.
      await this.sessions.revoke(payload.sessionId);
      throw error;
    }

    const access = this.tokens.issueAccessToken({
      userId: user.id.value,
      sessionId: payload.sessionId,
      roles: [...user.roles],
      permissions: user.permissions,
      institutionId: user.institutionId ?? undefined,
      locale: user.locale.value,
      critical: user.hasCriticalSession,
    });

    return {
      auth: {
        accessToken: access.token,
        expiresIn: access.expiresInSeconds,
        tokenType: 'Bearer',
        user: {
          id: user.id.value,
          email: user.email.value,
          firstName: user.name.first,
          lastName: user.name.last,
          displayName: user.name.shortName,
          avatarUrl: user.avatarUrl,
          roles: [...user.roles],
          permissions: user.permissions,
          institutionId: user.institutionId,
          institutionName: null,
          portal: resolvePortal(user),
          locale: user.locale.value,
          emailVerified: user.emailVerified,
          mustChangePassword: user.mustChangePassword,
        },
      },
      refreshToken: nextRefresh.token,
      refreshTokenExpiresAt: nextRefresh.expiresAt,
    };
  }
}

function sessionExpired(): UnauthorizedError {
  return new UnauthorizedError('SESSION_EXPIRED', 'Tu sesion expiro. Vuelve a iniciar sesion.');
}
