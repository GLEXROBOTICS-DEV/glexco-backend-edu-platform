import {
  ForbiddenError,
  NotFoundError,
  type ObjectStorage,
  type UseCase,
} from '@glexco/kernel';
import type { ContentAsset, ContentRepository, EntitlementRepository } from '../domain/repositories';

/**
 * Abre un recurso de la biblioteca de un kit.
 *
 * Es el unico camino por el que el material de un kit llega al navegador de un
 * alumno, y por eso concentra la comprobacion que de verdad importa: **el
 * derecho se comprueba sobre el kit del recurso, no sobre el kit que diga
 * quien pregunta**. Aceptar un `kitId` de la peticion permitiria pedir el
 * recurso de un kit ajeno diciendo tener derecho sobre el propio.
 *
 * Vive en catalogo y no en media porque catalogo es quien posee las dos mitades:
 * la fila del recurso y la regla del derecho. Media firma las SUBIDAS -evidencias
 * del alumno, material del docente-; esto es material del catalogo, que es otra
 * cosa aunque acabe en el mismo almacen.
 *
 * Los buckets son privados y siguen siendolo: lo que sale de aqui es una URL
 * firmada de vida corta, nunca una direccion permanente.
 */
export interface OpenLibraryAssetInput {
  assetId: string;
  studentId: string;
}

export interface OpenLibraryAssetOutput {
  assetId: string;
  title: string;
  description: string;
  type: string;
  locale: 'es' | 'en';
  /**
   * Como hay que presentarlo.
   *
   * `stream` es un archivo de video que el navegador reproduce directamente;
   * `embed` es la pagina del proveedor, que hay que incrustar en un marco. La
   * diferencia la decide el backend y no la pantalla: un proveedor de video no
   * sirve un MP4, sirve su propio reproductor con la restriccion de dominio
   * aplicada, y meterlo en un `<video>` no muestra nada. Que lo adivine el
   * cliente es como se consigue que la pantalla se rompa el dia que se contrate
   * el proveedor, sin que nadie haya tocado el frontend.
   */
  delivery: 'stream' | 'embed' | 'external' | 'download';
  url: string;
  /** `0` en un enlace externo: no caduca porque no lo firmamos nosotros. */
  expiresInSeconds: number;
  durationSeconds: number | null;
  sizeBytes: number | null;
  downloadable: boolean;
}

export class OpenLibraryAssetUseCase
  implements UseCase<OpenLibraryAssetInput, OpenLibraryAssetOutput>
{
  constructor(
    private readonly content: ContentRepository,
    private readonly entitlements: EntitlementRepository,
    private readonly storage: ObjectStorage,
    private readonly videoPlaybackUrl: (ref: string) => Promise<string>,
    /** `true` cuando hay proveedor contratado y lo que devuelve es su pagina. */
    private readonly videoIsEmbedded: boolean,
    private readonly ttlSeconds: number,
  ) {}

  async execute(input: OpenLibraryAssetInput): Promise<OpenLibraryAssetOutput> {
    const asset = await this.content.findAsset(input.assetId);

    // Un recurso en borrador no existe para un alumno. Se responde igual que si
    // no existiera: distinguirlos delataria que hay material en preparacion y
    // cuanto, que es informacion comercial.
    if (!asset || asset.status !== 'published') {
      throw new NotFoundError('ASSET_NOT_FOUND', 'Este material no está disponible.');
    }

    const allowed = await this.entitlements.hasActiveForKit(input.studentId, asset.kitId);
    if (!allowed) {
      // Mismo error que usa el listado de la biblioteca, y por la misma razon:
      // distinguir "no es tuyo" de "no existe" permite recorrer el catalogo
      // entero probando identificadores.
      throw new ForbiddenError('KIT_NOT_ACCESSIBLE', 'Este contenido no está en tu kit.');
    }

    return { ...this.describe(asset), ...(await this.locate(asset)) };
  }

  private describe(asset: ContentAsset) {
    return {
      assetId: asset.id,
      title: asset.title,
      description: asset.description,
      type: asset.type as string,
      locale: asset.locale,
      durationSeconds: asset.durationSeconds,
      sizeBytes: asset.sizeBytes,
      downloadable: asset.downloadable,
    };
  }

  private async locate(
    asset: ContentAsset,
  ): Promise<{ delivery: OpenLibraryAssetOutput['delivery']; url: string; expiresInSeconds: number }> {
    if (asset.storageKind === 'external_link') {
      // El objeto no es nuestro: no hay nada que firmar y el permiso lo gobierna
      // el proveedor del centro. Se marca como externo para que la pantalla lo
      // abra fuera en vez de intentar incrustarlo, que es lo que rompe con la
      // mitad de los proveedores por su politica de marcos.
      return { delivery: 'external', url: asset.storageRef, expiresInSeconds: 0 };
    }

    if (asset.storageKind === 'video_provider') {
      return {
        delivery: this.videoIsEmbedded ? 'embed' : 'stream',
        url: await this.videoPlaybackUrl(asset.storageRef),
        expiresInSeconds: this.ttlSeconds,
      };
    }

    if (!asset.bucket) {
      // Un recurso de almacen sin bucket es un dato roto, no una peticion mala.
      throw new NotFoundError('ASSET_NOT_FOUND', 'Este material no está disponible.');
    }

    return {
      delivery: 'download',
      url: await this.storage.presignDownload(asset.bucket, asset.storageRef, this.ttlSeconds),
      expiresInSeconds: this.ttlSeconds,
    };
  }
}
