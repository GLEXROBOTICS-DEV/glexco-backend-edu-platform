import {
  ForbiddenError,
  NotFoundError,
  type Clock,
  type ExecutionContext,
  type LoggerPort,
  type UnitOfWork,
  type UseCase,
} from '@glexco/kernel';
import { PERMISSIONS, ROLES, isPlatformRole, type Grade, type Role } from '@glexco/contracts';
import {
  Capacity,
  Classroom,
  ClassroomId,
  ClassroomName,
} from '../domain/classroom/classroom.aggregate';
import { InstitutionId } from '../domain/institution/value-objects';
import type {
  ClassroomRepository,
  ClassroomSummary,
  InstitutionRepository,
  SelectableClassroom,
  StudentDirectory,
  TeacherDirectory,
} from '../domain/repositories';

/** Resuelve el perfil de autorizacion del actor una sola vez. */
function actorProfile(context: ExecutionContext) {
  const actor = context.actor;
  if (!actor) {
    throw new ForbiddenError('UNAUTHENTICATED', 'Debes iniciar sesion.');
  }

  const roles = actor.roles as Role[];
  return {
    userId: actor.userId,
    institutionId: actor.institutionId,
    permissions: actor.permissions,
    isPlatformStaff: roles.some((role) => isPlatformRole(role)),
    isInstitutionAdmin: roles.includes(ROLES.INSTITUTION_ADMIN),
    isTeacher: roles.includes(ROLES.TEACHER),
  };
}

// ---------------------------------------------------------------------------
// Crear salon
// ---------------------------------------------------------------------------

export interface CreateClassroomInput {
  name: string;
  grade: Grade;
  capacity?: number;
  academicYear?: number;
  /** Docente titular. Solo un administrador puede asignar a otra persona; un
   *  docente que crea un salon queda como titular de forma implicita. */
  teacherId?: string;
  /** Solo lo usa el personal GLEXCO; para los demas se toma del token. */
  institutionId?: string;
}

export interface CreateClassroomOutput {
  classroomId: string;
  name: string;
  grade: Grade;
  capacity: number;
  academicYear: number;
  teacherId: string;
}

/**
 * Crea un salon.
 *
 * Lo pueden hacer el docente y el administrador de institucion, tal como pide la
 * propuesta. La diferencia esta en el alcance:
 *   - Un DOCENTE crea salones para si mismo. No puede asignarselos a un colega.
 *   - Un ADMINISTRADOR de institucion crea salones para cualquier docente de SU
 *     colegio.
 *
 * `institutionId` del cuerpo se ignora salvo para el personal GLEXCO, por el
 * mismo motivo que en el alta de usuarios: aceptarlo permitiria crear salones en
 * un colegio ajeno cambiando un campo.
 */
export class CreateClassroomUseCase
  implements UseCase<CreateClassroomInput, CreateClassroomOutput>
{
  constructor(
    private readonly classrooms: ClassroomRepository,
    private readonly institutions: InstitutionRepository,
    private readonly teachers: TeacherDirectory,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly logger: LoggerPort,
  ) {}

  async execute(
    input: CreateClassroomInput,
    context: ExecutionContext,
  ): Promise<CreateClassroomOutput> {
    const actor = actorProfile(context);

    if (!actor.permissions.includes(PERMISSIONS.CLASSROOM_CREATE)) {
      throw new ForbiddenError('INSUFFICIENT_PERMISSIONS', 'No tienes permiso para crear salones.');
    }

    const now = this.clock.now();
    const institutionId = this.resolveInstitution(input, actor);
    const teacherId = this.resolveTeacher(input, actor);

    const institution = await this.institutions.findById(InstitutionId.create(institutionId));
    if (!institution) {
      throw new NotFoundError('INSTITUTION_NOT_FOUND', 'La institucion no existe.');
    }

    // Impide crear un salon de secundaria en un colegio que solo atiende
    // primaria: es un error de tecleo frecuente que produce salones que ningun
    // alumno puede encontrar en el formulario de registro.
    institution.assertOffersGrade(input.grade);

    // Un docente asignado desde otro colegio no tendria ambito sobre el salon.
    if (!actor.isPlatformStaff && teacherId !== actor.userId) {
      const known = await this.teachers.findName(teacherId);
      if (!known) {
        throw new NotFoundError(
          'TEACHER_NOT_FOUND',
          'El docente indicado no pertenece a tu institucion.',
        );
      }
    }

    const classroom = Classroom.create({
      id: ClassroomId.create(),
      institutionId,
      teacherId,
      name: ClassroomName.create(input.name),
      grade: input.grade,
      capacity: Capacity.create(input.capacity),
      academicYear: input.academicYear ?? now.getUTCFullYear(),
      now,
      createdBy: actor.userId,
    });

    await this.unitOfWork.run(async (tx) => {
      await this.classrooms.save(classroom, tx);
      (tx as { enqueue(...events: unknown[]): void }).enqueue(...classroom.pullDomainEvents());
    });

    this.logger.info('Salon creado', {
      classroomId: classroom.id.value,
      institutionId,
      teacherId,
      capacity: classroom.capacity.value,
    });

    return {
      classroomId: classroom.id.value,
      name: classroom.name.value,
      grade: classroom.grade,
      capacity: classroom.capacity.value,
      academicYear: classroom.academicYear,
      teacherId,
    };
  }

  private resolveInstitution(
    input: CreateClassroomInput,
    actor: ReturnType<typeof actorProfile>,
  ): string {
    if (actor.isPlatformStaff) {
      if (!input.institutionId) {
        throw new ForbiddenError(
          'INSTITUTION_REQUIRED',
          'Indica la institucion en la que se crea el salon.',
        );
      }
      return input.institutionId;
    }

    if (!actor.institutionId) {
      throw new ForbiddenError(
        'ACTOR_WITHOUT_INSTITUTION',
        'Tu cuenta no esta asociada a una institucion.',
      );
    }

    if (input.institutionId && input.institutionId !== actor.institutionId) {
      throw new ForbiddenError(
        'CROSS_INSTITUTION_FORBIDDEN',
        'Solo puedes crear salones en tu propia institucion.',
      );
    }

    return actor.institutionId;
  }

  private resolveTeacher(
    input: CreateClassroomInput,
    actor: ReturnType<typeof actorProfile>,
  ): string {
    // Un docente siempre queda como titular de lo que crea. Permitirle asignar
    // el salon a un colega le daria capacidad de alterar la carga de otra
    // persona, que es competencia del administrador.
    if (actor.isTeacher && !actor.isInstitutionAdmin && !actor.isPlatformStaff) {
      if (input.teacherId && input.teacherId !== actor.userId) {
        throw new ForbiddenError(
          'TEACHER_CANNOT_ASSIGN_OTHERS',
          'Solo un administrador puede asignar salones a otros docentes.',
        );
      }
      return actor.userId;
    }

    return input.teacherId ?? actor.userId;
  }
}

// ---------------------------------------------------------------------------
// Actualizar salon
// ---------------------------------------------------------------------------

export interface UpdateClassroomInput {
  classroomId: string;
  name?: string;
  capacity?: number;
  teacherId?: string;
  archive?: boolean;
}

export class UpdateClassroomUseCase implements UseCase<UpdateClassroomInput, void> {
  constructor(
    private readonly classrooms: ClassroomRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: UpdateClassroomInput, context: ExecutionContext): Promise<void> {
    const actor = actorProfile(context);

    if (!actor.permissions.includes(PERMISSIONS.CLASSROOM_UPDATE)) {
      throw new ForbiddenError('INSUFFICIENT_PERMISSIONS', 'No tienes permiso para editar salones.');
    }

    const classroom = await this.classrooms.findById(ClassroomId.create(input.classroomId));
    if (!classroom) {
      throw new NotFoundError('CLASSROOM_NOT_FOUND', 'El salon indicado no existe.');
    }

    // Comprobacion de ambito sobre el recurso concreto: es SU salon, o al menos
    // de SU institucion si es administrador. El guard no puede saber esto.
    classroom.assertOperableBy(actor);

    const now = this.clock.now();

    if (input.name) classroom.rename(ClassroomName.create(input.name), now);
    if (input.capacity !== undefined) classroom.changeCapacity(Capacity.create(input.capacity), now);

    if (input.teacherId) {
      // Reasignar titular es competencia del administrador: un docente no debe
      // poder pasarle su salon a otro ni quitarselo.
      if (!actor.isInstitutionAdmin && !actor.isPlatformStaff) {
        throw new ForbiddenError(
          'TEACHER_REASSIGNMENT_FORBIDDEN',
          'Solo un administrador puede reasignar el docente de un salon.',
        );
      }
      classroom.assignTeacher(input.teacherId, actor.userId, now);
    }

    if (input.archive) classroom.archive(now);

    await this.unitOfWork.run(async (tx) => {
      await this.classrooms.save(classroom, tx);
      (tx as { enqueue(...events: unknown[]): void }).enqueue(...classroom.pullDomainEvents());
    });
  }
}

// ---------------------------------------------------------------------------
// Listados
// ---------------------------------------------------------------------------

export interface ListClassroomsInput {
  academicYear?: number;
  grade?: Grade;
  teacherId?: string;
  includeArchived?: boolean;
}

/**
 * Lista los salones que el actor puede ver.
 *
 * El alcance se decide por su rol, no por un parametro: un docente ve los suyos
 * y un administrador los de su colegio. Dejar que el cliente pida el alcance
 * seria delegarle una decision de autorizacion.
 */
export class ListClassroomsUseCase implements UseCase<ListClassroomsInput, ClassroomSummary[]> {
  constructor(private readonly classrooms: ClassroomRepository) {}

  async execute(
    input: ListClassroomsInput,
    context: ExecutionContext,
  ): Promise<ClassroomSummary[]> {
    const actor = actorProfile(context);

    if (actor.isInstitutionAdmin || actor.isPlatformStaff) {
      if (!actor.institutionId && !actor.isPlatformStaff) {
        throw new ForbiddenError('ACTOR_WITHOUT_INSTITUTION', 'Tu cuenta no tiene institucion.');
      }

      const page = await this.classrooms.listByInstitution(
        actor.institutionId!,
        {
          academicYear: input.academicYear,
          grade: input.grade,
          teacherId: input.teacherId,
          includeArchived: input.includeArchived,
        },
        { limit: 100 },
      );
      return page.items;
    }

    return this.classrooms.listByTeacher(actor.userId, {
      academicYear: input.academicYear,
      includeArchived: input.includeArchived,
    });
  }
}

// ---------------------------------------------------------------------------
// Salones seleccionables en el registro (publico)
// ---------------------------------------------------------------------------

export interface ListSelectableClassroomsInput {
  institutionId: string;
  grade: Grade;
  academicYear?: number;
}

/**
 * Salones que un alumno puede elegir al registrarse.
 *
 * Endpoint PUBLICO, sin autenticar, porque se usa antes de que la cuenta exista.
 * Por eso devuelve lo minimo: id, nombre del salon, nombre del docente y si hay
 * cupo. Nada de conteos exactos ni datos de alumnos.
 *
 * Se devuelve `hasCapacity` en lugar de "18 de 20 plazas" a proposito: el numero
 * exacto permitiria a un tercero medir la matricula de un colegio sondeando el
 * endpoint, que es informacion comercial que no le corresponde.
 */
export class ListSelectableClassroomsUseCase
  implements UseCase<ListSelectableClassroomsInput, SelectableClassroom[]>
{
  constructor(
    private readonly classrooms: ClassroomRepository,
    private readonly institutions: InstitutionRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: ListSelectableClassroomsInput): Promise<SelectableClassroom[]> {
    const institution = await this.institutions.findById(
      InstitutionId.create(input.institutionId),
    );

    // Una institucion suspendida responde como inexistente: no tiene sentido
    // dejar que un alumno avance en un registro que va a fallar al final.
    if (!institution || institution.status !== 'active') {
      throw new NotFoundError('INSTITUTION_NOT_FOUND', 'La institucion no esta disponible.');
    }

    institution.assertOffersGrade(input.grade);

    return this.classrooms.listSelectableForRegistration({
      institutionId: input.institutionId,
      grade: input.grade,
      academicYear: input.academicYear ?? this.clock.now().getUTCFullYear(),
    });
  }
}

// ---------------------------------------------------------------------------
// La clase: quien esta matriculado, con nombre
// ---------------------------------------------------------------------------

export interface RosterEntry {
  studentId: string;
  fullName: string | null;
  status: string;
  kitId: string | null;
  enrolledAt: string;
}

/**
 * Lista la clase de un salon.
 *
 * Es la consulta que hace posible cualquier pantalla del docente que hable de
 * alumnos concretos -la bandeja de correccion, el dashboard por alumno-, porque
 * es la unica que sabe poner un nombre donde hasta ahora habia un
 * identificador.
 *
 * El ambito se comprueba con `assertOperableBy` sobre el salon cargado, no con
 * el permiso a secas: `CLASSROOM_READ` dice que este actor puede leer salones,
 * no que pueda leer ESTE. Sin la segunda comprobacion, un docente del colegio A
 * que teclee el identificador de un salon del colegio B veria a sus alumnos.
 */
export class ListClassroomRosterUseCase
  implements UseCase<{ classroomId: string }, { items: RosterEntry[] }>
{
  constructor(
    private readonly classrooms: ClassroomRepository,
    private readonly students: StudentDirectory,
  ) {}

  async execute(
    input: { classroomId: string },
    context: ExecutionContext,
  ): Promise<{ items: RosterEntry[] }> {
    const actor = actorProfile(context);

    if (!actor.permissions.includes(PERMISSIONS.CLASSROOM_READ)) {
      throw new ForbiddenError('INSUFFICIENT_PERMISSIONS', 'No tienes permiso para ver salones.');
    }

    const classroom = await this.classrooms.findById(ClassroomId.create(input.classroomId));
    if (!classroom) {
      throw new NotFoundError('CLASSROOM_NOT_FOUND', 'El salon indicado no existe.');
    }

    classroom.assertOperableBy(actor);

    const rows = await this.students.listRoster(input.classroomId);

    return {
      items: rows.map((row) => ({
        studentId: row.studentId,
        fullName: row.fullName,
        status: row.status,
        kitId: row.kitId,
        enrolledAt: row.enrolledAt.toISOString(),
      })),
    };
  }
}

// ---------------------------------------------------------------------------
// El salon del propio alumno
// ---------------------------------------------------------------------------

export interface MyClassroom {
  classroomId: string;
  institutionId: string;
  name: string;
  grade: string;
  teacherName: string | null;
  academicYear: number;
}

/**
 * En que salon esta el alumno que pregunta.
 *
 * El portal lo necesita para una cosa concreta: al abrir un intento de
 * evaluacion hay que decir de que salon es, y sin eso la entrega queda sin
 * salon y no aparece en la bandeja de correccion de ningun docente. El dato
 * vive en las matriculas de este servicio, no en el token: identidad recibe el
 * salon al registrar pero no lo guarda, y meterlo en el JWT lo dejaria
 * congelado hasta el siguiente inicio de sesion -justo lo que no sirve cuando a
 * un alumno lo cambian de salon a mitad de curso-.
 *
 * **No exige ningun permiso ademas de estar autenticado, y devuelve unicamente
 * lo del propio actor.** Es el mismo criterio que `MEDIA_READ`: el guard dice
 * "es un usuario"; el caso de uso decide que recurso. Un alumno no tiene
 * `CLASSROOM_READ` -no debe poder listar salones- pero si tiene que poder saber
 * en cual esta el.
 *
 * Lo que devuelve es deliberadamente escueto: nombre del salon, grado y
 * docente. Ni aforo ni matriculados: el numero de compañeros de clase no es
 * asunto suyo, y publicarlo permitiria medir la matricula de un colegio.
 */
export class ListMyClassroomsUseCase implements UseCase<void, { items: MyClassroom[] }> {
  constructor(private readonly classrooms: ClassroomRepository) {}

  async execute(_input: void, context: ExecutionContext): Promise<{ items: MyClassroom[] }> {
    const actor = actorProfile(context);
    const rows = await this.classrooms.listByStudent(actor.userId);

    return {
      items: rows.map((row) => ({
        classroomId: row.id,
        institutionId: row.institutionId,
        name: row.name,
        grade: row.grade,
        teacherName: row.teacherName,
        academicYear: row.academicYear,
      })),
    };
  }
}
