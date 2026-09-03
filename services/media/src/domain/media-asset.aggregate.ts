import {
  AggregateRoot,
  BusinessRuleError,
  DomainEvent,
  Guard,
  ValueObject,
  defineId,
  type DomainEventContext,
} from '@glexco/kernel';
import { EVENTS } from '@glexco/contracts';

export class MediaAssetId extends defineId('MediaAsset') {}

const AGGREGATE = 'MediaAsset';

/**
 * Estados de una subida.
 *
 * `pending` no es un detalle burocratico: la fila se crea ANTES de entregar la
 * URL prefirmada, de modo que todo objeto que llegue al bucket tiene un dueno
 * conocido. Sin ese registro previo, cualquier fichero subido con una URL
 * filtrada seria un objeto huerfano que nadie sabe de quien es ni si puede
 * borrarse.
 */
export const MEDIA_STATUS = {
  PENDING: 'pending',
  READY: 'ready',
  REJECTED: 'rejected',
  DELETED: 'deleted',
} as const;
export type MediaStatus = (typeof MEDIA_STATUS)[keyof typeof MEDIA_STATUS];

/**
 * Tipos que la plataforma acepta subir, con su firma binaria.
 *
 * La lista es cerrada a proposito. Aceptar "cualquier imagen" o "cualquier
 * documento" obliga a confiar en lo que declare el cliente, y lo que llega a
 * estos buckets son evidencias de trabajos escolares y material docente: un
 * fichero ejecutable con extension `.pdf` no es un caso hipotetico.
 *
 * Las firmas se comprueban sobre los BYTES REALES del objeto ya subido, no
 * sobre la extension ni sobre el `Content-Type` que anuncia el navegador. Las
 * dos ultimas las escribe el cliente y valen exactamente lo que valga su
 * palabra.
 */
export const ACCEPTED_MEDIA = {
  'image/jpeg': { extension: 'jpg', magic: [[0xff, 0xd8, 0xff]], maxBytes: 12 * 1024 * 1024 },
  'image/png': {
    extension: 'png',
    magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    maxBytes: 12 * 1024 * 1024,
  },
  'image/webp': {
    // RIFF....WEBP: los bytes 4-7 son el tamano, asi que se comprueban el
    // prefijo y el marcador de formato por separado.
    extension: 'webp',
    magic: [[0x52, 0x49, 0x46, 0x46]],
    magicAt8: [0x57, 0x45, 0x42, 0x50],
    maxBytes: 12 * 1024 * 1024,
  },
  'application/pdf': { extension: 'pdf', magic: [[0x25, 0x50, 0x44, 0x46, 0x2d]], maxBytes: 50 * 1024 * 1024 },
  'video/mp4': {
    // ....ftyp en el offset 4. El tamano de la caja ocupa los cuatro primeros.
    extension: 'mp4',
    magic: [],
    magicAt4: [0x66, 0x74, 0x79, 0x70],
    maxBytes: 2 * 1024 * 1024 * 1024,
  },
} as const;

export type AcceptedMimeType = keyof typeof ACCEPTED_MEDIA;

export function isAcceptedMimeType(value: string): value is AcceptedMimeType {
  return Object.prototype.hasOwnProperty.call(ACCEPTED_MEDIA, value);
}

/**
 * Clave del objeto en el bucket.
 *
 * Se construye SIEMPRE aqui y nunca se acepta del cliente. Una clave que venga
 * de fuera puede contener `../` y escribir donde no debe, o pisar el objeto de
 * otro usuario si adivina su ruta. Al derivarla del id del recurso, dos subidas
 * distintas jamas colisionan.
 */
export class StorageKey extends ValueObject<{ value: string }> {
  private constructor(value: string) {
    super({ value });
  }

  static build(input: {
    scope: string;
    ownerId: string;
    assetId: string;
    extension: string;
  }): StorageKey {
    Guard.againstEmpty(input.scope, 'scope');
    Guard.againstEmpty(input.ownerId, 'ownerId');

    // Se reparte por los dos primeros caracteres del id. Con millones de
    // objetos, una carpeta plana degrada el listado en cualquier almacen
    // compatible con S3 y complica cualquier operacion manual.
    const shard = input.assetId.slice(0, 2);
    return new StorageKey(
      `${input.scope}/${shard}/${input.assetId}.${input.extension}`,
    );
  }

  static fromString(value: string): StorageKey {
    Guard.againstEmpty(value, 'storageKey');
    return new StorageKey(value);
  }

  get value(): string {
    return this.props.value;
  }
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

export interface MediaUploadedPayload {
  mediaAssetId: string;
  ownerId: string;
  scope: string;
  bucket: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  institutionId: string | null;
}

export class MediaUploaded extends DomainEvent<MediaUploadedPayload> {
  constructor(payload: MediaUploadedPayload, version: number, context?: DomainEventContext) {
    super(EVENTS.MEDIA_UPLOAD_COMPLETED, AGGREGATE, payload.mediaAssetId, version, payload, context);
  }
}

export interface MediaRejectedPayload {
  mediaAssetId: string;
  ownerId: string;
  reason: string;
  declaredMimeType: string;
}

export class MediaRejected extends DomainEvent<MediaRejectedPayload> {
  constructor(payload: MediaRejectedPayload, version: number, context?: DomainEventContext) {
    super(EVENTS.MEDIA_PROCESSING_FAILED, AGGREGATE, payload.mediaAssetId, version, payload, context);
  }
}

// ---------------------------------------------------------------------------
// Agregado
// ---------------------------------------------------------------------------

interface MediaAssetState {
  ownerId: string;
  institutionId: string | null;
  scope: string;
  bucket: string;
  storageKey: StorageKey;
  declaredMimeType: AcceptedMimeType;
  detectedMimeType: string | null;
  originalFilename: string;
  sizeBytes: number | null;
  status: MediaStatus;
  rejectionReason: string | null;
  thumbnailKey: string | null;
  /** Id en el proveedor de video externo, cuando el recurso es un video largo. */
  videoProviderRef: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Un fichero subido por alguien de la plataforma.
 *
 * El ciclo de vida es corto y tiene una sola forma:
 *
 *   pending  --confirma y los bytes cuadran-->  ready
 *   pending  --los bytes NO cuadran-------->  rejected
 *
 * La transicion la decide `confirmUpload` comparando la firma binaria real con
 * el tipo declarado. No hay camino de `rejected` a `ready`: si el fichero no era
 * lo que decia ser, se vuelve a subir, no se indulta.
 */
export class MediaAsset extends AggregateRoot<MediaAssetId> {
  private constructor(
    id: MediaAssetId,
    private state: MediaAssetState,
  ) {
    super(id);
  }

  static requestUpload(input: {
    id: MediaAssetId;
    ownerId: string;
    institutionId: string | null;
    scope: string;
    bucket: string;
    declaredMimeType: AcceptedMimeType;
    originalFilename: string;
    now: Date;
  }): MediaAsset {
    const storageKey = StorageKey.build({
      scope: input.scope,
      ownerId: input.ownerId,
      assetId: input.id.value,
      extension: ACCEPTED_MEDIA[input.declaredMimeType].extension,
    });

    const asset = new MediaAsset(input.id, {
      ownerId: input.ownerId,
      institutionId: input.institutionId,
      scope: input.scope,
      bucket: input.bucket,
      storageKey,
      declaredMimeType: input.declaredMimeType,
      detectedMimeType: null,
      originalFilename: input.originalFilename,
      sizeBytes: null,
      status: MEDIA_STATUS.PENDING,
      rejectionReason: null,
      thumbnailKey: null,
      videoProviderRef: null,
      createdAt: input.now,
      updatedAt: input.now,
    });

    // La creacion NO emite evento: todavia no ha ocurrido nada que interese a
    // otro servicio. Una URL pedida y nunca usada es lo mas comun del mundo -el
    // usuario cambia de idea- y publicar un evento por cada una llenaria el bus
    // de ruido.
    asset.touch();
    return asset;
  }

  static rehydrate(id: MediaAssetId, state: MediaAssetState, version: number): MediaAsset {
    const asset = new MediaAsset(id, state);
    asset.setVersion(version);
    return asset;
  }

  /**
   * Acepta la subida tras comprobar que los bytes reales coinciden con el tipo
   * declarado.
   *
   * Recibe el tipo YA detectado, no los bytes: leer del almacen es trabajo de
   * infraestructura y el dominio no debe saber de dónde salen.
   */
  markReady(input: { detectedMimeType: string; sizeBytes: number; now: Date }): void {
    this.assertPending();

    const spec = ACCEPTED_MEDIA[this.state.declaredMimeType];

    if (input.detectedMimeType !== this.state.declaredMimeType) {
      throw new BusinessRuleError(
        'MEDIA_TYPE_MISMATCH',
        'El contenido del archivo no corresponde con su tipo declarado.',
        { declared: this.state.declaredMimeType, detected: input.detectedMimeType },
      );
    }

    if (input.sizeBytes > spec.maxBytes) {
      throw new BusinessRuleError(
        'MEDIA_TOO_LARGE',
        'El archivo supera el tamano maximo permitido para su tipo.',
        { sizeBytes: input.sizeBytes, maxBytes: spec.maxBytes },
      );
    }

    if (input.sizeBytes === 0) {
      throw new BusinessRuleError('MEDIA_EMPTY', 'El archivo esta vacio.');
    }

    this.state.detectedMimeType = input.detectedMimeType;
    this.state.sizeBytes = input.sizeBytes;
    this.state.status = MEDIA_STATUS.READY;
    this.state.updatedAt = input.now;

    this.record(
      (version) =>
        new MediaUploaded(
          {
            mediaAssetId: this.id.value,
            ownerId: this.state.ownerId,
            scope: this.state.scope,
            bucket: this.state.bucket,
            storageKey: this.state.storageKey.value,
            mimeType: input.detectedMimeType,
            sizeBytes: input.sizeBytes,
            institutionId: this.state.institutionId,
          },
          version,
          { actorId: this.state.ownerId, tenantId: this.state.institutionId ?? undefined },
        ),
    );
  }

  /** Rechaza la subida. El objeto se borra del bucket fuera del agregado. */
  reject(reason: string, detected: string | null, now: Date): void {
    this.assertPending();

    this.state.status = MEDIA_STATUS.REJECTED;
    this.state.rejectionReason = reason;
    this.state.detectedMimeType = detected;
    this.state.updatedAt = now;

    this.record(
      (version) =>
        new MediaRejected(
          {
            mediaAssetId: this.id.value,
            ownerId: this.state.ownerId,
            reason,
            declaredMimeType: this.state.declaredMimeType,
          },
          version,
          { actorId: this.state.ownerId, tenantId: this.state.institutionId ?? undefined },
        ),
    );
  }

  /** Miniatura generada. No emite evento: es un detalle de presentacion. */
  attachThumbnail(key: string, now: Date): void {
    this.touch();
    this.state.thumbnailKey = key;
    this.state.updatedAt = now;
  }

  /** Referencia en el proveedor de video externo. */
  attachVideoReference(ref: string, now: Date): void {
    this.touch();
    this.state.videoProviderRef = ref;
    this.state.updatedAt = now;
  }

  markDeleted(now: Date): void {
    this.touch();
    this.state.status = MEDIA_STATUS.DELETED;
    this.state.updatedAt = now;
  }

  /**
   * Comprueba que quien pide el fichero es su dueno.
   *
   * El guard de permisos sabe que alguien puede "leer medios"; solo aqui, con el
   * recurso concreto delante, se sabe si ESTE es suyo. Las dos comprobaciones
   * hacen falta y ninguna sustituye a la otra.
   */
  assertReadableBy(actor: { userId: string; institutionId?: string | undefined }): void {
    if (this.state.status !== MEDIA_STATUS.READY) {
      throw new BusinessRuleError('MEDIA_NOT_READY', 'El archivo no esta disponible.');
    }

    if (this.state.ownerId === actor.userId) return;

    // Un docente o administrador puede ver la evidencia de un alumno de SU
    // institucion. Fuera de ella, nadie: aqui hay trabajos de menores de edad.
    if (
      this.state.institutionId &&
      actor.institutionId &&
      this.state.institutionId === actor.institutionId
    ) {
      return;
    }

    throw new BusinessRuleError('MEDIA_NOT_ACCESSIBLE', 'Este archivo no esta disponible.');
  }

  private assertPending(): void {
    if (this.state.status !== MEDIA_STATUS.PENDING) {
      throw new BusinessRuleError(
        'MEDIA_ALREADY_RESOLVED',
        'Esta subida ya fue confirmada o rechazada.',
        { status: this.state.status },
      );
    }
  }

  get ownerId(): string {
    return this.state.ownerId;
  }
  get bucket(): string {
    return this.state.bucket;
  }
  get storageKey(): StorageKey {
    return this.state.storageKey;
  }
  get declaredMimeType(): AcceptedMimeType {
    return this.state.declaredMimeType;
  }
  get status(): MediaStatus {
    return this.state.status;
  }
  get sizeBytes(): number | null {
    return this.state.sizeBytes;
  }
  get thumbnailKey(): string | null {
    return this.state.thumbnailKey;
  }
  get institutionId(): string | null {
    return this.state.institutionId;
  }

  snapshot(): Readonly<MediaAssetState> {
    return this.state;
  }
}
