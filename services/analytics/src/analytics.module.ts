import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { authEnvSchema, baseEnvSchema, loadEnv, withServiceDatabaseUrl } from '@glexco/config';
import { createLogger, toLoggerPort, type Logger } from '@glexco/observability';
import type { LoggerPort } from '@glexco/kernel';
import {
  CorrelationMiddleware,
  DB_READ_POOL,
  DB_WRITE_POOL,
  HealthController,
  JWT_VERIFY_OPTIONS,
  JwtAuthGuard,
  PermissionsGuard,
  REDIS_CLIENT,
  createReadPool,
  createRedisClient,
  createWritePool,
} from '@glexco/nest-platform';
import {
  CLASSROOM_DIRECTORY,
  CONFIG,
  LOGGER,
  LOGGER_PORT,
  PROJECTION_REPOSITORY,
  QUERY_REPOSITORY,
} from './tokens';
import { AnalyticsController } from './interface/http/controllers';
import {
  PgAnalyticsProjectionRepository,
  PgAnalyticsQueryRepository,
} from './infrastructure/persistence/pg-analytics.repository';
import { PgClassroomDirectory } from './application/directory';

export {
  CLASSROOM_DIRECTORY,
  CONFIG,
  LOGGER,
  LOGGER_PORT,
  PROJECTION_REPOSITORY,
  QUERY_REPOSITORY,
} from './tokens';

const analyticsEnvSchema = baseEnvSchema.merge(authEnvSchema).extend({
  SERVICE_NAME: z.string().default('analytics'),
  PORT: z.coerce.number().int().default(3107),
});

export type AnalyticsConfig = z.infer<typeof analyticsEnvSchema>;

export const loadAnalyticsConfig = (): AnalyticsConfig =>
  loadEnv(analyticsEnvSchema, withServiceDatabaseUrl('analytics'));

@Module({
  controllers: [AnalyticsController, HealthController],
  providers: [
    Reflector,

    { provide: CONFIG, useFactory: (): AnalyticsConfig => loadAnalyticsConfig() },

    {
      provide: LOGGER,
      useFactory: (config: AnalyticsConfig) =>
        createLogger({
          serviceName: config.SERVICE_NAME,
          level: config.LOG_LEVEL,
          pretty: config.NODE_ENV === 'development',
        }),
      inject: [CONFIG],
    },
    {
      provide: LOGGER_PORT,
      useFactory: (logger: Logger): LoggerPort => toLoggerPort(logger),
      inject: [LOGGER],
    },

    {
      provide: DB_WRITE_POOL,
      useFactory: (config: AnalyticsConfig, logger: Logger): Pool =>
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
      // Toda consulta de dashboard es lectura pesada por definicion: es
      // exactamente el trafico que la separacion de pools existe para desviar
      // a las replicas. En local apuntan al mismo Postgres.
      provide: DB_READ_POOL,
      useFactory: (config: AnalyticsConfig, logger: Logger): Pool =>
        createReadPool({
          writeUrl: config.DATABASE_URL,
          readUrls: [],
          poolMax: config.DB_POOL_MAX,
          idleTimeoutMs: config.DB_POOL_IDLE_TIMEOUT_MS,
          // Un dashboard puede tardar mas que una peticion normal, pero no
          // eternamente: si una agregacion pasa de diez segundos, la proyeccion
          // esta mal y hay que verlo, no dejarla colgada.
          statementTimeoutMs: 10_000,
          applicationName: config.SERVICE_NAME,
          logger,
        }),
      inject: [CONFIG, LOGGER],
    },
    {
      provide: REDIS_CLIENT,
      useFactory: (config: AnalyticsConfig, logger: Logger): Redis =>
        createRedisClient(config.REDIS_URL, config.REDIS_KEY_PREFIX, logger),
      inject: [CONFIG, LOGGER],
    },

    { provide: PROJECTION_REPOSITORY, useValue: new PgAnalyticsProjectionRepository() },
    {
      provide: QUERY_REPOSITORY,
      useFactory: (read: Pool) => new PgAnalyticsQueryRepository(read),
      inject: [DB_READ_POOL],
    },
    {
      provide: CLASSROOM_DIRECTORY,
      useFactory: (read: Pool) => new PgClassroomDirectory(read),
      inject: [DB_READ_POOL],
    },

    {
      provide: AnalyticsController,
      useFactory: (...args: ConstructorParameters<typeof AnalyticsController>) =>
        new AnalyticsController(...args),
      inject: [QUERY_REPOSITORY, CLASSROOM_DIRECTORY],
    },

    {
      provide: JWT_VERIFY_OPTIONS,
      useFactory: (config: AnalyticsConfig) => ({
        secret: config.JWT_ACCESS_SECRET,
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
      }),
      inject: [CONFIG],
    },

    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [CONFIG, LOGGER, LOGGER_PORT, DB_WRITE_POOL, DB_READ_POOL, REDIS_CLIENT, PROJECTION_REPOSITORY],
})
export class AnalyticsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
