import { randomUUID } from 'node:crypto';
import {
  RateLimitError,
  UnauthorizedError,
  type Clock,
  type ExecutionContext,
  type LoggerPort,
  type PasswordHasher,
  type UnitOfWork,
  type UseCase,
} from '@glexco/kernel';
import type { AuthResult, LoginInput } from '@glexco/contracts';
import { RATE_LIMITS, type RateLimiter } from '@glexco/nest-platform';
import type { User } from '../domain/user/user.aggregate';
import { Email, PasswordHash } from '../domain/user/value-objects';
import type { UserRepository } from '../domain/user/user.repository';
import type { Session, SessionStore } from '../domain/session/session';
import type { AuditLog, TokenIssuer } from './ports';
import { resolvePortal } from './resolve-portal';

export interface LoginOutput {
  auth: AuthResult;
  /** El refresh token no viaja en el cuerpo: el controlador lo pone en una
   *  cookie httpOnly. Se devuelve aparte para dejar esa intencion explicita. */
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

/**
 * Inicio de sesion.
 *
 * Las decisiones de seguridad concretas y por que estan:
 *
 * - **Doble limitacion**: por IP y por cuenta. Solo por IP no frena el rociado
 *   de contrasenas, que prueba una contrasena comun contra miles de cuentas
 *   desde muchas IPs. Solo por cuenta permite que una IP recorra usuarios.
 *
 * - **Resistencia a ataques de tiempo**: si la cuenta no existe se ejecuta igual
 *   una verificacion de hash contra un valor senuelo. Sin eso, un "no existe"
 *   responde en 2 ms y un "contrasena incorrecta" en 90 ms, y esa diferencia
 *   permite enumerar que correos estan registrados en la plataforma.
 *
 * - **Mensaje unico**: "credenciales invalidas" para cualquier fallo. El detalle
 *   va al registro de auditoria, no a la respuesta.
 *
 * - **Rehash transparente**: si el hash guardado usa parametros mas debiles que
 *   los actuales, se recalcula aprovechando que en este instante tenemos la
 *   contrasena en claro. Es la unica forma de endurecer el hash de toda la base
 *   sin pedir a nadie que cambie su contrasena.
 */
export class LoginUseCase implements UseCase<LoginInput, LoginOutput> {
  /**
   * Hash senuelo para el camino "usuario no encontrado".
   *
   * Es un hash real de argon2id sobre una cadena aleatoria, asi que verificarlo
   * cuesta exactamente lo mismo que verificar el de un usuario real.
   */
  private decoyHash: string | null = null;

  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionStore,
    private readonly unitOfWork: UnitOfWork,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenIssuer,
    private readonly rateLimiter: RateLimiter,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
    private readonly logger: LoggerPort,
  ) {}

  async execute(input: LoginInput, context: ExecutionContext): Promise<LoginOutput> {
    const now = this.clock.now();
    const email = Email.create(input.email);

    await this.assertNotRateLimited(email, context);

    // Va contra el pool de escritura: alguien que acaba de registrarse debe
    // poder iniciar sesion de inmediato, sin depender del retardo de replicacion.
    const user = await this.users.findByEmailForAuth(email);

    if (!user) {
      // Se gasta el mismo tiempo que en el camino real. No es paranoia: la
      // enumeracion de correos es el primer paso de casi todo ataque dirigido,
      // y aqui los correos son de menores identificables.
      await this.burnTimeLikeRealVerification(input.password);
      await this.recordFailure(null, email.value, 'user_not_found', context);
      throw invalidCredentials();
    }

    // Comprueba bloqueo temporal, suspension y desactivacion.
    try {
      user.assertCanAuthenticate(now);
    } catch (error) {
      await this.recordFailure(user.id.value, email.value, 'account_not_authenticable', context);
      throw error;
    }

    const passwordMatches = await this.hasher.verify(input.password, user.passwordHash.value);

    if (!passwordMatches) {
      // El contador de fallos y el bloqueo progresivo se persisten aunque el
      // inicio de sesion falle: es justamente el estado que hay que conservar.
      user.recordFailedLogin(now);
      await this.unitOfWork.run(async (tx) => {
        await this.users.save(user, tx);
      });

      await this.recordFailure(user.id.value, email.value, 'wrong_password', context);
      throw invalidCredentials();
    }

    // Contrasena correcta: se rehashea si los parametros quedaron obsoletos.
    if (this.hasher.needsRehash(user.passwordHash.value)) {
      const upgraded = await this.hasher.hash(input.password);
      user.upgradePasswordHash(PasswordHash.fromHash(upgraded), now);
      this.logger.info('Hash de contrasena actualizado a los parametros vigentes', {
        userId: user.id.value,
      });
    }

    user.recordSuccessfulLogin(now);

    await this.unitOfWork.run(async (tx) => {
      await this.users.save(user, tx);
      (tx as { enqueue(...events: unknown[]): void }).enqueue(...user.pullDomainEvents());
    });

    const session = await this.openSession(user, input.rememberMe, context, now);

    await this.audit
      .record({
        actorId: user.id.value,
        action: 'auth.login',
        targetType: 'User',
        targetId: user.id.value,
        outcome: 'success',
        institutionId: user.institutionId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        correlationId: context.correlationId,
        metadata: { sessionId: session.session.id, rememberMe: input.rememberMe },
      })
      .catch(() => undefined);

    return session.output;
  }

  /**
   * Doble limitacion antes de tocar la base de datos.
   *
   * El limite por cuenta usa una ventana larga (15 minutos) y es mucho mas
   * estricto, porque un usuario legitimo casi nunca falla cinco veces seguidas
   * mientras que un ataque lo hace por definicion.
   */
  private async assertNotRateLimited(email: Email, context: ExecutionContext): Promise<void> {
    const checks: Array<Promise<{ allowed: boolean; retryAfterSeconds: number }>> = [];

    if (context.ipAddress) {
      checks.push(
        this.rateLimiter.consume(
          `login:ip:${context.ipAddress}`,
          RATE_LIMITS.LOGIN_BY_IP.limit,
          RATE_LIMITS.LOGIN_BY_IP.windowMs,
        ),
      );
    }

    checks.push(
      this.rateLimiter.consume(
        `login:account:${email.value}`,
        RATE_LIMITS.LOGIN_BY_ACCOUNT.limit,
        RATE_LIMITS.LOGIN_BY_ACCOUNT.windowMs,
      ),
    );

    const results = await Promise.all(checks);
    const blocked = results.find((result) => !result.allowed);

    if (blocked) {
      throw new RateLimitError(
        'TOO_MANY_LOGIN_ATTEMPTS',
        'Demasiados intentos de inicio de sesion. Espera unos minutos.',
        { retryAfterSeconds: blocked.retryAfterSeconds },
      );
    }
  }

  /**
   * Consume el mismo tiempo de CPU que una verificacion real.
   *
   * El hash senuelo se calcula una sola vez por proceso y se reutiliza: generarlo
   * en cada intento fallido convertiria la enumeracion de correos en un ataque de
   * agotamiento de CPU, que es cambiar un problema por otro peor.
   */
  private async burnTimeLikeRealVerification(candidate: string): Promise<void> {
    this.decoyHash ??= await this.hasher.hash(randomUUID());
    await this.hasher.verify(candidate, this.decoyHash).catch(() => false);
  }

  private async openSession(
    user: User,
    rememberMe: boolean,
    context: ExecutionContext,
    now: Date,
  ): Promise<{ session: Session; output: LoginOutput }> {
    const sessionId = randomUUID();
    const familyId = randomUUID();

    const refresh = this.tokens.issueRefreshToken({
      userId: user.id.value,
      sessionId,
      familyId,
      longLived: rememberMe,
    });

    const session: Session = {
      id: sessionId,
      userId: user.id.value,
      familyId,
      currentTokenId: refresh.tokenId,
      generation: 0,
      createdAt: now.toISOString(),
      lastUsedAt: now.toISOString(),
      expiresAt: refresh.expiresAt.toISOString(),
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
      critical: user.hasCriticalSession,
    };

    await this.sessions.create(session);

    const access = this.tokens.issueAccessToken({
      userId: user.id.value,
      sessionId,
      roles: [...user.roles],
      permissions: user.permissions,
      institutionId: user.institutionId ?? undefined,
      locale: user.locale.value,
      critical: user.hasCriticalSession,
    });

    return {
      session,
      output: {
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
            institutionName: null, // Lo resuelve el gateway consultando a instituciones.
            portal: resolvePortal(user),
            locale: user.locale.value,
            emailVerified: user.emailVerified,
            mustChangePassword: user.mustChangePassword,
          },
        },
        refreshToken: refresh.token,
        refreshTokenExpiresAt: refresh.expiresAt,
      },
    };
  }

  private async recordFailure(
    userId: string | null,
    email: string,
    reason: string,
    context: ExecutionContext,
  ): Promise<void> {
    await this.audit
      .record({
        actorId: userId,
        action: 'auth.login',
        targetType: 'User',
        targetId: userId,
        outcome: 'failure',
        reason,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        correlationId: context.correlationId,
        // El correo se guarda para poder investigar un ataque dirigido; la
        // auditoria es de acceso restringido y tiene politica de retencion.
        metadata: { email },
      })
      .catch(() => undefined);
  }
}

/** Un unico mensaje para todos los fallos de credenciales. */
function invalidCredentials(): UnauthorizedError {
  return new UnauthorizedError(
    'INVALID_CREDENTIALS',
    'El correo o la contrasena no son correctos.',
  );
}
