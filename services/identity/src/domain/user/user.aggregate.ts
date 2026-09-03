import { AggregateRoot, BusinessRuleError, ForbiddenError, Guard } from '@glexco/kernel';
import { ROLES, canCreateRole, resolvePermissions, type Permission, type Role } from '@glexco/contracts';
import {
  BirthDate,
  Email,
  LocalePreference,
  PasswordHash,
  PersonName,
  UserId,
} from './value-objects';
import {
  UserDeactivated,
  UserEmailVerified,
  UserPasswordChanged,
  UserProfileUpdated,
  UserReactivated,
  UserRegistered,
  UserRoleGranted,
  UserRoleRevoked,
} from './user.events';

export type UserStatus = 'pending_verification' | 'active' | 'suspended' | 'deactivated';
export type AccountType = 'institutional' | 'independent' | 'staff';

interface UserState {
  email: Email;
  name: PersonName;
  birthDate: BirthDate | null;
  passwordHash: PasswordHash;
  roles: Role[];
  institutionId: string | null;
  status: UserStatus;
  accountType: AccountType;
  emailVerified: boolean;
  guardianEmail: Email | null;
  locale: LocalePreference;
  avatarUrl: string | null;
  mustChangePassword: boolean;
  acceptedTermsAt: Date | null;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Agregado User: la unica puerta de entrada al estado de una cuenta.
 *
 * Todas las reglas de acceso viven aqui y no en el caso de uso, porque un caso
 * de uso es un guion (orquesta puertos) mientras que estas son invariantes que
 * deben cumplirse SIEMPRE, venga la operacion de HTTP, de un consumidor de
 * eventos o de un script de importacion masiva de alumnos.
 */
export class User extends AggregateRoot<UserId> {
  private constructor(
    id: UserId,
    private state: UserState,
  ) {
    super(id);
  }

  // -------------------------------------------------------------------------
  // Creacion
  // -------------------------------------------------------------------------

  /**
   * Alta de un alumno desde el formulario publico.
   *
   * Nace en `pending_verification`: puede entrar y ver su contenido, pero hasta
   * verificar el correo no recibe notificaciones ni puede recuperar la cuenta.
   * Bloquear el acceso hasta verificar seria peor experiencia sin ganancia real
   * de seguridad, y en un aula genera una avalancha de tickets el primer dia.
   */
  static registerStudent(input: {
    id: UserId;
    email: Email;
    name: PersonName;
    birthDate: BirthDate;
    passwordHash: PasswordHash;
    locale: LocalePreference;
    accountType: 'institutional' | 'independent';
    institutionId?: string;
    classroomId?: string;
    grade?: string;
    /** Fila del codigo canjeado, para que catalogo complete el canje al
     *  consumir el evento. Nunca el codigo. */
    activationCodeId?: string;
    guardianEmail?: Email;
    now: Date;
  }): User {
    const requiresGuardian = input.birthDate.requiresGuardian(input.now);

    // Regla legal, no de interfaz: se comprueba en el dominio para que ningun
    // camino de alta (importacion masiva incluida) pueda saltarsela.
    if (requiresGuardian && !input.guardianEmail) {
      throw new BusinessRuleError(
        'GUARDIAN_EMAIL_REQUIRED',
        'Los menores de 14 anos necesitan el correo de un apoderado.',
        { minimumAge: BirthDate.GUARDIAN_REQUIRED_BELOW },
      );
    }

    if (input.accountType === 'institutional') {
      Guard.againstEmpty(input.institutionId ?? '', 'institutionId');
      Guard.againstEmpty(input.classroomId ?? '', 'classroomId');
    }

    const user = new User(input.id, {
      email: input.email,
      name: input.name,
      birthDate: input.birthDate,
      passwordHash: input.passwordHash,
      roles: [ROLES.STUDENT],
      institutionId: input.institutionId ?? null,
      status: 'pending_verification',
      accountType: input.accountType,
      emailVerified: false,
      guardianEmail: input.guardianEmail ?? null,
      locale: input.locale,
      avatarUrl: null,
      mustChangePassword: false,
      acceptedTermsAt: input.now,
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    });

    user.record(
      (version) =>
        new UserRegistered(
          {
            userId: input.id.value,
            email: input.email.value,
            firstName: input.name.first,
            lastName: input.name.last,
            roles: [ROLES.STUDENT],
            institutionId: input.institutionId,
            classroomId: input.classroomId,
            grade: input.grade,
            activationCodeId: input.activationCodeId,
            locale: input.locale.value,
            requiresGuardianConsent: requiresGuardian,
            guardianEmail: input.guardianEmail?.value,
            accountType: input.accountType,
            registeredAt: input.now.toISOString(),
          },
          version,
          { tenantId: input.institutionId },
        ),
    );

    return user;
  }

  /**
   * Alta de personal: docente, administrador de institucion o empleado GLEXCO.
   *
   * A diferencia del alumno, la crea otra persona. Por eso:
   * - Se comprueba la matriz de creacion de roles: es lo que impide que un
   *   administrador de institucion se fabrique un `platform_admin`.
   * - Nace con `mustChangePassword`, porque la contrasena inicial la conoce
   *   quien creo la cuenta y por tanto no es un secreto.
   */
  static createStaff(input: {
    id: UserId;
    email: Email;
    name: PersonName;
    passwordHash: PasswordHash;
    role: Role;
    institutionId?: string;
    locale: LocalePreference;
    createdBy: { userId: string; roles: Role[] };
    now: Date;
  }): User {
    if (!canCreateRole(input.createdBy.roles, input.role)) {
      throw new ForbiddenError(
        'ROLE_CREATION_NOT_ALLOWED',
        'No tienes permiso para crear usuarios con ese rol.',
        { targetRole: input.role },
      );
    }

    // Un docente o administrador de institucion sin institucion no tiene ambito
    // sobre el que operar: seria una cuenta con permisos y sin limites.
    if (
      (input.role === ROLES.TEACHER || input.role === ROLES.INSTITUTION_ADMIN) &&
      !input.institutionId
    ) {
      throw new BusinessRuleError(
        'INSTITUTION_REQUIRED_FOR_ROLE',
        'Este rol debe pertenecer a una institucion educativa.',
        { role: input.role },
      );
    }

    const user = new User(input.id, {
      email: input.email,
      name: input.name,
      birthDate: null,
      passwordHash: input.passwordHash,
      roles: [input.role],
      institutionId: input.institutionId ?? null,
      status: 'pending_verification',
      accountType: 'staff',
      emailVerified: false,
      guardianEmail: null,
      locale: input.locale,
      avatarUrl: null,
      mustChangePassword: true,
      acceptedTermsAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    });

    user.record(
      (version) =>
        new UserRegistered(
          {
            userId: input.id.value,
            email: input.email.value,
            firstName: input.name.first,
            lastName: input.name.last,
            roles: [input.role],
            institutionId: input.institutionId,
            locale: input.locale.value,
            requiresGuardianConsent: false,
            accountType: 'institutional',
            registeredAt: input.now.toISOString(),
          },
          version,
          { actorId: input.createdBy.userId, tenantId: input.institutionId },
        ),
    );

    return user;
  }

  /** Rehidrata el agregado desde la base. No emite eventos. */
  static rehydrate(id: UserId, state: UserState, version: number): User {
    const user = new User(id, state);
    user.setVersion(version);
    return user;
  }

  // -------------------------------------------------------------------------
  // Autenticacion
  // -------------------------------------------------------------------------

  /**
   * Bloqueo progresivo de la cuenta tras intentos fallidos.
   *
   * Es la segunda linea de defensa contra la fuerza bruta; la primera es el
   * limitador por IP. Hace falta la segunda porque el rociado de contrasenas
   * reparte los intentos entre miles de IPs para esquivar el limite por IP.
   *
   * El bloqueo es TEMPORAL y creciente, no permanente: un bloqueo permanente
   * convierte el ataque en una denegacion de servicio contra el usuario legitimo
   * (cualquiera que sepa un correo podria dejar fuera a esa persona).
   */
  private static readonly LOCK_THRESHOLD = 5;
  private static readonly LOCK_STEPS_MS = [
    1 * 60_000, //  6.º fallo -> 1 minuto
    5 * 60_000, //  7.º       -> 5 minutos
    15 * 60_000, // 8.º       -> 15 minutos
    60 * 60_000, // 9.º y siguientes -> 1 hora
  ];

  isLockedAt(now: Date): boolean {
    return this.state.lockedUntil !== null && this.state.lockedUntil > now;
  }

  get lockedUntil(): Date | null {
    return this.state.lockedUntil;
  }

  /**
   * Registra un intento fallido.
   *
   * No emite evento de dominio a proposito: en un ataque se generarian millones
   * de eventos que inundarian la outbox y el bus. La deteccion de patrones se
   * hace con las metricas de la sonda y el registro de auditoria, que es donde
   * corresponde.
   */
  recordFailedLogin(now: Date): void {
    this.touch();
    this.state.failedLoginAttempts += 1;
    this.state.updatedAt = now;

    if (this.state.failedLoginAttempts > User.LOCK_THRESHOLD) {
      const stepIndex = Math.min(
        this.state.failedLoginAttempts - User.LOCK_THRESHOLD - 1,
        User.LOCK_STEPS_MS.length - 1,
      );
      const lockMs = User.LOCK_STEPS_MS[stepIndex]!;
      this.state.lockedUntil = new Date(now.getTime() + lockMs);
    }
  }

  recordSuccessfulLogin(now: Date): void {
    this.touch();
    this.state.failedLoginAttempts = 0;
    this.state.lockedUntil = null;
    this.state.lastLoginAt = now;
    this.state.updatedAt = now;
  }

  /**
   * Comprueba que la cuenta puede iniciar sesion.
   *
   * Los mensajes son deliberadamente poco especificos hacia fuera: distinguir
   * "no existe" de "contrasena incorrecta" de "cuenta bloqueada" permite
   * enumerar usuarios validos. El detalle queda en el codigo de error, que solo
   * se usa para telemetria interna.
   */
  assertCanAuthenticate(now: Date): void {
    if (this.isLockedAt(now)) {
      throw new BusinessRuleError(
        'ACCOUNT_TEMPORARILY_LOCKED',
        'La cuenta esta bloqueada temporalmente por intentos fallidos.',
        { retryAfterSeconds: Math.ceil((this.state.lockedUntil!.getTime() - now.getTime()) / 1000) },
      );
    }

    if (this.state.status === 'deactivated') {
      throw new ForbiddenError('ACCOUNT_DEACTIVATED', 'La cuenta esta desactivada.');
    }

    if (this.state.status === 'suspended') {
      throw new ForbiddenError('ACCOUNT_SUSPENDED', 'La cuenta esta suspendida.');
    }
  }

  // -------------------------------------------------------------------------
  // Ciclo de vida
  // -------------------------------------------------------------------------

  verifyEmail(now: Date): void {
    // Idempotente: reabrir el enlace de verificacion es normal (el usuario le da
    // dos veces, o el cliente de correo lo pre-carga) y no debe dar error.
    if (this.state.emailVerified) return;

    this.state.emailVerified = true;
    if (this.state.status === 'pending_verification') this.state.status = 'active';
    this.state.updatedAt = now;

    this.record(
      (version) =>
        new UserEmailVerified(
          {
            userId: this.id.value,
            email: this.state.email.value,
            verifiedAt: now.toISOString(),
          },
          version,
        ),
    );
  }

  changePassword(
    newHash: PasswordHash,
    reason: 'self_service' | 'reset' | 'admin_forced',
    now: Date,
  ): void {
    this.state.passwordHash = newHash;
    this.state.mustChangePassword = reason === 'admin_forced';
    // Cambiar la contrasena desbloquea la cuenta: si el usuario legitimo acaba
    // de demostrar control sobre su correo, el bloqueo por intentos fallidos ya
    // no protege nada y solo estorba.
    this.state.failedLoginAttempts = 0;
    this.state.lockedUntil = null;
    this.state.updatedAt = now;

    this.record(
      (version) =>
        new UserPasswordChanged(
          { userId: this.id.value, reason, changedAt: now.toISOString() },
          version,
        ),
    );
  }

  /** Marca que la contrasena debe rehashearse con parametros mas fuertes.
   *  No es un cambio de contrasena: no emite evento ni notifica al usuario. */
  upgradePasswordHash(newHash: PasswordHash, now: Date): void {
    this.touch();
    this.state.passwordHash = newHash;
    this.state.updatedAt = now;
  }

  grantRole(role: Role, grantedBy: { userId: string; roles: Role[] }, now: Date): void {
    if (!canCreateRole(grantedBy.roles, role)) {
      throw new ForbiddenError(
        'ROLE_GRANT_NOT_ALLOWED',
        'No tienes permiso para conceder ese rol.',
        { targetRole: role },
      );
    }
    if (this.state.roles.includes(role)) return;

    this.state.roles = [...this.state.roles, role];
    this.state.updatedAt = now;

    this.record(
      (version) =>
        new UserRoleGranted(
          {
            userId: this.id.value,
            role,
            institutionId: this.state.institutionId ?? undefined,
            grantedBy: grantedBy.userId,
            at: now.toISOString(),
          },
          version,
          { actorId: grantedBy.userId },
        ),
    );
  }

  revokeRole(role: Role, revokedBy: { userId: string; roles: Role[] }, now: Date): void {
    if (!this.state.roles.includes(role)) return;

    // Una cuenta sin roles quedaria autenticada y sin poder hacer nada: es un
    // estado que solo genera tickets de soporte. Para retirar el acceso existe
    // `deactivate`, que es explicito y auditable.
    if (this.state.roles.length === 1) {
      throw new BusinessRuleError(
        'CANNOT_REVOKE_LAST_ROLE',
        'No se puede retirar el ultimo rol de un usuario. Desactiva la cuenta en su lugar.',
      );
    }

    if (!canCreateRole(revokedBy.roles, role)) {
      throw new ForbiddenError('ROLE_REVOKE_NOT_ALLOWED', 'No tienes permiso para retirar ese rol.');
    }

    this.state.roles = this.state.roles.filter((current) => current !== role);
    this.state.updatedAt = now;

    this.record(
      (version) =>
        new UserRoleRevoked(
          {
            userId: this.id.value,
            role,
            institutionId: this.state.institutionId ?? undefined,
            grantedBy: revokedBy.userId,
            at: now.toISOString(),
          },
          version,
          { actorId: revokedBy.userId },
        ),
    );
  }

  /**
   * Desactivacion, no borrado.
   *
   * El progreso academico, las evaluaciones y los certificados de un alumno
   * deben sobrevivir a que deje el colegio: son su historial. Ademas, borrar
   * dejaria huerfanas las referencias de otros servicios. Para el derecho de
   * supresion existe un proceso aparte de anonimizacion.
   */
  deactivate(reason: string, by: string, now: Date): void {
    if (this.state.status === 'deactivated') return;

    this.state.status = 'deactivated';
    this.state.updatedAt = now;

    this.record(
      (version) =>
        new UserDeactivated(
          { userId: this.id.value, reason, deactivatedBy: by, at: now.toISOString() },
          version,
          { actorId: by, tenantId: this.state.institutionId ?? undefined },
        ),
    );
  }

  reactivate(by: string, now: Date): void {
    if (this.state.status !== 'deactivated') return;

    this.state.status = this.state.emailVerified ? 'active' : 'pending_verification';
    this.state.failedLoginAttempts = 0;
    this.state.lockedUntil = null;
    this.state.updatedAt = now;

    this.record(
      (version) =>
        new UserReactivated({ userId: this.id.value, reactivatedBy: by, at: now.toISOString() }, version, {
          actorId: by,
        }),
    );
  }

  updateProfile(input: { name?: PersonName; locale?: LocalePreference; avatarUrl?: string | null }, now: Date): void {
    if (input.name) this.state.name = input.name;
    if (input.locale) this.state.locale = input.locale;
    if (input.avatarUrl !== undefined) this.state.avatarUrl = input.avatarUrl;
    this.state.updatedAt = now;

    this.record(
      (version) =>
        new UserProfileUpdated(
          {
            userId: this.id.value,
            firstName: this.state.name.first,
            lastName: this.state.name.last,
            locale: this.state.locale.value,
            avatarUrl: this.state.avatarUrl,
            at: now.toISOString(),
          },
          version,
        ),
    );
  }

  // -------------------------------------------------------------------------
  // Consultas
  // -------------------------------------------------------------------------

  get email(): Email {
    return this.state.email;
  }
  get name(): PersonName {
    return this.state.name;
  }
  get passwordHash(): PasswordHash {
    return this.state.passwordHash;
  }
  get roles(): readonly Role[] {
    return this.state.roles;
  }
  get institutionId(): string | null {
    return this.state.institutionId;
  }
  get status(): UserStatus {
    return this.state.status;
  }
  get accountType(): AccountType {
    return this.state.accountType;
  }
  get emailVerified(): boolean {
    return this.state.emailVerified;
  }
  get locale(): LocalePreference {
    return this.state.locale;
  }
  get avatarUrl(): string | null {
    return this.state.avatarUrl;
  }
  get mustChangePassword(): boolean {
    return this.state.mustChangePassword;
  }
  get guardianEmail(): Email | null {
    return this.state.guardianEmail;
  }
  get birthDate(): BirthDate | null {
    return this.state.birthDate;
  }
  get failedLoginAttempts(): number {
    return this.state.failedLoginAttempts;
  }
  get lastLoginAt(): Date | null {
    return this.state.lastLoginAt;
  }
  get acceptedTermsAt(): Date | null {
    return this.state.acceptedTermsAt;
  }
  get createdAt(): Date {
    return this.state.createdAt;
  }
  get updatedAt(): Date {
    return this.state.updatedAt;
  }

  /** Permisos efectivos, expandidos desde los roles. */
  get permissions(): Permission[] {
    return resolvePermissions(this.state.roles);
  }

  /** Una sesion es critica si el usuario puede causar dano amplio. Estas si
   *  consultan la lista de revocacion en Redis en cada peticion. */
  get hasCriticalSession(): boolean {
    return this.state.roles.some(
      (role) =>
        role === ROLES.PLATFORM_OWNER ||
        role === ROLES.PLATFORM_ADMIN ||
        role === ROLES.CONTENT_MANAGER ||
        role === ROLES.SUPPORT_AGENT ||
        role === ROLES.COMMERCIAL_AGENT ||
        role === ROLES.INSTITUTION_ADMIN,
    );
  }

  /** Instantanea para el repositorio. Es el unico punto que expone el estado
   *  completo, y solo lo consume la capa de persistencia. */
  snapshot(): Readonly<UserState> {
    return this.state;
  }
}
