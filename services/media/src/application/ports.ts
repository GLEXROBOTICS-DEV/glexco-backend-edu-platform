import type { TransactionContext } from '@glexco/kernel';
import type { MediaAsset, MediaAssetId } from '../domain/media-asset.aggregate';

export interface MediaAssetRepository {
  findById(id: MediaAssetId): Promise<MediaAsset | null>;
  /** Carga bloqueando la fila: la confirmacion de una subida no puede solaparse
   *  consigo misma si el cliente reintenta. */
  findByIdForUpdate(id: MediaAssetId, tx: TransactionContext): Promise<MediaAsset | null>;
  save(asset: MediaAsset, tx: TransactionContext): Promise<void>;
  /** Subidas que quedaron a medias, para la limpieza periodica. */
  listAbandoned(olderThan: Date, limit: number): Promise<MediaAsset[]>;
}

/**
 * Lee los primeros bytes de un objeto ya subido.
 *
 * Es un puerto propio y no un metodo mas de `ObjectStorage` porque su motivo es
 * distinto: existe unicamente para la validacion de tipo real, y quien lo
 * implemente tiene que garantizar que descarga un PREFIJO y no el objeto
 * entero. Bajarse dos gigabytes de video para mirar cuatro bytes seria absurdo,
 * y con miles de subidas concurrentes, ruinoso.
 */
export interface ObjectPrefixReader {
  readPrefix(bucket: string, key: string, bytes: number): Promise<Buffer | null>;
}

/**
 * Detecta el tipo real a partir de la firma binaria.
 *
 * Devuelve `null` cuando no reconoce el contenido, que se trata como rechazo:
 * la lista de tipos aceptados es cerrada, asi que "no lo reconozco" y "no lo
 * acepto" son la misma respuesta.
 */
export interface ContentSniffer {
  detect(prefix: Buffer): string | null;
  /** Bytes que necesita para decidir. */
  readonly requiredBytes: number;
}

/**
 * Generacion de miniaturas.
 *
 * Falla en silencio a proposito -devuelve `null`- porque una miniatura es
 * presentacion, no contenido. Que no se pueda generar no debe invalidar una
 * evidencia que un alumno acaba de subir y que su docente tiene que calificar.
 */
export interface Thumbnailer {
  generate(input: {
    bucket: string;
    key: string;
    mimeType: string;
  }): Promise<{ key: string } | null>;
}

/**
 * Proveedor de video externo.
 *
 * La decision de arquitectura es hibrida: los videos largos NO se sirven desde
 * nuestro ancho de banda, sino desde un proveedor privado con restriccion de
 * dominio. Servirlos nosotros es lo primero que dispara la factura, y ademas
 * obligaria a resolver por nuestra cuenta el streaming adaptativo.
 *
 * El puerto aisla esa eleccion: cambiar de proveedor no toca el dominio.
 */
export interface VideoProvider {
  /** Registra el video y devuelve la referencia con la que se reproducira. */
  register(input: {
    mediaAssetId: string;
    bucket: string;
    key: string;
  }): Promise<{ ref: string } | null>;

  /** URL de reproduccion, de vida corta y restringida al dominio. */
  playbackUrl(ref: string): Promise<string>;
}
