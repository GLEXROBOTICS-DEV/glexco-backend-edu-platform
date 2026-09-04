import type { NextFunction, Request, Response } from 'express';
import { CircuitBreaker, RATE_LIMITS, type RateLimiter } from '@glexco/nest-platform';
import { getRequestContext, type Logger } from '@glexco/observability';
import { ServiceUnavailableError, UnauthorizedError } from '@glexco/kernel';
import type { GatewayConfig, RouteDefinition } from './config';

/**
 * Reenvio de peticiones a los microservicios.
 *
 * Se implementa con `fetch` nativo en vez de traer `http-proxy-middleware`. El
 * motivo no es minimalismo: necesitamos control explicito sobre tres cosas que
 * esa libreria hace de forma opaca, y las tres importan a escala.
 *
 * 1. **Que cabeceras se propagan.** Un proxy que reenvia todo puede filtrar
 *    cabeceras internas hacia fuera, o dejar que un cliente inyecte una cabecera
 *    de confianza hacia dentro. Aqui la lista es explicita en ambos sentidos.
 * 2. **El timeout por peticion.** Sin el, una llamada colgada aguas abajo
 *    inmoviliza la conexion del cliente hasta que el balanceador la corte.
 * 3. **El circuit breaker por servicio.** Es lo que impide que un servicio lento
 *    agote los sockets del gateway y tumbe tambien las rutas que no dependen de
 *    el (fallo en cascada).
 */

/** Cabeceras que NUNCA se reenvian aguas arriba ni aguas abajo. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  // La fija el gateway a partir de la conexion real; aceptar la del cliente
  // permitiria falsificar la IP de origen y esquivar la limitacion por IP.
  'x-forwarded-for',
  'x-real-ip',
  // Solo el gateway decide que es una llamada interna de confianza.
  'x-internal-service',
]);

/**
 * Cabeceras del servicio de destino que NO se copian hacia el cliente.
 *
 * `fetch` descomprime el cuerpo por su cuenta, asi que lo que el gateway tiene
 * en la mano es texto plano. Copiar el `content-encoding: gzip` del servicio de
 * origen hace que el navegador intente inflar algo que ya viene inflado y falle
 * con "incorrect header check"; el `content-length` original tampoco vale, y
 * ademas Express recalcula ambos al reenviar. Solo se notaba en respuestas
 * grandes -el login, por los permisos-, que son justo las que superan el umbral
 * de compresion.
 */
const RECALCULATED_DOWNSTREAM = new Set(['content-encoding', 'content-length']);

/**
 * Cabeceras del cliente que NO se reenvian al servicio de destino.
 *
 * El gateway no retransmite el cuerpo tal cual: lo vuelve a serializar desde
 * `request.body`. Copiar el `content-length` original hace que se anuncie una
 * longitud y se envie otra, y el servidor de destino cierra el socket sin
 * responder ("other side closed"). Se veia solo en `POST /auth/refresh`, que no
 * lleva cuerpo: el cliente anuncia 0 bytes y el gateway envia `{}`. En login y
 * registro coincidian por casualidad, porque reserializar el mismo JSON da la
 * misma longitud.
 *
 * `host` sobra por el mismo motivo: apunta al gateway, no al destino, y el
 * origen real ya viaja en `x-forwarded-host`.
 */
const REBUILT_UPSTREAM = new Set(['content-length', 'host']);

export interface ProxyDeps {
  config: GatewayConfig;
  rateLimiter: RateLimiter;
  logger: Logger;
}

export class ServiceProxy {
  /** Un interruptor por servicio, no uno global: que catalogo se degrade no debe
   *  cortar el acceso a identidad. */
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(private readonly deps: ProxyDeps) {}

  /** Construye el middleware Express de una ruta. */
  handlerFor(route: RouteDefinition) {
    const targetBase = this.deps.config[route.target] as string;

    return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
      const correlationId = getRequestContext()?.correlationId ?? '';

      try {
        this.assertCredentialPresent(route, request);
        await this.enforceRateLimit(route, request);

        const breaker = this.breakerFor(route.target as string);
        const upstream = await breaker.execute(() =>
          this.forward(request, targetBase, correlationId),
        );

        this.writeBack(upstream, response);
      } catch (error) {
        next(error);
      }
    };
  }

  /**
   * Corta en el borde lo que no lleva credencial.
   *
   * **Comprueba PRESENCIA, no validez, y es a proposito.** El gateway no tiene
   * el secreto de firma y no debe tenerlo: repartirlo multiplica los sitios
   * desde los que se puede falsificar un token. La verificacion criptografica la
   * hace cada servicio en cada peticion, que es donde importa.
   *
   * Entonces, ¿que aporta? Defensa en profundidad barata. Un sondeo anonimo de
   * `/api/v1/users` muere aqui en vez de recorrer la red interna, y sobre todo:
   * si algun dia alguien anade un controlador y se equivoca marcandolo
   * `@Public()`, esta tabla sigue sin exponerlo. Es la unica proteccion que
   * queda cuando la del servicio falla, y esa es justo la que hay que tener.
   *
   * Antes de esto, `publicPaths` estaba declarado en la tabla de rutas y no lo
   * leia nadie: un campo que se lee como un control de seguridad y no hace nada
   * es peor que no tenerlo, porque el siguiente que lo vea creera que anadir una
   * linea ahi expone o cierra algo.
   */
  private assertCredentialPresent(route: RouteDefinition, request: Request): void {
    // Sin `publicPaths`, el prefijo entero exige credencial. Es el valor por
    // defecto seguro: exponer algo tiene que costar anadir una linea, y no
    // olvidarse de anadirla.
    if (this.isPublicPath(route, request)) return;

    const authorization = request.headers.authorization;
    if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) return;

    // Tambien se deja pasar una cookie de sesion: el refresco llega asi, sin
    // cabecera de autorizacion, y rechazarlo aqui romperia la renovacion.
    if (request.headers.cookie?.includes('glexco_rt=')) return;

    throw new UnauthorizedError(
      'AUTHENTICATION_REQUIRED',
      'Esta operacion exige haber iniciado sesion.',
    );
  }

  private breakerFor(key: string): CircuitBreaker {
    let breaker = this.breakers.get(key);
    if (!breaker) {
      breaker = new CircuitBreaker({
        name: key,
        failureThreshold: 5,
        resetTimeoutMs: 10_000,
        successThreshold: 2,
        timeoutMs: this.deps.config.UPSTREAM_TIMEOUT_MS,
        logger: this.deps.logger,
      });
      this.breakers.set(key, breaker);
    }
    return breaker;
  }

  /**
   * Rutas sin credencial de un prefijo.
   *
   * Vive aparte porque lo usan DOS decisiones -si se exige token y si se aplica
   * el limite estricto- y tienen que coincidir siempre. Con la comprobacion
   * repetida en cada sitio, cambiar una lista y no la otra deja una ruta publica
   * con el limite de una privada, o al reves.
   */
  private isPublicPath(route: RouteDefinition, request: Request): boolean {
    return (route.publicPaths ?? []).some((pattern) => pattern.test(pathWithinPrefix(request)));
  }

  /**
   * Limitacion en el borde.
   *
   * Se aplica ANTES de reenviar: el objetivo es que el trafico abusivo no llegue
   * siquiera a consumir una conexion del servicio interno.
   *
   * **El limite estricto es para el trafico SIN credencial, no para el prefijo
   * entero.** Ahi el ataque no es saturar, es adivinar: una contrasena, un token
   * de recuperacion, una serie de certificado. Quien ya presenta un token no
   * esta adivinando nada, y leer su propio perfil no es un intento de fuerza
   * bruta.
   *
   * Esto era un fallo con consecuencias visibles y raras. `/auth/me` caia en el
   * limite estricto, y el portal lo llama en CADA carga de pagina: sesenta
   * vistas por minuto agotaban el presupuesto de un colegio entero -el gateway
   * no puede identificar al usuario y cuenta por IP, asi que todos comparten
   * cubo detras del NAT-. A partir de ahi el perfil respondia 429, la sesion
   * seguia adelante sin el, y el portal de un alumno de Academy se resolvia como
   * Discover: el cliente lo vio como "cambio a ingles y me saca a otra cuenta".
   *
   * Los dos cubos se llevan por SEPARADO. Compartir la clave hacia que las dos
   * politicas se descontaran del mismo contador, asi que el limite real de cada
   * una era el de la ultima peticion que pasara por aqui.
   */
  private async enforceRateLimit(route: RouteDefinition, request: Request): Promise<void> {
    // El gateway no verifica firmas -no tiene el secreto, y es deliberado-, asi
    // que `actor` casi nunca esta y en practica se cuenta por IP. Con un colegio
    // detras de un NAT eso significa un solo cubo para todo el centro, y esta
    // anotado como deuda en el traspaso.
    const identity = request.actor?.userId ?? request.ip ?? 'desconocido';

    const strict = route.strictRateLimit === true && this.isPublicPath(route, request);

    const policy = strict
      ? { limit: this.deps.config.RATE_LIMIT_AUTH_MAX, windowMs: 60_000 }
      : request.method === 'GET'
        ? RATE_LIMITS.READ
        : RATE_LIMITS.WRITE;

    const result = await this.deps.rateLimiter.consume(
      strict ? `gw:${route.prefix}:strict:${identity}` : `gw:${route.prefix}:${identity}`,
      policy.limit,
      policy.windowMs,
    );

    if (!result.allowed) {
      const error = new ServiceUnavailableError(
        'RATE_LIMITED',
        'Demasiadas peticiones. Espera unos segundos.',
        { retryAfterSeconds: result.retryAfterSeconds },
      );
      // Se marca para que el filtro de errores devuelva 429 y no 503.
      (error as unknown as { kind: string }).kind = 'rate_limited';
      throw error;
    }
  }

  private async forward(
    request: Request,
    targetBase: string,
    correlationId: string,
  ): Promise<UpstreamResponse> {
    const url = `${targetBase}${request.originalUrl}`;

    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (HOP_BY_HOP.has(name.toLowerCase())) continue;
      if (REBUILT_UPSTREAM.has(name.toLowerCase())) continue;
      if (value === undefined) continue;
      headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }

    headers.set('x-correlation-id', correlationId);
    // La IP real del cliente, tomada de la conexion y no de una cabecera que el
    // propio cliente pueda inventar.
    if (request.ip) headers.set('x-forwarded-for', request.ip);
    headers.set('x-forwarded-proto', request.protocol);
    headers.set('x-forwarded-host', request.hostname);

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

    const response = await fetch(url, {
      method: request.method,
      headers,
      body: hasBody ? JSON.stringify(request.body ?? {}) : undefined,
      redirect: 'manual',
    });

    return {
      status: response.status,
      headers: response.headers,
      body: await response.text(),
    };
  }

  private writeBack(upstream: UpstreamResponse, response: Response): void {
    upstream.headers.forEach((value, name) => {
      if (HOP_BY_HOP.has(name.toLowerCase())) return;
      if (RECALCULATED_DOWNSTREAM.has(name.toLowerCase())) return;
      // `set-cookie` necesita trato aparte: puede venir repetida y `Headers` la
      // colapsa en una sola cadena separada por comas, lo que rompe las cookies
      // que contienen comas en su fecha de caducidad.
      if (name.toLowerCase() === 'set-cookie') return;
      response.setHeader(name, value);
    });

    const cookies = upstream.headers.getSetCookie?.();
    if (cookies && cookies.length > 0) response.setHeader('set-cookie', cookies);

    response.status(upstream.status);
    if (upstream.body) response.send(upstream.body);
    else response.end();
  }
}

interface UpstreamResponse {
  status: number;
  headers: Headers;
  body: string;
}

/**
 * La ruta relativa al prefijo, que es contra lo que se escriben los patrones.
 *
 * Express deja en `request.url` lo que queda tras el `app.use`, asi que
 * `/api/v1/auth/login` llega aqui como `/login`. Se recorta la cadena de
 * consulta: un patron anclado con `$` no casaria con `/login?next=/discover`, y
 * ese fallo dejaria fuera una ruta publica sin que nadie entienda por que.
 */
function pathWithinPrefix(request: Request): string {
  const url = request.url || '/';
  const queryAt = url.indexOf('?');
  return queryAt >= 0 ? url.slice(0, queryAt) : url;
}
