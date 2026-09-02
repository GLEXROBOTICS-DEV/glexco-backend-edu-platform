import { randomBytes } from 'node:crypto';
import {
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
  type Clock,
  type ExecutionContext,
  type LoggerPort,
  type PasswordHasher,
  type UnitOfWork,
  type UseCase,
} from '@glexco/kernel';
import { PERMISSIONS, ROLES, isPlatformRole, type Role } from '@glexco/contracts';
import { User } from '../domain/user/user.aggregate';
import {
  Email,
  LocalePreference,
  PasswordHash,
  PersonName,
  UserId,
} from '../domain/user/value-objects';
import type { UserRepository } from '../domain/user/user.repository';
import type { AuditLog, OneTimeTokenStore } from './ports';

export interface CreateStaffUserInput {
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  /** Obligatorio para docente y administrador de institucion. Se ignora para
   *  el personal GLEXCO, que opera por encima de las instituciones. */
  institutionId?: string;
  locale?: 'es' | 'en';
}

export interface CreateStaffUserOutput {
  userId: string;
  email: string;
  role: Role;
  /**
   * Contrasena temporal.
   *
   * Se devuelve UNA sola vez a quien crea la cuenta y no se guarda en claro en
   * ningun sitio. Es la via practica para un colegio que da de alta docentes sin
   * correo institucional fiable: el administrador se la entrega en persona.
   * La cuenta nace con `mustChangePassword`, asi que el docente la cambia al
   * primer acceso.
   */
  temporaryPassword: string;
}

/**
 * Alta de personal: docente, administrador de institucion o empleado GLEXCO.
 *
 * Tres controles de autorizacion, y los tres son necesarios:
 *
 * 1. **Permiso** para crear usuarios (lo comprueba el guard).
 * 2. **Matriz de creacion de roles** (lo comprueba el agregado): impide que un
 *    administrador de institucion se fabrique un `platform_admin`.
 * 3. **Ambito de institucion** (lo comprueba ESTE caso de uso): impide que un
 *    administrador del colegio A cree docentes en el colegio B.
 *
 * El tercero solo puede vivir aqui, porque el guard no conoce el cuerpo de la
 * peticion y el agregado no conoce a que institucion pertenece quien la envia.
 * Omitirlo es exactamente como se producen las fugas entre instituciones.
 */
export class CreateStaffUserUseCase
  implements UseCase<CreateStaffUserInput, CreateStaffUserOutput>
{
  constructor(
    private readonly users: UserRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly hasher: PasswordHasher,
    private readonly oneTimeTokens: OneTimeTokenStore,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
    private readonly logger: LoggerPort,
  ) {}

  async execute(
    input: CreateStaffUserInput,
    context: ExecutionContext,
  ): Promise<CreateStaffUserOutput> {
    const actor = context.actor;
    if (!actor) {
      throw new UnauthorizedError('UNAUTHENTICATED', 'Debes iniciar sesion.');
    }

    const now = this.clock.now();
    const email = Email.create(input.email);
    const name = PersonName.create(input.firstName, input.lastName);

    const institutionId = this.resolveInstitutionScope(input, actor);

    if (await this.users.existsByEmail(email)) {
      throw new ConflictError('EMAIL_ALREADY_REGISTERED', 'Ya existe una cuenta con este correo.', {
        field: 'email',
      });
    }

    // Contrasena temporal legible pero con entropia suficiente: 32 caracteres
    // en base64url son ~192 bits. Se genera aqui y no se guarda en claro.
    const temporaryPassword = randomBytes(24).toString('base64url');
    const passwordHash = PasswordHash.fromHash(await this.hasher.hash(temporaryPassword));

    // El agregado aplica la matriz de creacion de roles y exige institucion a
    // docentes y administradores de institucion.
    const user = User.createStaff({
      id: UserId.create(),
      email,
      name,
      passwordHash,
      role: input.role,
      institutionId,
      locale: LocalePreference.create(input.locale),
      createdBy: { userId: actor.userId, roles: actor.roles as Role[] },
      now,
    });

    await this.unitOfWork.run(async (tx) => {
      await this.users.save(user, tx);
      (tx as { enqueue(...events: unknown[]): void }).enqueue(...user.pullDomainEvents());
    });

    // Token de verificacion para que el propio interesado confirme su correo.
    await this.oneTimeTokens
      .issue({ purpose: 'email_verification', userId: user.id.value, ttlSeconds: 7 * 24 * 3600 })
      .catch((error) => {
        this.logger.error('No se pudo emitir el token de verificacion del alta de personal', error, {
          userId: user.id.value,
        });
      });

    await this.audit
      .record({
        actorId: actor.userId,
        action: 'user.create_staff',
        targetType: 'User',
        targetId: user.id.value,
        outcome: 'success',
        institutionId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        correlationId: context.correlationId,
        metadata: { role: input.role },
      })
      .catch(() => undefined);

    this.logger.info('Usuario de personal creado', {
      userId: user.id.value,
      role: input.role,
      institutionId,
    });

    return {
      userId: user.id.value,
      email: user.email.value,
      role: input.role,
      temporaryPassword,
    };
  }

  /**
   * Decide y valida la institucion de la cuenta nueva.
   *
   * Para un actor con ambito de institucion se IGNORA el `institutionId` del
   * cuerpo y se usa el suyo. Es deliberado: aceptar el del cuerpo permitiria a
   * un administrador crear docentes en otro colegio con solo cambiar un campo,
   * y ese es el tipo de fallo que no se detecta hasta que ya hubo fuga.
   */
  private resolveInstitutionScope(
    input: CreateStaffUserInput,
    actor: NonNullable<ExecutionContext['actor']>,
  ): string | undefined {
    const actorIsPlatform = actor.roles.some((role) => isPlatformRole(role as Role));

    if (actorIsPlatform) {
      // Solo GLEXCO puede crear administradores de institucion, y necesita decir
      // a cual pertenecen.
      if (
        input.role === ROLES.INSTITUTION_ADMIN &&
        !actor.permissions.includes(PERMISSIONS.INSTITUTION_ADMIN_CREATE)
      ) {
        throw new ForbiddenError(
          'INSUFFICIENT_PERMISSIONS',
          'No tienes permiso para crear administradores de institucion.',
        );
      }
      return input.institutionId;
    }

    if (!actor.institutionId) {
      throw new ForbiddenError(
        'ACTOR_WITHOUT_INSTITUTION',
        'Tu cuenta no esta asociada a una institucion.',
      );
    }

    // Se avisa del intento en vez de fallar en silencio: si llega, o el frontend
    // esta mal, o alguien esta sondeando.
    if (input.institutionId && input.institutionId !== actor.institutionId) {
      throw new ForbiddenError(
        'CROSS_INSTITUTION_FORBIDDEN',
        'Solo puedes crear usuarios en tu propia institucion.',
      );
    }

    return actor.institutionId;
  }
}
