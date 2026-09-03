/**
 * Tokens de inyeccion del servicio de identidad.
 *
 * Viven en su propio archivo, y no en el modulo, porque los controladores
 * tambien los necesitan: si los importaran del modulo se formaria un ciclo
 * (modulo -> controlador -> modulo) y el simbolo llegaria sin definir al
 * ejecutarse el decorador.
 */

export const CONFIG = Symbol('IDENTITY_CONFIG');
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
export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
export const SESSION_STORE = Symbol('SESSION_STORE');
export const ONE_TIME_TOKENS = Symbol('ONE_TIME_TOKENS');
export const AUDIT_LOG = Symbol('AUDIT_LOG');
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
export const PASSWORD_POLICY = Symbol('PASSWORD_POLICY');
export const TOKEN_ISSUER = Symbol('TOKEN_ISSUER');
export const ACTIVATION_CODE_GATEWAY = Symbol('ACTIVATION_CODE_GATEWAY');
export const CLASSROOM_GATEWAY = Symbol('CLASSROOM_GATEWAY');
export const INSTITUTION_GATEWAY = Symbol('INSTITUTION_GATEWAY');
export const RATE_LIMITER = Symbol('RATE_LIMITER');
export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');
export const COOKIE_OPTIONS = Symbol('COOKIE_OPTIONS');
