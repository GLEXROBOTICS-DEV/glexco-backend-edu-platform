/**
 * Tokens de inyeccion del servicio de catalogo.
 *
 * Viven en su propio archivo, y no en el modulo, porque los controladores
 * tambien los necesitan: si los importaran del modulo se formaria un ciclo
 * (modulo -> controlador -> modulo) y el simbolo llegaria sin definir al
 * ejecutarse el decorador.
 */

export const CONFIG = Symbol('CATALOG_CONFIG');
export const LOGGER = Symbol('LOGGER');
export const LOGGER_PORT = Symbol('LOGGER_PORT');
export const CLOCK = Symbol('CLOCK');
export const SECURE_RANDOM = Symbol('SECURE_RANDOM');
export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');
export const ACTIVATION_CODE_REPOSITORY = Symbol('ACTIVATION_CODE_REPOSITORY');
export const KIT_REPOSITORY = Symbol('KIT_REPOSITORY');
export const ENTITLEMENT_REPOSITORY = Symbol('ENTITLEMENT_REPOSITORY');
export const CONTENT_REPOSITORY = Symbol('CONTENT_REPOSITORY');

/** Almacen de objetos. Catalogo solo FIRMA descargas del material del kit; las
 *  subidas siguen siendo cosa de media. */
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');
/** Como se obtiene la URL de reproduccion de un video ya registrado. Es una
 *  funcion y no el proveedor entero porque catalogo no registra videos: solo
 *  necesita saber donde se ven. */
export const VIDEO_PLAYBACK = Symbol('VIDEO_PLAYBACK');
export const CODE_PEPPER = Symbol('CODE_PEPPER');
export const CACHE_STORE = Symbol('CACHE_STORE');
