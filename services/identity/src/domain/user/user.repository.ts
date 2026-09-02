import type { CursorPage, CursorQuery, TransactionContext } from '@glexco/kernel';
import type { Role } from '@glexco/contracts';
import type { User } from './user.aggregate';
import type { Email, UserId } from './value-objects';

/**
 * Puerto de persistencia del agregado User.
 *
 * Se define desde la necesidad del dominio, no desde lo que un ORM ofrece: por
 * eso no hay `findAll`, `update` ni `query`. Cada metodo corresponde a una
 * pregunta que el negocio realmente hace, y eso mantiene el conjunto de accesos
 * pequeno, indexable y auditable.
 *
 * Los metodos de escritura reciben la transaccion para participar en la unidad
 * de trabajo junto con la outbox.
 */
export interface UserRepository {
  findById(id: UserId): Promise<User | null>;

  /**
   * Busca por correo para el inicio de sesion.
   *
   * Va contra el pool de ESCRITURA aunque sea una lectura: un usuario que acaba
   * de registrarse e inicia sesion de inmediato no puede encontrarse con que la
   * replica todavia no lo tiene. Es el caso clasico de "leer tus propias
   * escrituras".
   */
  findByEmailForAuth(email: Email): Promise<User | null>;

  /** Comprobacion previa en el formulario de registro. Va contra replica. */
  existsByEmail(email: Email): Promise<boolean>;

  save(user: User, tx: TransactionContext): Promise<void>;

  /**
   * Listado paginado para los paneles de administracion.
   *
   * `institutionId` no es opcional por comodidad: obliga a quien llama a decidir
   * explicitamente el ambito, y evita el listado global accidental que expondria
   * usuarios de todas las instituciones.
   */
  listByInstitution(
    institutionId: string,
    filters: { role?: Role; status?: string; search?: string },
    page: CursorQuery,
  ): Promise<CursorPage<UserSummary>>;

  /** Proyeccion de lectura para el panel: evita rehidratar agregados completos
   *  solo para pintar una tabla. */
  countByInstitutionAndRole(institutionId: string): Promise<Record<Role, number>>;
}

/** Proyeccion ligera para listados. No es el agregado. */
export interface UserSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: Role[];
  status: string;
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}
