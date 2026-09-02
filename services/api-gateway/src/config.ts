import { z } from 'zod';
import { baseEnvSchema, loadEnv } from '@glexco/config';

/**
 * Configuracion del gateway.
 *
 * El gateway es el UNICO servicio expuesto al exterior, asi que su
 * configuracion es la que decide que queda accesible desde internet. Se valida
 * al arrancar y el proceso muere si algo falta: una replica mal configurada que
 * arrancase igual pasaria el health check y empezaria a enrutar mal o a dejar
 * pasar lo que no debe.
 */
const gatewayEnvSchema = baseEnvSchema.extend({
  SERVICE_NAME: z.string().default('api-gateway'),
  PORT: z.coerce.number().int().default(3000),

  IDENTITY_URL: z.string().url().default('http://localhost:3101'),
  INSTITUTIONS_URL: z.string().url().default('http://localhost:3102'),
  CATALOG_URL: z.string().url().default('http://localhost:3103'),
  LEARNING_URL: z.string().url().default('http://localhost:3104'),
  ASSESSMENT_URL: z.string().url().default('http://localhost:3105'),
  ENGAGEMENT_URL: z.string().url().default('http://localhost:3106'),
  ANALYTICS_URL: z.string().url().default('http://localhost:3107'),
  MEDIA_URL: z.string().url().default('http://localhost:3108'),

  /** Limite estricto para las rutas de autenticacion, donde el ataque no es
   *  saturar sino adivinar credenciales. */
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(10),

  /** Tiempo maximo de espera de un servicio aguas abajo. Debe ser MENOR que el
   *  timeout del balanceador, o el cliente vera un 504 genérico del balanceador
   *  en vez de nuestro error con `correlationId`, que es el que permite
   *  investigar. */
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export type GatewayConfig = z.infer<typeof gatewayEnvSchema>;

export const loadGatewayConfig = (): GatewayConfig => loadEnv(gatewayEnvSchema);

/**
 * Tabla de enrutado: prefijo publico -> servicio interno.
 *
 * Es una tabla explicita y no un enrutado por convencion (tomar el primer
 * segmento de la ruta y buscar un servicio con ese nombre). Con la convencion,
 * anadir un servicio interno nuevo lo expondria a internet sin que nadie tomara
 * la decision; aqui, exponer algo exige anadir una linea.
 */
export interface RouteDefinition {
  /** Prefijo publico bajo /api/v1. */
  prefix: string;
  /** Clave de la variable de entorno con la URL del servicio. */
  target: keyof GatewayConfig;
  /** Rutas accesibles sin token. Todo lo demas exige autenticacion. */
  publicPaths?: RegExp[];
  /** Limite mas estricto que el general. */
  strictRateLimit?: boolean;
}

export const ROUTES: RouteDefinition[] = [
  {
    prefix: 'auth',
    target: 'IDENTITY_URL',
    // Solo estas rutas de identidad son publicas. Las demas (cambio de
    // contrasena, sesiones, alta de personal) exigen token.
    publicPaths: [
      /^\/login$/,
      /^\/refresh$/,
      /^\/logout$/,
      /^\/register\/student$/,
      /^\/verify-email$/,
      /^\/password-reset\/request$/,
      /^\/password-reset\/confirm$/,
    ],
    strictRateLimit: true,
  },
  { prefix: 'account', target: 'IDENTITY_URL' },
  { prefix: 'users', target: 'IDENTITY_URL' },
  { prefix: 'institutions', target: 'INSTITUTIONS_URL' },
  { prefix: 'classrooms', target: 'INSTITUTIONS_URL' },
  { prefix: 'catalog', target: 'CATALOG_URL' },
  { prefix: 'kits', target: 'CATALOG_URL' },
  { prefix: 'courses', target: 'CATALOG_URL' },
  { prefix: 'learning', target: 'LEARNING_URL' },
  { prefix: 'assessments', target: 'ASSESSMENT_URL' },
  { prefix: 'certificates', target: 'ASSESSMENT_URL' },
  { prefix: 'announcements', target: 'ENGAGEMENT_URL' },
  { prefix: 'notifications', target: 'ENGAGEMENT_URL' },
  { prefix: 'support', target: 'ENGAGEMENT_URL' },
  { prefix: 'analytics', target: 'ANALYTICS_URL' },
  { prefix: 'media', target: 'MEDIA_URL' },
];
