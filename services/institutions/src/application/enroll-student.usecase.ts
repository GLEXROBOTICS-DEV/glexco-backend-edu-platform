import {
  BusinessRuleError,
  NotFoundError,
  type Clock,
  type ExecutionContext,
  type LoggerPort,
  type UnitOfWork,
  type UseCase,
} from '@glexco/kernel';
import { ClassroomId } from '../domain/classroom/classroom.aggregate';
import { InstitutionId } from '../domain/institution/value-objects';
import type { ClassroomRepository, InstitutionRepository } from '../domain/repositories';

export interface EnrollStudentInput {
  classroomId: string;
  studentId: string;
  institutionId: string;
  /** Kit que el alumno activo con su codigo de libro, si ya se conoce. */
  kitId?: string | null;
}

export interface EnrollStudentOutput {
  classroomId: string;
  classroomName: string;
  teacherId: string;
  enrolledCount: number;
  capacity: number;
}

/**
 * Matricula a un alumno en un salon.
 *
 * Se invoca de dos formas:
 *   - Al consumir `identity.user.registered.v1`, cuando un alumno se registra
 *     eligiendo institucion y salon.
 *   - Desde el panel, cuando un docente o administrador mueve a un alumno.
 *
 * TODO el trabajo va dentro de UNA transaccion, y el salon se carga con
 * `SELECT ... FOR UPDATE`. Esa es la unica forma de hacer valer el tope de
 * plazas: comprobar el cupo fuera de la transaccion y despues insertar es la
 * condicion de carrera clasica, y con 30 alumnos entrando a la vez el primer dia
 * de clase se manifiesta de verdad, no en teoria.
 *
 * La operacion es IDEMPOTENTE porque el evento de registro puede llegar dos
 * veces: JetStream garantiza at-least-once. Si el alumno ya esta matriculado, se
 * devuelve el estado actual sin error y sin duplicar.
 */
export class EnrollStudentUseCase implements UseCase<EnrollStudentInput, EnrollStudentOutput> {
  constructor(
    private readonly classrooms: ClassroomRepository,
    private readonly institutions: InstitutionRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly logger: LoggerPort,
  ) {}

  async execute(
    input: EnrollStudentInput,
    _context: ExecutionContext,
  ): Promise<EnrollStudentOutput> {
    const now = this.clock.now();

    return this.unitOfWork.run(async (tx) => {
      // El bloqueo de fila se toma AQUI, y se libera al confirmar la
      // transaccion. Todo lo que sigue ve un estado que nadie mas puede cambiar.
      const classroom = await this.classrooms.findByIdForUpdate(
        ClassroomId.create(input.classroomId),
        tx,
      );

      if (!classroom) {
        throw new NotFoundError('CLASSROOM_NOT_FOUND', 'El salon indicado no existe.');
      }

      // Aislamiento entre instituciones: aunque el id del salon sea correcto, si
      // pertenece a otro colegio la operacion no procede. Sin esta comprobacion,
      // conocer un id bastaria para matricular a un alumno en un colegio ajeno.
      if (classroom.institutionId !== input.institutionId) {
        throw new NotFoundError('CLASSROOM_NOT_FOUND', 'El salon indicado no existe.');
      }

      // Idempotencia antes de tocar nada: si ya esta dentro, se devuelve el
      // estado y se sale. No se emite evento, para no duplicar la notificacion
      // al docente.
      if (classroom.hasActiveStudent(input.studentId)) {
        this.logger.debug('Matricula ya existente; operacion idempotente', {
          classroomId: input.classroomId,
          studentId: input.studentId,
        });

        return {
          classroomId: classroom.id.value,
          classroomName: classroom.name.value,
          teacherId: classroom.teacherId,
          enrolledCount: classroom.enrolledCount,
          capacity: classroom.capacity.value,
        };
      }

      const institution = await this.institutions.findById(
        InstitutionId.create(input.institutionId),
      );
      if (!institution) {
        throw new NotFoundError('INSTITUTION_NOT_FOUND', 'La institucion no existe.');
      }

      institution.assertAcceptsNewMembers();

      // El tope se hace valer dentro del agregado, ya con la fila bloqueada.
      classroom.enroll({ studentId: input.studentId, kitId: input.kitId, now });

      await this.classrooms.save(classroom, tx);
      (tx as { enqueue(...events: unknown[]): void }).enqueue(...classroom.pullDomainEvents());

      // Aviso de plazas de licencia excedidas: se registra, NO se bloquea. Dejar
      // a un alumno sin acceso a mitad de curso por un asunto administrativo
      // castiga a quien no tiene culpa; el equipo comercial lo ve en su panel.
      const usage = institution.seatUsageAt(now);
      if (usage?.exceeded) {
        this.logger.warn('Institucion por encima de las plazas de su licencia', {
          institutionId: input.institutionId,
          seats: usage.seats,
          used: usage.used,
        });
      }

      this.logger.info('Alumno matriculado', {
        classroomId: classroom.id.value,
        studentId: input.studentId,
        enrolled: classroom.enrolledCount,
        capacity: classroom.capacity.value,
      });

      return {
        classroomId: classroom.id.value,
        classroomName: classroom.name.value,
        teacherId: classroom.teacherId,
        enrolledCount: classroom.enrolledCount,
        capacity: classroom.capacity.value,
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Comprobacion previa que consulta el servicio de identidad
// ---------------------------------------------------------------------------

export interface PrecheckClassroomInput {
  institutionId: string;
  classroomId: string;
}

export interface PrecheckClassroomOutput {
  exists: boolean;
  belongsToInstitution: boolean;
  hasCapacity: boolean;
  capacity: number;
  enrolled: number;
  classroomName?: string;
  teacherName?: string;
}

/**
 * Comprobacion previa del salon, para el formulario de registro.
 *
 * La consulta el servicio de identidad ANTES de crear la cuenta, para que un
 * salon inexistente o lleno se rechace de inmediato en el formulario en vez de
 * al final de un proceso largo.
 *
 * Es INFORMATIVA y sin bloqueo: el cupo real se vuelve a comprobar en
 * `EnrollStudentUseCase`, dentro de la transaccion. Aqui no hace falta ser
 * exacto -y no se debe, porque bloquear la fila en cada pulsacion del formulario
 * serializaria todos los registros del salon-, solo evitar que el usuario
 * complete datos para nada.
 */
export class PrecheckClassroomUseCase
  implements UseCase<PrecheckClassroomInput, PrecheckClassroomOutput>
{
  constructor(
    private readonly classrooms: ClassroomRepository,
    private readonly teachers: { findName(userId: string): Promise<string | null> },
  ) {}

  async execute(input: PrecheckClassroomInput): Promise<PrecheckClassroomOutput> {
    const classroom = await this.classrooms.findById(ClassroomId.create(input.classroomId));

    if (!classroom) {
      return {
        exists: false,
        belongsToInstitution: false,
        hasCapacity: false,
        capacity: 0,
        enrolled: 0,
      };
    }

    const belongs = classroom.institutionId === input.institutionId;

    // Si el salon es de otra institucion no se devuelve NINGUN dato suyo, ni
    // siquiera el nombre: eso permitiria enumerar la estructura de otros
    // colegios probando ids.
    if (!belongs) {
      return {
        exists: true,
        belongsToInstitution: false,
        hasCapacity: false,
        capacity: 0,
        enrolled: 0,
      };
    }

    if (classroom.status === 'archived') {
      throw new BusinessRuleError(
        'CLASSROOM_ARCHIVED',
        'Este salon corresponde a un ano academico cerrado.',
      );
    }

    return {
      exists: true,
      belongsToInstitution: true,
      hasCapacity: !classroom.isFull,
      capacity: classroom.capacity.value,
      enrolled: classroom.enrolledCount,
      classroomName: classroom.name.value,
      teacherName: (await this.teachers.findName(classroom.teacherId)) ?? undefined,
    };
  }
}
