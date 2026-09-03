import { Module, type MiddlewareConsumer, type NestModule, type OnApplicationShutdown } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import type { Clock, PasswordHasher, UnitOfWork } from '@glexco/kernel';
import {
  CorrelationMiddleware,
  DB_READ_POOL,
  DB_WRITE_POOL,
  HealthController,
  JWT_VERIFY_OPTIONS,
  JwtAuthGuard,
  PermissionsGuard,
  PgUnitOfWork,
  RATE_LIMITS,
  RateLimiter,
  REDIS_CLIENT,
  RedisCacheStore,
  RedisDistributedLock,
  createReadPool,
  createRedisClient,
  createWritePool,
} from '@glexco/nest-platform';
import { createLogger, toLoggerPort, type Logger } from '@glexco/observability';

import { loadIdentityConfig, type IdentityConfig } from './config';
import {
  CONFIG,
  LOGGER,
  LOGGER_PORT,
  CLOCK,
  USER_REPOSITORY,
  SESSION_STORE,
  ONE_TIME_TOKENS,
  AUDIT_LOG,
  PASSWORD_HASHER,
  PASSWORD_POLICY,
  TOKEN_ISSUER,
  ACTIVATION_CODE_GATEWAY,
  CLASSROOM_GATEWAY,
  INSTITUTION_GATEWAY,
  RATE_LIMITER,
  UNIT_OF_WORK,
  COOKIE_OPTIONS,
} from './tokens';
import { GetMyProfileUseCase } from './application/get-my-profile.usecase';
import { AuthController } from './interface/http/auth.controller';
import { AccountController, UsersController } from './interface/http/account.controller';
import { RegisterStudentUseCase } from './application/register-student.usecase';
import { LoginUseCase } from './application/login.usecase';
import { RefreshSessionUseCase } from './application/refresh-session.usecase';
import { LogoutUseCase } from './application/logout.usecase';
import { VerifyEmailUseCase } from './application/verify-email.usecase';
import {
  ConfirmPasswordResetUseCase,
  RequestPasswordResetUseCase,
} from './application/password-reset.usecase';
import { ChangePasswordUseCase } from './application/change-password.usecase';
import { CreateStaffUserUseCase } from './application/create-staff-user.usecase';
import {
  ListSessionsUseCase,
  RevokeSessionUseCase,
} from './application/manage-sessions.usecase';
import type { UserRepository } from './domain/user/user.repository';
import { PgUserRepository } from './infrastructure/persistence/pg-user.repository';
import { RedisSessionStore } from './infrastructure/persistence/redis-session.store';
import { PgOneTimeTokenStore } from './infrastructure/persistence/pg-one-time-token.store';
import { PgAuditLog } from './infrastructure/persistence/pg-audit-log';
import { Argon2PasswordHasher } from './infrastructure/security/password-hasher';
import { JwtTokenIssuer } from './infrastructure/security/jwt-token-issuer';
import { DefaultPasswordPolicy } from './infrastructure/security/password-policy';
import {
  HttpActivationCodeGateway,
  HttpClassroomGateway,
  HttpInstitutionGateway,
  InMemoryActivationCodeGateway,
  InMemoryClassroomGateway,
  InMemoryInstitutionGateway,
} from './infrastructure/gateways/service-gateways';

// Los tokens viven en ./tokens para que los controladores puedan importarlos
// sin crear un ciclo con este modulo. Se reexportan para no romper a quien ya
// los importaba de aqui.
export {
  CONFIG,
  LOGGER,
  LOGGER_PORT,
  CLOCK,
  USER_REPOSITORY,
  SESSION_STORE,
  ONE_TIME_TOKENS,
  AUDIT_LOG,
  PASSWORD_HASHER,
  PASSWORD_POLICY,
  TOKEN_ISSUER,
  ACTIVATION_CODE_GATEWAY,
  CLASSROOM_GATEWAY,
  INSTITUTION_GATEWAY,
  RATE_LIMITER,
  UNIT_OF_WORK,
  COOKIE_OPTIONS,
} from './tokens';

/**
 * Cableado del servicio de identidad.
 *
 * Todas las dependencias se declaran con simbolos y fabricas, no con clases
 * concretas inyectadas por tipo. Es lo que hace real la arquitectura hexagonal:
 * los casos de uso reciben interfaces y en una prueba se les pasa una
 * implementacion en memoria sin tocar Nest ni levantar Docker.
 */
@Module({
  controllers: [AuthController, AccountController, UsersController, HealthController],
  providers: [
    Reflector,

    { provide: CONFIG, useFactory: (): IdentityConfig => loadIdentityConfig() },

    {
      provide: LOGGER,
      useFactory: (config: IdentityConfig): Logger =>
        createLogger({
          serviceName: config.SERVICE_NAME,
          level: config.LOG_LEVEL,
          pretty: config.NODE_ENV === 'development',
        }),
      inject: [CONFIG],
    },

    {
      provide: LOGGER_PORT,
      useFactory: (logger: Logger) => toLoggerPort(logger),
      inject: [LOGGER],
    },

    // ---------------------------------------------------------------------
    // Infraestructura
    // ---------------------------------------------------------------------
    {
      provide: DB_WRITE_POOL,
      useFactory: (config: IdentityConfig, logger: Logger): Pool =>
        createWritePool({
          writeUrl: config.DATABASE_URL,
          poolMax: config.DB_POOL_MAX,
          idleTimeoutMs: config.DB_POOL_IDLE_TIMEOUT_MS,
          statementTimeoutMs: config.DB_STATEMENT_TIMEOUT_MS,
          applicationName: config.SERVICE_NAME,
          logger,
        }),
      inject: [CONFIG, LOGGER],
    },
    {
      provide: DB_READ_POOL,
      useFactory: (config: IdentityConfig, logger: Logger): Pool =>
        createReadPool({
          writeUrl: config.DATABASE_URL,
          readUrls: config.DATABASE_READ_URLS,
          poolMax: config.DB_POOL_MAX,
          idleTimeoutMs: config.DB_POOL_IDLE_TIMEOUT_MS,
          statementTimeoutMs: config.DB_STATEMENT_TIMEOUT_MS,
          applicationName: config.SERVICE_NAME,
          logger,
        }),
      inject: [CONFIG, LOGGER],
    },
    {
      provide: REDIS_CLIENT,
      useFactory: (config: IdentityConfig, logger: Logger): Redis =>
        createRedisClient(config.REDIS_URL, config.REDIS_KEY_PREFIX, logger),
      inject: [CONFIG, LOGGER],
    },

    {
      provide: UNIT_OF_WORK,
      useFactory: (pool: Pool, logger: Logger): UnitOfWork =>
        new PgUnitOfWork(pool, 'identity', logger),
      inject: [DB_WRITE_POOL, LOGGER],
    },

    {
      provide: RATE_LIMITER,
      useFactory: (redis: Redis): RateLimiter => new RateLimiter(redis),
      inject: [REDIS_CLIENT],
    },

    // ---------------------------------------------------------------------
    // Adaptadores de los puertos
    // ---------------------------------------------------------------------
    {
      provide: CLOCK,
      // Reloj inyectable: ninguna regla llama a `new Date()` directamente, para
      // poder probar caducidades y bloqueos sin esperar en tiempo real.
      useValue: { now: () => new Date(), timestamp: () => Date.now() } satisfies Clock,
    },

    {
      provide: USER_REPOSITORY,
      useFactory: (write: Pool, read: Pool) => new PgUserRepository(write, read),
      inject: [DB_WRITE_POOL, DB_READ_POOL],
    },
    {
      provide: SESSION_STORE,
      useFactory: (redis: Redis) => new RedisSessionStore(redis),
      inject: [REDIS_CLIENT],
    },
    {
      provide: ONE_TIME_TOKENS,
      useFactory: (write: Pool, read: Pool) => new PgOneTimeTokenStore(write, read),
      inject: [DB_WRITE_POOL, DB_READ_POOL],
    },
    {
      provide: AUDIT_LOG,
      useFactory: (pool: Pool, logger: Logger) => {
        const auditLog = new PgAuditLog(pool, logger);
        auditLog.start();
        return auditLog;
      },
      inject: [DB_WRITE_POOL, LOGGER],
    },

    {
      provide: PASSWORD_HASHER,
      useFactory: (config: IdentityConfig): PasswordHasher =>
        new Argon2PasswordHasher({
          algorithm: config.PASSWORD_HASHER,
          argon2: {
            memoryKiB: config.ARGON2_MEMORY_KIB,
            timeCost: config.ARGON2_TIME_COST,
            parallelism: config.ARGON2_PARALLELISM,
          },
          bcryptRounds: config.BCRYPT_ROUNDS,
        }),
      inject: [CONFIG],
    },
    {
      provide: PASSWORD_POLICY,
      useFactory: (read: Pool) => new DefaultPasswordPolicy(read),
      inject: [DB_READ_POOL],
    },
    {
      provide: TOKEN_ISSUER,
      useFactory: (config: IdentityConfig) =>
        new JwtTokenIssuer({
          accessSecret: config.JWT_ACCESS_SECRET,
          refreshSecret: config.JWT_REFRESH_SECRET,
          accessTtl: config.JWT_ACCESS_TTL,
          refreshTtl: config.JWT_REFRESH_TTL,
          shortRefreshTtl: config.JWT_REFRESH_TTL_SHORT,
          issuer: config.JWT_ISSUER,
          audience: config.JWT_AUDIENCE,
        }),
      inject: [CONFIG],
    },

    // Los adaptadores en memoria solo se usan fuera de produccion, y solo si
    // falta la URL del servicio real. `loadIdentityConfig` ya aborta el arranque
    // en produccion si esas URLs no estan, asi que no pueden colarse.
    {
      provide: ACTIVATION_CODE_GATEWAY,
      useFactory: (config: IdentityConfig, logger: Logger) =>
        config.CATALOG_URL && config.INTERNAL_SERVICE_TOKEN
          ? new HttpActivationCodeGateway(config.CATALOG_URL, config.INTERNAL_SERVICE_TOKEN, logger)
          : new InMemoryActivationCodeGateway(),
      inject: [CONFIG, LOGGER],
    },
    {
      provide: CLASSROOM_GATEWAY,
      useFactory: (config: IdentityConfig, logger: Logger) =>
        config.INSTITUTIONS_URL && config.INTERNAL_SERVICE_TOKEN
          ? new HttpClassroomGateway(config.INSTITUTIONS_URL, config.INTERNAL_SERVICE_TOKEN, logger)
          : new InMemoryClassroomGateway(),
      inject: [CONFIG, LOGGER],
    },
    {
      provide: INSTITUTION_GATEWAY,
      useFactory: (config: IdentityConfig, logger: Logger) =>
        config.INSTITUTIONS_URL && config.INTERNAL_SERVICE_TOKEN
          ? new HttpInstitutionGateway(
              config.INSTITUTIONS_URL,
              config.INTERNAL_SERVICE_TOKEN,
              logger,
            )
          : new InMemoryInstitutionGateway(),
      inject: [CONFIG, LOGGER],
    },

    // ---------------------------------------------------------------------
    // Casos de uso
    // ---------------------------------------------------------------------
    {
      provide: RegisterStudentUseCase,
      useFactory: (...args: ConstructorParameters<typeof RegisterStudentUseCase>) =>
        new RegisterStudentUseCase(...args),
      inject: [
        USER_REPOSITORY,
        UNIT_OF_WORK,
        PASSWORD_HASHER,
        PASSWORD_POLICY,
        ACTIVATION_CODE_GATEWAY,
        CLASSROOM_GATEWAY,
        ONE_TIME_TOKENS,
        RATE_LIMITER,
        AUDIT_LOG,
        CLOCK,
        LOGGER_PORT,
      ],
    },
    {
      provide: LoginUseCase,
      useFactory: (...args: ConstructorParameters<typeof LoginUseCase>) => new LoginUseCase(...args),
      inject: [
        USER_REPOSITORY,
        SESSION_STORE,
        UNIT_OF_WORK,
        PASSWORD_HASHER,
        TOKEN_ISSUER,
        RATE_LIMITER,
        AUDIT_LOG,
        CLOCK,
        LOGGER_PORT,
      ],
    },
    {
      provide: RefreshSessionUseCase,
      useFactory: (...args: ConstructorParameters<typeof RefreshSessionUseCase>) =>
        new RefreshSessionUseCase(...args),
      inject: [USER_REPOSITORY, SESSION_STORE, TOKEN_ISSUER, AUDIT_LOG, CLOCK, LOGGER_PORT],
    },
    {
      provide: LogoutUseCase,
      useFactory: (...args: ConstructorParameters<typeof LogoutUseCase>) =>
        new LogoutUseCase(...args),
      inject: [SESSION_STORE, TOKEN_ISSUER, AUDIT_LOG],
    },
    {
      provide: VerifyEmailUseCase,
      useFactory: (...args: ConstructorParameters<typeof VerifyEmailUseCase>) =>
        new VerifyEmailUseCase(...args),
      inject: [USER_REPOSITORY, ONE_TIME_TOKENS, UNIT_OF_WORK, AUDIT_LOG, CLOCK],
    },
    {
      provide: RequestPasswordResetUseCase,
      useFactory: (...args: ConstructorParameters<typeof RequestPasswordResetUseCase>) =>
        new RequestPasswordResetUseCase(...args),
      inject: [USER_REPOSITORY, ONE_TIME_TOKENS, RATE_LIMITER, AUDIT_LOG, LOGGER_PORT],
    },
    {
      provide: ConfirmPasswordResetUseCase,
      useFactory: (...args: ConstructorParameters<typeof ConfirmPasswordResetUseCase>) =>
        new ConfirmPasswordResetUseCase(...args),
      inject: [
        USER_REPOSITORY,
        SESSION_STORE,
        ONE_TIME_TOKENS,
        UNIT_OF_WORK,
        PASSWORD_HASHER,
        PASSWORD_POLICY,
        AUDIT_LOG,
        CLOCK,
      ],
    },

    {
      provide: ChangePasswordUseCase,
      useFactory: (...args: ConstructorParameters<typeof ChangePasswordUseCase>) =>
        new ChangePasswordUseCase(...args),
      inject: [
        USER_REPOSITORY,
        SESSION_STORE,
        ONE_TIME_TOKENS,
        UNIT_OF_WORK,
        PASSWORD_HASHER,
        PASSWORD_POLICY,
        AUDIT_LOG,
        CLOCK,
      ],
    },
    {
      provide: CreateStaffUserUseCase,
      useFactory: (...args: ConstructorParameters<typeof CreateStaffUserUseCase>) =>
        new CreateStaffUserUseCase(...args),
      inject: [
        USER_REPOSITORY,
        UNIT_OF_WORK,
        PASSWORD_HASHER,
        ONE_TIME_TOKENS,
        INSTITUTION_GATEWAY,
        AUDIT_LOG,
        CLOCK,
        LOGGER_PORT,
      ],
    },
    {
      provide: ListSessionsUseCase,
      useFactory: (...args: ConstructorParameters<typeof ListSessionsUseCase>) =>
        new ListSessionsUseCase(...args),
      inject: [SESSION_STORE],
    },
    {
      provide: RevokeSessionUseCase,
      useFactory: (...args: ConstructorParameters<typeof RevokeSessionUseCase>) =>
        new RevokeSessionUseCase(...args),
      inject: [SESSION_STORE, AUDIT_LOG],
    },

    // ---------------------------------------------------------------------
    // Interfaz HTTP
    // ---------------------------------------------------------------------
    {
      provide: COOKIE_OPTIONS,
      useFactory: (config: IdentityConfig) => ({
        domain: config.COOKIE_DOMAIN,
        secure: config.COOKIE_SECURE,
        sameSite: config.COOKIE_SAMESITE,
      }),
      inject: [CONFIG],
    },
    {
      provide: AccountController,
      useFactory: (...args: ConstructorParameters<typeof AccountController>) =>
        new AccountController(...args),
      inject: [ChangePasswordUseCase, ListSessionsUseCase, RevokeSessionUseCase],
    },
    {
      provide: UsersController,
      useFactory: (...args: ConstructorParameters<typeof UsersController>) =>
        new UsersController(...args),
      inject: [CreateStaffUserUseCase],
    },
    {
      provide: GetMyProfileUseCase,
      useFactory: (users: UserRepository) => new GetMyProfileUseCase(users),
      inject: [USER_REPOSITORY],
    },
    {
      provide: AuthController,
      useFactory: (...args: ConstructorParameters<typeof AuthController>) =>
        new AuthController(...args),
      inject: [
        RegisterStudentUseCase,
        LoginUseCase,
        RefreshSessionUseCase,
        LogoutUseCase,
        VerifyEmailUseCase,
        RequestPasswordResetUseCase,
        ConfirmPasswordResetUseCase,
        GetMyProfileUseCase,
        COOKIE_OPTIONS,
      ],
    },

    {
      provide: JWT_VERIFY_OPTIONS,
      useFactory: (config: IdentityConfig) => ({
        secret: config.JWT_ACCESS_SECRET,
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
      }),
      inject: [CONFIG],
    },

    // Guards globales: por defecto TODO exige autenticacion, y las rutas
    // publicas se marcan una a una con @Public(). El sentido contrario -abrir
    // todo y proteger lo que se recuerde- es como se olvida proteger un endpoint.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [CONFIG, LOGGER_PORT, DB_WRITE_POOL, DB_READ_POOL, REDIS_CLIENT, AUDIT_LOG],
})
export class IdentityModule implements NestModule, OnApplicationShutdown {
  constructor() {}

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }

  async onApplicationShutdown(): Promise<void> {
    // El volcado final de auditoria y el cierre de pools los coordina `main.ts`,
    // que tiene las referencias concretas.
  }
}

/** Se exporta para que `main.ts` pueda construir el cerrojo y la cache si los
 *  necesita en tareas de fondo. */
export { RedisCacheStore, RedisDistributedLock, RATE_LIMITS };
