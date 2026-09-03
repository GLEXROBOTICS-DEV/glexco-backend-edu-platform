import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  ObjectMetadata,
  ObjectStorage,
  PresignUploadInput,
  PresignedUpload,
} from '@glexco/kernel';
import type { ObjectPrefixReader } from '../../application/ports';

export interface S3Options {
  endpoint?: string | undefined;
  region: string;
  accessKey: string;
  secretKey: string;
  /** MinIO y algunos almacenes compatibles no admiten el estilo de host virtual. */
  forcePathStyle: boolean;
  defaultTtlSeconds: number;
}

/**
 * Adaptador de almacenamiento de objetos compatible con S3.
 *
 * Sirve igual para MinIO en local, S3 en AWS y OBS en Huawei: los tres hablan el
 * mismo protocolo. Esa compatibilidad es lo que permite que la decision de
 * proveedor no se tome ahora y no cueste nada cambiarla despues.
 */
export class S3ObjectStorage implements ObjectStorage, ObjectPrefixReader {
  private readonly client: S3Client;

  constructor(private readonly options: S3Options) {
    this.client = new S3Client({
      region: options.region,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      forcePathStyle: options.forcePathStyle,
      credentials: {
        accessKeyId: options.accessKey,
        secretAccessKey: options.secretKey,
      },
    });
  }

  /**
   * Firma un POST con politica, no un PUT.
   *
   * Es la diferencia entre poder limitar el tamano y no poder. Un PUT prefirmado
   * autoriza a escribir en esa clave y punto: quien tenga la URL puede subir un
   * fichero de cualquier tamano hasta que caduque. La politica del POST lleva
   * `content-length-range` y es el propio almacen quien rechaza lo que se pase,
   * sin que nosotros recibamos un solo byte.
   *
   * El `Content-Type` tambien va fijado en la politica. No garantiza que el
   * contenido sea ese -eso solo lo dicen los bytes- pero impide que el objeto
   * quede almacenado anunciandose como algo distinto de lo que se autorizo.
   */
  async presignUpload(input: PresignUploadInput): Promise<PresignedUpload> {
    const ttl = input.ttlSeconds ?? this.options.defaultTtlSeconds;

    const { url, fields } = await createPresignedPost(this.client, {
      Bucket: input.bucket,
      Key: input.key,
      Conditions: [
        ['content-length-range', 1, input.maxSizeBytes],
        ['eq', '$Content-Type', input.contentType],
      ],
      Fields: {
        'Content-Type': input.contentType,
        ...Object.fromEntries(
          Object.entries(input.metadata ?? {}).map(([key, value]) => [`x-amz-meta-${key}`, value]),
        ),
      },
      Expires: ttl,
    });

    return {
      url,
      fields,
      key: input.key,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  }

  async presignDownload(bucket: string, key: string, ttlSeconds?: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: ttlSeconds ?? this.options.defaultTtlSeconds,
    });
  }

  async delete(bucket: string, key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  async head(bucket: string, key: string): Promise<ObjectMetadata | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));

      return {
        size: result.ContentLength ?? 0,
        contentType: result.ContentType ?? 'application/octet-stream',
        etag: result.ETag ?? '',
        lastModified: (result.LastModified ?? new Date()).toISOString(),
      };
    } catch (error) {
      // "No existe" es una respuesta valida, no un fallo: el usuario pudo pedir
      // la URL y no llegar a subir nada.
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  /**
   * Descarga solo los primeros bytes, con `Range`.
   *
   * Es lo que hace viable la validacion de tipo real: para decidir si un fichero
   * es lo que dice ser bastan doce bytes. Bajarse el objeto entero significaria
   * traer dos gigabytes de video por cada subida, y con un aula entera
   * entregando evidencias a la vez saturaria la red del servicio sin motivo.
   */
  async readPrefix(bucket: string, key: string, bytes: number): Promise<Buffer | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${bytes - 1}` }),
      );

      if (!result.Body) return null;
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  /** Sube un objeto derivado, como una miniatura. */
  async put(bucket: string, key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  destroy(): void {
    this.client.destroy();
  }
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string }).name;
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return name === 'NotFound' || name === 'NoSuchKey' || status === 404;
}
