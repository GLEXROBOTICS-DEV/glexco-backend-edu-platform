import { describe, expect, it } from 'vitest';
import { ConflictError, ForbiddenError, ValidationError } from '@glexco/kernel';
import { ENROLLMENT_STATUS, GRADES, MAX_CLASSROOM_CAPACITY } from '@glexco/contracts';
import {
  Capacity,
  Classroom,
  ClassroomId,
  ClassroomName,
} from '../src/domain/classroom/classroom.aggregate';

const NOW = new Date('2026-09-02T12:00:00Z');
const INSTITUTION_A = '11111111-1111-4111-8111-111111111111';
const INSTITUTION_B = '22222222-2222-4222-8222-222222222222';
const TEACHER = '33333333-3333-4333-8333-333333333333';

function makeClassroom(capacity = 20): Classroom {
  return Classroom.create({
    id: ClassroomId.create(),
    institutionId: INSTITUTION_A,
    teacherId: TEACHER,
    name: ClassroomName.create('3.º A'),
    grade: GRADES.PRIMARY_3,
    capacity: Capacity.create(capacity),
    academicYear: 2026,
    now: NOW,
    createdBy: TEACHER,
  });
}

describe('Capacity', () => {
  it('acepta el tope de 20 que pide la propuesta', () => {
    expect(Capacity.create(20).value).toBe(20);
  });

  it('usa 30 por defecto', () => {
    expect(Capacity.create().value).toBe(30);
  });

  it('rechaza cero, negativos y decimales', () => {
    // Un tope de cero deja el salon inutil; un decimal es siempre un error.
    expect(() => Capacity.create(0)).toThrow(ValidationError);
    expect(() => Capacity.create(-5)).toThrow(ValidationError);
    expect(() => Capacity.create(20.5)).toThrow(ValidationError);
  });

  it('rechaza un tope absurdo', () => {
    // Casi siempre es un error de tecleo, y deja al docente con un listado
    // ingobernable.
    expect(() => Capacity.create(MAX_CLASSROOM_CAPACITY + 1)).toThrow(ValidationError);
  });
});

describe('Classroom — tope de plazas', () => {
  it('cuenta las plazas ocupadas y las libres', () => {
    const classroom = makeClassroom(3);
    classroom.enroll({ studentId: 'a', now: NOW });
    classroom.enroll({ studentId: 'b', now: NOW });

    expect(classroom.enrolledCount).toBe(2);
    expect(classroom.availableSeats).toBe(1);
    expect(classroom.isFull).toBe(false);
  });

  it('RECHAZA la matricula cuando el salon esta lleno', () => {
    const classroom = makeClassroom(2);
    classroom.enroll({ studentId: 'a', now: NOW });
    classroom.enroll({ studentId: 'b', now: NOW });

    expect(classroom.isFull).toBe(true);
    expect(() => classroom.enroll({ studentId: 'c', now: NOW })).toThrow(ConflictError);
  });

  it('el error de salon lleno informa del tope y de los matriculados', () => {
    const classroom = makeClassroom(1);
    classroom.enroll({ studentId: 'a', now: NOW });

    try {
      classroom.enroll({ studentId: 'b', now: NOW });
      expect.unreachable('deberia haber lanzado');
    } catch (error) {
      const conflict = error as ConflictError;
      expect(conflict.code).toBe('CLASSROOM_FULL');
      expect(conflict.details).toMatchObject({ capacity: 1, enrolled: 1 });
    }
  });

  it('un alumno retirado LIBERA su plaza', () => {
    const classroom = makeClassroom(2);
    classroom.enroll({ studentId: 'a', now: NOW });
    classroom.enroll({ studentId: 'b', now: NOW });
    expect(classroom.isFull).toBe(true);

    classroom.withdraw({ studentId: 'a', reason: ENROLLMENT_STATUS.TRANSFERRED, now: NOW });

    expect(classroom.availableSeats).toBe(1);
    expect(() => classroom.enroll({ studentId: 'c', now: NOW })).not.toThrow();
  });

  it('permite bajar el tope por debajo de los ya matriculados', () => {
    // Si el colegio decide que el tope es 2 y ya hay 3 alumnos, impedir el
    // cambio no arregla nada. Lo util es que no entre nadie mas.
    const classroom = makeClassroom(5);
    for (const id of ['a', 'b', 'c']) classroom.enroll({ studentId: id, now: NOW });

    classroom.changeCapacity(Capacity.create(2), NOW);

    expect(classroom.enrolledCount).toBe(3);
    expect(classroom.availableSeats).toBe(0);
    expect(() => classroom.enroll({ studentId: 'd', now: NOW })).toThrow(ConflictError);
  });
});

describe('Classroom — idempotencia de la matricula', () => {
  it('matricular dos veces al mismo alumno no duplica ni falla', () => {
    // JetStream entrega at-least-once: el evento de registro puede llegar dos
    // veces y no debe producir dos matriculas.
    const classroom = makeClassroom(20);
    classroom.enroll({ studentId: 'a', now: NOW });
    classroom.pullDomainEvents();

    classroom.enroll({ studentId: 'a', now: NOW });

    expect(classroom.enrolledCount).toBe(1);
    // Tampoco debe emitir un segundo evento, o el docente recibiria dos avisos.
    expect(classroom.pullDomainEvents()).toHaveLength(0);
  });

  it('retirar a quien ya no esta no falla', () => {
    const classroom = makeClassroom();
    expect(() =>
      classroom.withdraw({ studentId: 'fantasma', reason: ENROLLMENT_STATUS.WITHDRAWN, now: NOW }),
    ).not.toThrow();
  });

  it('un alumno que vuelve reactiva su matricula sin partir el historial', () => {
    const classroom = makeClassroom();
    classroom.enroll({ studentId: 'a', kitId: 'kit-1', now: NOW });
    classroom.withdraw({ studentId: 'a', reason: ENROLLMENT_STATUS.TRANSFERRED, now: NOW });

    classroom.enroll({ studentId: 'a', now: NOW });

    // Una sola matricula, reactivada, conservando el kit que ya tenia.
    expect(classroom.enrollments).toHaveLength(1);
    expect(classroom.enrollments[0]!.status).toBe(ENROLLMENT_STATUS.ACTIVE);
    expect(classroom.enrollments[0]!.kitId).toBe('kit-1');
  });

  it('la retirada CONSERVA la matricula, no la borra', () => {
    // El progreso, las evaluaciones y los certificados del alumno cuelgan de
    // aqui: borrar dejaria huerfanas esas referencias en los demas servicios.
    const classroom = makeClassroom();
    classroom.enroll({ studentId: 'a', now: NOW });
    classroom.withdraw({ studentId: 'a', reason: ENROLLMENT_STATUS.WITHDRAWN, now: NOW });

    expect(classroom.enrollments).toHaveLength(1);
    expect(classroom.enrollments[0]!.leftAt).toEqual(NOW);
    expect(classroom.enrolledCount).toBe(0);
  });
});

describe('Classroom — eventos', () => {
  it('emite la creacion con el tope', () => {
    const classroom = makeClassroom(20);
    const events = classroom.pullDomainEvents();

    expect(events[0]!.metadata.eventName).toBe('institutions.classroom.created.v1');
    expect(events[0]!.payload).toMatchObject({ capacity: 20, grade: GRADES.PRIMARY_3 });
  });

  it('la matricula informa del conteo, que es lo que ve el docente', () => {
    const classroom = makeClassroom(20);
    classroom.pullDomainEvents();

    classroom.enroll({ studentId: 'a', now: NOW });
    const [event] = classroom.pullDomainEvents();

    expect(event!.metadata.eventName).toBe('institutions.enrollment.student_enrolled.v1');
    expect(event!.payload).toMatchObject({ enrolledCount: 1, capacity: 20 });
  });

  it('todos los eventos llevan el tenant, para poder particionar por institucion', () => {
    const classroom = makeClassroom();
    classroom.enroll({ studentId: 'a', now: NOW });

    for (const event of classroom.pullDomainEvents()) {
      expect(event.metadata.tenantId).toBe(INSTITUTION_A);
    }
  });
});

describe('Classroom — aislamiento entre instituciones', () => {
  const classroom = makeClassroom();

  it('el personal GLEXCO opera sobre cualquier salon', () => {
    expect(() =>
      classroom.assertOperableBy({
        userId: 'glexco',
        isPlatformStaff: true,
        isInstitutionAdmin: false,
      }),
    ).not.toThrow();
  });

  it('BLOQUEA a un actor de OTRA institucion', () => {
    // Es la fuga entre colegios que hay que impedir a toda costa: aqui hay datos
    // de menores de edad.
    expect(() =>
      classroom.assertOperableBy({
        userId: 'admin-b',
        institutionId: INSTITUTION_B,
        isPlatformStaff: false,
        isInstitutionAdmin: true,
      }),
    ).toThrow(ForbiddenError);
  });

  it('el administrador de la institucion opera sobre cualquier salon SUYO', () => {
    expect(() =>
      classroom.assertOperableBy({
        userId: 'admin-a',
        institutionId: INSTITUTION_A,
        isPlatformStaff: false,
        isInstitutionAdmin: true,
      }),
    ).not.toThrow();
  });

  it('el docente titular opera sobre su salon', () => {
    expect(() =>
      classroom.assertOperableBy({
        userId: TEACHER,
        institutionId: INSTITUTION_A,
        isPlatformStaff: false,
        isInstitutionAdmin: false,
      }),
    ).not.toThrow();
  });

  it('BLOQUEA a otro docente del MISMO colegio', () => {
    // Mismo colegio no basta: un docente solo manda sobre sus propios salones.
    expect(() =>
      classroom.assertOperableBy({
        userId: 'otro-docente',
        institutionId: INSTITUTION_A,
        isPlatformStaff: false,
        isInstitutionAdmin: false,
      }),
    ).toThrow(ForbiddenError);
  });
});

describe('Classroom — ciclo de vida', () => {
  it('un salon archivado no admite matriculas', () => {
    const classroom = makeClassroom();
    classroom.archive(NOW);

    expect(() => classroom.enroll({ studentId: 'a', now: NOW })).toThrow();
  });

  it('rechaza un ano academico fuera de rango', () => {
    // 1999 o 3050 son errores de tecleo que producen salones invisibles en los
    // listados del ano en curso.
    expect(() =>
      Classroom.create({
        id: ClassroomId.create(),
        institutionId: INSTITUTION_A,
        teacherId: TEACHER,
        name: ClassroomName.create('3.º A'),
        grade: GRADES.PRIMARY_3,
        capacity: Capacity.create(20),
        academicYear: 1999,
        now: NOW,
        createdBy: TEACHER,
      }),
    ).toThrow(ValidationError);
  });

  it('reasignar docente emite evento con el titular anterior', () => {
    const classroom = makeClassroom();
    classroom.pullDomainEvents();

    classroom.assignTeacher('nuevo-docente', 'admin-a', NOW);
    const [event] = classroom.pullDomainEvents();

    expect(event!.metadata.eventName).toBe('institutions.classroom.teacher_assigned.v1');
    expect(event!.payload).toMatchObject({
      teacherId: 'nuevo-docente',
      previousTeacherId: TEACHER,
    });
  });

  it('reasignar al mismo docente no emite evento', () => {
    const classroom = makeClassroom();
    classroom.pullDomainEvents();

    classroom.assignTeacher(TEACHER, 'admin-a', NOW);

    expect(classroom.pullDomainEvents()).toHaveLength(0);
  });
});
