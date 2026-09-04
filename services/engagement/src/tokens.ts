/**
 * Tokens de inyeccion de engagement.
 *
 * Viven en su propio archivo, y no en el modulo, porque los controladores
 * tambien los necesitan: si los importaran del modulo se formaria un ciclo
 * (modulo -> controlador -> modulo) y el simbolo llegaria sin definir al
 * ejecutarse el decorador.
 */

export const CONFIG = Symbol('ENGAGEMENT_CONFIG');
export const LOGGER = Symbol('LOGGER');
export const LOGGER_PORT = Symbol('LOGGER_PORT');
export const CLOCK = Symbol('CLOCK');
export const SECURE_RANDOM = Symbol('SECURE_RANDOM');
export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');

export const ANNOUNCEMENT_REPOSITORY = Symbol('ANNOUNCEMENT_REPOSITORY');
export const CLASSROOM_DIRECTORY = Symbol('CLASSROOM_DIRECTORY');
export const REPLY_REPOSITORY = Symbol('REPLY_REPOSITORY');

/** Envio de correo. Es un puerto: cambiar de SMTP a una API transaccional es
 *  escribir otro adaptador, no tocar un caso de uso. */
export const MAIL_SENDER = Symbol('MAIL_SENDER');
export const EMAIL_DELIVERY_LOG = Symbol('EMAIL_DELIVERY_LOG');
/** Acuna el enlace de un solo uso contra identidad, en el momento del envio. */
export const ONE_TIME_TOKEN_ISSUER = Symbol('ONE_TIME_TOKEN_ISSUER');
