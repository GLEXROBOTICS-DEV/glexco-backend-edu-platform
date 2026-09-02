import { timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import type { Request } from 'express';
import { ForbiddenError } from '@glexco/kernel';

export const INTERNAL_SERVICE_TOKEN = Symbol('INTERNAL_SERVICE_TOKEN');

/**
 * Protege los endpoints que consumen otros microservicios, no el navegador.
 *
 * Es la SEGUNDA barrera. La primera es que el gateway no publica las rutas
 * `/internal`: su tabla de enrutado es explicita y no las incluye, asi que desde
 * fuera no hay camino hasta aqui. Esta guarda cubre el caso de que alguien
 * alcance la red interna -un contenedor comprometido, un servicio mal
 * configurado, un puerto expuesto por error- y evita que eso baste para operar
 * como si fuese un servicio de confianza.
 *
 * Detalles que importan:
 *
 * - La comparacion es en **tiempo constante**. Con `===`, el tiempo hasta la
 *   primera diferencia filtra el token byte a byte.
 *
 * - Si no hay token configurado, la guarda **deniega todo**. Es deliberado:
 *   dejarla pasar cuando falta configuracion convierte un despiste de
 *   despliegue en una puerta abierta, y ese fallo es silencioso hasta que
 *   alguien lo encuentra.
 */
@Injectable()
export class InternalOnlyGuard implements CanActivate {
  constructor(
    @Optional() @Inject(INTERNAL_SERVICE_TOKEN) private readonly expectedToken?: string,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (!this.expectedToken) {
      throw new ForbiddenError(
        'INTERNAL_API_NOT_CONFIGURED',
        'La API interna no esta disponible.',
      );
    }

    const header = request.headers.authorization;
    const presented = header?.startsWith('Bearer ') ? header.slice(7) : null;

    if (!presented || !safeEquals(presented, this.expectedToken)) {
      // Mismo error que si la ruta no existiera: no confirmamos que aqui haya
      // una API interna esperando el token correcto.
      throw new ForbiddenError('FORBIDDEN', 'Acceso no permitido.');
    }

    return true;
  }
}

/**
 * Comparacion en tiempo constante.
 *
 * `timingSafeEqual` exige buffers de la misma longitud, asi que la diferencia de
 * longitud se resuelve antes. Eso filtra la longitud del token, que no es
 * informacion util para un atacante: lo que protege es el contenido.
 */
function safeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
