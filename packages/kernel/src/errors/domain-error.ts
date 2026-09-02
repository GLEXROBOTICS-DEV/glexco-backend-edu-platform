/**
 * Jerarquia de errores del dominio.
 *
 * El dominio no conoce HTTP. Lanza errores semanticos y un filtro de excepciones
 * en la capa de infraestructura los traduce a codigos de estado. Asi el mismo
 * caso de uso sirve a un controlador REST, a un consumidor de NATS o a un
 * comando de CLI sin cambiar una linea.
 *
 * `code` es un identificador estable en SCREAMING_SNAKE_CASE que el frontend usa
 * como clave de traduccion (es/en). El `message` es para logs y desarrolladores,
 * nunca para mostrar tal cual al usuario final.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  /** Categoria que la capa HTTP mapea a un status. */
  abstract readonly kind:
    | 'validation'
    | 'not_found'
    | 'conflict'
    | 'forbidden'
    | 'unauthorized'
    | 'rule_violation'
    | 'rate_limited'
    | 'unavailable';

  /** Datos seguros para enviar al cliente (jamas PII ni secretos). */
  readonly details: Readonly<Record<string, unknown>>;

  protected constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
    this.details = Object.freeze({ ...details });
    Error.captureStackTrace?.(this, new.target);
  }
}

/** Una precondicion de formato o rango no se cumple. -> 422 */
export class ValidationError extends DomainError {
  readonly kind = 'validation' as const;
  constructor(
    readonly code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message, details);
  }
}

/** El recurso no existe o el actor no tiene derecho a saber que existe. -> 404 */
export class NotFoundError extends DomainError {
  readonly kind = 'not_found' as const;
  constructor(
    readonly code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message, details);
  }
}

/** Choca con el estado actual: duplicado, version obsoleta, doble envio. -> 409 */
export class ConflictError extends DomainError {
  readonly kind = 'conflict' as const;
  constructor(
    readonly code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message, details);
  }
}

/** Autenticado, pero sin permiso para esta operacion o este recurso. -> 403 */
export class ForbiddenError extends DomainError {
  readonly kind = 'forbidden' as const;
  constructor(
    readonly code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message, details);
  }
}

/** Falta identidad o la credencial no es valida. -> 401 */
export class UnauthorizedError extends DomainError {
  readonly kind = 'unauthorized' as const;
  constructor(
    readonly code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message, details);
  }
}

/** Una regla de negocio prohibe la operacion aunque los datos sean validos. -> 422 */
export class BusinessRuleError extends DomainError {
  readonly kind = 'rule_violation' as const;
  constructor(
    readonly code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message, details);
  }
}

/** Se excedio una cuota o un limite de intentos. -> 429 */
export class RateLimitError extends DomainError {
  readonly kind = 'rate_limited' as const;
  constructor(
    readonly code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message, details);
  }
}

/** Una dependencia externa no responde. -> 503 (el cliente puede reintentar) */
export class ServiceUnavailableError extends DomainError {
  readonly kind = 'unavailable' as const;
  constructor(
    readonly code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message, details);
  }
}

/**
 * Choque de escritura concurrente detectado por la version optimista del
 * agregado. Es un conflicto reintentable: la capa de aplicacion puede recargar
 * el agregado y repetir el caso de uso.
 */
export class ConcurrencyError extends ConflictError {
  constructor(aggregateType: string, aggregateId: string, expected: number, actual: number) {
    super(
      'CONCURRENCY_CONFLICT',
      `El agregado ${aggregateType} ${aggregateId} cambio durante la operacion.`,
      { aggregateType, aggregateId, expectedVersion: expected, actualVersion: actual },
    );
  }
}

export const isDomainError = (error: unknown): error is DomainError => error instanceof DomainError;
