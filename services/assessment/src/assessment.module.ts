import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { authEnvSchema, baseEnvSchema, loadEnv, withServiceDatabaseUrl } from '@glexco/config';
import { createLogger, toLoggerPort, type Logger } from '@glexco/observability';
import type { Clock, LoggerPort, SecureRandom } from '@glexco/kernel';
import {
  CorrelationMiddleware,
  DB_READ_POOL,
  DB_WRITE_POOL,
  HealthController,
  JWT_VERIFY_OPTIONS,
  JwtAuthGuard,
  PermissionsGuard,
  PgUnitOfWork,
  REDIS_CLIENT,
  createReadPool,
  createRedisClient,
  createWritePool,
} from '@glexco/nest-platform';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  ASSESSMENT_REPOSITORY,
  CLOCK,
  CONFIG,
  LOGGER,
  LOGGER_PORT,
  SECURE_RANDOM,
  SUBMISSION_REPOSITORY,
  UNIT_OF_WORK,
} from './tokens';
import { AssessmentsController, AttemptsController } from './interface/http/controllers';
import {
  AddQuestionUseCase,
  CloneAssessmentUseCase,
  CreateAssessmentUseCase,
  ListAssessmentsUseCase,
  PublishAssessmentUseCase,
} from './application/manage-assessment.usecase';
import {
  GradeSubmissionUseCase,
  SaveAnswerUseCase,
  StartAttemptUseCase,
  SubmitAttemptUseCase,
} from './application/take-assessment.usecase';
import {
  PgAssessmentRepository,
  PgSubmissionRepository,
} from './infrastructure/persistence/pg-assessment.repository';

export {
  ASSESSMENT_REPOSITORY,
  CLOCK,
  CONFIG,
  LOGGER,
  LOGGER_PORT,
  SECURE_RANDOM,
  SUBMISSION_REPOSITORY,
  UNIT_OF_WORK,
} from './tokens';

const assessmentEnvSchema = baseEnvSchema.merge(authEnvSchema).extend({
  SERVICE_NAME: z.string().default('assessment'),
  PORT: z.coerce.number().int().default(3105),
});

export type AssessmentConfig = z.infer<typeof assessmentEnvSchema>;

export const loadAssessmentConfig = (): AssessmentConfig =>
  loadEnv(assessmentEnvSchema, withServiceDatabaseUrl('assessment'));

@Module({
  controllers: [AssessmentsController, AttemptsController, HealthController],
  providers: [
    Reflector,

    { provide: CONFIG, useFactory: (): AssessmentConfig => loadAssessmentConfig() },

    {
      provide: LOGGER,
      useFactory: (config: AssessmentConfig) =>
        createLogger({
          serviceName: config.SERVICE_NAME,
          level: config.LOG_LEVEL,
          pretty: config.NODE_ENV === 'development',
        }),
      inject: [CONFIG],
    },
    {
      // Token aparte del logger de pino: las firmas estan invertidas y un casteo
      // compila y luego pierde el contexto de todas las lineas de log.
      provide: LOGGER_PORT,
      useFactory: (logger: Logger): LoggerPort => toLoggerPort(logger),
      inject: [LOGGER],
    },

    {
      provide: DB_WRITE_POOL,
      useFactory: (config: AssessmentConfig, logger: Logger): Pool =>
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
      useFactory: (config: AssessmentConfig, logger: Logger): Pool =>
        createReadPool({
          writeUrl: config.DATABASE_URL,
          readUrls: [],
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
      useFactory: (config: AssessmentConfig, logger: Logger): Redis =>
        createRedisClient(config.REDIS_URL, config.REDIS_KEY_PREFIX, logger),
      inject: [CONFIG, LOGGER],
    },
    {
      provide: UNIT_OF_WORK,
      useFactory: (pool: Pool, logger: Logger) => new PgUnitOfWork(pool, 'assessment', logger),
      inject: [DB_WRITE_POOL, LOGGER],
    },

    {
      provide: CLOCK,
      useValue: { now: () => new Date(), timestamp: () => Date.now() } satisfies Clock,
    },
    {
      provide: SECURE_RANDOM,
      useValue: {
        hex: (bytes: number) => randomBytes(bytes).toString('hex'),
        uuid: () => randomUUID(),
        fromAlphabet: (alphabet: string, length: number) => {
          let out = '';
          for (let i = 0; i < length; i += 1) {
            out += alphabet[randomBytes(1)[0]! % alphabet.length];
          }
          return out;
        },
      } satisfies SecureRandom,
    },

    {
      provide: ASSESSMENT_REPOSITORY,
      useFactory: (read: Pool) => new PgAssessmentRepository(read),
      inject: [DB_READ_POOL],
    },
    {
      provide: SUBMISSION_REPOSITORY,
      useFactory: (read: Pool) => new PgSubmissionRepository(read),
      inject: [DB_READ_POOL],
    },

    {
      provide: CreateAssessmentUseCase,
      useFactory: (...args: ConstructorParameters<typeof CreateAssessmentUseCase>) =>
        new CreateAssessmentUseCase(...args),
      inject: [ASSESSMENT_REPOSITORY, UNIT_OF_WORK, CLOCK, SECURE_RANDOM, LOGGER_PORT],
    },
    {
      provide: AddQuestionUseCase,
      useFactory: (...args: ConstructorParameters<typeof AddQuestionUseCase>) =>
        new AddQuestionUseCase(...args),
      inject: [ASSESSMENT_REPOSITORY, UNIT_OF_WORK, CLOCK, SECURE_RANDOM],
    },
    {
      provide: PublishAssessmentUseCase,
      useFactory: (...args: ConstructorParameters<typeof PublishAssessmentUseCase>) =>
        new PublishAssessmentUseCase(...args),
      inject: [ASSESSMENT_REPOSITORY, UNIT_OF_WORK, CLOCK],
    },
    {
      provide: CloneAssessmentUseCase,
      useFactory: (...args: ConstructorParameters<typeof CloneAssessmentUseCase>) =>
        new CloneAssessmentUseCase(...args),
      inject: [ASSESSMENT_REPOSITORY, UNIT_OF_WORK, CLOCK, SECURE_RANDOM, LOGGER_PORT],
    },
    {
      provide: ListAssessmentsUseCase,
      useFactory: (...args: ConstructorParameters<typeof ListAssessmentsUseCase>) =>
        new ListAssessmentsUseCase(...args),
      inject: [ASSESSMENT_REPOSITORY],
    },

    {
      provide: StartAttemptUseCase,
      useFactory: (...args: ConstructorParameters<typeof StartAttemptUseCase>) =>
        new StartAttemptUseCase(...args),
      inject: [
        ASSESSMENT_REPOSITORY,
        SUBMISSION_REPOSITORY,
        UNIT_OF_WORK,
        CLOCK,
        SECURE_RANDOM,
        LOGGER_PORT,
      ],
    },
    {
      provide: SaveAnswerUseCase,
      useFactory: (...args: ConstructorParameters<typeof SaveAnswerUseCase>) =>
        new SaveAnswerUseCase(...args),
      inject: [SUBMISSION_REPOSITORY, UNIT_OF_WORK, CLOCK],
    },
    {
      provide: SubmitAttemptUseCase,
      useFactory: (...args: ConstructorParameters<typeof SubmitAttemptUseCase>) =>
        new SubmitAttemptUseCase(...args),
      inject: [ASSESSMENT_REPOSITORY, SUBMISSION_REPOSITORY, UNIT_OF_WORK, CLOCK, LOGGER_PORT],
    },
    {
      provide: GradeSubmissionUseCase,
      useFactory: (...args: ConstructorParameters<typeof GradeSubmissionUseCase>) =>
        new GradeSubmissionUseCase(...args),
      inject: [ASSESSMENT_REPOSITORY, SUBMISSION_REPOSITORY, UNIT_OF_WORK, CLOCK, LOGGER_PORT],
    },

    {
      provide: AssessmentsController,
      useFactory: (...args: ConstructorParameters<typeof AssessmentsController>) =>
        new AssessmentsController(...args),
      inject: [
        CreateAssessmentUseCase,
        AddQuestionUseCase,
        PublishAssessmentUseCase,
        CloneAssessmentUseCase,
        ListAssessmentsUseCase,
      ],
    },
    {
      provide: AttemptsController,
      useFactory: (...args: ConstructorParameters<typeof AttemptsController>) =>
        new AttemptsController(...args),
      inject: [StartAttemptUseCase, SaveAnswerUseCase, SubmitAttemptUseCase, GradeSubmissionUseCase],
    },

    {
      provide: JWT_VERIFY_OPTIONS,
      useFactory: (config: AssessmentConfig) => ({
        secret: config.JWT_ACCESS_SECRET,
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
      }),
      inject: [CONFIG],
    },

    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [CONFIG, LOGGER, LOGGER_PORT, DB_WRITE_POOL, DB_READ_POOL, REDIS_CLIENT],
})
export class AssessmentModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
