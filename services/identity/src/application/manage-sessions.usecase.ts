import { NotFoundError, UnauthorizedError, type ExecutionContext, type UseCase } from '@glexco/kernel';
import type { SessionStore } from '../domain/session/session';
import type { AuditLog } from './ports';

export interface SessionSummary {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  /** Descripcion legible del dispositivo, derivada del user agent. */
  device: string;
  ipAddress: string | null;
  /** Marca la sesion desde la que se hace la consulta, para que la interfaz
   *  pueda decir "este dispositivo" y evitar que el usuario se expulse solo
   *  sin querer. */
  current: boolean;
}

/**
 * Lista las sesiones activas del usuario.
 *
 * Existe por una razon concreta del contexto escolar: los alumnos usan los
 * ordenadores del laboratorio y se dejan la sesion abierta constantemente. Poder
 * ver "tienes una sesion abierta en un equipo del colegio desde el martes" y
 * cerrarla desde el movil resuelve un problema real y frecuente.
 */
export class ListSessionsUseCase implements UseCase<void, SessionSummary[]> {
  constructor(private readonly sessions: SessionStore) {}

  async execute(_input: void, context: ExecutionContext): Promise<SessionSummary[]> {
    const actor = context.actor;
    if (!actor) throw new UnauthorizedError('UNAUTHENTICATED', 'Debes iniciar sesion.');

    const sessions = await this.sessions.listForUser(actor.userId);

    return sessions
      .map((session) => ({
        id: session.id,
        createdAt: session.createdAt,
        lastUsedAt: session.lastUsedAt,
        expiresAt: session.expiresAt,
        device: describeDevice(session.userAgent),
        // La IP se muestra completa solo al propio duenio de la sesion, que es
        // quien ya la conoce. No se expone en ningun listado ajeno.
        ipAddress: session.ipAddress ?? null,
        current: session.id === actor.sessionId,
      }))
      .sort((a, b) => Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt));
  }
}

export interface RevokeSessionInput {
  /** Sesion concreta a cerrar. Si se omite, se cierran todas menos la actual. */
  sessionId?: string;
}

/**
 * Cierra una sesion propia, o todas las demas.
 *
 * Solo se pueden cerrar sesiones PROPIAS. Se comprueba que la sesion pertenezca
 * al actor antes de tocarla; sin esa comprobacion, conocer un id de sesion
 * bastaria para expulsar a cualquier otro usuario de la plataforma.
 */
export class RevokeSessionUseCase implements UseCase<RevokeSessionInput, { revoked: number }> {
  constructor(
    private readonly sessions: SessionStore,
    private readonly audit: AuditLog,
  ) {}

  async execute(
    input: RevokeSessionInput,
    context: ExecutionContext,
  ): Promise<{ revoked: number }> {
    const actor = context.actor;
    if (!actor) throw new UnauthorizedError('UNAUTHENTICATED', 'Debes iniciar sesion.');

    if (input.sessionId) {
      const session = await this.sessions.findById(input.sessionId);

      // Mismo error para "no existe" y "es de otro": distinguirlos permitiria
      // averiguar que ids de sesion son reales.
      if (!session || session.userId !== actor.userId) {
        throw new NotFoundError('SESSION_NOT_FOUND', 'La sesion indicada no existe.');
      }

      await this.sessions.revoke(input.sessionId);
      await this.recordAudit(actor.userId, 1, context, input.sessionId);
      return { revoked: 1 };
    }

    const all = await this.sessions.listForUser(actor.userId);
    const others = all.filter((session) => session.id !== actor.sessionId);
    await Promise.all(others.map((session) => this.sessions.revoke(session.id)));

    await this.recordAudit(actor.userId, others.length, context);
    return { revoked: others.length };
  }

  private async recordAudit(
    userId: string,
    revoked: number,
    context: ExecutionContext,
    sessionId?: string,
  ): Promise<void> {
    await this.audit
      .record({
        actorId: userId,
        action: sessionId ? 'auth.revoke_session' : 'auth.revoke_other_sessions',
        targetType: 'Session',
        targetId: sessionId ?? null,
        outcome: 'success',
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        correlationId: context.correlationId,
        metadata: { revoked },
      })
      .catch(() => undefined);
  }
}

/**
 * Descripcion legible del dispositivo.
 *
 * Se hace con coincidencias simples en vez de traer una libreria de analisis de
 * user agents: solo hace falta que una persona reconozca su propio dispositivo
 * en una lista corta, no clasificar con precision. Una dependencia mas, con su
 * base de datos de firmas a actualizar, no se justifica para eso.
 */
function describeDevice(userAgent?: string): string {
  if (!userAgent) return 'Dispositivo desconocido';

  const ua = userAgent.toLowerCase();

  const platform = ua.includes('windows')
    ? 'Windows'
    : ua.includes('android')
      ? 'Android'
      : ua.includes('iphone') || ua.includes('ipad')
        ? 'iOS'
        : ua.includes('mac os') || ua.includes('macintosh')
          ? 'macOS'
          : ua.includes('linux')
            ? 'Linux'
            : 'Dispositivo';

  // El orden importa: Edge y Opera incluyen "Chrome" en su cadena, y Chrome
  // incluye "Safari". Comprobar de mas especifico a mas generico.
  const browser = ua.includes('edg/')
    ? 'Edge'
    : ua.includes('opr/') || ua.includes('opera')
      ? 'Opera'
      : ua.includes('firefox')
        ? 'Firefox'
        : ua.includes('chrome')
          ? 'Chrome'
          : ua.includes('safari')
            ? 'Safari'
            : 'navegador';

  return `${platform} · ${browser}`;
}
