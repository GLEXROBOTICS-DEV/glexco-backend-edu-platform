import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { z } from 'zod';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import type { Clock, UnitOfWork } from '@glexco/kernel';
import { authEnvSchema, baseEnvSchema, loadEnv } from '@glexco/config';
import {
  CorrelationMiddleware,
  DB_READ_POOL,
  DB_WRITE_POOL,
  HealthController,
  INTERNAL_SERVICE_TOKEN,
  InternalOnlyGuard,
  JWT_VERIFY_OPTIONS,
  JwtAuthGuard,
  PermissionsGuard,
  PgUnitOfWork,
  REDIS_CLIENT,
  createReadPool,
  createRedisClient,
  createWritePool,
} from '@glexco/nest-platform';
import { createLogger, toLoggerPort, type Logger } from '@glexco/observability';

import {
  ClassroomsController,
  InstitutionsController,
  InternalClassroomsController,
  InternalInstitutionsController,
} from './interface/http/controllers';
import {
  CreateInstitutionUseCase,
  GrantLicenseUseCase,
  LookupInstitutionUseCase,
} from './application/manage-institutions.usecase';
import {
  CreateClassroomUseCase,
  ListClassroomsUseCase,
  ListSelectableClassroomsUseCase,
  UpdateClassroomUseCase,
} from './application/manage-classrooms.usecase';
import {
  EnrollStudentUseCase,
  PrecheckClassroomUseCase,
} from './application/enroll-student.usecase';
import {
  PgInstitutionRepository,
  PgTeacherDirectory,
} from './infrastructure/persistence/pg-institution.repository';
import { PgClassroomRepository } from './infrastructure/persistence/pg-classroom.repository';

/**
 * Configuracion del servicio.
 *
 * Solo necesita el secreto de ACCESO de JWT: este servicio verifica tokens pero
 * no los emite, asi que no debe conocer el secreto de refresh. Reducir lo que
 * cada servicio sabe reduce lo que se puede filtrar si uno se ve comprometido.
 */
const institutionsEnvSchema = baseEnvSchema
  .merge(
    authEnvSchema.pick({
      JWT_ACCESS_SECRET: true,
      JWT_ISSUER: true,
      JWT_AUDIENCE: true,
    }),
  )
  .extend({
    SERVICE_NAME: z.string().default('institutions'),
    PORT: z.coerce.number().int().default(3102),
    DATABASE_READ_URLS: z
      .string()
      .optional()
      .transform((value) =>
        (value ?? '')
          .split(',')
          .map((url) => url.trim())
          .filter(Boolean),
      ),
    INTERNAL_SERVICE_TOKEN: z.string().min(32).optional(),
  });

export type InstitutionsConfig = z.infer<typeof institutionsEnvSchema>;
export const loadInstitutionsConfig = (): InstitutionsConfig => loadEnv(institutionsEnvSchema);

export const CONFIG = Symbol('INSTITUTIONS_CONFIG');
export const LOGGER = Symbol('LOGGER');
/**
 * El mismo logger, adaptado al puerto que usan los casos de uso.
 *
 * Existe como token aparte porque las firmas de pino y de `LoggerPort` estan
 * invertidas: pino recibe `(contexto, mensaje)` y el puerto `(mensaje,
 * contexto)`. Inyectar el de pino donde se espera el puerto compila con un
 * casteo y luego pierde en silencio los campos por los que hay que filtrar en
 * produccion. Dos tokens distintos hacen que ese error no se pueda cometer.
 */
export const LOGGER_PORT = Symbol('LOGGER_PORT');
export const CLOCK = Symbol('CLOCK');
export const INSTITUTION_REPOSITORY = Symbol('INSTITUTION_REPOSITORY');
export const CLASSROOM_REPOSITORY = Symbol('CLASSROOM_REPOSITORY');
export const TEACHER_DIRECTORY = Symbol('TEACHER_DIRECTORY');
export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');

@Module({
  controllers: [
    InstitutionsController,
    ClassroomsController,
    InternalClassroomsController,
    InternalInstitutionsController,
    HealthController,
  ],
  providers: [
    Reflector,
    InternalOnlyGuard,

    { provide: CONFIG, useFactory: (): InstitutionsConfig => loadInstitutionsConfig() },

    {
      provide: LOGGER,
      useFactory: (config: InstitutionsConfig): Logger =>
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

    {
      provide: DB_WRITE_POOL,
      useFactory: (config: InstitutionsConfig, logger: Logger): Pool =>
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
      useFactory: (config: InstitutionsConfig, logger: Logger): Pool =>
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
      useFactory: (config: InstitutionsConfig, logger: Logger): Redis =>
        createRedisClient(config.REDIS_URL, config.REDIS_KEY_PREFIX, logger),
      inject: [CONFIG, LOGGER],
    },
    {
      provide: UNIT_OF_WORK,
      useFactory: (pool: Pool, logger: Logger): UnitOfWork =>
        new PgUnitOfWork(pool, 'institutions', logger),
      inject: [DB_WRITE_POOL, LOGGER],
    },

    {
      provide: CLOCK,
      useValue: { now: () => new Date(), timestamp: () => Date.now() } satisfies Clock,
    },

    {
      provide: INSTITUTION_REPOSITORY,
      useFactory: (read: Pool) => new PgInstitutionRepository(read),
      inject: [DB_READ_POOL],
    },
    {
      provide: CLASSROOM_REPOSITORY,
      useFactory: (read: Pool) => new PgClassroomRepository(read),
      inject: [DB_READ_POOL],
    },
    {
      provide: TEACHER_DIRECTORY,
      useFactory: (write: Pool, read: Pool) => new PgTeacherDirectory(write, read),
      inject: [DB_WRITE_POOL, DB_READ_POOL],
    },

    // -----------------------------------------------------------------------
    // Casos de uso
    // -----------------------------------------------------------------------
    {
      provide: CreateInstitutionUseCase,
      useFactory: (...args: ConstructorParameters<typeof CreateInstitutionUseCase>) =>
        new CreateInstitutionUseCase(...args),
      inject: [INSTITUTION_REPOSITORY, UNIT_OF_WORK, CLOCK, LOGGER_PORT],
    },
    {
      provide: GrantLicenseUseCase,
      useFactory: (...args: ConstructorParameters<typeof GrantLicenseUseCase>) =>
        new GrantLicenseUseCase(...args),
      inject: [INSTITUTION_REPOSITORY, UNIT_OF_WORK, CLOCK, LOGGER_PORT],
    },
    {
      provide: LookupInstitutionUseCase,
      useFactory: (...args: ConstructorParameters<typeof LookupInstitutionUseCase>) =>
        new LookupInstitutionUseCase(...args),
      inject: [INSTITUTION_REPOSITORY],
    },
    {
      provide: CreateClassroomUseCase,
      useFactory: (...args: ConstructorParameters<typeof CreateClassroomUseCase>) =>
        new CreateClassroomUseCase(...args),
      inject: [
        CLASSROOM_REPOSITORY,
        INSTITUTION_REPOSITORY,
        TEACHER_DIRECTORY,
        UNIT_OF_WORK,
        CLOCK,
        LOGGER_PORT,
      ],
    },
    {
      provide: UpdateClassroomUseCase,
      useFactory: (...args: ConstructorParameters<typeof UpdateClassroomUseCase>) =>
        new UpdateClassroomUseCase(...args),
      inject: [CLASSROOM_REPOSITORY, UNIT_OF_WORK, CLOCK],
    },
    {
      provide: ListClassroomsUseCase,
      useFactory: (...args: ConstructorParameters<typeof ListClassroomsUseCase>) =>
        new ListClassroomsUseCase(...args),
      inject: [CLASSROOM_REPOSITORY],
    },
    {
      provide: ListSelectableClassroomsUseCase,
      useFactory: (...args: ConstructorParameters<typeof ListSelectableClassroomsUseCase>) =>
        new ListSelectableClassroomsUseCase(...args),
      inject: [CLASSROOM_REPOSITORY, INSTITUTION_REPOSITORY, CLOCK],
    },
    {
      provide: EnrollStudentUseCase,
      useFactory: (...args: ConstructorParameters<typeof EnrollStudentUseCase>) =>
        new EnrollStudentUseCase(...args),
      inject: [CLASSROOM_REPOSITORY, INSTITUTION_REPOSITORY, UNIT_OF_WORK, CLOCK, LOGGER_PORT],
    },
    {
      provide: PrecheckClassroomUseCase,
      useFactory: (...args: ConstructorParameters<typeof PrecheckClassroomUseCase>) =>
        new PrecheckClassroomUseCase(...args),
      inject: [CLASSROOM_REPOSITORY, TEACHER_DIRECTORY],
    },

    // -----------------------------------------------------------------------
    // Controladores
    // -----------------------------------------------------------------------
    {
      provide: InstitutionsController,
      useFactory: (...args: ConstructorParameters<typeof InstitutionsController>) =>
        new InstitutionsController(...args),
      inject: [CreateInstitutionUseCase, GrantLicenseUseCase, LookupInstitutionUseCase],
    },
    {
      provide: ClassroomsController,
      useFactory: (...args: ConstructorParameters<typeof ClassroomsController>) =>
        new ClassroomsController(...args),
      inject: [
        CreateClassroomUseCase,
        UpdateClassroomUseCase,
        ListClassroomsUseCase,
        ListSelectableClassroomsUseCase,
        EnrollStudentUseCase,
      ],
    },
    {
      provide: InternalClassroomsController,
      useFactory: (...args: ConstructorParameters<typeof InternalClassroomsController>) =>
        new InternalClassroomsController(...args),
      inject: [PrecheckClassroomUseCase],
    },
    {
      provide: InternalInstitutionsController,
      useFactory: (...args: ConstructorParameters<typeof InternalInstitutionsController>) =>
        new InternalInstitutionsController(...args),
      inject: [INSTITUTION_REPOSITORY],
    },

    {
      provide: JWT_VERIFY_OPTIONS,
      useFactory: (config: InstitutionsConfig) => ({
        secret: config.JWT_ACCESS_SECRET,
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
      }),
      inject: [CONFIG],
    },
    {
      provide: INTERNAL_SERVICE_TOKEN,
      useFactory: (config: InstitutionsConfig) => config.INTERNAL_SERVICE_TOKEN,
      inject: [CONFIG],
    },

    // Todo exige autenticacion por defecto; lo publico se marca con @Public().
    // El sentido contrario -abrir todo y proteger lo que se recuerde- es como se
    // deja un endpoint sin proteger sin que nadie se entere.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [CONFIG, LOGGER_PORT, DB_WRITE_POOL, DB_READ_POOL, REDIS_CLIENT],
})
export class InstitutionsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
