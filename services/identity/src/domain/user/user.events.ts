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

// ---------------------------------------------------------------------------
// Correos con enlace de un solo uso
// ---------------------------------------------------------------------------

/**
 * Peticion de envio de un correo con enlace.
 *
 * **El token NO va en el payload, y es lo que define este evento.** Un evento
 * vive dias en la outbox y en el stream: un token de recuperacion escrito ahi
 * convierte el acceso de lectura a una tabla en el control de cualquier cuenta.
 * Es el mismo criterio por el que el codigo de activacion viaja como id de fila.
 *
 * Engagement pide el token a identidad por la API interna justo antes de enviar,
 * asi que el secreto cruza la red una vez y no queda escrito en ningun registro
 * duradero. Ademas, la vida del enlace empieza cuando el correo sale: con la
 * outbox retrasada, un token embebido llegaria ya medio caducado.
 */
export interface EmailDeliveryRequestedPayload {
  userId: string;
  email: string;
  firstName: string;
  locale: 'es' | 'en';
  /** Correo del apoderado, cuando el alumno es menor de 14. El aviso de creacion
   *  de cuenta va tambien a un adulto: es un requisito legal, no una cortesia. */
  guardianEmail?: string | null;
  requestedAt: string;
}

export class EmailVerificationRequested extends DomainEvent<EmailDeliveryRequestedPayload> {
  constructor(payload: EmailDeliveryRequestedPayload, version: number, context?: DomainEventContext) {
    super(EVENTS.EMAIL_VERIFICATION_REQUESTED, AGGREGATE, payload.userId, version, payload, context);
  }
}

export class PasswordResetRequested extends DomainEvent<EmailDeliveryRequestedPayload> {
  constructor(payload: EmailDeliveryRequestedPayload, version: number, context?: DomainEventContext) {
    super(EVENTS.PASSWORD_RESET_REQUESTED, AGGREGATE, payload.userId, version, payload, context);
  }
}
