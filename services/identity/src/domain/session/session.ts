import { defineId } from '@glexco/kernel';

export class SessionId extends defineId('Session') {}

/**
 * Sesion de usuario.
 *
 * No es un agregado con persistencia relacional: vive en Redis, con caducidad
 * automatica. Motivo: es estado de alta rotacion y vida corta (millones de
 * escrituras al dia, cero valor historico), justo el perfil de dato que
 * envenena una base relacional de tabla creciente y VACUUM constante.
 *
 * Lo que si se guarda en PostgreSQL es el registro de auditoria de acceso, que
 * es otra cosa: pocos campos, escritura unica y valor legal.
 */
export interface Session {
  id: string;
  userId: string;
  /**
   * Familia de rotacion del refresh token.
   *
   * Cada refresco emite un token nuevo dentro de la misma familia e invalida el
   * anterior. Si aparece un token YA USADO de esta familia, significa que
   * alguien lo copio: se revoca la familia entera y se fuerza reautenticacion.
   * Es la deteccion de robo de token recomendada por OAuth 2.1.
   */
  familyId: string;
  /**
   * Identificador del refresh token vigente.
   *
   * Es lo que permite detectar la reutilizacion: si llega un refresh token cuyo
   * `jti` no coincide con este, o bien es antiguo (robado) o bien la sesion ya
   * roto. Ese contraste es toda la deteccion.
   */
  currentTokenId: string;
  /** Numero de rotaciones. Un valor anormalmente alto delata automatizacion. */
  generation: number;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  /** Contexto del dispositivo, para que el usuario reconozca sus sesiones en
   *  "cerrar sesion en otros dispositivos". */
  userAgent?: string;
  ipAddress?: string;
  /** Sesion de administrador: se comprueba la revocacion en cada peticion. */
  critical: boolean;
}

/**
 * Puerto del almacen de sesiones.
 *
 * Las operaciones estan pensadas para ser O(1) en Redis. Deliberadamente no hay
 * "buscar sesiones por institucion" ni nada que exigiria recorrer claves: eso en
 * Redis es `SCAN` y a escala bloquea.
 */
export interface SessionStore {
  create(session: Session): Promise<void>;
  findById(sessionId: string): Promise<Session | null>;

  /**
   * Rota el refresh token de una sesion de forma ATOMICA.
   *
   * Debe ser atomico porque dos pestanas del navegador refrescan a la vez con
   * frecuencia. Sin atomicidad, ambas leerian el mismo token vigente, ambas
   * rotarian, y la segunda parecerria una reutilizacion: al usuario se le
   * cerraria la sesion sin motivo. Devuelve `null` si el token presentado ya no
   * es el vigente.
   */
  rotate(sessionId: string, presentedTokenId: string, next: Session): Promise<'rotated' | 'reused' | 'not_found'>;

  revoke(sessionId: string): Promise<void>;
  /** Revoca la familia entera ante sospecha de robo de token. */
  revokeFamily(familyId: string): Promise<void>;
  /** Cierra todas las sesiones del usuario (cambio de contrasena, desactivacion). */
  revokeAllForUser(userId: string): Promise<void>;
  listForUser(userId: string): Promise<Session[]>;
  /** Marca consultada por los guards cuando el token es de sesion critica. */
  isRevoked(sessionId: string): Promise<boolean>;
}
