import { CircuitBreaker, defaultBreakerOptions, type S3ObjectStorage } from '@glexco/nest-platform';
import { ServiceUnavailableError } from '@glexco/kernel';
import type { Logger } from '@glexco/observability';
import type { VideoProvider } from '../../application/ports';

/**
 * Proveedor de video externo.
 *
 * **Que es y por que hace falta.** Un video no se sirve como un PDF. Un tutorial
 * de diez minutos en 720p pesa unos 150 MB; visto por cien mil alumnos son
 * 15 TB de salida, que a precio de almacenamiento de objetos son cuatro cifras
 * por UN solo video. Ademas, un MP4 servido tal cual no se adapta a la conexion:
 * en un colegio con mala linea el alumno mira la rueda girando en vez de la
 * clase. El bitrate adaptativo exige transcodificar cada video a varias
 * calidades, y eso un bucket no lo hace.
 *
 * **El catalogo de GLEXCO juega a favor.** Los tutoriales los produce GLEXCO y
 * son los mismos para todos: es un catalogo fijo y pequeno, no contenido subido
 * por usuarios. Eso abarata mucho la factura -se paga por minuto almacenado y
 * por minuto visto- y hace la eleccion de proveedor reversible.
 *
 * La decision de arquitectura es hibrida y esta tomada: el video largo NO se
 * sirve desde nuestro ancho de banda. Un video de clase son cientos de megas y
 * lo abren aulas enteras a la vez; servirlo nosotros es lo primero que dispara
 * la factura de salida, y ademas obligaria a resolver por nuestra cuenta el
 * streaming adaptativo, que es lo que hace que el video se vea en la conexion
 * de un colegio rural.
 *
 * El proveedor aplica ademas la restriccion de dominio: sus URLs solo funcionan
 * incrustadas desde nuestras paginas, asi que un enlace copiado no convierte el
 * contenido de pago en contenido publico.
 */
export class HttpVideoProvider implements VideoProvider {
  private readonly breaker: CircuitBreaker;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    logger?: Logger,
  ) {
    this.breaker = new CircuitBreaker({
      ...defaultBreakerOptions('video-provider', logger),
      // Registrar un video es una operacion de ingesta y tarda: el timeout es
      // mas generoso que el de una lectura normal.
      timeoutMs: 15_000,
      failureThreshold: 5,
    });
  }

  async register(input: {
    mediaAssetId: string;
    bucket: string;
    key: string;
  }): Promise<{ ref: string } | null> {
    return this.breaker.execute(async () => {
      const response = await fetch(`${this.baseUrl}/videos`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          externalId: input.mediaAssetId,
          source: { bucket: input.bucket, key: input.key },
        }),
      });

      if (!response.ok) {
        throw new ServiceUnavailableError(
          'VIDEO_PROVIDER_UNAVAILABLE',
          'El proveedor de video no respondio correctamente.',
          { status: response.status },
        );
      }

      const body = (await response.json()) as { id?: string };
      return body.id ? { ref: body.id } : null;
    });
  }

  async playbackUrl(ref: string): Promise<string> {
    return `${this.baseUrl}/play/${encodeURIComponent(ref)}`;
  }
}

/**
 * Sustituto para desarrollo: el video se queda en el almacen de objetos.
 *
 * Sirve para trabajar sin contratar un proveedor, y **no puede llegar a
 * produccion**: `loadMediaConfig` aborta el arranque si falta la URL del
 * proveedor real fuera de desarrollo. Sin esa comprobacion, un despliegue
 * descuidado empezaria a servir video desde nuestro propio ancho de banda y el
 * primer aviso seria la factura.
 */
export class ObjectStorageVideoProvider implements VideoProvider {
  constructor(
    private readonly storage: S3ObjectStorage,
    private readonly ttlSeconds: number,
  ) {}

  async register(input: { bucket: string; key: string }): Promise<{ ref: string } | null> {
    // La referencia es la propia ubicacion: no hay proveedor al que registrar.
    return { ref: `${input.bucket}:${input.key}` };
  }

  async playbackUrl(ref: string): Promise<string> {
    const separator = ref.indexOf(':');
    const bucket = ref.slice(0, separator);
    const key = ref.slice(separator + 1);
    return this.storage.presignDownload(bucket, key, this.ttlSeconds);
  }
}
