import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { runWithContext } from '@glexco/observability';

export const CORRELATION_HEADER = 'x-correlation-id';

/**
 * Asigna (o propaga) el identificador de correlacion de la peticion.
 *
 * El gateway lo genera y lo reenvia a cada microservicio en la cabecera, de modo
 * que una sola busqueda por `correlationId` recupera los logs de toda la cadena
 * aunque cada salto haya caido en una replica distinta.
 *
 * El id que llega de fuera se acepta solo si parece un UUID: sin esa
 * comprobacion, un cliente podria inyectar texto arbitrario en nuestros logs
 * (log injection) o hacerlos crecer sin limite.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const incoming = request.headers[CORRELATION_HEADER];
    const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
    const correlationId = candidate && UUID_PATTERN.test(candidate) ? candidate : randomUUID();

    request.headers[CORRELATION_HEADER] = correlationId;
    response.setHeader(CORRELATION_HEADER, correlationId);

    // Todo lo que ocurra dentro de `next()` -incluidas las continuaciones
    // asincronas- vera este contexto sin tener que pasarlo por parametro.
    runWithContext(
      {
        correlationId,
        ip: request.ip,
      },
      () => next(),
    );
  }
}
