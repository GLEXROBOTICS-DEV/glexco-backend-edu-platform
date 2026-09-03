import type { Pool } from 'pg';
import { ConcurrencyError, type TransactionContext } from '@glexco/kernel';
import type { PgTransaction } from '@glexco/nest-platform';
import {
  MediaAsset,
  MediaAssetId,
  StorageKey,
  type AcceptedMimeType,
  type MediaStatus,
} from '../../domain/media-asset.aggregate';
import type { MediaAssetRepository } from '../../application/ports';

interface MediaRow {
  id: string;
  owner_id: string;
  institution_id: string | null;
  scope: string;
  source: 'upload' | 'link';
  bucket: string | null;
  storage_key: string | null;
  declared_mime_type: string | null;
  external_url: string | null;
  external_host: string | null;
  detected_mime_type: string | null;
  original_filename: string;
  size_bytes: string | null;
  status: MediaStatus;
  rejection_reason: string | null;
  thumbnail_key: string | null;
  video_provider_ref: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `
  id, owner_id, institution_id, scope, source, bucket, storage_key,
  declared_mime_type, external_url, external_host, detected_mime_type,
  original_filename, size_bytes, status, rejection_reason, thumbnail_key,
  video_provider_ref, version, created_at, updated_at
`;

export class PgMediaAssetRepository implements MediaAssetRepository {
  /** Solo el pool de LECTURA: toda escritura pasa por el cliente de la
   *  transaccion. Ver la nota equivalente en los repositorios de catalogo. */
  constructor(private readonly readPool: Pool) {}

  async findById(id: MediaAssetId): Promise<MediaAsset | null> {
    const { rows } = await this.readPool.query<MediaRow>(
      `SELECT ${COLUMNS} FROM media.media_assets WHERE id = $1`,
      [id.value],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  /**
   * Carga bloqueando la fila.
   *
   * El cliente reintenta la confirmacion con mucha facilidad -una conexion movil
   * que se corta a mitad basta- y sin el bloqueo dos confirmaciones simultaneas
   * leerian ambas `pending`, ambas generarian miniatura y ambas emitirian el
   * evento de subida completada.
   */
  async findByIdForUpdate(id: MediaAssetId, tx: TransactionContext): Promise<MediaAsset | null> {
    const client = (tx as PgTransaction).client;
    const { rows } = await client.query<MediaRow>(
      `SELECT ${COLUMNS} FROM media.media_assets WHERE id = $1 FOR UPDATE`,
      [id.value],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async save(asset: MediaAsset, tx: TransactionContext): Promise<void> {
    // Sin cambios no se escribe. Un `UPDATE ... WHERE version < :nueva` con la
    // misma version no encontraria fila y se interpretaria como conflicto de
    // concurrencia: ver `AggregateRoot.hasChanges`.
    if (!asset.hasChanges) return;
    const client = (tx as PgTransaction).client;
    const state = asset.snapshot();

    const result = await client.query(
      `INSERT INTO media.media_assets
         (id, owner_id, institution_id, scope, source, bucket, storage_key,
          declared_mime_type, external_url, external_host, detected_mime_type,
          original_filename, size_bytes, status, rejection_reason, thumbnail_key,
          video_provider_ref, version, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       ON CONFLICT (id) DO UPDATE
          SET detected_mime_type = EXCLUDED.detected_mime_type,
              size_bytes         = EXCLUDED.size_bytes,
              status             = EXCLUDED.status,
              rejection_reason   = EXCLUDED.rejection_reason,
              thumbnail_key      = EXCLUDED.thumbnail_key,
              video_provider_ref = EXCLUDED.video_provider_ref,
              version            = EXCLUDED.version,
              updated_at         = EXCLUDED.updated_at
        WHERE media.media_assets.version < EXCLUDED.version`,
      [
        asset.id.value,
        state.ownerId,
        state.institutionId,
        state.scope,
        state.source,
        state.bucket,
        state.storageKey?.value ?? null,
        state.declaredMimeType,
        state.externalUrl,
        state.externalHost,
        state.detectedMimeType,
        state.originalFilename,
        state.sizeBytes,
        state.status,
        state.rejectionReason,
        state.thumbnailKey,
        state.videoProviderRef,
        asset.version,
        state.createdAt,
        state.updatedAt,
      ],
    );

    // En un INSERT nuevo siempre hay una fila afectada, asi que un 0 solo puede
    // venir de la clausula WHERE del UPDATE: otra escritura gano la carrera.
    if (result.rowCount === 0 && asset.version > 1) {
      throw new ConcurrencyError('MediaAsset', asset.id.value, asset.version, -1);
    }
  }

  /**
   * Subidas que se quedaron a medias.
   *
   * Son inevitables y numerosas: el usuario pide la URL, cambia de idea o pierde
   * la conexion, y la fila queda en `pending` para siempre. La tarea de limpieza
   * las borra junto con cualquier objeto que si llegara al bucket, que de otro
   * modo se pagaria indefinidamente sin que nadie sepa que esta ahi.
   */
  async listAbandoned(olderThan: Date, limit: number): Promise<MediaAsset[]> {
    const { rows } = await this.readPool.query<MediaRow>(
      `SELECT ${COLUMNS} FROM media.media_assets
        WHERE status = 'pending' AND created_at < $1
        ORDER BY created_at
        LIMIT $2`,
      [olderThan, limit],
    );
    return rows.map(toDomain);
  }
}

function toDomain(row: MediaRow): MediaAsset {
  return MediaAsset.rehydrate(
    MediaAssetId.create(row.id),
    {
      ownerId: row.owner_id,
      institutionId: row.institution_id,
      scope: row.scope,
      source: row.source,
      bucket: row.bucket,
      storageKey: row.storage_key ? StorageKey.fromString(row.storage_key) : null,
      declaredMimeType: (row.declared_mime_type as AcceptedMimeType | null) ?? null,
      externalUrl: row.external_url,
      externalHost: row.external_host,
      detectedMimeType: row.detected_mime_type,
      originalFilename: row.original_filename,
      // bigint llega como cadena para no perder precision con valores enormes;
      // aqui caben de sobra en un number, pero la conversion tiene que ser
      // explicita o acabaria comparandose una cadena con un numero.
      sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
      status: row.status,
      rejectionReason: row.rejection_reason,
      thumbnailKey: row.thumbnail_key,
      videoProviderRef: row.video_provider_ref,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    row.version,
  );
}
