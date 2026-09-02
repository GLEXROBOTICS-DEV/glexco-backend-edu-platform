import {
  NotFoundError,
  RateLimitError,
  type Clock,
  type ExecutionContext,
  type LoggerPort,
  type PasswordHasher,
  type UnitOfWork,
  type UseCase,
} from '@glexco/kernel';
import { RATE_LIMITS, type RateLimiter } from '@glexco/nest-platform';
import type { UserRepository } from '../domain/user/user.repository';
import { Email, PasswordHash, UserId } from '../domain/user/value-objects';
import type { SessionStore } from '../domain/session/session';
import type { AuditLog, OneTimeTokenStore, PasswordPolicy } from './ports';

// ---------------------------------------------------------------------------
// Solicitud
// ---------------------------------------------------------------------------

export interface RequestPasswordResetInput {
  email: string;
  locale: 'es' | 'en';
}

/**
 * Solicitud de recuperacion de contrasena.
 *
 * **Nunca revela si la cuenta existe.** El controlador responde siempre 202 con
 * el mismo mensaje. Si distinguiéramos, este endpoint seria un oraculo para
 * averiguar que correos estan registrados, y en esta plataforma esos correos son
 * de menores identificables por su institucion.
 *
 * El limite es agresivo (3 por hora) por dos motivos: evita que se use como
 * amplificador para inundar el buzon de alguien, y evita que se convierta en un
 * enumerador por diferencia de tiempo.
 *
 * El correo lo envia el servicio de engagement al consumir el evento; aqui solo
 * se emite el token, porque su unicidad y su caducidad las hace valer identidad.
 */
export class RequestPasswordResetUseCase implements UseCase<RequestPasswordResetInput, void> {
  constructor(
    private readonly users: UserRepository,
    private readonly tokenStore: OneTimeTokenStore,
    private readonly rateLimiter: RateLimiter,
    private readonly audit: AuditLog,
    private readonly logger: LoggerPort,
  ) {}

  async execute(input: RequestPasswordResetInput, context: ExecutionContext): Promise<void> {
    const email = Email.create(input.email);

    const result = await this.rateLimiter.consume(
      `pwdreset:${email.value}`,
      RATE_LIMITS.PASSWORD_RESET.limit,
      RATE_LIMITS.PASSWORD_RESET.windowMs,
    );

    if (!result.allowed) {
      // Este si es un 429 visible. No filtra existencia de cuenta: se limita por
      // correo solicitado, exista o no.
      throw new RateLimitError(
        'TOO_MANY_RESET_REQUESTS',
        'Ya se solicitaron varios restablecimientos. Espera antes de volver a intentarlo.',
        { retryAfterSeconds: result.retryAfterSeconds },
      );
    }

    const user = await this.users.findByEmailForAuth(email);

    if (!user) {
      // Se registra para poder detectar sondeos, pero al cliente se le responde
      // exactamente igual que si existiera.
      await this.audit
        .record({
          actorId: null,
          action: 'auth.password_reset_request',
          targetType: 'User',
          targetId: null,
          outcome: 'failure',
          reason: 'user_not_found',
          ipAddress: context.ipAddress,
          correlationId: context.correlationId,
          metadata: { email: email.value },
        })
        .catch(() => undefined);
      return;
    }

    // Una hora de vida: suficiente para que alguien lea su correo, y corto para
    // limitar la ventana si el buzon esta comprometido.
    await this.tokenStore.issue({
      purpose: 'password_reset',
      userId: user.id.value,
      ttlSeconds: 3600,
    });

    this.logger.info('Token de recuperacion emitido', { userId: user.id.value });

    await this.audit
      .record({
        actorId: user.id.value,
        action: 'auth.password_reset_request',
        targetType: 'User',
        targetId: user.id.value,
        outcome: 'success',
        institutionId: user.institutionId,
        ipAddress: context.ipAddress,
        correlationId: context.correlationId,
      })
      .catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Confirmacion
// ---------------------------------------------------------------------------

export interface ConfirmPasswordResetInput {
  token: string;
  password: string;
}

/**
 * Confirmacion del restablecimiento.
 *
 * Al terminar se revocan TODAS las sesiones del usuario. Es imprescindible: si
 * el restablecimiento se debe a que alguien tomo la cuenta, dejar viva la sesion
 * del atacante haria inutil el cambio de contrasena. Tambien se invalidan los
 * demas enlaces de recuperacion pendientes.
 */
export class ConfirmPasswordResetUseCase implements UseCase<ConfirmPasswordResetInput, void> {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionStore,
    private readonly tokenStore: OneTimeTokenStore,
    private readonly unitOfWork: UnitOfWork,
    private readonly hasher: PasswordHasher,
    private readonly passwordPolicy: PasswordPolicy,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: ConfirmPasswordResetInput, context: ExecutionContext): Promise<void> {
    const consumed = await this.tokenStore.consume('password_reset', input.token);

    if (!consumed) {
      throw new NotFoundError(
        'RESET_TOKEN_INVALID',
        'El enlace de restablecimiento no es valido o ya caduco. Solicita uno nuevo.',
      );
    }

    const user = await this.users.findById(UserId.create(consumed.userId));
    if (!user) {
      throw new NotFoundError('USER_NOT_FOUND', 'La cuenta asociada al enlace ya no existe.');
    }

    await this.passwordPolicy.assertAcceptable({
      password: input.password,
      email: user.email.value,
      firstName: user.name.first,
      lastName: user.name.last,
    });

    const newHash = PasswordHash.fromHash(await this.hasher.hash(input.password));
    user.changePassword(newHash, 'reset', this.clock.now());

    await this.unitOfWork.run(async (tx) => {
      await this.users.save(user, tx);
      (tx as { enqueue(...events: unknown[]): void }).enqueue(...user.pullDomainEvents());
    });

    // Orden intencional: primero se persiste la contrasena nueva, despues se
    // cierran las sesiones. Al reves, un fallo al guardar dejaria al usuario sin
    // sesiones Y con la contrasena antigua, es decir, fuera de su cuenta.
    await this.sessions.revokeAllForUser(user.id.value);
    await this.tokenStore.invalidateAll('password_reset', user.id.value);

    await this.audit
      .record({
        actorId: user.id.value,
        action: 'auth.password_reset_confirm',
        targetType: 'User',
        targetId: user.id.value,
        outcome: 'success',
        institutionId: user.institutionId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        correlationId: context.correlationId,
      })
      .catch(() => undefined);
  }
}
