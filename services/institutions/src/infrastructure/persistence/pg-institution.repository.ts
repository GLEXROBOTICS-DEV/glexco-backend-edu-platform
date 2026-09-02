import type { Pool } from 'pg';
import {
  ConcurrencyError,
  ConflictError,
  encodeCursor,
  decodeCursor,
  normalizeLimit,
  type CursorPage,
  type CursorQuery,
  type TransactionContext,
} from '@glexco/kernel';
import type { EducationLevel, InstitutionStatus, LicenseStatus } from '@glexco/contracts';
import type { PgTransaction } from '@glexco/nest-platform';
import { Institution, type License } from '../../domain/institution/institution.aggregate';
import {
  ContactInfo,
  EducationLevels,
  InstitutionCode,
  InstitutionId,
  InstitutionName,
} from '../../domain/institution/value-objects';
import type {
  InstitutionRepository,
  InstitutionSummary,
  TeacherDirectory,
} from '../../domain/repositories';

interface InstitutionRow {
  id: string;
  code: string;
  name: string;
  short_name: string;
  education_levels: string[];
  status: InstitutionStatus;
  responsible_name: string;
  contact_email: string;
  phone: string | null;
  city: string;
  address: string | null;
  student_count: number;
  teacher_count: number;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface LicenseRow {
  id: string;
  institution_id: string;
  seats: number;
  starts_at: Date;
  expires_at: Date;
  status: LicenseStatus;
  reference: string | null;
  granted_by: string;
  granted_at: Date;
}

const COLUMNS = `
  id, code, name, short_name, education_levels, status, responsible_name,
  contact_email, phone, city, address, student_count, teacher_count,
  version, created_at, updated_at
`;

export class PgInstitutionRepository implements InstitutionRepository {
  constructor(private readonly readPool: Pool) {}

  async findById(id: InstitutionId): Promise<Institution | null> {
    const { rows } = await this.readPool.query<InstitutionRow>(
      `SELECT ${COLUMNS} FROM institutions.institutions WHERE id = $1`,
      [id.value],
    );
    if (!rows[0]) return null;
    return toDomain(rows[0], await this.loadLicenses(id.value));
  }

  /**
   * Busca por codigo institucional.
   *
   * Es la consulta de la pantalla de ingreso, sin autenticar, asi que la reciben
   * usuarios anonimos. Va contra replica porque un codigo institucional cambia
   * como mucho una vez en la vida de un colegio: el retardo de replicacion es
   * irrelevante aqui.
   */
  async findByCode(code: InstitutionCode): Promise<Institution | null> {
    const { rows } = await this.readPool.query<InstitutionRow>(
      `SELECT ${COLUMNS} FROM institutions.institutions WHERE code = $1`,
      [code.value],
    );
    if (!rows[0]) return null;
    return toDomain(rows[0], await this.loadLicenses(rows[0].id));
  }

  async existsByCode(code: InstitutionCode): Promise<boolean> {
    const { rows } = await this.readPool.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM institutions.institutions WHERE code = $1) AS exists`,
      [code.value],
    );
    return rows[0]?.exists ?? false;
  }

  async save(institution: Institution, tx: TransactionContext): Promise<void> {
    const client = (tx as PgTransaction).client;
    const state = institution.snapshot();
    const isNew =
      institution.version === 1 && state.createdAt.getTime() === state.updatedAt.getTime();

    const values = [
      institution.id.value,
      state.code.value,
      state.name.value,
      state.name.short,
      [...state.educationLevels.levels],
      state.status,
      state.contact.responsibleName,
      state.contact.email,
      state.contact.phone,
      state.contact.city,
      state.contact.address,
      state.studentCount,
      state.teacherCount,
      institution.version,
    ];

    if (isNew) {
      try {
        await client.query(
          `INSERT INTO institutions.institutions
             (id, code, name, short_name, education_levels, status, responsible_name,
              contact_email, phone, city, address, student_count, teacher_count, version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          values,
        );
      } catch (error) {
        // La comprobacion previa de codigo duplicado en el caso de uso reduce el
        // ruido, pero no elimina la carrera entre dos altas simultaneas con el
        // mismo codigo: solo la restriccion unica lo garantiza de verdad.
        if ((error as { code?: string }).code === '23505') {
          throw new ConflictError(
            'INSTITUTION_CODE_TAKEN',
            'Ya existe una institucion con ese codigo.',
            { field: 'code' },
          );
        }
        throw error;
      }
    } else {
      const result = await client.query(
        `UPDATE institutions.institutions SET
           code = $2, name = $3, short_name = $4, education_levels = $5, status = $6,
           responsible_name = $7, contact_email = $8, phone = $9, city = $10,
           address = $11, student_count = $12, teacher_count = $13, version = $14
         WHERE id = $1 AND version < $14`,
        values,
      );

      if (result.rowCount === 0) {
        const { rows } = await client.query<{ version: number }>(
          `SELECT version FROM institutions.institutions WHERE id = $1`,
          [institution.id.value],
        );
        throw new ConcurrencyError(
          'Institution',
          institution.id.value,
          institution.version,
          rows[0]?.version ?? -1,
        );
      }
    }

    await this.saveLicenses(client, institution.id.value, state.licenses);
  }

  /**
   * Sincroniza las licencias del agregado.
   *
   * Se deja que la restriccion de exclusion de la base rechace los solapamientos
   * en vez de confiar solo en la comprobacion del agregado: una importacion
   * manual o un script tampoco deben poder crear dos licencias vigentes a la vez.
   */
  private async saveLicenses(
    client: PgTransaction['client'],
    institutionId: string,
    licenses: readonly License[],
  ): Promise<void> {
    for (const license of licenses) {
      try {
        await client.query(
          `INSERT INTO institutions.licenses
             (id, institution_id, seats, starts_at, expires_at, status, reference, granted_by, granted_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (id) DO UPDATE
              SET seats = EXCLUDED.seats,
                  starts_at = EXCLUDED.starts_at,
                  expires_at = EXCLUDED.expires_at,
                  status = EXCLUDED.status,
                  reference = EXCLUDED.reference`,
          [
            license.id,
            institutionId,
            license.seats,
            license.startsAt,
            license.expiresAt,
            license.status,
            license.reference,
            license.grantedBy,
            license.grantedAt,
          ],
        );
      } catch (error) {
        // 23P01 = exclusion_violation, la restriccion de no solapamiento.
        if ((error as { code?: string }).code === '23P01') {
          throw new ConflictError(
            'LICENSE_PERIOD_OVERLAPS',
            'Ya existe una licencia vigente en ese periodo.',
            { institutionId },
          );
        }
        throw error;
      }
    }
  }

  async list(
    filters: { status?: string; city?: string; search?: string },
    page: CursorQuery,
  ): Promise<CursorPage<InstitutionSummary>> {
    const limit = normalizeLimit(page.limit);
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];

    if (filters.status) {
      params.push(filters.status);
      conditions.push(`i.status = $${params.length}`);
    }
    if (filters.city) {
      params.push(filters.city);
      conditions.push(`i.city = $${params.length}`);
    }
    if (filters.search) {
      params.push(`%${filters.search}%`);
      conditions.push(
        `(unaccent(i.name) ILIKE unaccent($${params.length}) OR i.code ILIKE $${params.length})`,
      );
    }

    const cursor = page.cursor ? decodeCursor<{ createdAt: string; id: string }>(page.cursor) : null;
    if (cursor) {
      params.push(cursor.createdAt, cursor.id);
      conditions.push(
        `(i.created_at, i.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
      );
    }

    params.push(limit + 1);

    // La licencia vigente se resuelve con LATERAL y LIMIT 1: solo hay una activa
    // por institucion (lo garantiza la restriccion de exclusion), asi que no hace
    // falta agregar.
    const { rows } = await this.readPool.query<
      InstitutionRow & { license_status: string | null; license_expires_at: Date | null }
    >(
      `SELECT ${COLUMNS.split(',').map((c) => `i.${c.trim()}`).join(', ')},
              l.status     AS license_status,
              l.expires_at AS license_expires_at
         FROM institutions.institutions i
         LEFT JOIN LATERAL (
           SELECT status, expires_at
             FROM institutions.licenses
            WHERE institution_id = i.id AND status <> 'cancelled'
            ORDER BY expires_at DESC
            LIMIT 1
         ) l ON true
        WHERE ${conditions.join(' AND ')}
        ORDER BY i.created_at DESC, i.id DESC
        LIMIT $${params.length}`,
      params,
    );

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];

    return {
      items: items.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        shortName: row.short_name,
        city: row.city,
        status: row.status,
        educationLevels: row.education_levels,
        studentCount: row.student_count,
        teacherCount: row.teacher_count,
        licenseStatus: row.license_status,
        licenseExpiresAt: row.license_expires_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
      })),
      nextCursor:
        hasMore && last
          ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id })
          : null,
    };
  }

  /**
   * Instituciones con licencia proxima a vencer.
   *
   * La consulta el equipo comercial y la tarea periodica de avisos. Usa el
   * indice parcial `licenses_expiring_idx`, que solo cubre las licencias vivas.
   */
  async findWithExpiringLicenses(withinDays: number): Promise<Institution[]> {
    const { rows } = await this.readPool.query<InstitutionRow>(
      `SELECT DISTINCT ${COLUMNS.split(',').map((c) => `i.${c.trim()}`).join(', ')}
         FROM institutions.institutions i
         JOIN institutions.licenses l ON l.institution_id = i.id
        WHERE l.status IN ('active','expiring_soon')
          AND l.expires_at <= now() + ($1 || ' days')::interval
        ORDER BY i.name`,
      [String(withinDays)],
    );

    return Promise.all(rows.map(async (row) => toDomain(row, await this.loadLicenses(row.id))));
  }

  private async loadLicenses(institutionId: string): Promise<License[]> {
    const { rows } = await this.readPool.query<LicenseRow>(
      `SELECT id, institution_id, seats, starts_at, expires_at, status, reference,
              granted_by, granted_at
         FROM institutions.licenses
        WHERE institution_id = $1
        ORDER BY starts_at DESC`,
      [institutionId],
    );

    return rows.map((row) => ({
      id: row.id,
      seats: row.seats,
      startsAt: row.starts_at,
      expiresAt: row.expires_at,
      status: row.status,
      reference: row.reference,
      grantedBy: row.granted_by,
      grantedAt: row.granted_at,
    }));
  }
}

function toDomain(row: InstitutionRow, licenses: License[]): Institution {
  return Institution.rehydrate(
    InstitutionId.create(row.id),
    {
      code: InstitutionCode.create(row.code),
      name: InstitutionName.create(row.name, row.short_name),
      educationLevels: EducationLevels.create(row.education_levels as EducationLevel[]),
      contact: ContactInfo.create({
        responsibleName: row.responsible_name,
        email: row.contact_email,
        phone: row.phone,
        city: row.city,
        address: row.address,
      }),
      status: row.status,
      licenses,
      studentCount: row.student_count,
      teacherCount: row.teacher_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    row.version,
  );
}

/**
 * Proyeccion de docentes.
 *
 * Copia de solo lectura del nombre, alimentada por eventos de identidad. Existe
 * porque pintar el listado de salones necesita el nombre del docente, y pedirlo
 * a identidad por cada fila serian N llamadas de red por listado. Puede ir unos
 * segundos por detras; para un nombre eso es irrelevante.
 */
export class PgTeacherDirectory implements TeacherDirectory {
  constructor(
    private readonly writePool: Pool,
    private readonly readPool: Pool,
  ) {}

  async upsert(input: {
    userId: string;
    institutionId: string;
    fullName: string;
    email: string;
  }): Promise<void> {
    await this.writePool.query(
      `INSERT INTO institutions.teacher_directory (user_id, institution_id, full_name, email)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id) DO UPDATE
          SET institution_id = EXCLUDED.institution_id,
              full_name = EXCLUDED.full_name,
              email = EXCLUDED.email,
              updated_at = now()`,
      [input.userId, input.institutionId, input.fullName, input.email],
    );
  }

  async rename(userId: string, fullName: string): Promise<void> {
    // UPDATE, no upsert: si el usuario no esta en el directorio no hay nada que
    // hacer, y desde luego no hay que crearlo. Un alumno que cambia su nombre no
    // debe aparecer en la tabla de docentes.
    await this.writePool.query(
      `UPDATE institutions.teacher_directory
          SET full_name = $2, updated_at = now()
        WHERE user_id = $1`,
      [userId, fullName],
    );
  }

  async remove(userId: string): Promise<void> {
    await this.writePool.query(`DELETE FROM institutions.teacher_directory WHERE user_id = $1`, [
      userId,
    ]);
  }

  async findName(userId: string): Promise<string | null> {
    const { rows } = await this.readPool.query<{ full_name: string }>(
      `SELECT full_name FROM institutions.teacher_directory WHERE user_id = $1`,
      [userId],
    );
    return rows[0]?.full_name ?? null;
  }

  async listByInstitution(
    institutionId: string,
  ): Promise<Array<{ userId: string; fullName: string }>> {
    const { rows } = await this.readPool.query<{ user_id: string; full_name: string }>(
      `SELECT user_id, full_name FROM institutions.teacher_directory
        WHERE institution_id = $1 ORDER BY full_name`,
      [institutionId],
    );
    return rows.map((row) => ({ userId: row.user_id, fullName: row.full_name }));
  }
}
