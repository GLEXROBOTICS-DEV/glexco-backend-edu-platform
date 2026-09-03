import {
  BusinessRuleError,
  ConflictError,
  RateLimitError,
  type Clock,
  type ExecutionContext,
  type LoggerPort,
  type PasswordHasher,
  type UnitOfWork,
  type UseCase,
} from '@glexco/kernel';
import type { StudentRegistrationInput } from '@glexco/contracts';
import { RATE_LIMITS, type RateLimiter } from '@glexco/nest-platform';
import { User } from '../domain/user/user.aggregate';
import {
  BirthDate,
  Email,
  LocalePreference,
  PasswordHash,
  PersonName,
  UserId,
} from '../domain/user/value-objects';
import type { UserRepository } from '../domain/user/user.repository';
import type {
  ActivationCodeGateway,
  AuditLog,
  ClassroomGateway,
  OneTimeTokenStore,
  PasswordPolicy,
} from './ports';

export interface RegisterStudentOutput {
  userId: string;
  email: string;
  requiresGuardianConsent: boolean;
  kitName?: string;
  classroomName?: string;
}

/**
 * Alta de un alumno desde el formulario publico.
 *
 * Es el caso de uso mas delicado de la plataforma: cruza tres servicios
 * (identidad, catalogo y instituciones), toca un recurso con valor economico
 * (el codigo de libro) y afecta a menores de edad.
 *
 * ORDEN DE LAS COMPROBACIONES, y por que ese y no otro:
 *
 *   1. Limite de intentos      -> antes de tocar la base. Si alguien esta
 *                                 automatizando altas, se corta sin gastar CPU
 *                                 ni consultas.
 *   2. Politica de contrasena  -> local y barata, antes de salir a la red.
 *   3. Correo duplicado        -> una consulta indexada. Falla pronto.
 *   4. Codigo de activacion    -> llamada a catalogo. La primera cara.
 *   5. Salon                   -> llamada a instituciones.
 *   6. Hash de la contrasena   -> Argon2 cuesta ~50-100 ms y memoria de verdad.
 *                                 Va el ULTIMO a proposito: si se hiciera antes,
 *                                 un atacante conseguiria que el servidor gaste
 *                                 ese coste en cada peticion basura. Colocarlo
 *                                 detras de todas las validaciones baratas es una
 *                                 defensa concreta contra el agotamiento de CPU.
 *   7. Transaccion            -> crear usuario + escribir evento en la outbox.
 *
 * El canje real del codigo NO ocurre aqui. Catalogo consume
 * `identity.user.registered.v1` y lo canjea de forma idempotente. Ver la
 * explicacion del diseno en dos pasos en `ports.ts`.
 */
export class RegisterStudentUseCase
  implements UseCase<StudentRegistrationInput, RegisterStudentOutput>
{
  constructor(
    private readonly users: UserRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly hasher: PasswordHasher,
    private readonly passwordPolicy: PasswordPolicy,
    private readonly activationCodes: ActivationCodeGateway,
    private readonly classrooms: ClassroomGateway,
    private readonly oneTimeTokens: OneTimeTokenStore,
    private readonly rateLimiter: RateLimiter,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
    private readonly logger: LoggerPort,
  ) {}

  async execute(
    input: StudentRegistrationInput,
    context: ExecutionContext,
  ): Promise<RegisterStudentOutput> {
    const now = this.clock.now();

    // 1. Limite de altas por IP.
    await this.assertRegistrationAllowed(context);

    const email = Email.create(input.email);
    const name = PersonName.create(input.firstName, input.lastName);
    const birthDate = BirthDate.create(input.birthDate);
    const locale = LocalePreference.create(input.locale);

    // 2. Politica de contrasena: rechaza las filtradas y las que contienen datos
    //    personales del propio usuario (su nombre o su correo), que es lo
    //    primero que se prueba en un ataque dirigido.
    await this.passwordPolicy.assertAcceptable({
      password: input.password,
      email: email.value,
      firstName: name.first,
      lastName: name.last,
    });

    // 3. Correo duplicado.
    if (await this.users.existsByEmail(email)) {
      // Se responde con un conflicto explicito porque el formulario necesita
      // decir "ya existe una cuenta con este correo". Ocultarlo aqui no aporta:
      // el propio formulario de recuperacion de contrasena revelaria lo mismo,
      // y a cambio dejaria al usuario sin saber por que no puede registrarse.
      throw new ConflictError('EMAIL_ALREADY_REGISTERED', 'Ya existe una cuenta con este correo.', {
        field: 'email',
      });
    }

    // 4. Codigo de activacion del libro.
    await this.assertActivationCodeRedeemable(input.activationCode, context);
    const precheck = await this.activationCodes.precheck(input.activationCode);

    // 5. Salon, solo en el alta institucional.
    let classroomInfo: { name?: string } = {};
    if (input.accountType === 'institutional') {
      classroomInfo = await this.assertClassroomAccepts(input.institutionId, input.classroomId);
    }

    // 6. Hash de la contrasena. El paso caro, deliberadamente el ultimo.
    const passwordHash = PasswordHash.fromHash(await this.hasher.hash(input.password));

    const guardianEmail = input.guardianEmail ? Email.create(input.guardianEmail) : undefined;

    const user = User.registerStudent({
      id: UserId.create(),
      email,
      name,
      birthDate,
      passwordHash,
      locale,
      accountType: input.accountType,
      institutionId: input.accountType === 'institutional' ? input.institutionId : undefined,
      classroomId: input.accountType === 'institutional' ? input.classroomId : undefined,
      grade: input.grade,
      activationCodeId: precheck.activationCodeId,
      guardianEmail,
      now,
    });

    // 7. Usuario y evento, en la misma transaccion.
    await this.unitOfWork.run(async (tx) => {
      await this.users.save(user, tx);
      // `enqueue` deja el evento en la outbox dentro de esta transaccion. Es
      // esto lo que garantiza que catalogo se entere del alta aunque NATS este
      // caido en este instante.
      (tx as { enqueue(...events: unknown[]): void }).enqueue(...user.pullDomainEvents());
    });

    // A partir de aqui, nada puede hacer fallar el registro: el usuario ya
    // existe. Un correo que no sale es un problema recuperable (el usuario puede
    // pedir el reenvio); devolver un error tras haber creado la cuenta seria
    // mucho peor, porque el usuario reintentaria y chocaria con "correo ya
    // registrado".
    await this.issueVerificationToken(user, context).catch((error) => {
      this.logger.error('No se pudo emitir el token de verificacion tras el registro', error, {
        userId: user.id.value,
      });
    });

    await this.audit
      .record({
        actorId: user.id.value,
        action: 'user.register',
        targetType: 'User',
        targetId: user.id.value,
        outcome: 'success',
        institutionId: user.institutionId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        correlationId: context.correlationId,
        metadata: { accountType: input.accountType, grade: input.grade },
      })
      .catch(() => undefined);

    this.logger.info('Alumno registrado', {
      userId: user.id.value,
      accountType: input.accountType,
      institutionId: user.institutionId,
    });

    return {
      userId: user.id.value,
      email: user.email.value,
      requiresGuardianConsent: birthDate.requiresGuardian(now),
      kitName: precheck.kitName,
      classroomName: classroomInfo.name,
    };
  }

  private async assertRegistrationAllowed(context: ExecutionContext): Promise<void> {
    if (!context.ipAddress) return;

    const result = await this.rateLimiter.consume(
      `register:ip:${context.ipAddress}`,
      RATE_LIMITS.REGISTRATION_BY_IP.limit,
      RATE_LIMITS.REGISTRATION_BY_IP.windowMs,
    );

    if (!result.allowed) {
      throw new RateLimitError(
        'TOO_MANY_REGISTRATIONS',
        'Se hicieron demasiados registros desde esta conexion. Intentalo mas tarde.',
        { retryAfterSeconds: result.retryAfterSeconds },
      );
    }
  }

  /**
   * Comprueba el codigo con limitacion muy estricta.
   *
   * Un codigo valido vale dinero, asi que la fuerza bruta aqui es
   * economicamente interesante para un atacante. Cinco intentos por IP y hora
   * hacen que recorrer el espacio de claves sea inviable, y el mensaje de error
   * no distingue "no existe" de "ya canjeado" para no confirmar aciertos
   * parciales.
   */
  private async assertActivationCodeRedeemable(
    code: string,
    context: ExecutionContext,
  ): Promise<void> {
    if (context.ipAddress) {
      const result = await this.rateLimiter.consume(
        `activation:ip:${context.ipAddress}`,
        RATE_LIMITS.ACTIVATION_REDEEM_BY_IP.limit,
        RATE_LIMITS.ACTIVATION_REDEEM_BY_IP.windowMs,
      );
      if (!result.allowed) {
        throw new RateLimitError(
          'TOO_MANY_ACTIVATION_ATTEMPTS',
          'Se intentaron demasiados codigos desde esta conexion. Intentalo mas tarde.',
          { retryAfterSeconds: result.retryAfterSeconds },
        );
      }
    }

    const precheck = await this.activationCodes.precheck(code);

    if (!precheck.valid) {
      await this.audit
        .record({
          actorId: null,
          action: 'activation_code.precheck',
          targetType: 'ActivationCode',
          targetId: null,
          outcome: 'failure',
          reason: precheck.reason,
          ipAddress: context.ipAddress,
          correlationId: context.correlationId,
        })
        .catch(() => undefined);

      // `already_redeemed` si se distingue: es el unico caso en que el usuario
      // puede hacer algo util con la informacion (ese libro ya lo activo otra
      // persona, y debe reclamar). Los demas se agrupan para no dar pistas.
      if (precheck.reason === 'already_redeemed') {
        throw new BusinessRuleError(
          'ACTIVATION_CODE_ALREADY_USED',
          'Este codigo ya fue utilizado. Si crees que es un error, contacta con tu institucion.',
          { field: 'activationCode' },
        );
      }

      throw new BusinessRuleError(
        'ACTIVATION_CODE_INVALID',
        'El codigo del libro no es valido. Revisa que lo hayas copiado correctamente.',
        { field: 'activationCode' },
      );
    }
  }

  private async assertClassroomAccepts(
    institutionId: string,
    classroomId: string,
  ): Promise<{ name?: string }> {
    const check = await this.classrooms.precheck({ institutionId, classroomId });

    // El salon existe pero es de otro colegio: se responde igual que si no
    // existiera. Distinguirlos permitiria a cualquiera sondear que ids de salon
    // son reales en otras instituciones.
    if (!check.exists || !check.belongsToInstitution) {
      throw new BusinessRuleError(
        'CLASSROOM_NOT_FOUND',
        'El salon seleccionado no esta disponible.',
        { field: 'classroomId' },
      );
    }

    // Comprobacion informativa: el cupo REAL se vuelve a verificar dentro de la
    // transaccion de matricula en el servicio de instituciones. Aqui solo
    // evitamos que el usuario complete un formulario largo para que se lo
    // rechacen al final.
    if (!check.hasCapacity) {
      throw new BusinessRuleError(
        'CLASSROOM_FULL',
        'El salon ya alcanzo su cupo maximo. Consulta con tu docente.',
        { field: 'classroomId', capacity: check.capacity, enrolled: check.enrolled },
      );
    }

    return { name: check.classroomName };
  }

  /**
   * Emite el token de verificacion de correo.
   *
   * En cuentas de menores de 14 el aviso va tambien al apoderado. El envio del
   * correo lo hace el servicio de engagement al consumir el evento de registro;
   * aqui solo se crea el token, para que su vida y su unicidad las controle
   * identidad, que es quien las hara valer.
   */
  private async issueVerificationToken(user: User, _context: ExecutionContext): Promise<void> {
    await this.oneTimeTokens.issue({
      purpose: 'email_verification',
      userId: user.id.value,
      ttlSeconds: 48 * 3600,
    });
  }
}
