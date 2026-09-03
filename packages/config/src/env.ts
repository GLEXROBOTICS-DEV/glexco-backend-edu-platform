import { z } from 'zod';

/**
 * Configuracion validada al arrancar.
 *
 * El proceso se niega a levantar si falta o esta mal una variable. Es
 * deliberado: en un despliegue con balanceador, un servicio que arranca con
 * `JWT_ACCESS_SECRET` vacio pasaria el health check y empezaria a emitir tokens
 * invalidos. Fallar en el arranque hace que la replica nueva nunca entre al
 * balanceador y el despliegue se detenga solo.
 */

const duration = z
  .string()
  .regex(/^\d+(ms|s|m|h|d)$/, 'Duracion invalida. Ejemplos: 900s, 15m, 30d');

const bool = z
  .string()
  .transform((v) => v.toLowerCase())
  .pipe(z.enum(['true', 'false', '1', '0']))
  .transform((v) => v === 'true' || v === '1');

const port = z.coerce.number().int().min(1).max(65535);

/** Secretos: se exige longitud real para que nadie despliegue con "changeme". */
const secret = z
  .string()
  .min(32, 'El secreto debe tener al menos 32 caracteres (openssl rand -base64 48)');

/**
 * Trata una variable vacia como ausente.
 *
 * En un `.env` no hay forma de escribir "no definida": lo que se pone es
 * `VIDEO_PROVIDER_URL=`, y eso llega como cadena vacia. Sin esto,
 * `z.string().url().optional()` la recibe como valor presente e invalido, y el
 * servicio se niega a arrancar por una variable que precisamente se dejo en
 * blanco a proposito.
 */
export const optionalEnv = <S extends z.ZodTypeAny>(schema: S) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVICE_NAME: z.string().min(1),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  PLATFORM_NAME: z.string().default('GLEXCO'),
  PLATFORM_URL: z.string().url().default('http://localhost:3010'),

  PORT: port,

  DATABASE_URL: z.string().url(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DB_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().default(30_000),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().default(15_000),

  REDIS_URL: z.string().url(),
  REDIS_KEY_PREFIX: z.string().default('glexco'),
  CACHE_DEFAULT_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  NATS_URL: z.string().url(),
  NATS_STREAM: z.string().default('GLEXCO'),

  OTEL_ENABLED: bool.default('true'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_SERVICE_NAMESPACE: z.string().default('glexco'),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3010')
    .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean)),

  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),

  /** Apagado ordenado: tiempo que damos a las peticiones en vuelo antes de
   *  cerrar. Debe ser menor que el `terminationGracePeriod` del orquestador. */
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
});

export const authEnvSchema = z.object({
  JWT_ACCESS_SECRET: secret,
  JWT_REFRESH_SECRET: secret,
  JWT_ACCESS_TTL: duration.default('15m'),
  JWT_REFRESH_TTL: duration.default('30d'),
  JWT_ISSUER: z.string().default('glexco.platform'),
  JWT_AUDIENCE: z.string().default('glexco.web'),
  SIGNING_SECRET: secret,
  PASSWORD_HASHER: z.enum(['argon2id', 'bcrypt']).default('argon2id'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(8192).default(19_456),
  ARGON2_TIME_COST: z.coerce.number().int().min(2).default(2),
  ARGON2_PARALLELISM: z.coerce.number().int().min(1).default(1),
  COOKIE_DOMAIN: z.string().default('localhost'),
  COOKIE_SECURE: bool.default('false'),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(10),
});

export const storageEnvSchema = z.object({
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: bool.default('true'),
  S3_BUCKET_MEDIA: z.string().default('glexco-media'),
  S3_BUCKET_DOCUMENTS: z.string().default('glexco-documents'),
  S3_BUCKET_EVIDENCE: z.string().default('glexco-evidence'),
  S3_BUCKET_CERTIFICATES: z.string().default('glexco-certificates'),
  S3_PRESIGN_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(900),
});

export const mailEnvSchema = z.object({
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: port.default(1025),
  SMTP_SECURE: bool.default('false'),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().min(1),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;
export type AuthEnv = z.infer<typeof authEnvSchema>;
export type StorageEnv = z.infer<typeof storageEnvSchema>;
export type MailEnv = z.infer<typeof mailEnvSchema>;

/**
 * Rellena `DATABASE_URL` a partir de `DATABASE_URL_<SERVICIO>` cuando no viene
 * definida.
 *
 * En produccion cada servicio recibe SOLO su propia `DATABASE_URL` y esta
 * funcion no hace nada. En local, en cambio, los ocho servicios comparten un
 * unico `.env` (uno por servicio obligaria a mantener ocho copias de los mismos
 * secretos), y ahi cada uno toma la suya por nombre. Nunca sobreescribe una
 * `DATABASE_URL` explicita: si esta puesta, manda.
 */
export function withServiceDatabaseUrl(
  serviceName: string,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (source.DATABASE_URL) return source;

  const scoped = source[`DATABASE_URL_${serviceName.toUpperCase().replace(/-/g, '_')}`];
  if (!scoped) return source;

  return { ...source, DATABASE_URL: scoped };
}

/**
 * Valida `process.env` contra el esquema del servicio y aborta con un informe
 * legible si algo falta. Se ejecuta ANTES de construir el contenedor de Nest.
 */
export function loadEnv<S extends z.ZodTypeAny>(schema: S, source: NodeJS.ProcessEnv = process.env): z.infer<S> {
  const result = schema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('\n');

    // Se escribe en stderr y se sale con codigo 1: ni logger ni telemetria
    // existen todavia en este punto del arranque.
    process.stderr.write(
      `\nConfiguracion invalida. El servicio no puede arrancar:\n${issues}\n\n` +
        `Revisa tu archivo .env (partiendo de .env.example).\n\n`,
    );
    process.exit(1);
  }

  return result.data;
}

/** Producciones reales no pueden usar los valores de ejemplo del repositorio. */
export function assertProductionSafety(env: BaseEnv & Partial<AuthEnv>): void {
  if (env.NODE_ENV !== 'production') return;

  const forbidden = ['cambiar-en-produccion', 'glexco_local_dev', 'changeme', 'localhost'];
  const suspicious: string[] = [];

  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'SIGNING_SECRET'] as const) {
    const value = env[key];
    if (value && forbidden.some((needle) => value.includes(needle))) suspicious.push(key);
  }

  if (env.JWT_ACCESS_SECRET && env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    suspicious.push('JWT_ACCESS_SECRET === JWT_REFRESH_SECRET');
  }

  if (env.COOKIE_SECURE === false) suspicious.push('COOKIE_SECURE debe ser true en produccion');

  if (suspicious.length > 0) {
    process.stderr.write(
      `\nConfiguracion insegura para produccion:\n${suspicious
        .map((item) => `  - ${item}`)
        .join('\n')}\n\n`,
    );
    process.exit(1);
  }
}
