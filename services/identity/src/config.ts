import { z } from 'zod';
import { authEnvSchema, baseEnvSchema, loadEnv, withServiceDatabaseUrl } from '@glexco/config';

/**
 * Configuracion del servicio de identidad.
 *
 * Se valida al arrancar y el proceso muere si algo falta. Con un balanceador
 * delante, una replica mal configurada que arrancase igual pasaria el health
 * check y empezaria a emitir tokens invalidos; fallar en el arranque hace que
 * nunca entre al balanceador y el despliegue se detenga solo.
 */
const identityEnvSchema = baseEnvSchema.merge(authEnvSchema).extend({
  SERVICE_NAME: z.string().default('identity'),
  PORT: z.coerce.number().int().default(3101),

  /** Replicas de lectura, separadas por coma. Vacio en local: se usa el primario. */
  DATABASE_READ_URLS: z
    .string()
    .optional()
    .transform((value) =>
      (value ?? '')
        .split(',')
        .map((url) => url.trim())
        .filter(Boolean),
    ),

  /** Vida del refresh cuando NO se marca "recordarme". En un aula el equipo es
   *  compartido: una sesion de 30 dias en el ordenador del laboratorio es un
   *  riesgo concreto, no teorico. */
  JWT_REFRESH_TTL_SHORT: z
    .string()
    .regex(/^\d+(ms|s|m|h|d)$/)
    .default('12h'),

  /** Servicios de los que depende el registro. */
  CATALOG_URL: z.string().url().optional(),
  INSTITUTIONS_URL: z.string().url().optional(),
  /** Token compartido para las llamadas internas entre microservicios. */
  INTERNAL_SERVICE_TOKEN: z.string().min(32).optional(),
});

export type IdentityConfig = z.infer<typeof identityEnvSchema>;

export function loadIdentityConfig(): IdentityConfig {
  const config = loadEnv(identityEnvSchema, withServiceDatabaseUrl('identity'));

  // En produccion no se admiten los adaptadores en memoria de catalogo e
  // instituciones. Sin esta comprobacion, un despliegue al que se le olvidara
  // definir CATALOG_URL aceptaria CUALQUIER codigo de libro que empezara por
  // GLX-TEST, regalando acceso al contenido de pago.
  if (config.NODE_ENV === 'production') {
    const missing: string[] = [];
    if (!config.CATALOG_URL) missing.push('CATALOG_URL');
    if (!config.INSTITUTIONS_URL) missing.push('INSTITUTIONS_URL');
    if (!config.INTERNAL_SERVICE_TOKEN) missing.push('INTERNAL_SERVICE_TOKEN');

    if (missing.length > 0) {
      process.stderr.write(
        `\nFaltan dependencias obligatorias en produccion:\n${missing
          .map((name) => `  - ${name}`)
          .join('\n')}\n\n`,
      );
      process.exit(1);
    }
  }

  return config;
}
