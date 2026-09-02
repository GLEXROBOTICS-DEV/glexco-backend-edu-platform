import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  SetMetadata,
  createParamDecorator,
  Inject,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import type { Redis } from 'ioredis';
import { ForbiddenError, UnauthorizedError } from '@glexco/kernel';
import type { Permission, Role } from '@glexco/contracts';
import { REDIS_CLIENT } from '../redis/redis.provider';
import type { AccessTokenClaims, RequestActor } from './jwt.types';

export const JWT_VERIFY_OPTIONS = Symbol('JWT_VERIFY_OPTIONS');

export interface JwtVerifyOptions {
  secret: string;
  issuer: string;
  audience: string;
}

// ---------------------------------------------------------------------------
// Decoradores
// ---------------------------------------------------------------------------

const IS_PUBLIC = 'glexco:public';
const REQUIRED_PERMISSIONS = 'glexco:permissions';
const REQUIRED_ROLES = 'glexco:roles';

/** Marca una ruta accesible sin autenticacion (login, registro, verificacion). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

/** Exige TODOS los permisos indicados. */
export const RequirePermissions = (
  ...permissions: Permission[]
): MethodDecorator & ClassDecorator => SetMetadata(REQUIRED_PERMISSIONS, permissions);

/** Exige al menos UNO de los roles indicados. Se prefiere `RequirePermissions`:
 *  los permisos sobreviven a una reorganizacion de roles, los roles no. */
export const RequireRoles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_ROLES, roles);

/** Inyecta el actor autenticado en un parametro del controlador. */
export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestActor => {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.actor) {
      throw new UnauthorizedError('UNAUTHENTICATED', 'La peticion no tiene un actor autenticado.');
    }
    return request.actor;
  },
);

// ---------------------------------------------------------------------------
// Guardia de autenticacion
// ---------------------------------------------------------------------------

/**
 * Verifica el access token en CADA servicio, no solo en el gateway.
 *
 * Es defensa en profundidad: si alguien alcanza la red interna (un servicio
 * comprometido, una regla de red mal puesta, un despliegue que expone un puerto
 * por error), no basta con esquivar el gateway para operar como administrador.
 *
 * La verificacion es local, sin llamadas de red: comprobar una firma HMAC cuesta
 * microsegundos, y eso es lo que permite que la autenticacion no sea un cuello
 * de botella a decenas de miles de peticiones por segundo.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(JWT_VERIFY_OPTIONS) private readonly options: JwtVerifyOptions,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearer(request);

    if (!token) {
      throw new UnauthorizedError('MISSING_TOKEN', 'Falta el token de acceso.');
    }

    let claims: AccessTokenClaims;
    try {
      claims = jwt.verify(token, this.options.secret, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: ['HS256'], // Fijar el algoritmo cierra el ataque "alg: none".
        clockTolerance: 5, // Margen para desfases de reloj entre replicas.
      }) as AccessTokenClaims;
    } catch (error) {
      const expired = error instanceof jwt.TokenExpiredError;
      throw new UnauthorizedError(
        expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
        expired ? 'El token de acceso caduco.' : 'El token de acceso no es valido.',
      );
    }

    // Solo las sesiones marcadas como criticas pagan el viaje a Redis. Aplicarlo
    // a todas anadiria una llamada de red por peticion a millones de alumnos,
    // que es precisamente lo que evitamos al meter los permisos en el token.
    if (claims.crit && this.redis) {
      const revoked = await this.redis.exists(`revoked:session:${claims.sid}`).catch(() => 0);
      if (revoked === 1) {
        throw new UnauthorizedError('SESSION_REVOKED', 'La sesion fue revocada.');
      }
    }

    request.actor = {
      userId: claims.sub,
      sessionId: claims.sid,
      roles: claims.roles ?? [],
      permissions: claims.perms ?? [],
      institutionId: claims.inst,
      locale: claims.loc ?? 'es',
      isCritical: claims.crit === true,
    };

    return true;
  }
}

// ---------------------------------------------------------------------------
// Guardia de autorizacion
// ---------------------------------------------------------------------------

/**
 * Comprueba permisos y roles declarados en el controlador.
 *
 * IMPORTANTE: esto solo resuelve "puede hacer esta clase de operacion". El
 * "puede hacerlo sobre ESTE recurso" (este salon, este alumno, esta institucion)
 * lo decide el caso de uso, porque depende de datos que el guardia no tiene.
 * Confundir ambas cosas es como se producen las fugas entre instituciones.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required?.length && !requiredRoles?.length) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const actor = request.actor;

    if (!actor) {
      throw new UnauthorizedError('UNAUTHENTICATED', 'La peticion no tiene un actor autenticado.');
    }

    if (required?.length) {
      const missing = required.filter((permission) => !actor.permissions.includes(permission));
      if (missing.length > 0) {
        // No se devuelve la lista de permisos que faltan: enumerar el modelo de
        // permisos ayuda mas a quien sondea el sistema que a quien lo usa bien.
        throw new ForbiddenError('INSUFFICIENT_PERMISSIONS', 'No tienes permiso para esta accion.');
      }
    }

    if (requiredRoles?.length) {
      const hasRole = requiredRoles.some((role) => actor.roles.includes(role));
      if (!hasRole) {
        throw new ForbiddenError('INSUFFICIENT_ROLE', 'No tienes permiso para esta accion.');
      }
    }

    return true;
  }
}

function extractBearer(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!value || scheme?.toLowerCase() !== 'bearer') return null;
  return value.trim();
}
