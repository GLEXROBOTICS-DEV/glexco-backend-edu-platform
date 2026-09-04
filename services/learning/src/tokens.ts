/**
 * Tokens de inyeccion de learning.
 *
 * Viven en su propio archivo, y no en el modulo, porque los controladores
 * tambien los necesitan: si los importaran del modulo se formaria un ciclo
 * (modulo -> controlador -> modulo) y el simbolo llegaria sin definir al
 * ejecutarse el decorador.
 */

export const CONFIG = Symbol('LEARNING_CONFIG');
export const LOGGER = Symbol('LOGGER');
export const LOGGER_PORT = Symbol('LOGGER_PORT');
export const CLOCK = Symbol('CLOCK');
export const SECURE_RANDOM = Symbol('SECURE_RANDOM');
export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');

export const LEARNING_REPOSITORY = Symbol('LEARNING_REPOSITORY');
export const GAMIFICATION_REPOSITORY = Symbol('GAMIFICATION_REPOSITORY');
export const MISSION_REPOSITORY = Symbol('MISSION_REPOSITORY');
export const CERTIFICATE_REPOSITORY = Symbol('CERTIFICATE_REPOSITORY');
/** `null` cuando el despliegue no tiene claves de firma configuradas. */
export const CERTIFICATE_KEYS = Symbol('CERTIFICATE_KEYS');
