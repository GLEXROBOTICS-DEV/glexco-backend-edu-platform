/**
 * Tokens de inyeccion del servicio de medios.
 *
 * Viven en su propio archivo, y no en el modulo, porque los controladores
 * tambien los necesitan: si los importaran del modulo se formaria un ciclo
 * (modulo -> controlador -> modulo) y el simbolo llegaria sin definir al
 * ejecutarse el decorador.
 */

export const CONFIG = Symbol('MEDIA_CONFIG');
export const LOGGER = Symbol('LOGGER');
export const LOGGER_PORT = Symbol('LOGGER_PORT');
export const CLOCK = Symbol('CLOCK');
export const SECURE_RANDOM = Symbol('SECURE_RANDOM');
export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');
export const MEDIA_REPOSITORY = Symbol('MEDIA_REPOSITORY');
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');
export const PREFIX_READER = Symbol('PREFIX_READER');
export const CONTENT_SNIFFER = Symbol('CONTENT_SNIFFER');
export const THUMBNAILER = Symbol('THUMBNAILER');
export const VIDEO_PROVIDER = Symbol('VIDEO_PROVIDER');
export const BUCKETS = Symbol('BUCKETS');
export const PRESIGN_TTL = Symbol('PRESIGN_TTL');
