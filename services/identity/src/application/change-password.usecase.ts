import {
  NotFoundError,
  UnauthorizedError,
  type Clock,
  type ExecutionContext,
  type PasswordHasher,
  type UnitOfWork,
  type UseCase,
} from '@glexco/kernel';
import type { UserRepository } from '../domain/user/user.repository';
import { PasswordHash, UserId } from '../domain/user/value-objects';
import type { SessionStore } from '../domain/session/session';
import type { AuditLog, OneTimeTokenStore, PasswordPolicy } from './ports';

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
  /** Mantener viva la sesion actual y cerrar solo las demas. Es lo que espera un
   *  usuario que cambia su contrasena por higiene: no quiere que le expulsen del
   *  navegador donde acaba de hacerlo. */
  keepCurrentSession?: boolean;
}

/**
 * Cambio de contrasena por el propio usuario.
 *
 * Exige la contrasena actual aunque la sesion ya este autenticada. Puede parecer
 * redundante, y no lo es: si alguien se sienta en el ordenador del laboratorio
 * ante una sesion abierta, sin esta comprobacion podria cambiar la contrasena y
 * quedarse con la cuenta. Pedir la actual convierte el secuestro de una sesion
 * descuidada en un problema temporal en vez de una perdida de cuenta.
 *
 * Al terminar se cierran las demas sesiones: si el motivo del cambio es una
 * sospecha de compromiso, dejar vivas las sesiones del atacante haria inutil el
 * cambio.
 */
export class ChangePasswordUseCase implements UseCase<ChangePasswordInput, void> {
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

  async execute(input: ChangePasswordInput, context: ExecutionContext): Promise<void> {
    const actor = context.actor;
    if (!actor) {
      throw new UnauthorizedError('UNAUTHENTICATED', 'Debes iniciar sesion para cambiar tu contrasena.');
    }

    const user = await this.users.findById(UserId.create(actor.userId));
    if (!user) throw new NotFoundError('USER_NOT_FOUND', 'La cuenta ya no existe.');

    const matches = await this.hasher.verify(input.currentPassword, user.passwordHash.value);

    if (!matches) {
      // Cuenta como intento fallido: si alguien esta probando contrasenas contra
      // una sesion secuestrada, debe toparse con el mismo bloqueo progresivo.
      user.recordFailedLogin(this.clock.now());
      await this.unitOfWork.run(async (tx) => {
        await this.users.save(user, tx);
      });

      await this.audit
        .record({
          actorId: user.id.value,
          action: 'auth.change_password',
          targetType: 'User',
          targetId: user.id.value,
          outcome: 'failure',
          reason: 'wrong_current_password',
          institutionId: user.institutionId,
          ipAddress: context.ipAddress,
          correlationId: context.correlationId,
        })
        .catch(() => undefined);

      throw new UnauthorizedError(
        'CURRENT_PASSWORD_INVALID',
        'La contrasena actual no es correcta.',
      );
    }

    await this.passwordPolicy.assertAcceptable({
      password: input.newPassword,
      email: user.email.value,
      firstName: user.name.first,
      lastName: user.name.last,
    });

    const newHash = PasswordHash.fromHash(await this.hasher.hash(input.newPassword));
    user.changePassword(newHash, 'self_service', this.clock.now());

    await this.unitOfWork.run(async (tx) => {
      await this.users.save(user, tx);
      (tx as { enqueue(...events: unknown[]): void }).enqueue(...user.pullDomainEvents());
    });

    // Las demas sesiones caen. La actual se conserva o no segun lo pedido; el
    // controlador se encarga de reponer su cookie cuando corresponda.
    if (input.keepCurrentSession) {
      const others = await this.sessions.listForUser(user.id.value);
      await Promise.all(
        others
          .filter((session) => session.id !== actor.sessionId)
          .map((session) => this.sessions.revoke(session.id)),
      );
    } else {
      await this.sessions.revokeAllForUser(user.id.value);
    }

    // Los enlaces de recuperacion pendientes mueren: si alguien pidio un
    // restablecimiento antes, ese enlace ya no debe servir.
    await this.tokenStore.invalidateAll('password_reset', user.id.value);

    await this.audit
      .record({
        actorId: user.id.value,
        action: 'auth.change_password',
        targetType: 'User',
        targetId: user.id.value,
        outcome: 'success',
        institutionId: user.institutionId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        correlationId: context.correlationId,
        metadata: { keptCurrentSession: input.keepCurrentSession === true },
      })
      .catch(() => undefined);
  }
}
