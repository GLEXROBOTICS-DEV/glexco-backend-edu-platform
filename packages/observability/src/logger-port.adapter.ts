import type { LoggerPort } from '@glexco/kernel';
import type { Logger } from './logger';

/**
 * Adapta un logger de pino al puerto `LoggerPort` que usan los casos de uso.
 *
 * Hace falta un adaptador de verdad y no un casteo porque las firmas estan
 * invertidas:
 *
 *   pino:        logger.info(objetoDeContexto, mensaje)
 *   LoggerPort:  logger.info(mensaje, objetoDeContexto)
 *
 * Pasar un `Logger` donde se espera un `LoggerPort` compila si se fuerza con un
 * casteo, y falla en silencio: pino interpretaria el mensaje como el objeto de
 * contexto y el contexto como parametros de formato. El resultado son lineas de
 * log sin los campos por los que despues hay que filtrar en produccion, que es
 * justo cuando se descubre el problema y ya es tarde.
 *
 * El caso de uso depende del PUERTO, no de pino: eso es lo que permite pasarle
 * un logger silencioso en las pruebas sin arrastrar la libreria.
 */
export function toLoggerPort(logger: Logger): LoggerPort {
  return {
    debug(message, context) {
      logger.debug(context ?? {}, message);
    },

    info(message, context) {
      logger.info(context ?? {}, message);
    },

    warn(message, context) {
      logger.warn(context ?? {}, message);
    },

    error(message, error, context) {
      // `err` es la clave que pino serializa como excepcion, con su stack. Usar
      // otro nombre guardaria el error como un objeto vacio, porque las
      // propiedades de Error no son enumerables.
      logger.error({ ...(context ?? {}), ...(error === undefined ? {} : { err: error }) }, message);
    },

    child(bindings) {
      return toLoggerPort(logger.child(bindings));
    },
  };
}
