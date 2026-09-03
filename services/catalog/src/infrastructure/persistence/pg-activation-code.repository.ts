import type { Pool } from 'pg';
import {
  ConcurrencyError,
  encodeCursor,
  decodeCursor,
  normalizeLimit,
  type CursorPage,
  type CursorQuery,
  type TransactionContext,
} from '@glexco/kernel';
import type { ActivationCodeStatus } from '@glexco/contracts';
import type { PgTransaction } from '@glexco/nest-platform';
import {
  ActivationCode,
  ActivationCodeId,
} from '../../domain/activation-code/activation-code.aggregate';
import type {
  ActivationCodeRepository,
  BatchCodeSummary,
  CodeBatchSummary,
  NewCodeBatch,
} from '../../domain/repositories';

interface CodeRow {
  id: string;
  code_hash: string;
  code_suffix: string;
  batch_id: string;
  kit_id: string;
  grade: string;
  status: ActivationCodeStatus;
  redeemed_by: string | null;
  redeemed_at: Date | null;
  distributed_to: string | null;
  expires_at: Date | null;
  revoked_reason: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `
  id, code_hash, code_suffix, batch_id, kit_id, grade, status, redeemed_by,
  redeemed_at, distributed_to, expires_at, revoked_reason, version,
  created_at, updated_at
`;

export class PgActivationCodeRepository implements ActivationCodeRepository {
  /**
   * Solo el pool de LECTURA.
   *
   * Toda escritura pasa por el cliente de la transaccion. No tener aqui un pool
   * de escritura hace imposible el error que romperia la garantia de un solo
   * uso: lanzar el UPDATE del canje al pool tomaria otra conexion, fuera de la
   * transaccion, sin ver el bloqueo de fila.
   */
  constructor(private readonly readPool: Pool) {}

  /**
   * Carga el codigo por su hash BLOQUEANDO la fila.
   *
   * Es la pieza central del "un libro, un acceso". `FOR UPDATE` obliga a que dos
   * canjes simultaneos del mismo codigo se serialicen: el segundo espera al
   * COMMIT del primero y entonces lee `status = 'redeemed'`, asi que el agregado
   * lo rechaza. Sin el bloqueo, ambos leerian `issued` y ambos pasarian.
   *
   * No se usa `NOWAIT` ni `SKIP LOCKED`: aqui esperar es lo correcto. Con
   * `NOWAIT` el segundo alumno veria un error tecnico en vez del mensaje claro
   * de "este codigo ya fue utilizado", y con `SKIP LOCKED` se le diria que el
   * codigo no existe, que es peor todavia.
   */
  async findByHashForUpdate(
    codeHash: string,
    tx: TransactionContext,
  ): Promise<ActivationCode | null> {
    const client = (tx as PgTransaction).client;
    const { rows } = await client.query<CodeRow>(
      `SELECT ${COLUMNS} FROM catalog.activation_codes WHERE code_hash = $1 FOR UPDATE`,
      [codeHash],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  /** Mismo bloqueo que `findByHashForUpdate`, pero por id: es la via del canje
   *  que llega por evento, donde el codigo en claro ya no existe. */
  async findByIdForUpdate(id: string, tx: TransactionContext): Promise<ActivationCode | null> {
    const client = (tx as PgTransaction).client;
    const { rows } = await client.query<CodeRow>(
      `SELECT ${COLUMNS} FROM catalog.activation_codes WHERE id = $1 FOR UPDATE`,
      [id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  /** Lectura sin bloqueo para la comprobacion previa del formulario. */
  async findByHash(codeHash: string): Promise<ActivationCode | null> {
    const { rows } = await this.readPool.query<CodeRow>(
      `SELECT ${COLUMNS} FROM catalog.activation_codes WHERE code_hash = $1`,
      [codeHash],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async findById(id: string): Promise<ActivationCode | null> {
    const { rows } = await this.readPool.query<CodeRow>(
      `SELECT ${COLUMNS} FROM catalog.activation_codes WHERE id = $1`,
      [id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async save(code: ActivationCode, tx: TransactionContext): Promise<void> {
    // Sin cambios no se escribe. Un `UPDATE ... WHERE version < :nueva` con la
    // misma version no encontraria fila y se interpretaria como conflicto de
    // concurrencia: ver `AggregateRoot.hasChanges`.
    if (!code.hasChanges) return;
    const client = (tx as PgTransaction).client;
    const state = code.snapshot();

    const result = await client.query(
      `UPDATE catalog.activation_codes SET
         status = $2, redeemed_by = $3, redeemed_at = $4, distributed_to = $5,
         revoked_reason = $6, version = $7
       WHERE id = $1 AND version < $7`,
      [
        code.id.value,
        state.status,
        state.redeemedBy,
        state.redeemedAt,
        state.distributedTo,
        state.revokedReason,
        code.version,
      ],
    );

    if (result.rowCount === 0) {
      const { rows } = await client.query<{ version: number }>(
        `SELECT version FROM catalog.activation_codes WHERE id = $1`,
        [code.id.value],
      );
      throw new ConcurrencyError('ActivationCode', code.id.value, code.version, rows[0]?.version ?? -1);
    }
  }

  async createBatch(batch: NewCodeBatch, tx: TransactionContext): Promise<void> {
    const client = (tx as PgTransaction).client;

    await client.query(
      `INSERT INTO catalog.code_batches
         (id, kit_id, grade, total, distributed_to, reference, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        batch.id,
        batch.kitId,
        batch.grade,
        batch.total,
        batch.distributedTo,
        batch.reference,
        batch.createdBy,
      ],
    );
  }

  /**
   * Inserta un lote completo.
   *
   * Se escribe en bloques de 1000 filas por sentencia, no fila a fila. Un lote
   * de imprenta son decenas de miles de codigos: cien mil INSERT individuales
   * tardarian minutos y mantendrian abierta una transaccion todo ese tiempo,
   * bloqueando el vacuum y acumulando WAL.
   *
   * El tope por bloque no es arbitrario: cada fila usa 6 parametros y PostgreSQL
   * admite 65535 por sentencia, asi que 1000 filas (6000 parametros) deja margen
   * de sobra sin acercarse al limite.
   */
  async insertBatch(
    batchId: string,
    codes: ReadonlyArray<{
      id: string;
      codeHash: string;
      codeSuffix: string;
      kitId: string;
      grade: string;
      expiresAt: Date | null;
    }>,
    tx: TransactionContext,
  ): Promise<void> {
    const client = (tx as PgTransaction).client;
    const CHUNK = 1000;

    for (let offset = 0; offset < codes.length; offset += CHUNK) {
      const chunk = codes.slice(offset, offset + CHUNK);
      const values: unknown[] = [];
      const rows: string[] = [];

      chunk.forEach((code, index) => {
        const base = index * 7;
        rows.push(
          `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`,
        );
        values.push(
          code.id,
          code.codeHash,
          code.codeSuffix,
          batchId,
          code.kitId,
          code.grade,
          code.expiresAt,
        );
      });

      await client.query(
        `INSERT INTO catalog.activation_codes
           (id, code_hash, code_suffix, batch_id, kit_id, grade, expires_at)
         VALUES ${rows.join(',')}`,
        values,
      );
    }
  }

  async batchSummary(batchId: string): Promise<CodeBatchSummary | null> {
    const { rows } = await this.readPool.query<{
      batch_id: string;
      kit_id: string;
      kit_name: string | null;
      grade: string;
      total: number;
      issued: string;
      distributed: string;
      redeemed: string;
      revoked: string;
      expired: string;
      distributed_to: string | null;
      created_by: string;
      created_at: Date;
    }>(
      `SELECT b.id AS batch_id, b.kit_id, k.name AS kit_name, b.grade, b.total,
              count(*) FILTER (WHERE c.status = 'issued')      AS issued,
              count(*) FILTER (WHERE c.status = 'distributed') AS distributed,
              count(*) FILTER (WHERE c.status = 'redeemed')    AS redeemed,
              count(*) FILTER (WHERE c.status = 'revoked')     AS revoked,
              count(*) FILTER (WHERE c.status = 'expired')     AS expired,
              b.distributed_to, b.created_by, b.created_at
         FROM catalog.code_batches b
         JOIN catalog.kits k ON k.id = b.kit_id
         LEFT JOIN catalog.activation_codes c ON c.batch_id = b.id
        WHERE b.id = $1
        GROUP BY b.id, k.name`,
      [batchId],
    );

    const row = rows[0];
    return row ? toBatchSummary(row) : null;
  }

  async listBatches(page: CursorQuery): Promise<CursorPage<CodeBatchSummary>> {
    const limit = normalizeLimit(page.limit);
    const params: unknown[] = [];
    let condition = '1=1';

    const cursor = page.cursor ? decodeCursor<{ createdAt: string; id: string }>(page.cursor) : null;
    if (cursor) {
      params.push(cursor.createdAt, cursor.id);
      condition = `(b.created_at, b.id) < ($1::timestamptz, $2::uuid)`;
    }

    params.push(limit + 1);

    const { rows } = await this.readPool.query(
      `SELECT b.id AS batch_id, b.kit_id, k.name AS kit_name, b.grade, b.total,
              count(*) FILTER (WHERE c.status = 'issued')      AS issued,
              count(*) FILTER (WHERE c.status = 'distributed') AS distributed,
              count(*) FILTER (WHERE c.status = 'redeemed')    AS redeemed,
              count(*) FILTER (WHERE c.status = 'revoked')     AS revoked,
              count(*) FILTER (WHERE c.status = 'expired')     AS expired,
              b.distributed_to, b.created_by, b.created_at
         FROM catalog.code_batches b
         JOIN catalog.kits k ON k.id = b.kit_id
         LEFT JOIN catalog.activation_codes c ON c.batch_id = b.id
        WHERE ${condition}
        GROUP BY b.id, k.name
        ORDER BY b.created_at DESC, b.id DESC
        LIMIT $${params.length}`,
      params,
    );

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];

    return {
      items: items.map(toBatchSummary),
      nextCursor:
        hasMore && last
          ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.batch_id })
          : null,
    };
  }

  async listCodesByBatch(
    batchId: string,
    page: CursorQuery,
  ): Promise<CursorPage<BatchCodeSummary>> {
    const limit = normalizeLimit(page.limit);
    const params: unknown[] = [batchId];
    let condition = 'batch_id = $1';

    const cursor = page.cursor
      ? decodeCursor<{ createdAt: string; id: string }>(page.cursor)
      : null;

    if (cursor) {
      params.push(cursor.createdAt, cursor.id);
      condition += ` AND (created_at, id) < ($2::timestamptz, $3::uuid)`;
    }

    params.push(limit + 1);

    const { rows } = await this.readPool.query<CodeRow>(
      `SELECT ${COLUMNS} FROM catalog.activation_codes
        WHERE ${condition}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.length}`,
      params,
    );

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];

    return {
      items: items.map((row) => ({
        activationCodeId: row.id,
        codeSuffix: row.code_suffix,
        status: row.status,
        redeemedBy: row.redeemed_by,
        redeemedAt: row.redeemed_at?.toISOString() ?? null,
        expiresAt: row.expires_at?.toISOString() ?? null,
        revokedReason: row.revoked_reason,
        createdAt: row.created_at.toISOString(),
      })),
      nextCursor:
        hasMore && last
          ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id })
          : null,
    };
  }

  /**
   * Marca como caducados los codigos vencidos. Tarea periodica.
   *
   * Se hace en una sola sentencia y NO cargando agregados: son potencialmente
   * cientos de miles de filas, y rehidratar cada una para cambiar un campo seria
   * absurdo. La contrapartida es que no emite eventos de dominio; es aceptable
   * porque la caducidad no dispara ninguna reaccion en otro servicio, solo
   * cierra la puerta al canje.
   */
  async expireOverdue(now: Date): Promise<number> {
    const { rowCount } = await this.readPool.query(
      `UPDATE catalog.activation_codes
          SET status = 'expired', updated_at = now()
        WHERE expires_at IS NOT NULL
          AND expires_at <= $1
          AND status IN ('issued','distributed')`,
      [now],
    );
    return rowCount ?? 0;
  }
}

function toBatchSummary(row: {
  batch_id: string;
  kit_id: string;
  kit_name: string | null;
  grade: string;
  total: number;
  issued: string;
  distributed: string;
  redeemed: string;
  revoked: string;
  expired: string;
  distributed_to: string | null;
  created_by: string;
  created_at: Date;
}): CodeBatchSummary {
  return {
    batchId: row.batch_id,
    kitId: row.kit_id,
    kitName: row.kit_name,
    grade: row.grade,
    total: row.total,
    issued: Number(row.issued),
    distributed: Number(row.distributed),
    redeemed: Number(row.redeemed),
    revoked: Number(row.revoked),
    expired: Number(row.expired),
    distributedTo: row.distributed_to,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  };
}

function toDomain(row: CodeRow): ActivationCode {
  return ActivationCode.rehydrate(
    ActivationCodeId.create(row.id),
    {
      codeHash: row.code_hash,
      codeSuffix: row.code_suffix,
      batchId: row.batch_id,
      kitId: row.kit_id,
      grade: row.grade,
      status: row.status,
      redeemedBy: row.redeemed_by,
      redeemedAt: row.redeemed_at,
      distributedTo: row.distributed_to,
      expiresAt: row.expires_at,
      revokedReason: row.revoked_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    row.version,
  );
}
