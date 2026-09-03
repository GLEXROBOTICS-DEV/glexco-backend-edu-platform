/**
 * Tokens de inyeccion del servicio de evaluacion.
 *
 * Viven en su propio archivo, y no en el modulo, porque los controladores
 * tambien los necesitan: si los importaran del modulo se formaria un ciclo
 * (modulo -> controlador -> modulo) y el simbolo llegaria sin definir al
 * ejecutarse el decorador.
 */

export const CONFIG = Symbol('ASSESSMENT_CONFIG');
export const LOGGER = Symbol('LOGGER');
export const LOGGER_PORT = Symbol('LOGGER_PORT');
export const CLOCK = Symbol('CLOCK');
export const SECURE_RANDOM = Symbol('SECURE_RANDOM');
export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');
export const ASSESSMENT_REPOSITORY = Symbol('ASSESSMENT_REPOSITORY');
export const SUBMISSION_REPOSITORY = Symbol('SUBMISSION_REPOSITORY');
export const CLASSROOM_DIRECTORY = Symbol('CLASSROOM_DIRECTORY');
