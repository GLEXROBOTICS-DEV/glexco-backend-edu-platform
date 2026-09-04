import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import type { Clock, LoggerPort, SecureRandom, UnitOfWork } from '@glexco/kernel';
import { authEnvSchema, baseEnvSchema, loadEnv, withServiceDatabaseUrl } from '@glexco/config';
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
  LEARNING_REPOSITORY,
  GAMIFICATION_REPOSITORY,
  MISSION_REPOSITORY,
  CERTIFICATE_REPOSITORY,
  CERTIFICATE_KEYS,
} from './tokens';
import { CertificatesController, LearningController } from './interface/http/controllers';
import {
  CompleteLessonUseCase,
  GetClassroomProgressUseCase,
  GetMyProgressUseCase,
  StartLessonUseCase,
} from './application/progress.usecase';
import { MyMissionsUseCase } from './application/missions.usecase';
import {
  PgCertificateRepository,
  PgGamificationRepository,
  PgLearningRepository,
  PgMissionRepository,
} from './infrastructure/persistence/pg-learning.repositories';
import {
  IssueCertificateUseCase,
  IssueClassroomCertificatesUseCase,
  MyCertificatesUseCase,
  VerifyCertificateUseCase,
} from './application/certificates.usecase';
import { readCertificateKeys, type CertificateKeyPair } from './certificate-keys';
import type {
  CertificateRepository,
  GamificationRepository,
  MissionRepository,
} from './domain/repositories';

const learningEnvSchema = baseEnvSchema
  .merge(authEnvSchema.pick({ JWT_ACCESS_SECRET: true, JWT_ISSUER: true, JWT_AUDIENCE: true }))
  .extend({
    SERVICE_NAME: z.string().default('learning'),
    PORT: z.coerce.number().int().default(3104),
    DATABASE_READ_URLS: z
      .string()
      .optional()
      .transform((value) =>
        (value ?? '').split(',').map((url) => url.trim()).filter(Boolean),
      ),

    /**
     * Claves de firma de los certificados, en PEM (Ed25519).
     *
     * Se validan como cadena y se normalizan en `readCertificateKeys`, que es
     * donde se resuelven los saltos de linea escapados de los paneles de
     * despliegue. Opcionales: sin ellas el servicio arranca y solo los
     * certificados quedan desactivados.
     */
    CERTIFICATE_PRIVATE_KEY: z.string().optional(),
    CERTIFICATE_PUBLIC_KEY: z.string().optional(),

    CERTIFICATE_VERIFY_URL: z.string().default('https://glexcoweb-production.up.railway.app/verificar'),
  });

export type LearningConfig = z.infer<typeof learningEnvSchema>;
export const loadLearningConfig = (): LearningConfig =>
  loadEnv(learningEnvSchema, withServiceDatabaseUrl('learning'));

export { CONFIG, LOGGER, LOGGER_PORT } from './tokens';

@Module({
  controllers: [LearningController, CertificatesController, HealthController],
  providers: [
    Reflector,

    { provide: CONFIG, useFactory: (): LearningConfig => loadLearningConfig() },

    {
      provide: LOGGER,
      useFactory: (config: LearningConfig): Logger =>
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
      useFactory: (config: LearningConfig, logger: Logger): Pool =>
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
      useFactory: (config: LearningConfig, logger: Logger): Pool =>
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
      useFactory: (config: LearningConfig, logger: Logger): Redis =>
        createRedisClient(config.REDIS_URL, config.REDIS_KEY_PREFIX, logger),
      inject: [CONFIG, LOGGER],
    },
    {
      provide: UNIT_OF_WORK,
      useFactory: (pool: Pool, logger: Logger): UnitOfWork =>
        new PgUnitOfWork(pool, 'learning', logger),
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
      provide: LEARNING_REPOSITORY,
      useFactory: (writePool: Pool, readPool: Pool) => new PgLearningRepository(writePool, readPool),
      inject: [DB_WRITE_POOL, DB_READ_POOL],
    },
    {
      provide: GAMIFICATION_REPOSITORY,
      useFactory: (readPool: Pool) => new PgGamificationRepository(readPool),
      inject: [DB_READ_POOL],
    },
    {
      // Solo lectura: el catalogo de misiones y los hechos con los que se mide
      // el avance. Lo unico que escribe una mision es su XP, y eso lo hace el
      // repositorio de gamificacion dentro de la transaccion del caso de uso.
      provide: MISSION_REPOSITORY,
      useFactory: (readPool: Pool) => new PgMissionRepository(readPool),
      inject: [DB_READ_POOL],
    },
    {
      provide: CertificatesController,
      useFactory: (...args: ConstructorParameters<typeof CertificatesController>) =>
        new CertificatesController(...args),
      inject: [
        IssueCertificateUseCase,
        IssueClassroomCertificatesUseCase,
        VerifyCertificateUseCase,
        MyCertificatesUseCase,
        CERTIFICATE_KEYS,
      ],
    },
    {
      provide: CERTIFICATE_REPOSITORY,
      useFactory: (writePool: Pool, readPool: Pool) =>
        new PgCertificateRepository(writePool, readPool),
      inject: [DB_WRITE_POOL, DB_READ_POOL],
    },
    {
      provide: CERTIFICATE_KEYS,
      // Se leen UNA vez al arrancar. Leerlas en cada firma volveria a normalizar
      // el PEM en cada peticion y, peor, permitiria que el servicio cambiara de
      // clave a mitad de vida sin que nadie lo notara.
      useFactory: () => readCertificateKeys(),
    },
    {
      provide: IssueCertificateUseCase,
      // Las claves pueden ser `null` -despliegue sin certificados-, y el caso de
      // uso las exige. Se le pasa un par vacio y es el controlador quien corta
      // antes con un mensaje claro: dejar que falle al firmar produciria un
      // error de criptografia en vez de "esto no esta configurado".
      useFactory: (
        certificates: CertificateRepository,
        keys: CertificateKeyPair | null,
        random: SecureRandom,
        logger: LoggerPort,
      ) =>
        new IssueCertificateUseCase(
          certificates,
          keys ?? { privateKeyPem: '', publicKeyPem: '' },
          () => random.uuid(),
          (alphabet, length) => random.fromAlphabet(alphabet, length),
          logger,
        ),
      inject: [CERTIFICATE_REPOSITORY, CERTIFICATE_KEYS, SECURE_RANDOM, LOGGER_PORT],
    },
    {
      provide: IssueClassroomCertificatesUseCase,
      useFactory: (...args: ConstructorParameters<typeof IssueClassroomCertificatesUseCase>) =>
        new IssueClassroomCertificatesUseCase(...args),
      inject: [CERTIFICATE_REPOSITORY, IssueCertificateUseCase],
    },
    {
      provide: VerifyCertificateUseCase,
      useFactory: (certificates: CertificateRepository, keys: CertificateKeyPair | null) =>
        new VerifyCertificateUseCase(
          certificates,
          keys ?? { privateKeyPem: '', publicKeyPem: '' },
        ),
      inject: [CERTIFICATE_REPOSITORY, CERTIFICATE_KEYS],
    },
    {
      provide: MyCertificatesUseCase,
      useFactory: (...args: ConstructorParameters<typeof MyCertificatesUseCase>) =>
        new MyCertificatesUseCase(...args),
      inject: [CERTIFICATE_REPOSITORY],
    },

    {
      provide: StartLessonUseCase,
      useFactory: (...args: ConstructorParameters<typeof StartLessonUseCase>) =>
        new StartLessonUseCase(...args),
      inject: [LEARNING_REPOSITORY, CLOCK],
    },
    {
      provide: CompleteLessonUseCase,
      useFactory: (...args: ConstructorParameters<typeof CompleteLessonUseCase>) =>
        new CompleteLessonUseCase(...args),
      inject: [
        LEARNING_REPOSITORY,
        GAMIFICATION_REPOSITORY,
        UNIT_OF_WORK,
        CLOCK,
        SECURE_RANDOM,
        LOGGER_PORT,
      ],
    },
    {
      provide: GetMyProgressUseCase,
      useFactory: (...args: ConstructorParameters<typeof GetMyProgressUseCase>) =>
        new GetMyProgressUseCase(...args),
      inject: [LEARNING_REPOSITORY],
    },
    {
      provide: MyMissionsUseCase,
      // El orden es el del constructor y NO el alfabetico: Nest inyecta por
      // posicion. Anadir una dependencia al constructor y olvidarla aqui es el
      // fallo que dejo el muro del salon devolviendo un 500 en la sesion 14.
      useFactory: (
        missions: MissionRepository,
        gamification: GamificationRepository,
        unitOfWork: UnitOfWork,
        clock: Clock,
        logger: LoggerPort,
        random: SecureRandom,
      ) =>
        new MyMissionsUseCase(missions, gamification, unitOfWork, clock, logger, () =>
          random.uuid(),
        ),
      inject: [
        MISSION_REPOSITORY,
        GAMIFICATION_REPOSITORY,
        UNIT_OF_WORK,
        CLOCK,
        LOGGER_PORT,
        SECURE_RANDOM,
      ],
    },
    {
      provide: GetClassroomProgressUseCase,
      useFactory: (...args: ConstructorParameters<typeof GetClassroomProgressUseCase>) =>
        new GetClassroomProgressUseCase(...args),
      inject: [LEARNING_REPOSITORY, CLOCK],
    },

    {
      provide: JWT_VERIFY_OPTIONS,
      useFactory: (config: LearningConfig) => ({
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
export class LearningModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
