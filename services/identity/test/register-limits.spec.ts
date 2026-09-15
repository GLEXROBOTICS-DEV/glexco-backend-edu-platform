import { beforeEach, describe, expect, it } from 'vitest';
import { RateLimitError } from '@glexco/kernel';
import { RegisterStudentUseCase } from '../src/application/register-student.usecase';
import type {
  ActivationCodeGateway,
  ActivationCodePrecheck,
  ClassroomGateway,
  ClassroomPrecheck,
} from '../src/application/ports';
import {
  FakeAuditLog,
  FakeClock,
  FakePasswordHasher,
  FakeRateLimiter,
  FakeUnitOfWork,
  FakeUserRepository,
  PermissivePasswordPolicy,
  silentLogger,
} from './fakes';

const INSTITUTION = '22222222-2222-4222-8222-222222222222';
const CLASSROOM = '33333333-3333-4333-8333-333333333333';
const KIT = '44444444-4444-4444-8444-444444444444';

class CodigosDeLibro implements ActivationCodeGateway {
  constructor(private readonly valido: boolean) {}

  async precheck(): Promise<ActivationCodePrecheck> {
    if (!this.valido) return { valid: false, reason: 'not_found' };
    return {
      valid: true,
      activationCodeId: '55555555-5555-4555-8555-555555555555',
      kitId: KIT,
      kitName: 'uKit Explore',
      grade: 'primary_4',
      program: 'discover',
    };
  }
}

class SalonConCupo implements ClassroomGateway {
  async precheck(): Promise<ClassroomPrecheck> {
    return {
      exists: true,
      belongsToInstitution: true,
      hasCapacity: true,
      capacity: 35,
      enrolled: 4,
      classroomName: '4.º A',
      grade: 'primary_4',
    };
  }
}

function alta(overrides: Record<string, unknown> = {}) {
  return {
    accountType: 'institutional' as const,
    email: `alumno${Math.random().toString(36).slice(2, 8)}@colegio.pe`,
    password: 'una-contrasena-larga-y-buena',
    firstName: 'Mateo',
    lastName: 'Rojas',
    birthDate: '2016-04-12',
    // Tiene 10 anos: el dominio exige el correo del apoderado, y sin el ninguna
    // de estas pruebas llegaria al limite que quieren comprobar.
    guardianEmail: 'madre@correo.pe',
    locale: 'es' as const,
    acceptedTerms: true as const,
    activationCode: 'GLX89Y5J7CP82EV',
    institutionId: INSTITUTION,
    classroomId: CLASSROOM,
    grade: 'primary_4',
    ...overrides,
  };
}

function contexto(ip = '190.12.4.7') {
  return {
    correlationId: 'c-1',
    locale: 'es' as const,
    requestedAt: new Date(),
    ipAddress: ip,
  };
}

function montar(codigoValido = true) {
  const rateLimiter = new FakeRateLimiter();
  const usecase = new RegisterStudentUseCase(
    new FakeUserRepository(),
    new FakeUnitOfWork(),
    new FakePasswordHasher(),
    new PermissivePasswordPolicy(),
    new CodigosDeLibro(codigoValido),
    new SalonConCupo(),
    rateLimiter as never,
    new FakeAuditLog(),
    new FakeClock(new Date('2026-09-15T12:00:00Z')),
    silentLogger,
  );
  return { usecase, rateLimiter };
}

describe('El limite de altas distingue el aula de la casa', () => {
  let montaje: ReturnType<typeof montar>;

  beforeEach(() => {
    montaje = montar();
  });

  it('el alta institucional se cuenta por SALON, no por la IP del colegio', async () => {
    // Es la razon de ser del cambio: un colegio sale a internet por una sola IP,
    // asi que contando por IP una clase de treinta se bloqueaba en el minuto
    // tres por hacer exactamente lo que se espera de ella.
    await montaje.usecase.execute(alta(), contexto());

    expect(montaje.rateLimiter.consumed).toContain(`register:classroom:${CLASSROOM}`);
    expect(montaje.rateLimiter.consumed.some((k) => k.startsWith('register:ip:'))).toBe(false);
  });

  it('el alta independiente sigue contandose por IP', async () => {
    // No hay salon por el que agrupar, y la IP es lo unico que queda. Sustituir
    // el limite por IP en vez de anadir el de salon habria dejado el alta
    // independiente sin ninguna proteccion.
    await montaje.usecase.execute(
      alta({ accountType: 'independent', institutionId: undefined, classroomId: undefined }),
      contexto(),
    );

    expect(montaje.rateLimiter.consumed.some((k) => k.startsWith('register:ip:'))).toBe(true);
    expect(montaje.rateLimiter.consumed.some((k) => k.startsWith('register:classroom:'))).toBe(
      false,
    );
  });

  it('un salon saturado se rechaza con su propio mensaje', async () => {
    montaje.rateLimiter.blockKeys.add('register:classroom:');

    await expect(montaje.usecase.execute(alta(), contexto())).rejects.toThrow(RateLimitError);
  });

  it('el salon saturado de un colegio no bloquea al de otro', async () => {
    // Lo que el limite por IP no podia distinguir: dos salones del mismo centro
    // -o dos centros tras el mismo proveedor- compartian contador.
    montaje.rateLimiter.blockKeys.add(`register:classroom:${CLASSROOM}`);
    const otro = '99999999-9999-4999-8999-999999999999';

    await expect(
      montaje.usecase.execute(alta({ classroomId: otro }), contexto()),
    ).resolves.toBeDefined();
  });
});

describe('El limite de codigos de libro cuenta FALLOS, no intentos', () => {
  it('un codigo correcto se comprueba pero no gasta cupo', async () => {
    // Es lo que permite que treinta alumnos con sus codigos impresos se
    // registren seguidos: no estan fallando, estan acertando.
    const { usecase, rateLimiter } = montar(true);

    await usecase.execute(alta(), contexto());

    expect(rateLimiter.peeked.some((k) => k.startsWith('activation:failed:ip:'))).toBe(true);
    expect(rateLimiter.consumed.some((k) => k.startsWith('activation:failed:ip:'))).toBe(false);
  });

  it('un codigo incorrecto SI gasta cupo', async () => {
    const { usecase, rateLimiter } = montar(false);

    await expect(usecase.execute(alta(), contexto())).rejects.toThrow();

    expect(rateLimiter.consumed.some((k) => k.startsWith('activation:failed:ip:'))).toBe(true);
  });

  it('agotados los fallos, ya no se admite ni un codigo bueno', async () => {
    // Si al llegar al tope se dejara pasar el acierto, quien recorre el espacio
    // de claves solo tendria que seguir probando: el bloqueo no serviria de nada
    // justo en el caso que existe para cortar.
    const { usecase, rateLimiter } = montar(true);
    rateLimiter.blockKeys.add('activation:failed:ip:');

    await expect(usecase.execute(alta(), contexto())).rejects.toThrow(RateLimitError);
  });
});
