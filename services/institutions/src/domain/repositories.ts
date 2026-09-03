import type { CursorPage, CursorQuery, TransactionContext } from '@glexco/kernel';
import type { Grade } from '@glexco/contracts';
import type { Institution } from './institution/institution.aggregate';
import type { InstitutionCode, InstitutionId } from './institution/value-objects';
import type { Classroom, ClassroomId } from './classroom/classroom.aggregate';

export interface InstitutionRepository {
  findById(id: InstitutionId): Promise<Institution | null>;
  findByCode(code: InstitutionCode): Promise<Institution | null>;
  existsByCode(code: InstitutionCode): Promise<boolean>;
  save(institution: Institution, tx: TransactionContext): Promise<void>;

  /** Listado para el panel ejecutivo de GLEXCO. */
  list(
    filters: { status?: string; city?: string; search?: string },
    page: CursorQuery,
  ): Promise<CursorPage<InstitutionSummary>>;

  /** Instituciones con licencia proxima a vencer, para el equipo comercial. */
  findWithExpiringLicenses(withinDays: number): Promise<Institution[]>;
}

export interface InstitutionSummary {
  id: string;
  code: string;
  name: string;
  shortName: string;
  city: string;
  status: string;
  educationLevels: string[];
  studentCount: number;
  teacherCount: number;
  licenseStatus: string | null;
  licenseExpiresAt: string | null;
  createdAt: string;
}

export interface ClassroomRepository {
  findById(id: ClassroomId): Promise<Classroom | null>;

  /**
   * Carga el salon BLOQUEANDO su fila, dentro de la transaccion dada.
   *
   * Es la pieza que hace real el tope de plazas. `SELECT ... FOR UPDATE` obliga a
   * que dos matriculas simultaneas sobre el mismo salon se serialicen: la
   * segunda espera a que la primera confirme y entonces ve el conteo ya
   * actualizado. Sin esto, ambas leerian la misma ultima plaza libre y las dos
   * pasarian la comprobacion.
   *
   * El coste es que las matriculas del MISMO salon se serializan. Es aceptable:
   * son decenas de alumnos, no miles, y salones distintos no se estorban.
   */
  findByIdForUpdate(id: ClassroomId, tx: TransactionContext): Promise<Classroom | null>;

  save(classroom: Classroom, tx: TransactionContext): Promise<void>;

  /** Salones de un docente. */
  listByTeacher(
    teacherId: string,
    filters: { academicYear?: number; includeArchived?: boolean },
  ): Promise<ClassroomSummary[]>;

  /** Salones de una institucion, para el administrador del colegio. */
  listByInstitution(
    institutionId: string,
    filters: { academicYear?: number; grade?: Grade; teacherId?: string; includeArchived?: boolean },
    page: CursorQuery,
  ): Promise<CursorPage<ClassroomSummary>>;

  /**
   * Salones que un alumno puede elegir en el formulario de registro.
   *
   * Es una consulta PUBLICA (sin autenticar), asi que devuelve el minimo
   * imprescindible: nombre del salon, nombre del docente y si hay cupo. Nunca
   * ids de alumnos, ni conteos exactos, ni datos de contacto.
   */
  listSelectableForRegistration(input: {
    institutionId: string;
    grade: Grade;
    academicYear: number;
  }): Promise<SelectableClassroom[]>;

  /** Salones donde el alumno tiene matricula activa. */
  listByStudent(studentId: string): Promise<ClassroomSummary[]>;
}

export interface ClassroomSummary {
  id: string;
  institutionId: string;
  teacherId: string;
  teacherName: string | null;
  name: string;
  grade: Grade;
  capacity: number;
  enrolledCount: number;
  availableSeats: number;
  academicYear: number;
  status: string;
  createdAt: string;
}

export interface SelectableClassroom {
  id: string;
  name: string;
  teacherName: string | null;
  hasCapacity: boolean;
}

/**
 * Proyeccion de docentes de una institucion.
 *
 * Los usuarios son propiedad del servicio de identidad; aqui se guarda una copia
 * de solo lectura del nombre, alimentada por eventos. Motivo: pintar el listado
 * de salones exige el nombre del docente, y hacer una llamada a identidad por
 * cada fila del listado seria N+1 llamadas de red. La copia puede quedar
 * desactualizada unos segundos, y para un nombre eso es irrelevante.
 */
export interface TeacherDirectory {
  upsert(input: {
    userId: string;
    institutionId: string;
    fullName: string;
    email: string;
  }): Promise<void>;
  /**
   * Cambia SOLO el nombre.
   *
   * Existe porque `upsert` reescribe la fila entera: usarlo para reflejar un
   * cambio de nombre borraria la institucion y el correo, que ese evento no
   * trae. Es el fallo clasico de reutilizar un upsert para una actualizacion
   * parcial.
   */
  rename(userId: string, fullName: string): Promise<void>;
  remove(userId: string): Promise<void>;
  findName(userId: string): Promise<string | null>;
  listByInstitution(institutionId: string): Promise<Array<{ userId: string; fullName: string }>>;
}

/**
 * Nombres de los alumnos, para pintar listados.
 *
 * Gemelo de `TeacherDirectory`. La razon de que esto sea un puerto aparte y no
 * un metodo mas del repositorio de salones: el nombre NO es estado del agregado
 * -no participa en ninguna regla del salon- y viene de otro servicio. Tenerlo
 * separado deja claro que puede ir unos segundos desactualizado sin que eso
 * afecte a ninguna invariante.
 */
export interface StudentDirectory {
  upsert(input: {
    userId: string;
    institutionId: string;
    fullName: string;
    email: string;
  }): Promise<void>;

  /** Cambia SOLO el nombre; no crea la fila si no existe. */
  rename(userId: string, fullName: string): Promise<void>;

  /**
   * La clase, con nombre y kit activado.
   *
   * Es la unica consulta que cruza la matricula con el directorio, y vive aqui
   * -en el lado de lectura- para que el repositorio del agregado no tenga que
   * conocer una tabla de proyeccion.
   */
  listRoster(classroomId: string): Promise<
    Array<{
      studentId: string;
      fullName: string | null;
      status: string;
      kitId: string | null;
      enrolledAt: Date;
    }>
  >;
}
