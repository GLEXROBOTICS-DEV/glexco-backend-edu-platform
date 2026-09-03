/**
 * Tokens de inyeccion del servicio de instituciones.
 *
 * Viven en su propio archivo, y no en el modulo, porque los controladores
 * tambien los necesitan: si los importaran del modulo se formaria un ciclo
 * (modulo -> controlador -> modulo) y el simbolo llegaria sin definir al
 * ejecutarse el decorador.
 */

export const CONFIG = Symbol('INSTITUTIONS_CONFIG');
export const LOGGER = Symbol('LOGGER');
/**
 * El mismo logger, adaptado al puerto que usan los casos de uso.
 *
 * Existe como token aparte porque las firmas de pino y de `LoggerPort` estan
 * invertidas: pino recibe `(contexto, mensaje)` y el puerto `(mensaje,
 * contexto)`. Inyectar el de pino donde se espera el puerto compila con un
 * casteo y luego pierde en silencio los campos por los que hay que filtrar en
 * produccion. Dos tokens distintos hacen que ese error no se pueda cometer.
 */
export const LOGGER_PORT = Symbol('LOGGER_PORT');
export const CLOCK = Symbol('CLOCK');
export const INSTITUTION_REPOSITORY = Symbol('INSTITUTION_REPOSITORY');
export const CLASSROOM_REPOSITORY = Symbol('CLASSROOM_REPOSITORY');
export const TEACHER_DIRECTORY = Symbol('TEACHER_DIRECTORY');
export const STUDENT_DIRECTORY = Symbol('STUDENT_DIRECTORY');
export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');
