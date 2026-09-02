import { AsyncLocalStorage } from 'node:async_hooks';
import pino, { type Logger as PinoLogger } from 'pino';

/**
 * Logging estructurado.
 *
 * Los logs son JSON en una sola linea porque van a un agregador (Railway,
 * CloudWatch, LTS de Huawei) donde se filtran por campo. Con N replicas detras
 * de un balanceador, poder buscar `correlationId=abc` y ver la peticion completa
 * atravesando gateway -> identidad -> catalogo es la diferencia entre depurar en
 * minutos o a ciegas.
 */

export interface RequestContext {
  correlationId: string;
  userId?: string;
  institutionId?: string;
  sessionId?: string;
  ip?: string;
}

/**
 * Contexto por peticion sin pasarlo a mano por cada funcion.
 *
 * AsyncLocalStorage lo hace seguro entre peticiones concurrentes: cada cadena de
 * llamadas asincronas ve su propio almacen, a diferencia de una variable global.
 */
const requestStore = new AsyncLocalStorage<RequestContext>();

export const runWithContext = <T>(context: RequestContext, fn: () => T): T =>
  requestStore.run(context, fn);

export const getRequestContext = (): RequestContext | undefined => requestStore.getStore();

/**
 * Campos que jamas deben aparecer en un log.
 *
 * La plataforma maneja datos de menores de edad. Un volcado accidental de
 * `password` o de un token en los logs es un incidente de proteccion de datos,
 * asi que la redaccion se aplica de forma central y no depende de que cada
 * desarrollador se acuerde.
 */
const REDACTED_PATHS = [
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'activationCode',
  'authorization',
  'cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.activationCode',
];

export interface LoggerOptions {
  serviceName: string;
  level: string;
  pretty: boolean;
  version?: string;
}

export function createLogger(options: LoggerOptions): PinoLogger {
  return pino({
    name: options.serviceName,
    level: options.level,
    base: {
      service: options.serviceName,
      version: options.version ?? process.env.npm_package_version,
      // Identifica la replica concreta cuando hay varias detras del balanceador.
      instance: process.env.HOSTNAME ?? process.env.RAILWAY_REPLICA_ID ?? undefined,
    },
    redact: { paths: REDACTED_PATHS, censor: '[redactado]' },
    // El agregador espera epoch en milisegundos, no el formato por defecto.
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    // Inyecta el contexto de la peticion en cada linea automaticamente.
    mixin() {
      const context = getRequestContext();
      return context ? { ...context } : {};
    },
    transport: options.pretty
      ? {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,service' },
        }
      : undefined,
  });
}

export type Logger = PinoLogger;
