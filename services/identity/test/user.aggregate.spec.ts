import { describe, expect, it } from 'vitest';
import { ROLES } from '@glexco/contracts';
import { BusinessRuleError, ForbiddenError } from '@glexco/kernel';
import { User } from '../src/domain/user/user.aggregate';
import {
  BirthDate,
  Email,
  LocalePreference,
  PasswordHash,
  PersonName,
  UserId,
} from '../src/domain/user/value-objects';

/**
 * Pruebas del agregado User.
 *
 * Corren en memoria, sin Docker ni base de datos, en milisegundos. Es
 * exactamente el beneficio que se buscaba al mantener el dominio libre de
 * infraestructura: si estas reglas dependieran de PostgreSQL, la suite tardaria
 * minutos y en la practica nadie la ejecutaria antes de subir cambios.
 */

const NOW = new Date('2026-09-02T12:00:00Z');

function birthDateForAge(age: number): BirthDate {
  const year = NOW.getUTCFullYear() - age;
  // Un mes atras, para que la edad este cumplida sin ambiguedad.
  return BirthDate.create(`${year}-08-02`);
}

function baseStudentInput(overrides: Partial<Parameters<typeof User.registerStudent>[0]> = {}) {
  return {
    id: UserId.create(),
    email: Email.create('carlos.salazar@colegio.pe'),
    name: PersonName.create('Carlos', 'Salazar'),
    birthDate: birthDateForAge(16),
    passwordHash: PasswordHash.fromHash('$argon2id$v=19$m=19456,t=2,p=1$abc$def'),
    locale: LocalePreference.create('es'),
    accountType: 'independent' as const,
    now: NOW,
    ...overrides,
  };
}

describe('User.registerStudent', () => {
  it('crea la cuenta en pending_verification con el rol de alumno', () => {
    const user = User.registerStudent(baseStudentInput());

    expect(user.status).toBe('pending_verification');
    expect(user.roles).toEqual([ROLES.STUDENT]);
    expect(user.emailVerified).toBe(false);
    expect(user.acceptedTermsAt).toEqual(NOW);
  });

  it('emite el evento de registro con la version 1 del agregado', () => {
    const user = User.registerStudent(baseStudentInput());
    const events = user.pullDomainEvents();

    expect(events).toHaveLength(1);
    expect(events[0]!.metadata.eventName).toBe('identity.user.registered.v1');
    expect(events[0]!.metadata.aggregateVersion).toBe(1);
    // Vaciar el buffer es lo que hace el repositorio tras escribir en la outbox.
    expect(user.pullDomainEvents()).toHaveLength(0);
  });

  it('exige correo de apoderado para menores de 14', () => {
    expect(() =>
      User.registerStudent(baseStudentInput({ birthDate: birthDateForAge(9) })),
    ).toThrow(BusinessRuleError);
  });

  it('acepta un menor de 14 si trae correo de apoderado', () => {
    const user = User.registerStudent(
      baseStudentInput({
        birthDate: birthDateForAge(9),
        guardianEmail: Email.create('madre@familia.pe'),
      }),
    );

    expect(user.guardianEmail?.value).toBe('madre@familia.pe');
  });

  it('exige institucion y salon en el alta institucional', () => {
    expect(() =>
      User.registerStudent(baseStudentInput({ accountType: 'institutional' })),
    ).toThrow();
  });
});

describe('User.createStaff — matriz de creacion de roles', () => {
  const staffInput = {
    id: UserId.create(),
    email: Email.create('docente@colegio.pe'),
    name: PersonName.create('Ana', 'Quispe'),
    passwordHash: PasswordHash.fromHash('$argon2id$v=19$m=19456,t=2,p=1$abc$def'),
    locale: LocalePreference.create('es'),
    now: NOW,
  };

  it('un administrador de institucion puede crear docentes de su colegio', () => {
    const teacher = User.createStaff({
      ...staffInput,
      role: ROLES.TEACHER,
      institutionId: '00000000-0000-4000-8000-000000000001',
      createdBy: { userId: 'admin-1', roles: [ROLES.INSTITUTION_ADMIN] },
    });

    expect(teacher.roles).toEqual([ROLES.TEACHER]);
    // Nace obligado a cambiar la contrasena: la inicial la conoce quien creo la
    // cuenta, asi que no es un secreto.
    expect(teacher.mustChangePassword).toBe(true);
  });

  it('BLOQUEA que un administrador de institucion se fabrique un platform_admin', () => {
    // Es la escalada de privilegios que la matriz existe para impedir: sin ella,
    // el permiso `user:create` bastaria para tomar el control de la plataforma.
    expect(() =>
      User.createStaff({
        ...staffInput,
        role: ROLES.PLATFORM_ADMIN,
        createdBy: { userId: 'admin-1', roles: [ROLES.INSTITUTION_ADMIN] },
      }),
    ).toThrow(ForbiddenError);
  });

  it('rechaza un docente sin institucion', () => {
    expect(() =>
      User.createStaff({
        ...staffInput,
        role: ROLES.TEACHER,
        createdBy: { userId: 'owner', roles: [ROLES.PLATFORM_OWNER] },
      }),
    ).toThrow(BusinessRuleError);
  });
});

describe('User — bloqueo progresivo por intentos fallidos', () => {
  it('no bloquea hasta superar el umbral', () => {
    const user = User.registerStudent(baseStudentInput());

    for (let i = 0; i < 5; i += 1) user.recordFailedLogin(NOW);

    expect(user.isLockedAt(NOW)).toBe(false);
    expect(user.failedLoginAttempts).toBe(5);
  });

  it('bloquea con espera creciente a partir del sexto fallo', () => {
    const user = User.registerStudent(baseStudentInput());

    for (let i = 0; i < 6; i += 1) user.recordFailedLogin(NOW);
    const firstLock = user.lockedUntil!.getTime();
    expect(user.isLockedAt(NOW)).toBe(true);

    user.recordFailedLogin(NOW);
    const secondLock = user.lockedUntil!.getTime();

    // La espera crece: es lo que hace inviable la fuerza bruta sin castigar de
    // forma permanente a un usuario legitimo despistado.
    expect(secondLock).toBeGreaterThan(firstLock);
  });

  it('el bloqueo caduca solo', () => {
    const user = User.registerStudent(baseStudentInput());
    for (let i = 0; i < 6; i += 1) user.recordFailedLogin(NOW);

    const later = new Date(NOW.getTime() + 2 * 60_000);
    expect(user.isLockedAt(later)).toBe(false);
  });

  it('un inicio de sesion correcto limpia el bloqueo', () => {
    const user = User.registerStudent(baseStudentInput());
    for (let i = 0; i < 8; i += 1) user.recordFailedLogin(NOW);

    user.recordSuccessfulLogin(NOW);

    expect(user.failedLoginAttempts).toBe(0);
    expect(user.lockedUntil).toBeNull();
  });

  it('cambiar la contrasena desbloquea la cuenta', () => {
    const user = User.registerStudent(baseStudentInput());
    for (let i = 0; i < 8; i += 1) user.recordFailedLogin(NOW);

    user.changePassword(
      PasswordHash.fromHash('$argon2id$v=19$m=19456,t=2,p=1$xyz$uvw'),
      'reset',
      NOW,
    );

    expect(user.isLockedAt(NOW)).toBe(false);
  });
});

describe('User — verificacion de correo', () => {
  it('activa la cuenta y emite el evento', () => {
    const user = User.registerStudent(baseStudentInput());
    user.pullDomainEvents();

    user.verifyEmail(NOW);

    expect(user.emailVerified).toBe(true);
    expect(user.status).toBe('active');
    expect(user.pullDomainEvents()[0]!.metadata.eventName).toBe('identity.user.email_verified.v1');
  });

  it('es idempotente: reabrir el enlace no falla ni duplica eventos', () => {
    // Los clientes de correo pre-cargan enlaces y los usuarios hacen doble clic.
    const user = User.registerStudent(baseStudentInput());
    user.verifyEmail(NOW);
    user.pullDomainEvents();

    user.verifyEmail(NOW);

    expect(user.pullDomainEvents()).toHaveLength(0);
  });
});

describe('User — roles', () => {
  it('no permite retirar el ultimo rol', () => {
    // Una cuenta sin roles queda autenticada y sin poder hacer nada: solo genera
    // tickets de soporte. Para retirar el acceso esta `deactivate`.
    const user = User.registerStudent(baseStudentInput());

    expect(() =>
      user.revokeRole(ROLES.STUDENT, { userId: 'owner', roles: [ROLES.PLATFORM_OWNER] }, NOW),
    ).toThrow(BusinessRuleError);
  });

  it('expande los permisos efectivos desde los roles', () => {
    const user = User.registerStudent(baseStudentInput());

    expect(user.permissions).toContain('content:read');
    expect(user.permissions).toContain('progress:read_own');
    // Un alumno jamas debe poder crear contenido.
    expect(user.permissions).not.toContain('content:create');
  });

  it('marca como critica la sesion del personal, no la del alumno', () => {
    const student = User.registerStudent(baseStudentInput());
    expect(student.hasCriticalSession).toBe(false);

    const admin = User.createStaff({
      id: UserId.create(),
      email: Email.create('admin@glexco.pe'),
      name: PersonName.create('Sofia', 'Rojas'),
      passwordHash: PasswordHash.fromHash('$argon2id$v=19$m=19456,t=2,p=1$abc$def'),
      role: ROLES.PLATFORM_ADMIN,
      locale: LocalePreference.create('es'),
      createdBy: { userId: 'owner', roles: [ROLES.PLATFORM_OWNER] },
      now: NOW,
    });
    expect(admin.hasCriticalSession).toBe(true);
  });
});

describe('BirthDate — calculo de edad', () => {
  it('no cuenta el ano si el cumpleanos aun no llego', () => {
    // El calculo por componentes evita el error de dividir milisegundos, que con
    // los anos bisiestos puede dar 13 a alguien que ya cumplio 14, y eso decide
    // si se exige o no el correo del apoderado.
    const birthDate = BirthDate.create('2012-12-25');
    expect(birthDate.ageAt(new Date('2026-12-24T00:00:00Z'))).toBe(13);
    expect(birthDate.ageAt(new Date('2026-12-25T00:00:00Z'))).toBe(14);
  });

  it('marca la necesidad de apoderado justo por debajo de los 14', () => {
    expect(birthDateForAge(13).requiresGuardian(NOW)).toBe(true);
    expect(birthDateForAge(14).requiresGuardian(NOW)).toBe(false);
  });
});

describe('PersonName', () => {
  it('acepta nombres reales del Peru con tildes, apostrofes y guiones', () => {
    expect(PersonName.create('José María', "D'Angelo").full).toBe("José María D'Angelo");
    expect(PersonName.create('Ana', 'Nuñez-Melgar').last).toBe('Nuñez-Melgar');
  });

  it('colapsa espacios pegados desde una hoja de calculo', () => {
    expect(PersonName.create('  Carlos   Andres ', ' Salazar ').first).toBe('Carlos Andres');
  });

  it('rechaza digitos y simbolos', () => {
    expect(() => PersonName.create('Carlos123', 'Salazar')).toThrow();
    expect(() => PersonName.create('<script>', 'Salazar')).toThrow();
  });
});

describe('Email', () => {
  it('normaliza a minusculas para que no existan cuentas duplicadas', () => {
    expect(Email.create('  Carlos.Salazar@Colegio.PE ').value).toBe('carlos.salazar@colegio.pe');
  });
});

describe('PasswordHash', () => {
  it('rechaza que se le pase una contrasena en claro', () => {
    // Es el accidente que el objeto de valor existe para impedir.
    expect(() => PasswordHash.fromHash('miContrasena123')).toThrow();
  });

  it('no serializa el hash', () => {
    const hash = PasswordHash.fromHash('$argon2id$v=19$m=19456,t=2,p=1$abc$def');
    expect(JSON.stringify(hash)).not.toContain('argon2');
  });
});
