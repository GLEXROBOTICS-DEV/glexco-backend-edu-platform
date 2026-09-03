import { DomainEvent, type DomainEventContext } from '@glexco/kernel';
import { EVENTS, type Role } from '@glexco/contracts';

/**
 * Eventos del agregado User.
 *
 * Cada uno lleva el minimo indispensable para que un consumidor actue sin tener
 * que volver a preguntar a identidad. Deliberadamente NO llevan el hash de la
 * contrasena, ni el codigo de activacion, ni ningun dato que un consumidor no
 * necesite: los eventos quedan persistidos en la outbox y en el stream durante
 * dias, asi que meter en ellos datos sensibles es multiplicar la superficie de
 * exposicion.
 */

const AGGREGATE = 'User';

export interface UserRegisteredPayload {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: Role[];
  institutionId?: string;
  classroomId?: string;
  /** Grado declarado en el registro; catalogo lo usa para resolver el kit. */
  grade?: string;
  /**
   * Id de la FILA del codigo de activacion que el alumno introdujo.
   *
   * Nunca el codigo. El codigo es un secreto con valor economico y este evento
   * vive dias en la outbox y en el stream; el identificador de su fila, en
   * cambio, no permite deducirlo ni canjear nada por HTTP. Con el, catalogo
   * puede completar el canje de forma asincrona al consumir este evento.
   */
  activationCodeId?: string;
  locale: 'es' | 'en';
  /** Cuenta de un menor de 14: engagement debe avisar tambien al apoderado. */
  requiresGuardianConsent: boolean;
  guardianEmail?: string;
  accountType: 'institutional' | 'independent';
  registeredAt: string;
}

export class UserRegistered extends DomainEvent<UserRegisteredPayload> {
  constructor(payload: UserRegisteredPayload, version: number, context?: DomainEventContext) {
    super(EVENTS.USER_REGISTERED, AGGREGATE, payload.userId, version, payload, context);
  }
}

export interface UserEmailVerifiedPayload {
  userId: string;
  email: string;
  verifiedAt: string;
}

export class UserEmailVerified extends DomainEvent<UserEmailVerifiedPayload> {
  constructor(payload: UserEmailVerifiedPayload, version: number, context?: DomainEventContext) {
    super(EVENTS.USER_EMAIL_VERIFIED, AGGREGATE, payload.userId, version, payload, context);
  }
}

export interface UserPasswordChangedPayload {
  userId: string;
  /** Distingue el cambio voluntario del forzado tras un reseteo, porque el aviso
   *  al usuario y la reaccion de seguridad son distintos. */
  reason: 'self_service' | 'reset' | 'admin_forced';
  changedAt: string;
}

export class UserPasswordChanged extends DomainEvent<UserPasswordChangedPayload> {
  constructor(payload: UserPasswordChangedPayload, version: number, context?: DomainEventContext) {
    super(EVENTS.USER_PASSWORD_CHANGED, AGGREGATE, payload.userId, version, payload, context);
  }
}

export interface UserRoleChangedPayload {
  userId: string;
  role: Role;
  institutionId?: string;
  /** Quien concedio o revoco el rol. Imprescindible para auditoria. */
  grantedBy: string;
  at: string;
}

export class UserRoleGranted extends DomainEvent<UserRoleChangedPayload> {
  constructor(payload: UserRoleChangedPayload, version: number, context?: DomainEventContext) {
    super(EVENTS.USER_ROLE_GRANTED, AGGREGATE, payload.userId, version, payload, context);
  }
}

export class UserRoleRevoked extends DomainEvent<UserRoleChangedPayload> {
  constructor(payload: UserRoleChangedPayload, version: number, context?: DomainEventContext) {
    super(EVENTS.USER_ROLE_REVOKED, AGGREGATE, payload.userId, version, payload, context);
  }
}

export interface UserDeactivatedPayload {
  userId: string;
  reason: string;
  deactivatedBy: string;
  at: string;
}

export class UserDeactivated extends DomainEvent<UserDeactivatedPayload> {
  constructor(payload: UserDeactivatedPayload, version: number, context?: DomainEventContext) {
    super(EVENTS.USER_DEACTIVATED, AGGREGATE, payload.userId, version, payload, context);
  }
}

export interface UserReactivatedPayload {
  userId: string;
  reactivatedBy: string;
  at: string;
}

export class UserReactivated extends DomainEvent<UserReactivatedPayload> {
  constructor(payload: UserReactivatedPayload, version: number, context?: DomainEventContext) {
    super(EVENTS.USER_REACTIVATED, AGGREGATE, payload.userId, version, payload, context);
  }
}

export interface UserProfileUpdatedPayload {
  userId: string;
  firstName: string;
  lastName: string;
  locale: 'es' | 'en';
  avatarUrl: string | null;
  at: string;
}

export class UserProfileUpdated extends DomainEvent<UserProfileUpdatedPayload> {
  constructor(payload: UserProfileUpdatedPayload, version: number, context?: DomainEventContext) {
    super(EVENTS.USER_PROFILE_UPDATED, AGGREGATE, payload.userId, version, payload, context);
  }
}
