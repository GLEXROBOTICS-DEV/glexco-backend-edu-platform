import {
  NotFoundError,
  type Clock,
  type ExecutionContext,
  type UnitOfWork,
  type UseCase,
} from '@glexco/kernel';
import type { UserRepository } from '../domain/user/user.repository';
import { UserId } from '../domain/user/value-objects';
import type { AuditLog, OneTimeTokenStore } from './ports';

export interface VerifyEmailInput {
  token: string;
}

export interface VerifyEmailOutput {
  verified: boolean;
  email: string;
}

/**
 * Verificacion del correo electronico.
 *
 * El token se consume de forma ATOMICA antes de tocar al usuario. Ese orden
 * importa: si primero se verificase el usuario y luego se consumiera el token,
 * un fallo entre ambos pasos dejaria un token vivo capaz de "verificar" una
 * cuenta ya verificada, que es inofensivo pero desordenado. Al reves, si el
 * token se consume y el usuario no llega a verificarse, el usuario puede pedir
 * otro enlace. Entre dos fallos, se elige el recuperable.
 *
 * La operacion sobre el agregado es idempotente: reabrir el enlace no falla,
 * porque los clientes de correo pre-cargan enlaces y los usuarios hacen doble
 * clic.
 */
export class VerifyEmailUseCase implements UseCase<VerifyEmailInput, VerifyEmailOutput> {
  constructor(
    private readonly users: UserRepository,
    private readonly tokenStore: OneTimeTokenStore,
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: VerifyEmailInput, context: ExecutionContext): Promise<VerifyEmailOutput> {
    const consumed = await this.tokenStore.consume('email_verification', input.token);

    if (!consumed) {
      await this.audit
        .record({
          actorId: null,
          action: 'auth.verify_email',
          targetType: 'User',
          targetId: null,
          outcome: 'failure',
          reason: 'invalid_or_expired_token',
          ipAddress: context.ipAddress,
          correlationId: context.correlationId,
        })
        .catch(() => undefined);

      throw new NotFoundError(
        'VERIFICATION_TOKEN_INVALID',
        'El enlace de verificacion no es valido o ya caduco. Solicita uno nuevo.',
      );
    }

    const user = await this.users.findById(UserId.create(consumed.userId));
    if (!user) {
      throw new NotFoundError('USER_NOT_FOUND', 'La cuenta asociada al enlace ya no existe.');
    }

    user.verifyEmail(this.clock.now());

    await this.unitOfWork.run(async (tx) => {
      await this.users.save(user, tx);
      (tx as { enqueue(...events: unknown[]): void }).enqueue(...user.pullDomainEvents());
    });

    await this.audit
      .record({
        actorId: user.id.value,
        action: 'auth.verify_email',
        targetType: 'User',
        targetId: user.id.value,
        outcome: 'success',
        institutionId: user.institutionId,
        ipAddress: context.ipAddress,
        correlationId: context.correlationId,
      })
      .catch(() => undefined);

    return { verified: true, email: user.email.value };
  }
}
