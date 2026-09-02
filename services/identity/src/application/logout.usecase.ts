import type { ExecutionContext, UseCase } from '@glexco/kernel';
import type { SessionStore } from '../domain/session/session';
import type { AuditLog, TokenIssuer } from './ports';

export interface LogoutInput {
  refreshToken: string;
  /** Cierra TODAS las sesiones del usuario, no solo esta. Es la opcion "cerrar
   *  sesion en todos los dispositivos", util cuando alguien sospecha que dejo la
   *  sesion abierta en un equipo del colegio. */
  allDevices?: boolean;
}

/**
 * Cierre de sesion.
 *
 * Deliberadamente tolerante: si el token ya caduco o la sesion no existe, no
 * falla. Un cierre de sesion que devuelve error deja al cliente sin saber si
 * limpiar su estado local, y el resultado practico es peor (usuarios que creen
 * seguir dentro).
 *
 * Lo que si es estricto es el efecto: revocar la sesion marca la lista de
 * revocacion en Redis para sesiones criticas, de modo que el access token ya
 * emitido -que sigue siendo criptograficamente valido hasta 15 minutos despues-
 * deje de aceptarse de inmediato en las cuentas que importan.
 */
export class LogoutUseCase implements UseCase<LogoutInput, void> {
  constructor(
    private readonly sessions: SessionStore,
    private readonly tokens: TokenIssuer,
    private readonly audit: AuditLog,
  ) {}

  async execute(input: LogoutInput, context: ExecutionContext): Promise<void> {
    let payload: { userId: string; sessionId: string } | null = null;

    try {
      payload = this.tokens.verifyRefreshToken(input.refreshToken);
    } catch {
      // Token invalido o caducado: no hay nada que revocar y no es un error.
      return;
    }

    if (input.allDevices) {
      await this.sessions.revokeAllForUser(payload.userId);
    } else {
      await this.sessions.revoke(payload.sessionId);
    }

    await this.audit
      .record({
        actorId: payload.userId,
        action: input.allDevices ? 'auth.logout_all' : 'auth.logout',
        targetType: 'Session',
        targetId: payload.sessionId,
        outcome: 'success',
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        correlationId: context.correlationId,
      })
      .catch(() => undefined);
  }
}
