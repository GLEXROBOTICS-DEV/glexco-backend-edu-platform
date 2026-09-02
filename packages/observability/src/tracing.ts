import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';

/**
 * Claves de atributo escritas literalmente en vez de importar las constantes de
 * `@opentelemetry/semantic-conventions`.
 *
 * Motivo: esos nombres han cambiado de sitio y de forma varias veces entre
 * versiones (SEMRESATTRS_* -> ATTR_* -> subruta `/incubating`), mientras que las
 * cadenas en si llevan estables desde la primera especificacion. Escribirlas
 * directas nos ahorra que una actualizacion menor rompa la compilacion de los
 * ocho servicios a la vez.
 */
const ATTR_SERVICE_NAME = 'service.name';
const ATTR_SERVICE_VERSION = 'service.version';

/**
 * Trazas distribuidas.
 *
 * En una arquitectura de microservicios, "la plataforma va lenta" es una queja
 * inutil sin trazas: la peticion pasa por gateway, identidad, catalogo, Redis y
 * Postgres, y solo un trace muestra cual de esos saltos consume el tiempo.
 *
 * DEBE inicializarse antes de importar cualquier libreria instrumentada
 * (Express, pg, ioredis), por eso cada servicio lo llama en la primera linea de
 * su `main.ts`, antes que nada.
 */
export interface TracingOptions {
  serviceName: string;
  serviceVersion?: string;
  namespace: string;
  endpoint?: string;
  enabled: boolean;
}

let sdk: NodeSDK | null = null;

export function startTracing(options: TracingOptions): void {
  if (!options.enabled || !options.endpoint) return;
  if (sdk) return;

  sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: options.serviceName,
      [ATTR_SERVICE_VERSION]: options.serviceVersion ?? '0.1.0',
      'service.namespace': options.namespace,
      'deployment.environment': process.env.NODE_ENV ?? 'development',
    }),
    traceExporter: new OTLPTraceExporter({ url: `${options.endpoint}/v1/traces` }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // El ruido de fs ahoga las trazas utiles y multiplica el coste de ingesta.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-http': {
          // Los sondeos del balanceador generarian miles de trazas vacias.
          ignoreIncomingRequestHook: (request) =>
            request.url?.startsWith('/health') === true || request.url === '/metrics',
        },
      }),
    ],
  });

  sdk.start();
}

export async function stopTracing(): Promise<void> {
  if (!sdk) return;
  await sdk.shutdown();
  sdk = null;
}
