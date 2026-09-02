import { beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError, UnauthorizedError, type ExecutionContext } from '@glexco/kernel';
import { PERMISSIONS, ROLES, resolvePermissions } from '@glexco/contracts';
import { ChangePasswordUseCase } from '../src/application/change-password.usecase';
import { CreateStaffUserUseCase } from '../src/application/create-staff-user.usecase';
import {
  ListSessionsUseCase,
  RevokeSessionUseCase,
} from '../src/application/manage-sessions.usecase';
import { User } from '../src/domain/user/user.aggregate';
import {
  BirthDate,
  Email,
  LocalePreference,
  PasswordHash,
  PersonName,
  UserId,
} from '../src/domain/user/value-objects';
import type { Session } from '../src/domain/session/session';
import {
  FakeAuditLog,
  FakeClock,
  FakePasswordHasher,
  FakeSessionStore,
  FakeUnitOfWork,
  FakeUserRepository,
  PermissivePasswordPolicy,
  silentLogger,
} from './fakes';

const INSTITUTION_A = '11111111-1111-4111-8111-111111111111';
const INSTITUTION_B = '22222222-2222-4222-8222-222222222222';

/**
 * Puerta a instituciones, en memoria.
 *
 * Por defecto acepta cualquier institucion, para no obligar a cada prueba a
 * declararla. Las pruebas que comprueban el rechazo la configuran de forma
 * explicita.
 */
class FakeInstitutionGateway {
  known = new Map<string, { exists: boolean; acceptsNewMembers: boolean; status?: string }>();
  defaultAnswer = { exists: true, acceptsNewMembers: true };

  async summary(institutionId: string) {
    return this.known.get(institutionId) ?? this.defaultAnswer;
  }
}

/** Almacen de tokens de un solo uso, en memoria. */
class FakeOneTimeTokenStore {
  readonly issued: Array<{ purpose: string; userId: string; token: string }> = [];
  readonly invalidated: Array<{ purpose: string; userId: string }> = [];

  async issue(input: { purpose: string; userId: string }): Promise<{ token: string }> {
    const token = `tok_${input.purpose}_${this.issued.length}`;
    this.issued.push({ purpose: input.purpose, userId: input.userId, token });
    return { token };
  }
  async consume(purpose: string, token: string): Promise<{ userId: string } | null> {
    const found = this.issued.find((item) => item.purpose === purpose && item.token === token);
    return found ? { userId: found.userId } : null;
  }
  async invalidateAll(purpose: string, userId: string): Promise<void> {
    this.invalidated.push({ purpose, userId });
  }
}

function contextFor(actor: {
  userId: string;
  roles: string[];
  institutionId?: string;
  sessionId?: string;
}): ExecutionContext {
  return {
    correlationId: '00000000-0000-4000-8000-00000000abcd',
    locale: 'es',
    requestedAt: new Date('2026-09-02T12:00:00Z'),
    ipAddress: '190.12.34.56',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/131',
    actor: {
      userId: actor.userId,
      roles: actor.roles,
      institutionId: actor.institutionId,
      permissions: resolvePermissions(actor.roles as never),
      sessionId: actor.sessionId ?? 'session-1',
    },
  };
}

describe('ChangePasswordUseCase', () => {
  let users: FakeUserRepository;
  let sessions: FakeSessionStore;
  let tokens: FakeOneTimeTokenStore;
  let hasher: FakePasswordHasher;
  let audit: FakeAuditLog;
  let clock: FakeClock;
  let changePassword: ChangePasswordUseCase;
  let user: User;

  const CURRENT = 'robotica-2026';

  beforeEach(async () => {
    users = new FakeUserRepository();
    sessions = new FakeSessionStore();
    tokens = new FakeOneTimeTokenStore();
    hasher = new FakePasswordHasher();
    audit = new FakeAuditLog();
    clock = new FakeClock();

    changePassword = new ChangePasswordUseCase(
      users,
      sessions,
      tokens as never,
      new FakeUnitOfWork(),
      hasher,
      new PermissivePasswordPolicy(),
      audit,
      clock,
    );

    user = User.registerStudent({
      id: UserId.create(),
      email: Email.create('carlos@colegio.pe'),
      name: PersonName.create('Carlos', 'Salazar'),
      birthDate: BirthDate.create('2008-01-15'),
      passwordHash: PasswordHash.fromHash(await hasher.hash(CURRENT)),
      locale: LocalePreference.create('es'),
      accountType: 'independent',
      now: clock.now(),
    });
    user.pullDomainEvents();
    users.seed(user);

    // Tres sesiones abiertas: el movil (la actual) y dos equipos del colegio.
    for (const id of ['session-1', 'session-2', 'session-3']) {
      await sessions.create({
        id,
        userId: user.id.value,
        familyId: `fam-${id}`,
        currentTokenId: `tok-${id}`,
        generation: 0,
        createdAt: clock.now().toISOString(),
        lastUsedAt: clock.now().toISOString(),
        expiresAt: new Date(clock.now().getTime() + 86_400_000).toISOString(),
        critical: false,
      } satisfies Session);
    }
  });

  it('cambia la contrasena con la actual correcta', async () => {
    await changePassword.execute(
      { currentPassword: CURRENT, newPassword: 'nueva-clave-2026', keepCurrentSession: true },
      contextFor({ userId: user.id.value, roles: [ROLES.STUDENT] }),
    );

    const stored = await users.findById(user.id);
    expect(await hasher.verify('nueva-clave-2026', stored!.passwordHash.value)).toBe(true);
  });

  it('EXIGE la contrasena actual aunque la sesion este autenticada', async () => {
    // Sin esto, quien se siente ante una sesion abierta en el laboratorio podria
    // cambiar la contrasena y quedarse con la cuenta.
    await expect(
      changePassword.execute(
        { currentPassword: 'incorrecta', newPassword: 'nueva-clave-2026' },
        contextFor({ userId: user.id.value, roles: [ROLES.STUDENT] }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    const stored = await users.findById(user.id);
    expect(await hasher.verify(CURRENT, stored!.passwordHash.value)).toBe(true);
  });

  it('un intento con contrasena actual incorrecta cuenta para el bloqueo', async () => {
    await changePassword
      .execute(
        { currentPassword: 'incorrecta', newPassword: 'nueva-clave-2026' },
        contextFor({ userId: user.id.value, roles: [ROLES.STUDENT] }),
      )
      .catch(() => undefined);

    const stored = await users.findById(user.id);
    expect(stored!.failedLoginAttempts).toBe(1);
  });

  it('conserva la sesion actual y cierra las demas', async () => {
    await changePassword.execute(
      { currentPassword: CURRENT, newPassword: 'nueva-clave-2026', keepCurrentSession: true },
      contextFor({ userId: user.id.value, roles: [ROLES.STUDENT], sessionId: 'session-1' }),
    );

    expect(sessions.sessions.has('session-1')).toBe(true);
    expect(sessions.sessions.has('session-2')).toBe(false);
    expect(sessions.sessions.has('session-3')).toBe(false);
  });

  it('cierra TODAS las sesiones si no se pide conservar la actual', async () => {
    await changePassword.execute(
      { currentPassword: CURRENT, newPassword: 'nueva-clave-2026', keepCurrentSession: false },
      contextFor({ userId: user.id.value, roles: [ROLES.STUDENT], sessionId: 'session-1' }),
    );

    expect(sessions.sessions.size).toBe(0);
  });

  it('invalida los enlaces de recuperacion pendientes', async () => {
    // Si alguien pidio un restablecimiento antes, ese enlace no debe seguir vivo
    // despues de que el usuario cambie su contrasena.
    await changePassword.execute(
      { currentPassword: CURRENT, newPassword: 'nueva-clave-2026' },
      contextFor({ userId: user.id.value, roles: [ROLES.STUDENT] }),
    );

    expect(tokens.invalidated).toContainEqual({
      purpose: 'password_reset',
      userId: user.id.value,
    });
  });

  it('rechaza si no hay actor autenticado', async () => {
    await expect(
      changePassword.execute(
        { currentPassword: CURRENT, newPassword: 'nueva-clave-2026' },
        { ...contextFor({ userId: 'x', roles: [] }), actor: undefined },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('CreateStaffUserUseCase — aislamiento entre instituciones', () => {
  let users: FakeUserRepository;
  let hasher: FakePasswordHasher;
  let tokens: FakeOneTimeTokenStore;
  let audit: FakeAuditLog;
  let institutions: FakeInstitutionGateway;
  let createStaff: CreateStaffUserUseCase;

  const NEW_TEACHER = {
    email: 'ana.quispe@colegio.pe',
    firstName: 'Ana',
    lastName: 'Quispe',
    role: ROLES.TEACHER,
  } as const;

  beforeEach(() => {
    users = new FakeUserRepository();
    hasher = new FakePasswordHasher();
    tokens = new FakeOneTimeTokenStore();
    audit = new FakeAuditLog();

    institutions = new FakeInstitutionGateway();

    createStaff = new CreateStaffUserUseCase(
      users,
      new FakeUnitOfWork(),
      hasher,
      tokens as never,
      institutions,
      audit,
      new FakeClock(),
      silentLogger,
    );
  });

  it('un administrador de institucion crea docentes en SU colegio', async () => {
    const result = await createStaff.execute(
      NEW_TEACHER,
      contextFor({
        userId: 'admin-a',
        roles: [ROLES.INSTITUTION_ADMIN],
        institutionId: INSTITUTION_A,
      }),
    );

    expect(result.role).toBe(ROLES.TEACHER);
    expect(result.temporaryPassword).toHaveLength(32);

    const created = await users.findByEmailForAuth(Email.create(NEW_TEACHER.email));
    expect(created!.institutionId).toBe(INSTITUTION_A);
    // Nace obligado a cambiar la contrasena: la temporal la conoce quien la creo.
    expect(created!.mustChangePassword).toBe(true);
  });

  it('BLOQUEA crear un docente en OTRA institucion', async () => {
    // Es la fuga entre colegios que el control de ambito existe para impedir.
    await expect(
      createStaff.execute(
        { ...NEW_TEACHER, institutionId: INSTITUTION_B },
        contextFor({
          userId: 'admin-a',
          roles: [ROLES.INSTITUTION_ADMIN],
          institutionId: INSTITUTION_A,
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('IGNORA el institutionId del cuerpo y usa el del token', async () => {
    // Aunque coincida, el servidor no debe confiar en el campo del cuerpo.
    await createStaff.execute(
      { ...NEW_TEACHER, institutionId: INSTITUTION_A },
      contextFor({
        userId: 'admin-a',
        roles: [ROLES.INSTITUTION_ADMIN],
        institutionId: INSTITUTION_A,
      }),
    );

    const created = await users.findByEmailForAuth(Email.create(NEW_TEACHER.email));
    expect(created!.institutionId).toBe(INSTITUTION_A);
  });

  it('BLOQUEA que un administrador de institucion cree un platform_admin', async () => {
    await expect(
      createStaff.execute(
        { ...NEW_TEACHER, role: ROLES.PLATFORM_ADMIN },
        contextFor({
          userId: 'admin-a',
          roles: [ROLES.INSTITUTION_ADMIN],
          institutionId: INSTITUTION_A,
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('solo GLEXCO puede crear administradores de institucion', async () => {
    const platformAdminContext = contextFor({
      userId: 'glexco-1',
      roles: [ROLES.PLATFORM_ADMIN],
    });
    expect(platformAdminContext.actor!.permissions).toContain(
      PERMISSIONS.INSTITUTION_ADMIN_CREATE,
    );

    const result = await createStaff.execute(
      {
        email: 'director@colegio.pe',
        firstName: 'Sofia',
        lastName: 'Rojas',
        role: ROLES.INSTITUTION_ADMIN,
        institutionId: INSTITUTION_B,
      },
      platformAdminContext,
    );

    expect(result.role).toBe(ROLES.INSTITUTION_ADMIN);
    const created = await users.findByEmailForAuth(Email.create('director@colegio.pe'));
    expect(created!.institutionId).toBe(INSTITUTION_B);
  });

  it('rechaza a un actor sin institucion y sin ambito de plataforma', async () => {
    await expect(
      createStaff.execute(
        NEW_TEACHER,
        contextFor({ userId: 'huerfano', roles: [ROLES.INSTITUTION_ADMIN] }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('RECHAZA una institucion que no existe', async () => {
    // Sin esta comprobacion, un identificador mal tecleado crearia un
    // administrador con permisos sobre una institucion inexistente: el alta no
    // fallaria y el problema aparecería despues, de forma confusa.
    institutions.known.set(INSTITUTION_B, { exists: false, acceptsNewMembers: false });

    await expect(
      createStaff.execute(
        {
          email: 'director@colegio.pe',
          firstName: 'Sofia',
          lastName: 'Rojas',
          role: ROLES.INSTITUTION_ADMIN,
          institutionId: INSTITUTION_B,
        },
        contextFor({ userId: 'glexco-1', roles: [ROLES.PLATFORM_ADMIN] }),
      ),
    ).rejects.toMatchObject({ code: 'INSTITUTION_NOT_FOUND' });
  });

  it('RECHAZA una institucion suspendida', async () => {
    // Existe, pero no admite altas nuevas. Los usuarios que ya tiene conservan su
    // acceso: suspender es una medida contra la institucion, no contra sus alumnos.
    institutions.known.set(INSTITUTION_A, {
      exists: true,
      acceptsNewMembers: false,
      status: 'suspended',
    });

    await expect(
      createStaff.execute(
        NEW_TEACHER,
        contextFor({
          userId: 'admin-a',
          roles: [ROLES.INSTITUTION_ADMIN],
          institutionId: INSTITUTION_A,
        }),
      ),
    ).rejects.toMatchObject({ code: 'INSTITUTION_NOT_ACCEPTING_MEMBERS' });
  });

  it('no consulta al servicio de instituciones para el personal GLEXCO', async () => {
    // Un empleado de GLEXCO no pertenece a ninguna institucion, asi que no hay
    // nada que comprobar y no debe gastarse una llamada de red.
    institutions.known.set('', { exists: false, acceptsNewMembers: false });

    const result = await createStaff.execute(
      {
        email: 'soporte@glexco.pe',
        firstName: 'Luis',
        lastName: 'Mendoza',
        role: ROLES.SUPPORT_AGENT,
      },
      contextFor({ userId: 'owner', roles: [ROLES.PLATFORM_OWNER] }),
    );

    expect(result.role).toBe(ROLES.SUPPORT_AGENT);
  });

  it('rechaza un correo ya registrado', async () => {
    const context = contextFor({
      userId: 'admin-a',
      roles: [ROLES.INSTITUTION_ADMIN],
      institutionId: INSTITUTION_A,
    });
    await createStaff.execute(NEW_TEACHER, context);

    await expect(createStaff.execute(NEW_TEACHER, context)).rejects.toThrow();
  });

  it('emite token de verificacion y deja rastro en auditoria', async () => {
    await createStaff.execute(
      NEW_TEACHER,
      contextFor({
        userId: 'admin-a',
        roles: [ROLES.INSTITUTION_ADMIN],
        institutionId: INSTITUTION_A,
      }),
    );

    expect(tokens.issued.some((item) => item.purpose === 'email_verification')).toBe(true);
    expect(audit.find('user.create_staff', 'success')).toHaveLength(1);
  });
});

describe('Gestion de sesiones', () => {
  let sessions: FakeSessionStore;
  let list: ListSessionsUseCase;
  let revoke: RevokeSessionUseCase;

  const USER = '33333333-3333-4333-8333-333333333333';
  const OTHER_USER = '44444444-4444-4444-8444-444444444444';

  beforeEach(async () => {
    sessions = new FakeSessionStore();
    list = new ListSessionsUseCase(sessions);
    revoke = new RevokeSessionUseCase(sessions, new FakeAuditLog());

    const base = {
      familyId: 'fam',
      currentTokenId: 'tok',
      generation: 0,
      createdAt: '2026-09-01T10:00:00Z',
      expiresAt: '2026-10-01T10:00:00Z',
      critical: false,
    };

    await sessions.create({
      ...base,
      id: 'session-1',
      userId: USER,
      lastUsedAt: '2026-09-02T12:00:00Z',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/131',
    } as Session);
    await sessions.create({
      ...base,
      id: 'session-2',
      userId: USER,
      lastUsedAt: '2026-09-01T18:00:00Z',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604',
    } as Session);
    await sessions.create({
      ...base,
      id: 'ajena',
      userId: OTHER_USER,
      lastUsedAt: '2026-09-02T09:00:00Z',
    } as Session);
  });

  it('lista solo las sesiones propias, la mas reciente primero', async () => {
    const result = await list.execute(
      undefined,
      contextFor({ userId: USER, roles: [ROLES.STUDENT], sessionId: 'session-1' }),
    );

    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe('session-1');
    expect(result.map((session) => session.id)).not.toContain('ajena');
  });

  it('marca cual es la sesion actual', async () => {
    const result = await list.execute(
      undefined,
      contextFor({ userId: USER, roles: [ROLES.STUDENT], sessionId: 'session-2' }),
    );

    expect(result.find((session) => session.id === 'session-2')!.current).toBe(true);
    expect(result.find((session) => session.id === 'session-1')!.current).toBe(false);
  });

  it('describe el dispositivo de forma reconocible', async () => {
    const result = await list.execute(
      undefined,
      contextFor({ userId: USER, roles: [ROLES.STUDENT], sessionId: 'session-1' }),
    );

    expect(result.find((session) => session.id === 'session-1')!.device).toBe('Windows · Chrome');
    expect(result.find((session) => session.id === 'session-2')!.device).toBe('iOS · Safari');
  });

  it('cierra las demas sesiones pero NUNCA la actual', async () => {
    // Quien pulsa "cerrar las demas sesiones" no espera quedar fuera.
    const result = await revoke.execute(
      {},
      contextFor({ userId: USER, roles: [ROLES.STUDENT], sessionId: 'session-1' }),
    );

    expect(result.revoked).toBe(1);
    expect(sessions.sessions.has('session-1')).toBe(true);
    expect(sessions.sessions.has('session-2')).toBe(false);
  });

  it('IMPIDE cerrar la sesion de otro usuario', async () => {
    // Sin esta comprobacion, conocer un id de sesion bastaria para expulsar a
    // cualquiera de la plataforma.
    await expect(
      revoke.execute(
        { sessionId: 'ajena' },
        contextFor({ userId: USER, roles: [ROLES.STUDENT], sessionId: 'session-1' }),
      ),
    ).rejects.toThrow();

    expect(sessions.sessions.has('ajena')).toBe(true);
  });

  it('devuelve el mismo error para una sesion inexistente y una ajena', async () => {
    const context = contextFor({
      userId: USER,
      roles: [ROLES.STUDENT],
      sessionId: 'session-1',
    });

    const missing = await revoke
      .execute({ sessionId: 'no-existe' }, context)
      .catch((error) => error as { code: string });
    const foreign = await revoke
      .execute({ sessionId: 'ajena' }, context)
      .catch((error) => error as { code: string });

    // Distinguirlos permitiria averiguar que ids de sesion son reales.
    expect(missing.code).toBe(foreign.code);
  });
});
