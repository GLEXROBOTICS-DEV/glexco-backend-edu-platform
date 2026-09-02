import { beforeEach, describe, expect, it } from 'vitest';
import { RateLimitError, UnauthorizedError, ForbiddenError } from '@glexco/kernel';
import { ROLES } from '@glexco/contracts';
import { LoginUseCase } from '../src/application/login.usecase';
import { RefreshSessionUseCase } from '../src/application/refresh-session.usecase';
import { User } from '../src/domain/user/user.aggregate';
import {
  BirthDate,
  Email,
  LocalePreference,
  PasswordHash,
  PersonName,
  UserId,
} from '../src/domain/user/value-objects';
import type { ExecutionContext } from '@glexco/kernel';
import {
  FakeAuditLog,
  FakeClock,
  FakePasswordHasher,
  FakeRateLimiter,
  FakeSessionStore,
  FakeTokenIssuer,
  FakeUnitOfWork,
  FakeUserRepository,
  silentLogger,
} from './fakes';

const CONTEXT: ExecutionContext = {
  correlationId: '00000000-0000-4000-8000-00000000abcd',
  locale: 'es',
  requestedAt: new Date('2026-09-02T12:00:00Z'),
  ipAddress: '190.12.34.56',
  userAgent: 'Mozilla/5.0 (aula)',
};

describe('LoginUseCase', () => {
  let users: FakeUserRepository;
  let sessions: FakeSessionStore;
  let unitOfWork: FakeUnitOfWork;
  let hasher: FakePasswordHasher;
  let tokens: FakeTokenIssuer;
  let rateLimiter: FakeRateLimiter;
  let audit: FakeAuditLog;
  let clock: FakeClock;
  let login: LoginUseCase;

  const PASSWORD = 'robotica-2026';

  async function seedStudent(overrides: { age?: number } = {}): Promise<User> {
    const passwordHash = PasswordHash.fromHash(await hasher.hash(PASSWORD));
    const age = overrides.age ?? 16;

    const birthDate = BirthDate.create(`${2026 - age}-01-15`);

    const user = User.registerStudent({
      id: UserId.create(),
      email: Email.create('carlos@colegio.pe'),
      name: PersonName.create('Carlos', 'Salazar'),
      birthDate,
      passwordHash,
      locale: LocalePreference.create('es'),
      accountType: 'independent',
      // El dominio exige apoderado por debajo de los 14, asi que el fixture lo
      // aporta cuando toca. Es la regla funcionando, no un obstaculo de prueba.
      ...(birthDate.requiresGuardian(clock.now())
        ? { guardianEmail: Email.create('madre@familia.pe') }
        : {}),
      now: clock.now(),
    });
    user.verifyEmail(clock.now());
    user.pullDomainEvents();
    users.seed(user);
    return user;
  }

  beforeEach(() => {
    users = new FakeUserRepository();
    sessions = new FakeSessionStore();
    unitOfWork = new FakeUnitOfWork();
    hasher = new FakePasswordHasher();
    tokens = new FakeTokenIssuer();
    rateLimiter = new FakeRateLimiter();
    audit = new FakeAuditLog();
    clock = new FakeClock();

    login = new LoginUseCase(
      users,
      sessions,
      unitOfWork,
      hasher,
      tokens,
      rateLimiter as never,
      audit,
      clock,
      silentLogger,
    );
  });

  it('autentica y abre una sesion', async () => {
    const user = await seedStudent();

    const result = await login.execute(
      { email: 'carlos@colegio.pe', password: PASSWORD, rememberMe: false, locale: 'es' },
      CONTEXT,
    );

    expect(result.auth.user.id).toBe(user.id.value);
    expect(result.auth.tokenType).toBe('Bearer');
    expect(result.refreshToken).toMatch(/^refresh\./);
    expect(sessions.sessions.size).toBe(1);
  });

  it('lleva los permisos resueltos dentro del resultado', async () => {
    // Es lo que permite que ningun otro servicio tenga que preguntar a identidad
    // en cada peticion.
    await seedStudent();

    const result = await login.execute(
      { email: 'carlos@colegio.pe', password: PASSWORD, rememberMe: false, locale: 'es' },
      CONTEXT,
    );

    expect(result.auth.user.roles).toEqual([ROLES.STUDENT]);
    expect(result.auth.user.permissions).toContain('content:read');
  });

  it('manda a un alumno de 10 anos al portal Discover y a uno de 16 a Academy', async () => {
    await seedStudent({ age: 10 });
    const discover = await login.execute(
      { email: 'carlos@colegio.pe', password: PASSWORD, rememberMe: false, locale: 'es' },
      CONTEXT,
    );
    expect(discover.auth.user.portal).toBe('discover');

    users = new FakeUserRepository();
    login = new LoginUseCase(
      users,
      sessions,
      unitOfWork,
      hasher,
      tokens,
      rateLimiter as never,
      audit,
      clock,
      silentLogger,
    );
    await seedStudent({ age: 16 });
    const academy = await login.execute(
      { email: 'carlos@colegio.pe', password: PASSWORD, rememberMe: false, locale: 'es' },
      CONTEXT,
    );
    expect(academy.auth.user.portal).toBe('academy');
  });

  it('devuelve el MISMO error si el usuario no existe o si la contrasena es incorrecta', async () => {
    // Distinguirlos permitiria enumerar que correos estan registrados, y aqui
    // son correos de menores identificables por su institucion.
    await seedStudent();

    const noSuchUser = await login
      .execute(
        { email: 'nadie@colegio.pe', password: PASSWORD, rememberMe: false, locale: 'es' },
        CONTEXT,
      )
      .catch((error) => error as UnauthorizedError);

    const wrongPassword = await login
      .execute(
        { email: 'carlos@colegio.pe', password: 'incorrecta', rememberMe: false, locale: 'es' },
        CONTEXT,
      )
      .catch((error) => error as UnauthorizedError);

    expect(noSuchUser.code).toBe('INVALID_CREDENTIALS');
    expect(wrongPassword.code).toBe('INVALID_CREDENTIALS');
    expect(noSuchUser.message).toBe(wrongPassword.message);
  });

  it('gasta una verificacion de hash aunque el usuario no exista', async () => {
    // Sin esto, "no existe" responderia en microsegundos y "contrasena
    // incorrecta" en decenas de milisegundos: esa diferencia es el oraculo.
    const before = hasher.verifyCalls;

    await login
      .execute(
        { email: 'nadie@colegio.pe', password: 'loquesea', rememberMe: false, locale: 'es' },
        CONTEXT,
      )
      .catch(() => undefined);

    expect(hasher.verifyCalls).toBeGreaterThan(before);
  });

  it('persiste el contador de fallos aunque el inicio de sesion falle', async () => {
    const user = await seedStudent();

    await login
      .execute(
        { email: 'carlos@colegio.pe', password: 'incorrecta', rememberMe: false, locale: 'es' },
        CONTEXT,
      )
      .catch(() => undefined);

    const stored = await users.findById(user.id);
    expect(stored!.failedLoginAttempts).toBe(1);
  });

  it('bloquea la cuenta tras superar el umbral de fallos', async () => {
    await seedStudent();

    for (let i = 0; i < 6; i += 1) {
      await login
        .execute(
          { email: 'carlos@colegio.pe', password: 'incorrecta', rememberMe: false, locale: 'es' },
          CONTEXT,
        )
        .catch(() => undefined);
    }

    // Con la contrasena CORRECTA sigue bloqueada: es lo que frena la fuerza
    // bruta que acierta al final.
    const error = await login
      .execute(
        { email: 'carlos@colegio.pe', password: PASSWORD, rememberMe: false, locale: 'es' },
        CONTEXT,
      )
      .catch((caught) => caught as { code: string });

    expect(error.code).toBe('ACCOUNT_TEMPORARILY_LOCKED');
  });

  it('el bloqueo es temporal: pasado el tiempo, la contrasena correcta funciona', async () => {
    await seedStudent();
    for (let i = 0; i < 6; i += 1) {
      await login
        .execute(
          { email: 'carlos@colegio.pe', password: 'incorrecta', rememberMe: false, locale: 'es' },
          CONTEXT,
        )
        .catch(() => undefined);
    }

    // Un bloqueo permanente convertiria el ataque en una denegacion de servicio
    // contra el usuario legitimo.
    clock.advance(2 * 60_000);

    const result = await login.execute(
      { email: 'carlos@colegio.pe', password: PASSWORD, rememberMe: false, locale: 'es' },
      CONTEXT,
    );
    expect(result.auth.user.email).toBe('carlos@colegio.pe');
  });

  it('aplica limite por IP y por cuenta', async () => {
    await seedStudent();

    await login.execute(
      { email: 'carlos@colegio.pe', password: PASSWORD, rememberMe: false, locale: 'es' },
      CONTEXT,
    );

    expect(rateLimiter.consumed.some((key) => key.startsWith('login:ip:'))).toBe(true);
    // El limite por cuenta es el que frena el rociado de contrasenas, que
    // reparte los intentos entre muchas IPs para esquivar el limite por IP.
    expect(rateLimiter.consumed.some((key) => key.startsWith('login:account:'))).toBe(true);
  });

  it('rechaza con 429 cuando el limitador bloquea', async () => {
    await seedStudent();
    rateLimiter.blockKeys.add('login:ip:');

    await expect(
      login.execute(
        { email: 'carlos@colegio.pe', password: PASSWORD, rememberMe: false, locale: 'es' },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it('rechaza una cuenta desactivada', async () => {
    const user = await seedStudent();
    user.deactivate('baja del colegio', 'admin-1', clock.now());
    await users.save(user);

    await expect(
      login.execute(
        { email: 'carlos@colegio.pe', password: PASSWORD, rememberMe: false, locale: 'es' },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rehashea de forma transparente si el hash quedo obsoleto', async () => {
    const user = await seedStudent();
    hasher.staleHashes.add(user.passwordHash.value);
    const hashesBefore = hasher.hashCalls;

    await login.execute(
      { email: 'carlos@colegio.pe', password: PASSWORD, rememberMe: false, locale: 'es' },
      CONTEXT,
    );

    // Es la unica forma de endurecer el hash de toda la base sin pedir a nadie
    // que cambie su contrasena.
    expect(hasher.hashCalls).toBe(hashesBefore + 1);
  });

  it('registra en auditoria tanto el exito como el fallo', async () => {
    await seedStudent();

    await login.execute(
      { email: 'carlos@colegio.pe', password: PASSWORD, rememberMe: false, locale: 'es' },
      CONTEXT,
    );
    await login
      .execute(
        { email: 'carlos@colegio.pe', password: 'incorrecta', rememberMe: false, locale: 'es' },
        CONTEXT,
      )
      .catch(() => undefined);

    expect(audit.find('auth.login', 'success')).toHaveLength(1);
    expect(audit.find('auth.login', 'failure')).toHaveLength(1);
  });
});

describe('RefreshSessionUseCase — deteccion de reutilizacion', () => {
  let users: FakeUserRepository;
  let sessions: FakeSessionStore;
  let tokens: FakeTokenIssuer;
  let audit: FakeAuditLog;
  let clock: FakeClock;
  let hasher: FakePasswordHasher;
  let login: LoginUseCase;
  let refresh: RefreshSessionUseCase;

  const PASSWORD = 'robotica-2026';

  beforeEach(async () => {
    users = new FakeUserRepository();
    sessions = new FakeSessionStore();
    tokens = new FakeTokenIssuer();
    audit = new FakeAuditLog();
    clock = new FakeClock();
    hasher = new FakePasswordHasher();

    login = new LoginUseCase(
      users,
      sessions,
      new FakeUnitOfWork(),
      hasher,
      tokens,
      new FakeRateLimiter() as never,
      audit,
      clock,
      silentLogger,
    );
    refresh = new RefreshSessionUseCase(users, sessions, tokens, audit, clock, silentLogger);

    const user = User.registerStudent({
      id: UserId.create(),
      email: Email.create('carlos@colegio.pe'),
      name: PersonName.create('Carlos', 'Salazar'),
      birthDate: BirthDate.create('2010-01-15'),
      passwordHash: PasswordHash.fromHash(await hasher.hash(PASSWORD)),
      locale: LocalePreference.create('es'),
      accountType: 'independent',
      now: clock.now(),
    });
    user.verifyEmail(clock.now());
    user.pullDomainEvents();
    users.seed(user);
  });

  async function signIn() {
    return login.execute(
      { email: 'carlos@colegio.pe', password: PASSWORD, rememberMe: false, locale: 'es' },
      CONTEXT,
    );
  }

  it('rota el refresh token y emite uno nuevo', async () => {
    const session = await signIn();

    const renewed = await refresh.execute({ refreshToken: session.refreshToken }, CONTEXT);

    expect(renewed.refreshToken).not.toBe(session.refreshToken);
    expect(renewed.auth.accessToken).toBeTruthy();
  });

  it('REVOCA LA FAMILIA si se reutiliza un refresh token ya rotado', async () => {
    // Es la senal de robo de token que define OAuth 2.1: un token ya usado solo
    // puede llegar si alguien lo copio.
    const session = await signIn();
    await refresh.execute({ refreshToken: session.refreshToken }, CONTEXT);

    const error = await refresh
      .execute({ refreshToken: session.refreshToken }, CONTEXT)
      .catch((caught) => caught as { code: string });

    expect(error.code).toBe('SESSION_COMPROMISED');
    expect(sessions.revokedFamilies).toHaveLength(1);
    // El atacante y el usuario legitimo quedan ambos fuera: es incomodo, pero la
    // alternativa deja viva una sesion robada durante semanas.
    expect(sessions.sessions.size).toBe(0);
    expect(audit.find('auth.refresh_reuse_detected', 'failure')).toHaveLength(1);
  });

  it('recarga roles y permisos en cada refresco', async () => {
    const session = await signIn();
    const user = (await users.findByEmailForAuth(Email.create('carlos@colegio.pe')))!;

    user.grantRole(ROLES.TEACHER, { userId: 'admin', roles: [ROLES.PLATFORM_OWNER] }, clock.now());
    await users.save(user);

    const renewed = await refresh.execute({ refreshToken: session.refreshToken }, CONTEXT);

    // Un cambio de rol se propaga como maximo en el tiempo de vida del access
    // token, sin que ningun servicio tenga que consultar a identidad.
    expect(renewed.auth.user.roles).toContain(ROLES.TEACHER);
    expect(renewed.auth.user.portal).toBe('teacher');
  });

  it('cierra la sesion si la cuenta fue desactivada entre refrescos', async () => {
    const session = await signIn();
    const user = (await users.findByEmailForAuth(Email.create('carlos@colegio.pe')))!;
    user.deactivate('baja', 'admin', clock.now());
    await users.save(user);

    await expect(refresh.execute({ refreshToken: session.refreshToken }, CONTEXT)).rejects.toThrow();
    expect(sessions.sessions.size).toBe(0);
  });

  it('rechaza un token que no emitimos', async () => {
    const error = await refresh
      .execute({ refreshToken: 'refresh.inventado' }, CONTEXT)
      .catch((caught) => caught as { code: string });

    expect(error.code).toBe('SESSION_EXPIRED');
  });
});
