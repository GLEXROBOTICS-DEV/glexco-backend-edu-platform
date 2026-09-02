/**
 * Contrato de un caso de uso.
 *
 * Un caso de uso es una operacion completa del negocio ("registrar alumno con
 * codigo de libro"), no un metodo CRUD. Recibe un comando plano, orquesta
 * agregados y puertos, y devuelve un DTO de salida. No conoce Express, ni
 * Nest, ni SQL.
 */
export interface UseCase<Input, Output> {
  execute(input: Input, context: ExecutionContext): Promise<Output>;
}

/**
 * Contexto de ejecucion que atraviesa cada peticion.
 *
 * Viaja explicito (no en un almacenamiento global) para que el mismo caso de uso
 * funcione desde HTTP, desde un consumidor de eventos o desde un job programado,
 * y para que los tests puedan fabricar cualquier actor sin montar middleware.
 */
export interface ExecutionContext {
  /** Id que enlaza todos los logs, trazas y eventos de una misma peticion. */
  readonly correlationId: string;
  /** Actor autenticado. Ausente en operaciones publicas como el registro. */
  readonly actor?: Actor;
  /** Idioma preferido, para mensajes y correos. */
  readonly locale: 'es' | 'en';
  /** Momento de entrada de la peticion, fijo durante todo el caso de uso. */
  readonly requestedAt: Date;
  /** IP de origen, usada en auditoria y limitacion de intentos. */
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

export interface Actor {
  readonly userId: string;
  readonly roles: readonly string[];
  /** Institucion a la que pertenece el actor. Ausente en usuarios independientes
   *  y en administradores GLEXCO, que operan por encima de las instituciones. */
  readonly institutionId?: string;
  /** Permisos efectivos ya resueltos por el servicio de identidad. */
  readonly permissions: readonly string[];
  readonly sessionId: string;
}
