import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import type { Clock, SecureRandom, UnitOfWork } from '@glexco/kernel';
import {
  authEnvSchema,
  baseEnvSchema,
  loadEnv,
  mailEnvSchema,
  withServiceDatabaseUrl,
} from '@glexco/config';
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
import { createLogger, toLoggerPort, type Logger } from '@glexco/observability';

import {
  CONFIG,
  LOGGER,
  LOGGER_PORT,
  CLOCK,
  SECURE_RANDOM,
  UNIT_OF_WORK,
  ANNOUNCEMENT_REPOSITORY,
  CLASSROOM_DIRECTORY,
  REPLY_REPOSITORY,
  MAIL_SENDER,
  EMAIL_DELIVERY_LOG,
  ONE_TIME_TOKEN_ISSUER,
} from './tokens';
import { AnnouncementsController } from './interface/http/controllers';
import {
  ArchiveAnnouncementUseCase,
  AskQuestionUseCase,
  ReplyToPostUseCase,
  ListMyAnnouncementsUseCase,
  PublishAnnouncementUseCase,
} from './application/announcements.usecase';
import { SendAccountEmailUseCase } from './application/send-account-email.usecase';
import {
  PgAnnouncementRepository,
  PgReplyRepository,
  PgClassroomDirectory,
  PgEmailDeliveryLog,
} from './infrastructure/persistence/pg-engagement.repositories';
import { SmtpMailSender } from './infrastructure/mail/smtp.sender';
import { IdentityTokenIssuer } from './infrastructure/mail/identity-token.issuer';

/**
 * Configuracion de engagement.
 *
 * `IDENTITY_URL` e `INTERNAL_SERVICE_TOKEN` son obligatorios de hecho aunque el
 * esquema los deje opcionales: sin ellos no se puede acunar el enlace y ningun
 * correo de cuenta sale. Se comprueba abajo, en el arranque, para que el fallo
 * aparezca al desplegar y no la primera vez que un alumno pide su contrasena.
 */
const engagementEnvSchema = baseEnvSchema
  .merge(authEnvSchema.pick({ JWT_ACCESS_SECRET: true, JWT_ISSUER: true, JWT_AUDIENCE: true }))
  .merge(mailEnvSchema)
  .extend({
    SERVICE_NAME: z.string().default('engagement'),
    PORT: z.coerce.number().int().default(3106),
    DATABASE_READ_URLS: z
      .string()
      .optional()
      .transform((value) =>
        (value ?? '').split(',').map((url) => url.trim()).filter(Boolean),
      ),
    IDENTITY_URL: z.string().url().optional(),
    INTERNAL_SERVICE_TOKEN: z.string().min(32).optional(),
    /** Base de los enlaces del correo. Apunta al PORTAL y no a la API: quien
     *  abre el mensaje es una persona y tiene que aterrizar en una pantalla. */
    WEB_URL: z.string().url().default('http://localhost:3010'),
  });

export type EngagementConfig = z.infer<typeof engagementEnvSchema>;

export function loadEngagementConfig(): EngagementConfig {
  const config = loadEnv(engagementEnvSchema, withServiceDatabaseUrl('engagement'));

  // Sin la via interna hacia identidad, este servicio arranca, pasa el health
  // check y no envia ni un correo: los eventos se acumulan sin confirmar. Es
  // preferible no arrancar a arrancar en silencio y descubrirlo cuando un
  // alumno no pueda recuperar su contrasena.
  const missing: string[] = [];
  if (!config.IDENTITY_URL) missing.push('IDENTITY_URL');
  if (!config.INTERNAL_SERVICE_TOKEN) missing.push('INTERNAL_SERVICE_TOKEN');

  if (missing.length > 0) {
    process.stderr.write(
      [
        '',
        'Engagement no puede arrancar sin la via interna hacia identidad.',
        `Faltan: ${missing.join(', ')}`,
        'Sin ellas no se puede acunar el enlace de un solo uso y ningun correo sale.',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  return config;
}

export {
  CONFIG,
  LOGGER,
  LOGGER_PORT,
  ANNOUNCEMENT_REPOSITORY,
  CLASSROOM_DIRECTORY,
} from './tokens';

@Module({
  controllers: [AnnouncementsController, HealthController],
  providers: [
    Reflector,

    { provide: CONFIG, useFactory: (): EngagementConfig => loadEngagementConfig() },

    {
      provide: LOGGER,
      useFactory: (config: EngagementConfig): Logger =>
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
      useFactory: (config: EngagementConfig, logger: Logger): Pool =>
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
      useFactory: (config: EngagementConfig, logger: Logger): Pool =>
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
      useFactory: (config: EngagementConfig, logger: Logger): Redis =>
        createRedisClient(config.REDIS_URL, config.REDIS_KEY_PREFIX, logger),
      inject: [CONFIG, LOGGER],
    },
    {
      provide: UNIT_OF_WORK,
      useFactory: (pool: Pool, logger: Logger): UnitOfWork =>
        new PgUnitOfWork(pool, 'engagement', logger),
      inject: [DB_WRITE_POOL, LOGGER],
    },

    { provide: CLOCK, useValue: { now: () => new Date(), timestamp: () => Date.now() } satisfies Clock },
    {
      provide: SECURE_RANDOM,
      useValue: {
        hex: (bytes: number) => randomBytes(bytes).toString('hex'),
        fromAlphabet: (alphabet: string, length: number) =>
          Array.from(randomBytes(length))
            .map((byte) => alphabet[byte % alphabet.length])
            .join(''),
        uuid: () => randomUUID(),
      } satisfies SecureRandom,
    },

    {
      provide: ANNOUNCEMENT_REPOSITORY,
      useFactory: (writePool: Pool, readPool: Pool) =>
        new PgAnnouncementRepository(writePool, readPool),
      inject: [DB_WRITE_POOL, DB_READ_POOL],
    },
    {
      provide: CLASSROOM_DIRECTORY,
      useFactory: (readPool: Pool) => new PgClassroomDirectory(readPool),
      inject: [DB_READ_POOL],
    },
    {
      provide: EMAIL_DELIVERY_LOG,
      useFactory: (writePool: Pool) => new PgEmailDeliveryLog(writePool),
      inject: [DB_WRITE_POOL],
    },
    {
      provide: MAIL_SENDER,
      useFactory: (config: EngagementConfig) =>
        new SmtpMailSender({
          host: config.SMTP_HOST,
          port: config.SMTP_PORT,
          secure: config.SMTP_SECURE,
          user: config.SMTP_USER,
          password: config.SMTP_PASSWORD,
          from: config.MAIL_FROM,
        }),
      inject: [CONFIG],
    },
    {
      provide: ONE_TIME_TOKEN_ISSUER,
      useFactory: (config: EngagementConfig, logger: Logger) =>
        new IdentityTokenIssuer(config.IDENTITY_URL!, config.INTERNAL_SERVICE_TOKEN!, logger),
      inject: [CONFIG, LOGGER],
    },

    {
      provide: SendAccountEmailUseCase,
      useFactory: (
        tokens: ConstructorParameters<typeof SendAccountEmailUseCase>[0],
        mail: ConstructorParameters<typeof SendAccountEmailUseCase>[1],
        log: ConstructorParameters<typeof SendAccountEmailUseCase>[2],
        ids: SecureRandom,
        config: EngagementConfig,
        logger: ConstructorParameters<typeof SendAccountEmailUseCase>[5],
      ) => new SendAccountEmailUseCase(tokens, mail, log, ids, config.WEB_URL, logger),
      inject: [ONE_TIME_TOKEN_ISSUER, MAIL_SENDER, EMAIL_DELIVERY_LOG, SECURE_RANDOM, CONFIG, LOGGER_PORT],
    },
    {
      provide: PublishAnnouncementUseCase,
      useFactory: (...args: ConstructorParameters<typeof PublishAnnouncementUseCase>) =>
        new PublishAnnouncementUseCase(...args),
      inject: [ANNOUNCEMENT_REPOSITORY, CLASSROOM_DIRECTORY, UNIT_OF_WORK, CLOCK, SECURE_RANDOM],
    },
    {
      provide: ListMyAnnouncementsUseCase,
      useFactory: (...args: ConstructorParameters<typeof ListMyAnnouncementsUseCase>) =>
        new ListMyAnnouncementsUseCase(...args),
      inject: [ANNOUNCEMENT_REPOSITORY, CLASSROOM_DIRECTORY, REPLY_REPOSITORY],
    },
    {
      provide: ArchiveAnnouncementUseCase,
      useFactory: (...args: ConstructorParameters<typeof ArchiveAnnouncementUseCase>) =>
        new ArchiveAnnouncementUseCase(...args),
      inject: [ANNOUNCEMENT_REPOSITORY, UNIT_OF_WORK, CLOCK],
    },

    {
      provide: REPLY_REPOSITORY,
      useFactory: (writePool: Pool, readPool: Pool) => new PgReplyRepository(writePool, readPool),
      inject: [DB_WRITE_POOL, DB_READ_POOL],
    },
    {
      provide: AskQuestionUseCase,
      useFactory: (...args: ConstructorParameters<typeof AskQuestionUseCase>) =>
        new AskQuestionUseCase(...args),
      inject: [ANNOUNCEMENT_REPOSITORY, CLASSROOM_DIRECTORY, UNIT_OF_WORK, CLOCK, SECURE_RANDOM],
    },
    {
      provide: ReplyToPostUseCase,
      useFactory: (...args: ConstructorParameters<typeof ReplyToPostUseCase>) =>
        new ReplyToPostUseCase(...args),
      inject: [ANNOUNCEMENT_REPOSITORY, REPLY_REPOSITORY, CLASSROOM_DIRECTORY, CLOCK, SECURE_RANDOM],
    },

    {
      provide: JWT_VERIFY_OPTIONS,
      useFactory: (config: EngagementConfig) => ({
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
export class EngagementModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
