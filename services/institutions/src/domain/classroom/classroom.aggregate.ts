import {
  AggregateRoot,
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  Guard,
  ValueObject,
  defineId,
  DomainEvent,
  type DomainEventContext,
} from '@glexco/kernel';
import {
  DEFAULT_CLASSROOM_CAPACITY,
  ENROLLMENT_STATUS,
  EVENTS,
  GRADE_LEVEL,
  MAX_CLASSROOM_CAPACITY,
  type EnrollmentStatus,
  type Grade,
} from '@glexco/contracts';

export class ClassroomId extends defineId('Classroom') {}

/**
 * Tope de plazas de un salon.
 *
 * La propuesta lo pide explicitamente ("con topes, ejemplo 20 alumnos"). Se
 * modela como objeto de valor y no como un simple numero porque tiene reglas:
 * un tope de cero deja el salon inutil, y uno de mil no es un salon sino un
 * error de tecleo que dejaria a un docente con un listado ingobernable.
 */
export class Capacity extends ValueObject<{ value: number }> {
  private constructor(value: number) {
    super({ value });
  }

  static create(value: number = DEFAULT_CLASSROOM_CAPACITY): Capacity {
    Guard.isPositiveInteger(value, 'capacity');
    Guard.inRange(value, 1, MAX_CLASSROOM_CAPACITY, 'capacity');
    return new Capacity(value);
  }

  get value(): number {
    return this.props.value;
  }
}

/** Nombre del salon: "3.º A", "5to B - Robotica", "Taller de la tarde". */
export class ClassroomName extends ValueObject<{ value: string }> {
  private constructor(value: string) {
    super({ value });
  }

  static create(raw: string): ClassroomName {
    const value = raw.trim().replace(/\s+/g, ' ');
    Guard.againstEmpty(value, 'classroomName');
    Guard.lengthBetween(value, 1, 60, 'classroomName');
    return new ClassroomName(value);
  }

  get value(): string {
    return this.props.value;
  }
}

/**
 * Matricula de un alumno en un salon.
 *
 * Es una entidad interna del agregado Classroom, no una raiz propia: su
 * invariante -"no se puede matricular por encima del tope"- solo se puede
 * garantizar con el salon delante. Si la matricula fuese su propia raiz, dos
 * matriculas simultaneas no verian el conteo la una de la otra.
 */
export interface Enrollment {
  studentId: string;
  status: EnrollmentStatus;
  enrolledAt: Date;
  /** Kit activado por el alumno. Lo informa catalogo al canjear el codigo. */
  kitId: string | null;
  leftAt: Date | null;
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

const AGGREGATE = 'Classroom';

export interface ClassroomCreatedPayload {
  classroomId: string;
  institutionId: string;
  teacherId: string;
  name: string;
  grade: Grade;
  capacity: number;
  academicYear: number;
  createdAt: string;
}

export class ClassroomCreated extends DomainEvent<ClassroomCreatedPayload> {
  constructor(payload: ClassroomCreatedPayload, version: number, context?: DomainEventContext) {
    super(EVENTS.CLASSROOM_CREATED, AGGREGATE, payload.classroomId, version, payload, context);
  }
}

export interface StudentEnrolledPayload {
  classroomId: string;
  institutionId: string;
  studentId: string;
  teacherId: string;
  grade: Grade;
  /** Plazas ocupadas tras la matricula. El docente lo ve en su panel. */
  enrolledCount: number;
  capacity: number;
  enrolledAt: string;
}

export class StudentEnrolled extends DomainEvent<StudentEnrolledPayload> {
  constructor(payload: StudentEnrolledPayload, version: number, context?: DomainEventContext) {
    super(EVENTS.STUDENT_ENROLLED, AGGREGATE, payload.classroomId, version, payload, context);
  }
}

export interface StudentWithdrawnPayload {
  classroomId: string;
  institutionId: string;
  studentId: string;
  reason: EnrollmentStatus;
  withdrawnAt: string;
}

export class StudentWithdrawn extends DomainEvent<StudentWithdrawnPayload> {
  constructor(payload: StudentWithdrawnPayload, version: number, context?: DomainEventContext) {
    super(EVENTS.STUDENT_WITHDRAWN, AGGREGATE, payload.classroomId, version, payload, context);
  }
}

export interface TeacherAssignedPayload {
  classroomId: string;
  institutionId: string;
  teacherId: string;
  previousTeacherId: string | null;
  assignedAt: string;
}

export class TeacherAssigned extends DomainEvent<TeacherAssignedPayload> {
  constructor(payload: TeacherAssignedPayload, version: number, context?: DomainEventContext) {
    super(EVENTS.TEACHER_ASSIGNED, AGGREGATE, payload.classroomId, version, payload, context);
  }
}

// ---------------------------------------------------------------------------
// Agregado
// ---------------------------------------------------------------------------

export type ClassroomStatus = 'active' | 'archived';

interface ClassroomState {
  institutionId: string;
  teacherId: string;
  name: ClassroomName;
  grade: Grade;
  capacity: Capacity;
  /** Ano academico. Un salon "3.º A" existe cada ano y son salones distintos:
   *  sin este campo, el historial de un alumno se mezclaria entre promociones. */
  academicYear: number;
  status: ClassroomStatus;
  enrollments: Enrollment[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Salon de clases.
 *
 * El agregado incluye las matriculas porque el tope de plazas es una invariante
 * que abarca a las dos cosas. Este es el ejemplo de libro de por que se elige
 * una frontera de agregado: si Enrollment fuese raiz independiente, comprobar
 * el cupo seria "contar y luego insertar", y entre esos dos pasos caben dos
 * peticiones simultaneas que ambas ven la ultima plaza libre.
 *
 * La proteccion tiene DOS capas y las dos son necesarias:
 *   1. Aqui, `enroll` rechaza si el salon esta lleno segun el estado cargado.
 *   2. En el repositorio, la carga usa `SELECT ... FOR UPDATE` sobre la fila del
 *      salon, de modo que dos transacciones concurrentes se serializan.
 * Sin la capa 2, la capa 1 es una comprobacion sobre datos ya obsoletos.
 */
export class Classroom extends AggregateRoot<ClassroomId> {
  private constructor(
    id: ClassroomId,
    private state: ClassroomState,
  ) {
    super(id);
  }

  static create(input: {
    id: ClassroomId;
    institutionId: string;
    teacherId: string;
    name: ClassroomName;
    grade: Grade;
    capacity: Capacity;
    academicYear: number;
    now: Date;
    createdBy: string;
  }): Classroom {
    // Un ano academico absurdo (1900, 3050) casi siempre es un error de tecleo,
    // y crea salones que nunca aparecen en los listados del ano en curso.
    const currentYear = input.now.getUTCFullYear();
    Guard.inRange(input.academicYear, currentYear - 1, currentYear + 2, 'academicYear');

    const classroom = new Classroom(input.id, {
      institutionId: input.institutionId,
      teacherId: input.teacherId,
      name: input.name,
      grade: input.grade,
      capacity: input.capacity,
      academicYear: input.academicYear,
      status: 'active',
      enrollments: [],
      createdAt: input.now,
      updatedAt: input.now,
    });

    classroom.record(
      (version) =>
        new ClassroomCreated(
          {
            classroomId: input.id.value,
            institutionId: input.institutionId,
            teacherId: input.teacherId,
            name: input.name.value,
            grade: input.grade,
            capacity: input.capacity.value,
            academicYear: input.academicYear,
            createdAt: input.now.toISOString(),
          },
          version,
          { actorId: input.createdBy, tenantId: input.institutionId },
        ),
    );

    return classroom;
  }

  static rehydrate(id: ClassroomId, state: ClassroomState, version: number): Classroom {
    const classroom = new Classroom(id, state);
    classroom.setVersion(version);
    return classroom;
  }

  // -------------------------------------------------------------------------
  // Matriculas
  // -------------------------------------------------------------------------

  /** Plazas ocupadas. Solo cuentan las matriculas activas: un alumno que se fue
   *  no debe seguir bloqueando una plaza. */
  get enrolledCount(): number {
    return this.state.enrollments.filter(
      (enrollment) => enrollment.status === ENROLLMENT_STATUS.ACTIVE,
    ).length;
  }

  get availableSeats(): number {
    return Math.max(0, this.state.capacity.value - this.enrolledCount);
  }

  get isFull(): boolean {
    return this.availableSeats === 0;
  }

  /**
   * Matricula a un alumno.
   *
   * Debe ejecutarse con el salon cargado bajo bloqueo de fila. El repositorio se
   * encarga de eso; aqui solo se hacen valer las reglas.
   */
  enroll(input: { studentId: string; kitId?: string | null; now: Date }): void {
    if (this.state.status === 'archived') {
      throw new BusinessRuleError(
        'CLASSROOM_ARCHIVED',
        'Este salon esta archivado y no admite matriculas.',
      );
    }

    const existing = this.state.enrollments.find(
      (enrollment) => enrollment.studentId === input.studentId,
    );

    if (existing?.status === ENROLLMENT_STATUS.ACTIVE) {
      // Idempotencia: reintentar la matricula (por un reintento de red o por un
      // evento entregado dos veces) no debe fallar ni duplicar.
      return;
    }

    if (this.isFull) {
      throw new ConflictError(
        'CLASSROOM_FULL',
        'El salon ya alcanzo su cupo maximo de alumnos.',
        { capacity: this.state.capacity.value, enrolled: this.enrolledCount },
      );
    }

    if (existing) {
      // Reingreso: el alumno ya estuvo aqui y volvio. Se reactiva su matricula
      // en vez de crear una nueva, para no partir su historial en dos.
      existing.status = ENROLLMENT_STATUS.ACTIVE;
      existing.leftAt = null;
      existing.enrolledAt = input.now;
      if (input.kitId) existing.kitId = input.kitId;
    } else {
      this.state.enrollments.push({
        studentId: input.studentId,
        status: ENROLLMENT_STATUS.ACTIVE,
        enrolledAt: input.now,
        kitId: input.kitId ?? null,
        leftAt: null,
      });
    }

    this.state.updatedAt = input.now;

    this.record(
      (version) =>
        new StudentEnrolled(
          {
            classroomId: this.id.value,
            institutionId: this.state.institutionId,
            studentId: input.studentId,
            teacherId: this.state.teacherId,
            grade: this.state.grade,
            enrolledCount: this.enrolledCount,
            capacity: this.state.capacity.value,
            enrolledAt: input.now.toISOString(),
          },
          version,
          { tenantId: this.state.institutionId },
        ),
    );
  }

  /**
   * Retira a un alumno del salon.
   *
   * No borra la matricula: cambia su estado y guarda la fecha. El progreso
   * academico, las evaluaciones y los certificados de un alumno deben sobrevivir
   * a que cambie de salon o de colegio; borrar la matricula dejaria huerfanas
   * esas referencias en los demas servicios.
   */
  withdraw(input: {
    studentId: string;
    reason: Extract<EnrollmentStatus, 'transferred' | 'withdrawn' | 'completed'>;
    now: Date;
  }): void {
    const enrollment = this.state.enrollments.find(
      (candidate) => candidate.studentId === input.studentId,
    );

    if (!enrollment || enrollment.status !== ENROLLMENT_STATUS.ACTIVE) {
      // Idempotente: retirar a quien ya no esta no es un error.
      return;
    }

    enrollment.status = input.reason;
    enrollment.leftAt = input.now;
    this.state.updatedAt = input.now;

    this.record(
      (version) =>
        new StudentWithdrawn(
          {
            classroomId: this.id.value,
            institutionId: this.state.institutionId,
            studentId: input.studentId,
            reason: input.reason,
            withdrawnAt: input.now.toISOString(),
          },
          version,
          { tenantId: this.state.institutionId },
        ),
    );
  }

  // -------------------------------------------------------------------------
  // Gestion
  // -------------------------------------------------------------------------

  /**
   * Cambia el tope de plazas.
   *
   * Se permite BAJARLO por debajo de los ya matriculados: si un docente tiene 25
   * alumnos y el colegio decide que el tope es 20, impedir el cambio no arregla
   * nada. Lo que se impide es matricular a nadie mas hasta que el conteo baje,
   * que es el comportamiento util.
   */
  changeCapacity(capacity: Capacity, now: Date): void {
    this.state.capacity = capacity;
    this.state.updatedAt = now;
  }

  rename(name: ClassroomName, now: Date): void {
    this.state.name = name;
    this.state.updatedAt = now;
  }

  assignTeacher(teacherId: string, assignedBy: string, now: Date): void {
    if (this.state.teacherId === teacherId) return;

    const previous = this.state.teacherId;
    this.state.teacherId = teacherId;
    this.state.updatedAt = now;

    this.record(
      (version) =>
        new TeacherAssigned(
          {
            classroomId: this.id.value,
            institutionId: this.state.institutionId,
            teacherId,
            previousTeacherId: previous,
            assignedAt: now.toISOString(),
          },
          version,
          { actorId: assignedBy, tenantId: this.state.institutionId },
        ),
    );
  }

  /** Archiva el salon al terminar el ano academico. */
  archive(now: Date): void {
    if (this.state.status === 'archived') return;
    this.state.status = 'archived';
    this.state.updatedAt = now;
  }

  // -------------------------------------------------------------------------
  // Autorizacion de ambito
  // -------------------------------------------------------------------------

  /**
   * Comprueba que el actor puede operar sobre ESTE salon.
   *
   * El guard de permisos ya verifico que puede hacer "operaciones de salon"; lo
   * que falta -y solo se puede comprobar aqui, con el recurso delante- es que
   * sea SU salon o al menos de SU institucion. Es la mitad que se olvida y por
   * la que se filtran datos entre colegios.
   */
  assertOperableBy(actor: {
    userId: string;
    institutionId?: string;
    isPlatformStaff: boolean;
    isInstitutionAdmin: boolean;
  }): void {
    if (actor.isPlatformStaff) return;

    if (actor.institutionId !== this.state.institutionId) {
      // Mismo error que "no existe": distinguirlos permitiria sondear que ids de
      // salon son reales en otras instituciones.
      throw new ForbiddenError('CLASSROOM_NOT_ACCESSIBLE', 'El salon no esta disponible.');
    }

    // Un administrador de institucion manda sobre todos los salones de su
    // colegio; un docente, solo sobre los suyos.
    if (actor.isInstitutionAdmin) return;

    if (this.state.teacherId !== actor.userId) {
      throw new ForbiddenError(
        'CLASSROOM_NOT_OWNED',
        'Solo puedes gestionar los salones a tu cargo.',
      );
    }
  }

  // -------------------------------------------------------------------------
  // Consultas
  // -------------------------------------------------------------------------

  get institutionId(): string {
    return this.state.institutionId;
  }
  get teacherId(): string {
    return this.state.teacherId;
  }
  get name(): ClassroomName {
    return this.state.name;
  }
  get grade(): Grade {
    return this.state.grade;
  }
  get educationLevel() {
    return GRADE_LEVEL[this.state.grade];
  }
  get capacity(): Capacity {
    return this.state.capacity;
  }
  get academicYear(): number {
    return this.state.academicYear;
  }
  get status(): ClassroomStatus {
    return this.state.status;
  }
  get enrollments(): readonly Enrollment[] {
    return this.state.enrollments;
  }
  get createdAt(): Date {
    return this.state.createdAt;
  }
  get updatedAt(): Date {
    return this.state.updatedAt;
  }

  hasActiveStudent(studentId: string): boolean {
    return this.state.enrollments.some(
      (enrollment) =>
        enrollment.studentId === studentId && enrollment.status === ENROLLMENT_STATUS.ACTIVE,
    );
  }

  snapshot(): Readonly<ClassroomState> {
    return this.state;
  }
}
