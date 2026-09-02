import { type INestApplication, Logger, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { DomainExceptionFilter } from './http/domain-exception.filter';

/**
 * Arranque comun a todos los microservicios.
 *
 * Concentra aqui todo lo que debe ser identico en los ocho servicios: cabeceras
 * de seguridad, compresion, limites de cuerpo, versionado de API y -sobre todo-
 * el apagado ordenado, que es lo que permite desplegar sin cortar peticiones.
 */
export interface BootstrapOptions {
  module: unknown;
  serviceName: string;
  port: number;
  corsOrigins: string[];
  /** Prefijo global. El gateway enruta por el, por ejemplo `/api/v1/identity`. */
  globalPrefix?: string;
  shutdownTimeoutMs: number;
  /** Tareas de limpieza propias del servicio (cerrar pools, detener el relay). */
  onShutdown?: () => Promise<void>;
  /** Se invoca cuando el servicio ya puede recibir trafico. */
  onReady?: (app: INestApplication) => void | Promise<void>;
  trustProxy?: boolean;
}

export async function bootstrapService(options: BootstrapOptions): Promise<INestApplication> {
  const logger = new Logger(options.serviceName);

  const app = await NestFactory.create<NestExpressApplication>(options.module as never, {
    bufferLogs: true,
    // El apagado ordenado necesita que Nest escuche las senales del sistema.
    abortOnError: false,
  });

  /**
   * Detras de un balanceador (Railway, ALB, Nginx) la IP del socket es la del
   * propio balanceador. Sin confiar en el proxy, TODO el trafico compartiria una
   * sola IP a efectos de limitacion de peticiones, y un solo usuario abusivo
   * bloquearia a todos los demas.
   *
   * Se confia en un unico salto, no en toda la cadena: aceptar la cabecera
   * completa dejaria que cualquiera falsifique su IP anadiendo un
   * `X-Forwarded-For`.
   */
  app.set('trust proxy', options.trustProxy === false ? false : 1);

  // Sin esto, Express anuncia su version en cada respuesta y facilita el
  // reconocimiento automatizado de versiones vulnerables.
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: false, // La CSP la fija el frontend, que es quien sirve HTML.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  // La compresion se aplica en el borde (CDN) para el trafico publico, pero
  // tambien aqui: reduce el trafico entre servicios y el de las respuestas JSON
  // grandes (listados, reportes), que es donde mas se nota.
  app.use(compression({ threshold: 1024 }));

  app.use(cookieParser());

  // Limite de cuerpo bajo a proposito: las subidas de archivos NO pasan por la
  // API, van directas al almacenamiento de objetos con URL prefirmada. Aceptar
  // cuerpos grandes aqui seria regalar un vector de agotamiento de memoria.
  app.useBodyParser('json', { limit: '256kb' });
  app.useBodyParser('urlencoded', { limit: '256kb', extended: true });

  app.enableCors({
    origin: options.corsOrigins,
    credentials: true, // Necesario para la cookie httpOnly del refresh token.
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-Id', 'Accept-Language'],
    exposedHeaders: ['X-Correlation-Id', 'RateLimit-Remaining', 'Retry-After'],
    maxAge: 86_400,
  });

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  if (options.globalPrefix) {
    app.setGlobalPrefix(options.globalPrefix, {
      // Las sondas quedan fuera del prefijo: el balanceador no deberia tener que
      // conocer el esquema de rutas de la aplicacion.
      exclude: ['health/live', 'health/ready', 'health/startup', 'metrics'],
    });
  }

  app.useGlobalFilters(new DomainExceptionFilter());

  // Nest llama a onModuleDestroy/onApplicationShutdown de cada proveedor.
  app.enableShutdownHooks();

  await app.listen(options.port, '0.0.0.0');
  logger.log(`${options.serviceName} escuchando en el puerto ${options.port}`);

  await options.onReady?.(app);
  registerGracefulShutdown(app, options, logger);

  return app;
}

/**
 * Apagado ordenado.
 *
 * Es la pieza que hace posible desplegar sin errores visibles. Al recibir
 * SIGTERM:
 *
 * 1. La sonda de readiness empieza a fallar, asi que el balanceador deja de
 *    enviar peticiones nuevas a esta replica.
 * 2. Se espera un momento, porque los balanceadores tardan unos segundos en
 *    darse cuenta. Cerrar de inmediato produce los 502 clasicos de cada
 *    despliegue.
 * 3. Se cierra el servidor HTTP, que termina las peticiones en vuelo.
 * 4. Se ejecuta la limpieza del servicio (drenar la outbox, cerrar pools).
 * 5. Si algo se atasca, un temporizador fuerza la salida para no quedar colgado
 *    hasta que el orquestador mate el proceso a lo bruto.
 */
function registerGracefulShutdown(
  app: INestApplication,
  options: BootstrapOptions,
  logger: Logger,
): void {
  let shuttingDown = false;
  const DRAIN_DELAY_MS = 5_000;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log(`Senal ${signal} recibida; iniciando apagado ordenado`);

    const forceExit = setTimeout(() => {
      logger.error('El apagado excedio el tiempo limite; se fuerza la salida');
      process.exit(1);
    }, options.shutdownTimeoutMs);
    forceExit.unref();

    try {
      process.env.GLEXCO_DRAINING = 'true';
      await new Promise((resolve) => setTimeout(resolve, DRAIN_DELAY_MS));

      await app.close();
      await options.onShutdown?.();

      clearTimeout(forceExit);
      logger.log('Apagado ordenado completado');
      process.exit(0);
    } catch (error) {
      logger.error('Fallo durante el apagado', error instanceof Error ? error.stack : String(error));
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Una promesa rechazada sin manejar deja el proceso en estado indefinido.
  // Se registra y se apaga de forma ordenada: el orquestador levantara una
  // replica sana, que es mas seguro que seguir sirviendo desde un estado dudoso.
  process.on('unhandledRejection', (reason) => {
    logger.error('Promesa rechazada sin manejar', reason instanceof Error ? reason.stack : String(reason));
    void shutdown('unhandledRejection');
  });

  process.on('uncaughtException', (error) => {
    logger.error('Excepcion no capturada', error.stack);
    void shutdown('uncaughtException');
  });
}
