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
import type { Role } from '@glexco/contracts';
import type { PgTransaction } from '@glexco/nest-platform';
import { User, type UserStatus, type AccountType } from '../../domain/user/user.aggregate';
import type { UserRepository, UserSummary } from '../../domain/user/user.repository';
import {
  BirthDate,
  Email,
  LocalePreference,
  PasswordHash,
  PersonName,
  UserId,
} from '../../domain/user/value-objects';

interface UserRow {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  birth_date: Date | null;
  password_hash: string;
  roles: string[];
  institution_id: string | null;
  status: UserStatus;
  account_type: AccountType;
  email_verified: boolean;
  guardian_email: string | null;
  locale: string;
  avatar_url: string | null;
  must_change_password: boolean;
  accepted_terms_at: Date | null;
  failed_login_attempts: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `
  id, email, first_name, last_name, birth_date, password_hash, roles,
  institution_id, status, account_type, email_verified, guardian_email, locale,
  avatar_url, must_change_password, accepted_terms_at, failed_login_attempts,
  locked_until, last_login_at, version, created_at, updated_at
`;

/**
 * Adaptador PostgreSQL del repositorio de usuarios.
 *
 * Reparte las consultas entre los dos pools segun la semantica, no segun la
 * comodidad: es la decision que permite que el servicio escale cuando existan
 * replicas de lectura sin cambiar una linea de logica de negocio.
 */
export class PgUserRepository implements UserRepository {
  constructor(
    private readonly writePool: Pool,
    private readonly readPool: Pool,
  ) {}

  async findById(id: UserId): Promise<User | null> {
    // Va contra replica: es la lectura de un agregado que despues puede
    // modificarse, pero el UPDATE lleva control de version optimista, asi que
    // una version obsoleta produce un conflicto limpio y reintentable, no una
    // escritura incorrecta.
    const { rows } = await this.readPool.query<UserRow>(
      `SELECT ${COLUMNS} FROM identity.users WHERE id = $1`,
      [id.value],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  /**
   * Lectura para autenticar.
   *
   * Contra el pool de ESCRITURA a proposito: alguien que acaba de registrarse e
   * inicia sesion de inmediato no puede toparse con que la replica todavia no lo
   * tiene. Es el caso clasico de "leer tus propias escrituras", y aqui se
   * manifestaria como "acabo de crear mi cuenta y me dice que no existe".
   */
  async findByEmailForAuth(email: Email): Promise<User | null> {
    const { rows } = await this.writePool.query<UserRow>(
      `SELECT ${COLUMNS} FROM identity.users WHERE email = $1`,
      [email.value],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async existsByEmail(email: Email): Promise<boolean> {
    const { rows } = await this.readPool.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM identity.users WHERE email = $1) AS exists`,
      [email.value],
    );
    return rows[0]?.exists ?? false;
  }

  /**
   * Inserta o actualiza dentro de la transaccion de la unidad de trabajo.
   *
   * El UPDATE incluye `WHERE version = :esperada`. Si no afecta a ninguna fila
   * es que otro proceso modifico el usuario entre la lectura y la escritura, y
   * se lanza `ConcurrencyError` para que la capa superior recargue y reintente
   * en vez de sobrescribir en silencio.
   */
  async save(user: User, tx: TransactionContext): Promise<void> {
    // Sin cambios no se escribe. Un `UPDATE ... WHERE version < :nueva` con la
    // misma version no encontraria fila y se interpretaria como conflicto de
    // concurrencia: ver `AggregateRoot.hasChanges`.
    if (!user.hasChanges) return;
    const client = (tx as PgTransaction).client;
    const state = user.snapshot();
    const isNew = user.version === 1 && state.createdAt.getTime() === state.updatedAt.getTime();

    const values = [
      user.id.value,
      state.email.value,
      state.name.first,
      state.name.last,
      state.birthDate?.iso ?? null,
      state.passwordHash.value,
      state.roles,
      state.institutionId,
      state.status,
      state.accountType,
      state.emailVerified,
      state.guardianEmail?.value ?? null,
      state.locale.value,
      state.avatarUrl,
      state.mustChangePassword,
      state.acceptedTermsAt,
      state.failedLoginAttempts,
      state.lockedUntil,
      state.lastLoginAt,
      user.version,
    ];

    if (isNew) {
      try {
        await client.query(
          `INSERT INTO identity.users (
             id, email, first_name, last_name, birth_date, password_hash, roles,
             institution_id, status, account_type, email_verified, guardian_email,
             locale, avatar_url, must_change_password, accepted_terms_at,
             failed_login_attempts, locked_until, last_login_at, version
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
          values,
        );
      } catch (error) {
        // 23505 = unique_violation. La comprobacion previa de correo duplicado
        // en el caso de uso reduce el ruido, pero no elimina la carrera entre
        // dos registros simultaneos con el mismo correo: solo la restriccion
        // unica de la base lo garantiza de verdad.
        if ((error as { code?: string }).code === '23505') {
          throw new ConflictError(
            'EMAIL_ALREADY_REGISTERED',
            'Ya existe una cuenta con este correo.',
            { field: 'email' },
          );
        }
        throw error;
      }
      return;
    }

    const result = await client.query(
      `UPDATE identity.users SET
         email = $2, first_name = $3, last_name = $4, birth_date = $5,
         password_hash = $6, roles = $7, institution_id = $8, status = $9,
         account_type = $10, email_verified = $11, guardian_email = $12,
         locale = $13, avatar_url = $14, must_change_password = $15,
         accepted_terms_at = $16, failed_login_attempts = $17,
         locked_until = $18, last_login_at = $19, version = $20
       WHERE id = $1 AND version < $20`,
      values,
    );

    if (result.rowCount === 0) {
      const { rows } = await client.query<{ version: number }>(
        `SELECT version FROM identity.users WHERE id = $1`,
        [user.id.value],
      );
      throw new ConcurrencyError('User', user.id.value, user.version, rows[0]?.version ?? -1);
    }
  }

  /**
   * Listado paginado por cursor para el panel de institucion.
   *
   * Sin `OFFSET`: con decenas de miles de alumnos por red de colegios, el coste
   * de OFFSET crece con la profundidad de la pagina, y los resultados se
   * duplican o se saltan si alguien se registra mientras el administrador
   * navega. El cursor apunta a la ultima fila entregada.
   */
  async listByInstitution(
    institutionId: string,
    filters: { role?: Role; status?: string; search?: string },
    page: CursorQuery,
  ): Promise<CursorPage<UserSummary>> {
    const limit = normalizeLimit(page.limit);
    const conditions: string[] = ['institution_id = $1'];
    const params: unknown[] = [institutionId];

    if (filters.role) {
      params.push([filters.role]);
      conditions.push(`roles && $${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filters.search) {
      params.push(`%${filters.search}%`);
      conditions.push(
        `(unaccent(first_name || ' ' || last_name) ILIKE unaccent($${params.length})
          OR email ILIKE $${params.length})`,
      );
    }

    // El cursor combina created_at e id: created_at por si solo no es unico y
    // dos altas en el mismo milisegundo harian que una fila se repitiera o se
    // perdiera entre paginas.
    const cursor = page.cursor ? decodeCursor<{ createdAt: string; id: string }>(page.cursor) : null;
    if (cursor) {
      params.push(cursor.createdAt, cursor.id);
      conditions.push(
        `(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
      );
    }

    // Se pide un elemento de mas para saber si hay pagina siguiente sin ejecutar
    // un COUNT, que sobre millones de filas es caro y ademas innecesario.
    params.push(limit + 1);

    const { rows } = await this.readPool.query<UserRow>(
      `SELECT ${COLUMNS} FROM identity.users
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.length}`,
      params,
    );

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];

    return {
      items: items.map(toSummary),
      nextCursor:
        hasMore && last
          ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id })
          : null,
    };
  }

  async countByInstitutionAndRole(institutionId: string): Promise<Record<Role, number>> {
    const { rows } = await this.readPool.query<{ role: Role; total: string }>(
      `SELECT unnest(roles) AS role, count(*) AS total
         FROM identity.users
        WHERE institution_id = $1 AND status <> 'deactivated'
        GROUP BY role`,
      [institutionId],
    );

    const counts = {} as Record<Role, number>;
    for (const row of rows) counts[row.role] = Number(row.total);
    return counts;
  }
}

/** Reconstruye el agregado desde la fila. */
function toDomain(row: UserRow): User {
  return User.rehydrate(
    UserId.create(row.id),
    {
      email: Email.create(row.email),
      name: PersonName.create(row.first_name, row.last_name),
      birthDate: row.birth_date ? BirthDate.create(toIsoDate(row.birth_date)) : null,
      passwordHash: PasswordHash.fromHash(row.password_hash),
      roles: row.roles as Role[],
      institutionId: row.institution_id,
      status: row.status,
      accountType: row.account_type,
      emailVerified: row.email_verified,
      guardianEmail: row.guardian_email ? Email.create(row.guardian_email) : null,
      locale: LocalePreference.create(row.locale),
      avatarUrl: row.avatar_url,
      mustChangePassword: row.must_change_password,
      acceptedTermsAt: row.accepted_terms_at,
      failedLoginAttempts: row.failed_login_attempts,
      lockedUntil: row.locked_until,
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    row.version,
  );
}

function toSummary(row: UserRow): UserSummary {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    roles: row.roles as Role[],
    status: row.status,
    emailVerified: row.email_verified,
    lastLoginAt: row.last_login_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * `date` de PostgreSQL llega como Date en hora local del proceso.
 *
 * Formatear con `toISOString()` desplazaria la fecha un dia en zonas con offset
 * negativo (Peru es UTC-5), y eso cambiaria la edad calculada justo en el
 * cumpleanos, que es exactamente donde se decide si hace falta consentimiento
 * de un apoderado.
 */
function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
