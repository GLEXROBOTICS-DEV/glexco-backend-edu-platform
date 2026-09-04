import {
  BusinessRuleError,
  NotFoundError,
  type Clock,
  type ExecutionContext,
  type LoggerPort,
  type ObjectStorage,
  type SecureRandom,
  type UnitOfWork,
  type UseCase,
} from '@glexco/kernel';
import { EVIDENCE_UPLOAD_TYPES } from '@glexco/contracts';
import {
  ACCEPTED_MEDIA,
  MediaAsset,
  MediaAssetId,
  isAcceptedMimeType,
  type AcceptedMimeType,
} from '../domain/media-asset.aggregate';
import { ExternalLink } from '../domain/shared-link';
import type {
  ContentSniffer,
  MediaAssetRepository,
  ObjectPrefixReader,
  Thumbnailer,
  VideoProvider,
} from './ports';

/** Buckets por finalidad. Separarlos permite politicas de retencion distintas:
 *  una evidencia escolar y un certificado no se conservan el mismo tiempo. */
export interface BucketMap {
  media: string;
  documents: string;
  evidence: string;
  certificates: string;
}

export type UploadScope = 'evidence' | 'content' | 'avatar' | 'document';

const SCOPE_BUCKET: Record<UploadScope, keyof BucketMap> = {
  evidence: 'evidence',
  content: 'media',
  avatar: 'media',
  document: 'documents',
};

/**
 * Que tipos admite cada ambito.
 *
 * **`evidence` NO admite video, y es una decision del cliente.** Asi trabajan de
 * verdad: la mayoria de las veces el docente corrige el montaje EN CLASE y en la
 * plataforma solo registra la nota. Cuando es a distancia, el alumno publica su
 * video donde ya lo tiene -YouTube, Drive, el Stream de su centro- y lo que
 * envia es el ENLACE; como mucho sube una FOTO que demuestre que esta hecho, y
 * el docente ve el video fuera.
 *
 * Cerrarlo aqui y no solo en la pantalla es lo que hace que valga: la lista del
 * frontend es comodidad, y quien llame a la API directamente se salta cualquier
 * restriccion que solo viva alli. Ademas coincide con lo que este mismo archivo
 * ya advertia: servir video desde nuestro ancho de banda es lo primero que
 * dispara la factura, y el proveedor externo todavia no esta contratado, asi que
 * un MP4 subido hoy se serviria desde aqui.
 *
 * El video sigue admitido en `content`, que son los tutoriales que produce
 * GLEXCO y pasan por el proveedor externo.
 *
 * El avatar se limita a imagen por la razon evidente, y un documento no es una
 * foto: aceptar cualquier cosa en cualquier sitio convierte la lista en
 * decorativa.
 */
const SCOPE_TYPES: Record<UploadScope, readonly string[]> = {
  evidence: EVIDENCE_UPLOAD_TYPES,
  content: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'video/mp4'],
  avatar: ['image/jpeg', 'image/png', 'image/webp'],
  document: ['application/pdf'],
};

export interface RequestUploadInput {
  scope: UploadScope;
  mimeType: string;
  filename: string;
  sizeBytes: number;
}

export interface RequestUploadOutput {
  mediaAssetId: string;
  url: string;
  fields: Record<string, string>;
  storageKey: string;
  expiresAt: string;
  maxBytes: number;
}

/**
 * Entrega una URL prefirmada para subir un fichero.
 *
 * **El fichero no pasa por nuestros servidores.** El cliente sube directo al
 * almacen de objetos. Hacerlo al reves -recibir el fichero y reenviarlo-
 * convertiria cada subida de video en minutos de una conexion ocupada, y con un
 * aula entera subiendo evidencias a la vez agotaria el pool de peticiones del
 * servicio sin que ninguna logica de negocio lo justifique.
 *
 * **Se firma un POST con politica, no un PUT.** La diferencia importa: un PUT
 * prefirmado no puede limitar el tamano, asi que cualquiera con la URL podria
 * subir un fichero de cien gigabytes. La politica del POST lleva
 * `content-length-range` y el propio almacen rechaza lo que se pase, sin que
 * nosotros veamos un solo byte.
 *
 * **La fila se crea ANTES de entregar la URL.** Asi todo objeto que llegue al
 * bucket tiene dueno conocido. Al reves quedarian objetos huerfanos que nadie
 * sabe de quien son ni si se pueden borrar.
 *
 * Lo que esta URL **no** garantiza es que lo subido sea lo que dice ser: eso
 * solo se sabe mirando los bytes, y de eso se encarga `ConfirmUploadUseCase`.
 */
export class RequestUploadUseCase implements UseCase<RequestUploadInput, RequestUploadOutput> {
  constructor(
    private readonly assets: MediaAssetRepository,
    private readonly storage: ObjectStorage,
    private readonly unitOfWork: UnitOfWork,
    private readonly buckets: BucketMap,
    private readonly presignTtlSeconds: number,
    private readonly clock: Clock,
    private readonly ids: SecureRandom,
    private readonly logger: LoggerPort,
  ) {}

  async execute(
    input: RequestUploadInput,
    context: ExecutionContext,
  ): Promise<RequestUploadOutput> {
    const actor = context.actor;
    if (!actor) {
      throw new BusinessRuleError('ACTOR_REQUIRED', 'Subir un archivo exige estar autenticado.');
    }

    if (!isAcceptedMimeType(input.mimeType)) {
      throw new BusinessRuleError(
        'MEDIA_TYPE_NOT_ACCEPTED',
        'Ese tipo de archivo no se admite.',
        { mimeType: input.mimeType, accepted: Object.keys(ACCEPTED_MEDIA) },
      );
    }

    const mimeType: AcceptedMimeType = input.mimeType;

    if (!SCOPE_TYPES[input.scope].includes(mimeType)) {
      throw new BusinessRuleError(
        'MEDIA_TYPE_NOT_ALLOWED_FOR_SCOPE',
        'Ese tipo de archivo no se admite para este uso.',
        { scope: input.scope, mimeType, allowed: SCOPE_TYPES[input.scope] },
      );
    }

    const spec = ACCEPTED_MEDIA[mimeType];

    // El tamano declarado se comprueba ANTES de firmar. No sustituye al limite
    // de la politica -el cliente puede mentir- pero evita firmar una URL que el
    // almacen va a rechazar, y da un error claro en vez de un fallo opaco de S3.
    if (input.sizeBytes > spec.maxBytes) {
      throw new BusinessRuleError(
        'MEDIA_TOO_LARGE',
        'El archivo supera el tamano maximo permitido para su tipo.',
        { sizeBytes: input.sizeBytes, maxBytes: spec.maxBytes },
      );
    }

    const now = this.clock.now();
    const bucket = this.buckets[SCOPE_BUCKET[input.scope]];

    const asset = MediaAsset.requestUpload({
      id: MediaAssetId.create(this.ids.uuid()),
      ownerId: actor.userId,
      institutionId: actor.institutionId ?? null,
      scope: input.scope,
      bucket,
      declaredMimeType: mimeType,
      originalFilename: input.filename,
      now,
    });

    await this.unitOfWork.run(async (tx) => {
      await this.assets.save(asset, tx);
    });

    const presigned = await this.storage.presignUpload({
      bucket,
      key: asset.storageKey.value,
      contentType: mimeType,
      maxSizeBytes: spec.maxBytes,
      ttlSeconds: this.presignTtlSeconds,
      metadata: { 'media-asset-id': asset.id.value, 'owner-id': actor.userId },
    });

    this.logger.info('URL de subida emitida', {
      mediaAssetId: asset.id.value,
      scope: input.scope,
      mimeType,
      ownerId: actor.userId,
      correlationId: context.correlationId,
    });

    return {
      mediaAssetId: asset.id.value,
      url: presigned.url,
      fields: presigned.fields,
      storageKey: presigned.key,
      expiresAt: presigned.expiresAt,
      maxBytes: spec.maxBytes,
    };
  }
}

// ---------------------------------------------------------------------------

export interface ConfirmUploadInput {
  mediaAssetId: string;
}

export interface ConfirmUploadOutput {
  mediaAssetId: string;
  status: 'ready' | 'rejected';
  mimeType: string | null;
  sizeBytes: number | null;
  thumbnailKey: string | null;
  reason?: string;
}

/**
 * Confirma una subida comprobando que los bytes son lo que dicen ser.
 *
 * **Esta es la pieza que justifica todo el servicio.** Un fichero se identifica
 * por su firma binaria, no por su extension ni por el `Content-Type` que anuncia
 * el navegador: las dos ultimas las escribe el cliente. Alguien que renombre un
 * ejecutable a `.pdf` y declare `application/pdf` pasa cualquier validacion que
 * se fie de lo que le cuentan; no pasa esta.
 *
 * Aqui se sube material de menores de edad y se sirve a aulas enteras, asi que
 * un fichero que no es lo que declara no se acepta "por si acaso": se rechaza y
 * se borra del bucket.
 *
 * Se leen solo los primeros bytes del objeto, nunca el objeto entero.
 */
export class ConfirmUploadUseCase implements UseCase<ConfirmUploadInput, ConfirmUploadOutput> {
  constructor(
    private readonly assets: MediaAssetRepository,
    private readonly storage: ObjectStorage,
    private readonly prefixReader: ObjectPrefixReader,
    private readonly sniffer: ContentSniffer,
    private readonly thumbnailer: Thumbnailer,
    private readonly videoProvider: VideoProvider,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly logger: LoggerPort,
  ) {}

  async execute(
    input: ConfirmUploadInput,
    context: ExecutionContext,
  ): Promise<ConfirmUploadOutput> {
    const actor = context.actor;
    if (!actor) {
      throw new BusinessRuleError('ACTOR_REQUIRED', 'Confirmar una subida exige estar autenticado.');
    }

    const now = this.clock.now();
    const id = MediaAssetId.create(input.mediaAssetId);

    // Fuera de la transaccion: leer del almacen puede tardar, y mantener una
    // transaccion abierta mientras se espera a la red retiene una conexion del
    // pool sin ninguna necesidad.
    const preliminary = await this.assets.findById(id);
    if (!preliminary) {
      throw new NotFoundError('MEDIA_NOT_FOUND', 'La subida indicada no existe.');
    }

    // Solo el dueno confirma su propia subida. Sin esto, conocer un id bastaria
    // para dar por buena la subida de otro.
    if (preliminary.ownerId !== actor.userId) {
      throw new NotFoundError('MEDIA_NOT_FOUND', 'La subida indicada no existe.');
    }

    if (preliminary.source !== 'upload') {
      throw new BusinessRuleError(
        'MEDIA_NOT_AN_UPLOAD',
        'Un enlace externo no se confirma: no hay bytes que comprobar.',
      );
    }

    const metadata = await this.storage.head(preliminary.bucket, preliminary.storageKey.value);

    if (!metadata) {
      throw new BusinessRuleError(
        'MEDIA_NOT_UPLOADED',
        'No hay ningun archivo en esa ubicacion. Vuelve a intentar la subida.',
      );
    }

    const prefix = await this.prefixReader.readPrefix(
      preliminary.bucket,
      preliminary.storageKey.value,
      this.sniffer.requiredBytes,
    );

    const detected = prefix ? this.sniffer.detect(prefix) : null;

    const result = await this.unitOfWork.run(async (tx) => {
      const asset = await this.assets.findByIdForUpdate(id, tx);
      if (!asset) throw new NotFoundError('MEDIA_NOT_FOUND', 'La subida indicada no existe.');

      // Idempotencia: si otra peticion ya resolvio esta subida, se devuelve el
      // estado en vez de fallar. El cliente reintenta la confirmacion con mucha
      // facilidad -una conexion movil que se cae a mitad basta-.
      if (asset.status !== 'pending') {
        return {
          asset,
          alreadyResolved: true,
          rejected: asset.status === 'rejected',
        };
      }

      // `!detected` es necesario ademas de la comparacion: con el tipo declarado
      // ahora anulable, `null === null` daria por bueno un fichero que no se
      // reconocio. Es justo el caso que hay que rechazar.
      if (!detected || detected !== asset.declaredMimeType) {
        asset.reject(
          detected
            ? `el contenido real es ${detected}, no ${asset.declaredMimeType}`
            : 'el contenido no corresponde a ningun tipo admitido',
          detected,
          now,
        );
        await this.assets.save(asset, tx);
        (tx as { enqueue(...events: unknown[]): void }).enqueue(...asset.pullDomainEvents());
        return { asset, alreadyResolved: false, rejected: true };
      }

      asset.markReady({ detectedMimeType: detected, sizeBytes: metadata.size, now });
      await this.assets.save(asset, tx);
      (tx as { enqueue(...events: unknown[]): void }).enqueue(...asset.pullDomainEvents());
      return { asset, alreadyResolved: false, rejected: false };
    });

    if (result.rejected && !result.alreadyResolved) {
      // El objeto se borra FUERA de la transaccion y despues de confirmarla. Si
      // se borrara dentro y la transaccion acabara en rollback, el fichero
      // habria desaparecido y la fila seguiria diciendo que existe.
      await this.storage
        .delete(preliminary.bucket, preliminary.storageKey.value)
        .catch((error) => {
          // El barrido periodico de abandonadas lo recogera.
          this.logger.error('No se pudo borrar un archivo rechazado', error, {
            mediaAssetId: input.mediaAssetId,
          });
        });

      this.logger.warn('Subida rechazada por no coincidir el tipo real', {
        mediaAssetId: input.mediaAssetId,
        declared: preliminary.declaredMimeType,
        detected,
        ownerId: actor.userId,
        correlationId: context.correlationId,
      });

      return {
        mediaAssetId: input.mediaAssetId,
        status: 'rejected',
        mimeType: detected,
        sizeBytes: null,
        thumbnailKey: null,
        reason: 'El contenido del archivo no corresponde con su tipo declarado.',
      };
    }

    if (!result.alreadyResolved) {
      await this.postProcess(result.asset, context);
    }

    return {
      mediaAssetId: input.mediaAssetId,
      status: result.rejected ? 'rejected' : 'ready',
      mimeType: detected,
      sizeBytes: result.asset.sizeBytes,
      thumbnailKey: result.asset.thumbnailKey,
    };
  }

  /**
   * Miniatura y registro en el proveedor de video.
   *
   * Ocurre DESPUES de que la subida ya sea valida, y ningun fallo aqui la
   * invalida: una miniatura es presentacion, y un video sin registrar en el
   * proveedor sigue existiendo en el bucket y se puede reintentar. Hacer que un
   * fallo de post-proceso tumbara la subida significaria que la evidencia que un
   * alumno acaba de entregar se pierde porque `sharp` no supo leer un JPEG raro.
   */
  private async postProcess(asset: MediaAsset, context: ExecutionContext): Promise<void> {
    const now = this.clock.now();

    try {
      if (asset.source !== 'upload') return;

      if (asset.declaredMimeType === 'video/mp4') {
        const registered = await this.videoProvider.register({
          mediaAssetId: asset.id.value,
          bucket: asset.bucket,
          key: asset.storageKey.value,
        });

        if (registered) {
          asset.attachVideoReference(registered.ref, now);
          await this.unitOfWork.run(async (tx) => this.assets.save(asset, tx));
        }
        return;
      }

      if (!asset.declaredMimeType) return;

      const thumbnail = await this.thumbnailer.generate({
        bucket: asset.bucket,
        key: asset.storageKey.value,
        mimeType: asset.declaredMimeType,
      });

      if (thumbnail) {
        asset.attachThumbnail(thumbnail.key, now);
        await this.unitOfWork.run(async (tx) => this.assets.save(asset, tx));
      }
    } catch (error) {
      this.logger.error('Post-proceso de un archivo fallido; la subida sigue siendo valida', error, {
        mediaAssetId: asset.id.value,
        correlationId: context.correlationId,
      });
    }
  }
}


// ---------------------------------------------------------------------------

export interface ShareLinkInput {
  scope: UploadScope;
  url: string;
  title: string;
}

export interface ShareLinkOutput {
  mediaAssetId: string;
  url: string;
  host: string;
  /** Aviso para la interfaz. No es decorativo: es el fallo mas frecuente. */
  warning: string;
}

/**
 * Registra material alojado fuera de la plataforma.
 *
 * Es el flujo que los centros ya tienen: el video de la exposicion vive en el
 * OneDrive de la universidad y lo que se comparte es el enlace. Adoptarlo evita
 * almacenar y servir gigabytes que no son nuestros, y encaja con lo que la gente
 * hace igualmente.
 *
 * **Lo que esta operacion NO puede garantizar, y por eso lo advierte:** que
 * quien reciba el enlace pueda abrirlo. El permiso lo gobierna el proveedor del
 * centro, no nosotros, y el fallo mas comun con diferencia es que el alumno
 * comparte un enlace restringido a su cuenta y el docente recibe "acceso
 * denegado". Comprobarlo desde aqui exigiria la sesion del docente, asi que lo
 * unico honesto es decirlo de forma explicita en la respuesta.
 *
 * Tampoco garantiza permanencia: si el alumno borra el archivo o su cuenta se
 * da de baja al terminar el curso, la evidencia desaparece -incluso despues de
 * calificada-. Para lo que tenga que quedar en un expediente, la subida sigue
 * siendo la opcion correcta.
 */
export class ShareLinkUseCase implements UseCase<ShareLinkInput, ShareLinkOutput> {
  constructor(
    private readonly assets: MediaAssetRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: SecureRandom,
    private readonly logger: LoggerPort,
  ) {}

  async execute(input: ShareLinkInput, context: ExecutionContext): Promise<ShareLinkOutput> {
    const actor = context.actor;
    if (!actor) {
      throw new BusinessRuleError(
        'ACTOR_REQUIRED',
        'Compartir un enlace exige estar autenticado.',
      );
    }

    // Toda la validacion vive en el objeto de valor: https, sin credenciales,
    // sin acortador y dominio en lista blanca. Aqui no se repite.
    const link = ExternalLink.create(input.url);

    const asset = MediaAsset.shareLink({
      id: MediaAssetId.create(this.ids.uuid()),
      ownerId: actor.userId,
      institutionId: actor.institutionId ?? null,
      scope: input.scope,
      link,
      title: input.title,
      now: this.clock.now(),
    });

    await this.unitOfWork.run(async (tx) => {
      await this.assets.save(asset, tx);
      (tx as { enqueue(...events: unknown[]): void }).enqueue(...asset.pullDomainEvents());
    });

    this.logger.info('Enlace externo compartido', {
      mediaAssetId: asset.id.value,
      scope: input.scope,
      host: link.host,
      ownerId: actor.userId,
      correlationId: context.correlationId,
    });

    return {
      mediaAssetId: asset.id.value,
      url: link.url,
      host: link.host,
      warning:
        'Comprueba que el enlace se pueda abrir desde fuera de tu cuenta. ' +
        'Si esta restringido, quien lo reciba vera "acceso denegado".',
    };
  }
}

// ---------------------------------------------------------------------------

export interface IssueDownloadUrlOutput {
  url: string;
  expiresInSeconds: number;
  mimeType: string | null;
  thumbnailUrl: string | null;
}

/**
 * Entrega una URL de descarga de vida corta.
 *
 * Los buckets son privados y no se hacen publicos "para que funcione": cada
 * descarga se firma en el momento, para quien la pide y por unos minutos. Una
 * URL filtrada caduca sola; un bucket publico, no.
 *
 * Para el video no se firma el objeto: se devuelve la URL del proveedor externo,
 * que es quien aplica la restriccion de dominio y sirve el streaming.
 */
export class IssueDownloadUrlUseCase
  implements UseCase<{ mediaAssetId: string }, IssueDownloadUrlOutput>
{
  constructor(
    private readonly assets: MediaAssetRepository,
    private readonly storage: ObjectStorage,
    private readonly videoProvider: VideoProvider,
    private readonly ttlSeconds: number,
  ) {}

  async execute(
    input: { mediaAssetId: string },
    context: ExecutionContext,
  ): Promise<IssueDownloadUrlOutput> {
    const actor = context.actor;
    if (!actor) {
      throw new BusinessRuleError('ACTOR_REQUIRED', 'Descargar exige estar autenticado.');
    }

    const asset = await this.assets.findById(MediaAssetId.create(input.mediaAssetId));
    if (!asset) {
      throw new NotFoundError('MEDIA_NOT_FOUND', 'El archivo indicado no existe.');
    }

    asset.assertReadableBy({ userId: actor.userId, institutionId: actor.institutionId });

    const state = asset.snapshot();

    // Material externo: se devuelve la direccion tal cual. No hay nada que
    // firmar porque el objeto no es nuestro, y el permiso lo gobierna el
    // proveedor del centro.
    if (state.source === 'link' && state.externalUrl) {
      return {
        url: state.externalUrl,
        expiresInSeconds: 0,
        mimeType: 'external/link',
        thumbnailUrl: null,
      };
    }

    if (state.videoProviderRef) {
      return {
        url: await this.videoProvider.playbackUrl(state.videoProviderRef),
        expiresInSeconds: this.ttlSeconds,
        mimeType: state.detectedMimeType,
        thumbnailUrl: null,
      };
    }

    const url = await this.storage.presignDownload(
      asset.bucket,
      asset.storageKey.value,
      this.ttlSeconds,
    );

    const thumbnailUrl = asset.thumbnailKey
      ? await this.storage.presignDownload(asset.bucket, asset.thumbnailKey, this.ttlSeconds)
      : null;

    return {
      url,
      expiresInSeconds: this.ttlSeconds,
      mimeType: state.detectedMimeType,
      thumbnailUrl,
    };
  }
}
