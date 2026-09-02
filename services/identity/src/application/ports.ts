import type { Permission, Role } from '@glexco/contracts';

/**
 * Puertos propios del servicio de identidad, adicionales a los del kernel.
 */

// ---------------------------------------------------------------------------
// Emision de tokens
// ---------------------------------------------------------------------------

export interface TokenIssuer {
  issueAccessToken(input: AccessTokenInput): { token: string; expiresInSeconds: number };
  issueRefreshToken(input: RefreshTokenInput): { token: string; tokenId: string; expiresAt: Date };
  verifyRefreshToken(token: string): RefreshTokenPayload;
}

export interface AccessTokenInput {
  userId: string;
  sessionId: string;
  roles: Role[];
  permissions: Permission[];
  institutionId?: string;
  locale: 'es' | 'en';
  critical: boolean;
}

export interface RefreshTokenInput {
  userId: string;
  sessionId: string;
  familyId: string;
  /** Vida larga para "recordarme"; corta en un equipo compartido, que en un
   *  colegio es la norma y no la excepcion. */
  longLived: boolean;
}

export interface RefreshTokenPayload {
  userId: string;
  sessionId: string;
  familyId: string;
  tokenId: string;
  expiresAt: Date;
}

// ---------------------------------------------------------------------------
// Tokens de un solo uso (verificacion de correo, recuperacion de contrasena)
// ---------------------------------------------------------------------------

/**
 * Almacen de tokens de un solo uso.
 *
 * El token se entrega al usuario en claro por correo, pero se guarda HASHEADO.
 * Motivo: si alguien obtiene una copia de la base de datos, no puede usar los
 * tokens pendientes para tomar cuentas ajenas. Es el mismo razonamiento que con
 * las contrasenas.
 */
export interface OneTimeTokenStore {
  issue(input: {
    purpose: 'email_verification' | 'password_reset' | 'guardian_consent';
    userId: string;
    ttlSeconds: number;
  }): Promise<{ token: string }>;

  /** Consume el token. Devuelve el userId si es valido; `null` si no existe, ya
   *  se uso o caduco. La operacion es atomica: un token no puede usarse dos
   *  veces aunque lleguen dos peticiones simultaneas. */
  consume(purpose: string, token: string): Promise<{ userId: string } | null>;

  /** Invalida los tokens pendientes de un usuario y proposito. Se usa al cambiar
   *  la contrasena: los enlaces de recuperacion antiguos deben morir. */
  invalidateAll(purpose: string, userId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Comprobaciones contra otros servicios
// ---------------------------------------------------------------------------

/**
 * Verificacion previa del codigo de activacion contra el servicio de catalogo.
 *
 * Es una comprobacion de LECTURA, no el canje. El canje real ocurre despues,
 * de forma asincrona, cuando catalogo consume `identity.user.registered.v1`.
 *
 * Por que en dos pasos: canjear de forma sincrona exigiria una transaccion
 * distribuida entre identidad y catalogo, que no existe. La comprobacion previa
 * hace que un codigo invalido falle de inmediato en el formulario (que es lo que
 * importa para la experiencia), y el canje asincrono es idempotente y
 * compensable: si al final el codigo resultara ya usado por una condicion de
 * carrera, catalogo emite un evento de rechazo e identidad marca la cuenta como
 * pendiente de resolucion en vez de dejar al alumno con acceso indebido.
 */
export interface ActivationCodeGateway {
  precheck(code: string): Promise<ActivationCodePrecheck>;
}

export interface ActivationCodePrecheck {
  valid: boolean;
  reason?: 'not_found' | 'already_redeemed' | 'revoked' | 'expired';
  kitId?: string;
  kitName?: string;
  grade?: string;
  program?: 'discover' | 'academy';
}

/** Comprobacion previa del salon contra el servicio de instituciones. */
export interface ClassroomGateway {
  precheck(input: {
    institutionId: string;
    classroomId: string;
  }): Promise<ClassroomPrecheck>;
}

export interface ClassroomPrecheck {
  exists: boolean;
  /** Que el salon pertenezca a la institucion declarada. Sin esta comprobacion,
   *  un alumno podria matricularse en el salon de otro colegio conociendo su id. */
  belongsToInstitution: boolean;
  hasCapacity: boolean;
  capacity: number;
  enrolled: number;
  teacherName?: string;
  classroomName?: string;
}

// ---------------------------------------------------------------------------
// Politica de contrasenas
// ---------------------------------------------------------------------------

/**
 * Rechazo de contrasenas debiles.
 *
 * Siguiendo NIST SP 800-63B, es MAS efectivo comprobar contra una lista de
 * contrasenas conocidas que exigir mayusculas y simbolos. Las reglas de
 * composicion producen "Password1!" de forma sistematica; la lista bloquea
 * exactamente lo que los atacantes prueban primero.
 */
export interface PasswordPolicy {
  assertAcceptable(input: {
    password: string;
    email: string;
    firstName: string;
    lastName: string;
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------

/**
 * Registro de auditoria de acceso.
 *
 * Separado de los eventos de dominio a proposito: la auditoria debe conservarse
 * aunque el evento correspondiente ya haya salido del stream, tiene valor legal
 * y se consulta con filtros que un stream de eventos no soporta bien.
 */
export interface AuditLog {
  record(entry: AuditEntry): Promise<void>;
}

export interface AuditEntry {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  outcome: 'success' | 'failure';
  reason?: string;
  institutionId?: string | null;
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}
