import sharp from 'sharp';
import type { Logger } from '@glexco/observability';
import type { Thumbnailer } from '../../application/ports';
import type { S3ObjectStorage } from '../storage/s3-object-storage';

/**
 * Miniaturas de imagen con sharp.
 *
 * **Se genera aqui y no en el navegador** porque una miniatura hecha por el
 * cliente no es de fiar: quien sube el fichero controla lo que envia, y podria
 * mandar una miniatura que no tiene nada que ver con la imagen. En un portal
 * escolar eso es una via directa para colar contenido inapropiado detras de una
 * vista previa inocente.
 *
 * **El limite de pixeles no es opcional.** Sin el, una imagen de 40000x40000
 * -que comprime a pocos kilobytes y pasa cualquier limite de tamano- obliga a
 * reservar gigabytes al descomprimirla. Es la "bomba de descompresion" clasica,
 * y con subidas abiertas a miles de alumnos no es un escenario teorico.
 */
export class SharpThumbnailer implements Thumbnailer {
  /** Lado maximo de la miniatura, en pixeles. */
  private static readonly SIZE = 320;

  /** Tope de pixeles de la imagen ORIGEN. 50 megapixeles cubre cualquier camara
   *  de movil actual con margen y corta en seco las bombas de descompresion. */
  private static readonly MAX_SOURCE_PIXELS = 50_000_000;

  private static readonly THUMBNAILABLE = new Set(['image/jpeg', 'image/png', 'image/webp']);

  constructor(
    private readonly storage: S3ObjectStorage,
    private readonly logger: Logger,
  ) {}

  async generate(input: {
    bucket: string;
    key: string;
    mimeType: string;
  }): Promise<{ key: string } | null> {
    if (!SharpThumbnailer.THUMBNAILABLE.has(input.mimeType)) return null;

    try {
      // Se lee el objeto entero porque una imagen ya paso el limite de 12 MB al
      // subirse; para un video seria inviable, y por eso los videos no llegan
      // aqui.
      const source = await this.storage.readPrefix(input.bucket, input.key, 12 * 1024 * 1024);
      if (!source) return null;

      const pipeline = sharp(source, {
        limitInputPixels: SharpThumbnailer.MAX_SOURCE_PIXELS,
        // No se procesan imagenes con varias paginas o fotogramas: solo hace
        // falta la primera, y recorrerlas todas multiplica el coste.
        pages: 1,
      });

      const thumbnail = await pipeline
        .resize(SharpThumbnailer.SIZE, SharpThumbnailer.SIZE, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        // WebP para todas: pesa la mitad que un JPEG equivalente y lo soportan
        // todos los navegadores que esta plataforma admite.
        .webp({ quality: 78 })
        // `rotate()` sin argumentos aplica la orientacion EXIF. Sin esto, las
        // fotos hechas con el movil en vertical salen tumbadas en la miniatura
        // aunque se vean bien al abrirlas.
        .rotate()
        .toBuffer();

      const thumbnailKey = `${input.key}.thumb.webp`;
      await this.storage.put(input.bucket, thumbnailKey, thumbnail, 'image/webp');

      return { key: thumbnailKey };
    } catch (error) {
      // Una miniatura es presentacion, no contenido: que falle no puede
      // invalidar la evidencia que un alumno acaba de entregar.
      this.logger.warn({ err: error, key: input.key }, 'No se pudo generar la miniatura');
      return null;
    }
  }
}
