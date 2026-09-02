import type { Permission, Role } from '@glexco/contracts';

/**
 * Contenido del access token.
 *
 * Lleva roles Y permisos ya resueltos para que ningun servicio tenga que
 * preguntar a identidad en cada peticion: eso convertiria a identidad en un
 * punto unico de fallo y anadiria un salto de red a cada llamada, justo lo que
 * hunde la latencia cuando el trafico sube.
 *
 * El precio es que revocar un permiso tarda, como maximo, lo que quede de vida
 * al token. Por eso el access token dura 15 minutos, y para las revocaciones que
 * deben ser inmediatas (expulsar una sesion, desactivar una cuenta) existe la
 * lista de sesiones revocadas en Redis, que los servicios consultan solo cuando
 * el token trae la marca `crit`.
 *
 * El token se mantiene pequeno a proposito: viaja en cada peticion, y un JWT de
 * 4 KB por request es ancho de banda desperdiciado a escala.
 */
export interface AccessTokenClaims {
  /** Subject: id del usuario. */
  sub: string;
  /** Id de sesion. Permite revocar una sola sesion sin tocar las demas. */
  sid: string;
  /** Roles asignados. */
  roles: Role[];
  /** Permisos efectivos, ya expandidos desde los roles. */
  perms: Permission[];
  /** Institucion del usuario. Ausente en personal GLEXCO e independientes. */
  inst?: string;
  /** Idioma preferido. */
  loc: 'es' | 'en';
  /** Marca de sesion critica: obliga a comprobar la lista de revocacion en
   *  Redis antes de operaciones sensibles (administradores y personal GLEXCO). */
  crit?: boolean;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
}

/** Contenido del refresh token. Deliberadamente minimo. */
export interface RefreshTokenClaims {
  sub: string;
  sid: string;
  /** Familia de rotacion: identifica la cadena de refrescos de una sesion.
   *  Si aparece un token ya usado de esta familia, se revoca la familia entera
   *  porque significa que alguien copio el token. */
  fam: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
}

/** Actor autenticado que se adjunta a la peticion tras validar el token. */
export interface RequestActor {
  userId: string;
  sessionId: string;
  roles: Role[];
  permissions: Permission[];
  institutionId?: string;
  locale: 'es' | 'en';
  isCritical: boolean;
}

declare module 'express' {
  interface Request {
    actor?: RequestActor;
  }
}
