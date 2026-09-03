/**
 * API Gateway: el unico servicio expuesto a internet.
 *
 * Responsabilidades, y solo estas:
 *   - enrutar hacia el microservicio correcto segun una tabla explicita,
 *   - propagar el identificador de correlacion,
 *   - aplicar limitacion de peticiones en el borde,
 *   - cortar dependencias caidas con circuit breakers,
 *   - unificar CORS y cabeceras de seguridad.
 *
 * Lo que el gateway NO hace: logica de negocio. En cuanto un gateway empieza a
 * decidir reglas, se convierte en un monolito encubierto por el que pasa todo y
 * que hay que desplegar cada vez que cambia cualquier servicio.
 *
 * Tampoco es la unica linea de defensa: cada microservicio verifica el token por
 * su cuenta. Si alguien alcanza la red interna, esquivar el gateway no basta
 * para operar como administrador.
 */
import { startTracing, stopTracing } from '@glexco/observability';
import { loadGatewayConfig } from './config';

const config = loadGatewayConfig();

startTracing({
  serviceName: config.SERVICE_NAME,
  namespace: config.OTEL_SERVICE_NAMESPACE,
  endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
  enabled: config.OTEL_ENABLED,
});

/* eslint-disable import/first */
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { createLogger, runWithContext } from '@glexco/observability';
import { createRedisClient, RateLimiter } from '@glexco/nest-platform';
import { isDomainError } from '@glexco/kernel';
import { ROUTES } from './config';
import { ServiceProxy } from './proxy';
/* eslint-enable import/first */

const logger = createLogger({
  serviceName: config.SERVICE_NAME,
  level: config.LOG_LEVEL,
  pretty: config.NODE_ENV === 'development',
});

async function main(): Promise<void> {
  const app = express();
  const redis = createRedisClient(config.REDIS_URL, config.REDIS_KEY_PREFIX, logger);
  const rateLimiter = new RateLimiter(redis);
  const proxy = new ServiceProxy({ config, rateLimiter, logger });

  // Detras de un balanceador, la IP del socket es la del propio balanceador. Sin
  // esto, TODO el trafico compartiria una IP a efectos de limitacion y un solo
  // abusivo bloquearia a todos. Se confia en UN salto: aceptar la cabecera
  // completa dejaria que cualquiera falsifique su IP.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
    }),
  );
  app.use(compression({ threshold: 1024 }));
  app.use(cookieParser());
  app.use(
    cors({
      origin: config.CORS_ORIGINS,
      credentials: true,
      exposedHeaders: ['X-Correlation-Id', 'Retry-After'],
      maxAge: 86_400,
    }),
  );

  // Limite bajo: las subidas de archivos NO pasan por aqui, van directas al
  // almacenamiento de objetos con URL prefirmada.
  app.use(express.json({ limit: '256kb' }));

  // Correlacion: se genera aqui y viaja a todos los servicios, de modo que una
  // sola busqueda recupera los logs de la cadena completa.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  app.use((request: Request, response: Response, next: NextFunction) => {
    const incoming = request.headers['x-correlation-id'];
    const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
    // Solo se acepta el id entrante si parece un UUID: sin esa comprobacion, un
    // cliente podria inyectar texto arbitrario en nuestros logs.
    const correlationId = candidate && UUID.test(candidate) ? candidate : randomUUID();

    request.headers['x-correlation-id'] = correlationId;
    response.setHeader('x-correlation-id', correlationId);
    runWithContext({ correlationId, ip: request.ip }, () => next());
  });

  // Sondas del balanceador. Fuera del prefijo de API y sin limitacion: el
  // balanceador no debe conocer el esquema de rutas ni consumir cuota.
  app.get('/health/live', (_request, response) => {
    response.json({ status: 'ok', uptimeSeconds: Math.floor(process.uptime()) });
  });

  app.get('/health/ready', async (_request, response) => {
    // Redis es imprescindible AQUI: sin el no hay limitacion de peticiones, y un
    // gateway sin limitacion expuesto a internet es peor que un gateway retirado
    // del balanceador.
    const healthy = await redis
      .ping()
      .then(() => true)
      .catch(() => false);

    response.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'unavailable',
      draining: process.env.GLEXCO_DRAINING === 'true',
      checks: { redis: healthy ? 'up' : 'down' },
    });
  });

  // Rutas, desde la tabla explicita.
  for (const route of ROUTES) {
    app.use(`/api/v1/${route.prefix}`, proxy.handlerFor(route));
    logger.info({ prefix: route.prefix, target: route.target }, 'Ruta registrada');
  }

  // 404 uniforme: no revela que prefijos existen.
  app.use((_request: Request, response: Response) => {
    response.status(404).json({
      code: 'ROUTE_NOT_FOUND',
      message: 'La ruta solicitada no existe.',
      correlationId: response.getHeader('x-correlation-id'),
    });
  });

  // Manejador de errores. Igual que en los servicios: un fallo inesperado nunca
  // devuelve su mensaje ni su traza al cliente, solo el correlationId con el que
  // soporte puede encontrarlo en los logs.
  app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
    const correlationId = response.getHeader('x-correlation-id');

    if (isDomainError(error)) {
      const status =
        error.kind === 'rate_limited'
          ? 429
          : error.kind === 'unavailable'
            ? 503
            : error.kind === 'unauthorized'
              ? 401
              : error.kind === 'forbidden'
                ? 403
                : 500;

      const retryAfter = (error.details as { retryAfterSeconds?: number }).retryAfterSeconds;
      if (retryAfter) response.setHeader('Retry-After', String(retryAfter));

      logger.warn({ err: error, path: request.originalUrl }, 'Peticion rechazada en el gateway');
      response.status(status).json({
        code: error.code,
        message: error.message,
        details: error.details,
        correlationId,
      });
      return;
    }

    logger.error({ err: error, path: request.originalUrl }, 'Error inesperado en el gateway');
    response.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Ocurrio un error inesperado. Nuestro equipo ya fue notificado.',
      correlationId,
    });
  });

  const server = app.listen(config.PORT, '0.0.0.0', () => {
    logger.info({ port: config.PORT }, 'API Gateway escuchando');
  });

  registerGracefulShutdown(server, redis);
}

/**
 * Apagado ordenado.
 *
 * 1. La sonda de readiness empieza a fallar -> el balanceador deja de enviar
 *    peticiones nuevas.
 * 2. Se espera, porque los balanceadores tardan unos segundos en darse cuenta.
 *    Cerrar de inmediato produce los 502 clasicos de cada despliegue.
 * 3. Se cierra el servidor, terminando lo que ya estaba en vuelo.
 */
function registerGracefulShutdown(
  server: { close(callback?: () => void): void },
  redis: { disconnect(): void },
): void {
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.env.GLEXCO_DRAINING = 'true';
    logger.info({ signal }, 'Iniciando apagado ordenado del gateway');

    const force = setTimeout(() => {
      logger.error('El apagado excedio el tiempo limite; se fuerza la salida');
      process.exit(1);
    }, 15_000);
    force.unref();

    setTimeout(() => {
      server.close(() => {
        redis.disconnect();
        void stopTracing().finally(() => {
          clearTimeout(force);
          logger.info('Apagado ordenado completado');
          process.exit(0);
        });
      });
    }, 5_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void main();
