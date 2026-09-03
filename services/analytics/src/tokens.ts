/**
 * Tokens de inyeccion del servicio de analitica.
 *
 * Viven en su propio archivo, y no en el modulo, porque los controladores
 * tambien los necesitan: si los importaran del modulo se formaria un ciclo
 * (modulo -> controlador -> modulo) y el simbolo llegaria sin definir al
 * ejecutarse el decorador.
 */

export const CONFIG = Symbol('ANALYTICS_CONFIG');
export const LOGGER = Symbol('LOGGER');
export const LOGGER_PORT = Symbol('LOGGER_PORT');
/** Escribe las proyecciones. Solo lo usa el consumidor de eventos. */
export const PROJECTION_REPOSITORY = Symbol('PROJECTION_REPOSITORY');
/** Lee los dashboards. Solo lo usan los controladores. */
export const QUERY_REPOSITORY = Symbol('QUERY_REPOSITORY');
export const CLASSROOM_DIRECTORY = Symbol('CLASSROOM_DIRECTORY');
