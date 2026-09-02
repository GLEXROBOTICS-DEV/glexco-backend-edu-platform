import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError, isDomainError } from '@glexco/kernel';
import { getRequestContext } from '@glexco/observability';

/**
 * Traduce cualquier excepcion a un cuerpo de error uniforme.
 *
 * Dos objetivos:
 *
 * 1. El dominio no conoce HTTP. Lanza `NotFoundError`, `ConflictError`, etc., y
 *    este filtro decide el codigo de estado. Cambiar el transporte no obliga a
 *    tocar una sola regla de negocio.
 *
 * 2. No filtrar informacion. Una excepcion inesperada nunca devuelve su mensaje
 *    ni su stack al cliente: eso ha filtrado rutas de archivos, nombres de
 *    tablas y cadenas de conexion en incidentes reales. Al cliente le llega un
 *    codigo generico y el `correlationId`; el detalle queda en el log, donde
 *    soporte puede buscarlo por ese mismo id.
 */
const KIND_TO_STATUS: Record<DomainError['kind'], HttpStatus> = {
  validation: HttpStatus.UNPROCESSABLE_ENTITY,
  not_found: HttpStatus.NOT_FOUND,
  conflict: HttpStatus.CONFLICT,
  forbidden: HttpStatus.FORBIDDEN,
  unauthorized: HttpStatus.UNAUTHORIZED,
  rule_violation: HttpStatus.UNPROCESSABLE_ENTITY,
  rate_limited: HttpStatus.TOO_MANY_REQUESTS,
  unavailable: HttpStatus.SERVICE_UNAVAILABLE,
};

export interface ErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  correlationId: string;
  fieldErrors?: Record<string, string[]>;
}

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const correlationId =
      getRequestContext()?.correlationId ?? (request.headers['x-correlation-id'] as string) ?? 'unknown';

    const { status, body, logAsError } = this.describe(exception, correlationId);

    // 4xx son comportamiento esperado del sistema (un formulario mal llenado no
    // es un fallo); solo 5xx despierta a alguien.
    if (logAsError) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status} ${body.code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.debug(`${request.method} ${request.url} -> ${status} ${body.code}`);
    }

    response.status(status).json(body);
  }

  private describe(
    exception: unknown,
    correlationId: string,
  ): { status: HttpStatus; body: ErrorBody; logAsError: boolean } {
    if (isDomainError(exception)) {
      return {
        status: KIND_TO_STATUS[exception.kind],
        body: {
          code: exception.code,
          message: exception.message,
          details: Object.keys(exception.details).length > 0 ? exception.details : undefined,
          correlationId,
        },
        logAsError: false,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const asRecord = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};

      return {
        status,
        body: {
          code: typeof asRecord.code === 'string' ? asRecord.code : httpCodeFor(status),
          message: exception.message,
          details: typeof asRecord.details === 'object' ? (asRecord.details as Record<string, unknown>) : undefined,
          fieldErrors: asRecord.fieldErrors as Record<string, string[]> | undefined,
          correlationId,
        },
        logAsError: status >= 500,
      };
    }

    // Todo lo demas es un fallo nuestro. Mensaje generico hacia fuera, detalle
    // completo en el log.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: 'INTERNAL_ERROR',
        message: 'Ocurrio un error inesperado. Nuestro equipo ya fue notificado.',
        correlationId,
      },
      logAsError: true,
    };
  }
}

function httpCodeFor(status: number): string {
  const map: Record<number, string> = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHENTICATED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    413: 'PAYLOAD_TOO_LARGE',
    415: 'UNSUPPORTED_MEDIA_TYPE',
    422: 'VALIDATION_FAILED',
    429: 'RATE_LIMITED',
    503: 'SERVICE_UNAVAILABLE',
  };
  return map[status] ?? 'INTERNAL_ERROR';
}
