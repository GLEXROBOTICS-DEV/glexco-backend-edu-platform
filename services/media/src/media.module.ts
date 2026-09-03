import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import {
  baseEnvSchema,
  authEnvSchema,
  storageEnvSchema,
  loadEnv,
  optionalEnv,
  withServiceDatabaseUrl,
} from '@glexco/config';
import { createLogger, toLoggerPort, type Logger } from '@glexco/observability';
import type { Clock, LoggerPort, SecureRandom } from '@glexco/kernel';
import {
  CorrelationMiddleware,
  DB_READ_POOL,
  DB_WRITE_POOL,
  HealthController,
  JwtAuthGuard,
  JWT_VERIFY_OPTIONS,
  PermissionsGuard,
  PgUnitOfWork,
  REDIS_CLIENT,
  createReadPool,
  createRedisClient,
  createWritePool,
} from '@glexco/nest-platform';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  BUCKETS,
  CLOCK,
  CONFIG,
  CONTENT_SNIFFER,
  LOGGER,
  LOGGER_PORT,
  MEDIA_REPOSITORY,
  OBJECT_STORAGE,
  PREFIX_READER,
  PRESIGN_TTL,
  SECURE_RANDOM,
  THUMBNAILER,
  UNIT_OF_WORK,
  VIDEO_PROVIDER,
} from './tokens';
import { MediaController } from './interface/http/controllers';
import {
  ConfirmUploadUseCase,
  IssueDownloadUrlUseCase,
  RequestUploadUseCase,
  type BucketMap,
} from './application/upload.usecases';
import { PgMediaAssetRepository } from './infrastructure/persistence/pg-media-asset.repository';
import { S3ObjectStorage } from './infrastructure/storage/s3-object-storage';
import { MagicBytesSniffer } from './infrastructure/media/magic-bytes.sniffer';
import { SharpThumbnailer } from './infrastructure/media/sharp.thumbnailer';
import {
  HttpVideoProvider,
  ObjectStorageVideoProvider,
} from './infrastructure/video/video-providers';
import type { MediaAssetRepository, VideoProvider } from './application/ports';

export {
  BUCKETS,
  CLOCK,
  CONFIG,
  CONTENT_SNIFFER,
  LOGGER,
  LOGGER_PORT,
  MEDIA_REPOSITORY,
  OBJECT_STORAGE,
  PREFIX_READER,
  PRESIGN_TTL,
  SECURE_RANDOM,
  THUMBNAILER,
  UNIT_OF_WORK,
  VIDEO_PROVIDER,
} from './tokens';

const mediaEnvSchema = baseEnvSchema
  .merge(authEnvSchema)
  .merge(storageEnvSchema)
  .extend({
    SERVICE_NAME: z.string().default('media'),
    PORT: z.coerce.number().int().default(3108),

    /** Proveedor de video externo. Sin el, el video se sirve del bucket propio,
     *  que es aceptable en desarrollo y ruinoso en produccion. */
    VIDEO_PROVIDER_URL: optionalEnv(z.string().url()),
    VIDEO_PROVIDER_API_KEY: optionalEnv(z.string().min(16)),
  });

export type MediaConfig = z.infer<typeof mediaEnvSchema>;

export function loadMediaConfig(): MediaConfig {
  const config = loadEnv(mediaEnvSchema, withServiceDatabaseUrl('media'));

  // En produccion no se admite servir video desde nuestro propio bucket. La
  // decision de arquitectura es hibrida y esta tomada: el video largo va a un
  // proveedor externo con restriccion de dominio. Sin esta comprobacion, un
  // despliegue al que se le olvidara la variable empezaria a servir gigabytes
  // desde nuestro ancho de banda y el primer aviso seria la factura.
  if (config.NODE_ENV === 'production') {
    const missing: string[] = [];
    if (!config.VIDEO_PROVIDER_URL) missing.push('VIDEO_PROVIDER_URL');
    if (!config.VIDEO_PROVIDER_API_KEY) missing.push('VIDEO_PROVIDER_API_KEY');

    if (missing.length > 0) {
      process.stderr.write(
        `\nFaltan dependencias obligatorias en produccion:\n${missing
          .map((name) => `  - ${name}`)
          .join('\n')}\n\n`,
      );
      process.exit(1);
    }
  }

  return config;
}

@Module({
  controllers: [MediaController, HealthController],
  providers: [
    Reflector,

    { provide: CONFIG, useFactory: (): MediaConfig => loadMediaConfig() },

    {
      provide: LOGGER,
      useFactory: (config: MediaConfig) =>
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
      useFactory: (config: MediaConfig, logger: Logger): Pool =>
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
      useFactory: (config: MediaConfig, logger: Logger): Pool =>
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
      useFactory: (config: MediaConfig, logger: Logger): Redis =>
        createRedisClient(config.REDIS_URL, config.REDIS_KEY_PREFIX, logger),
      inject: [CONFIG, LOGGER],
    },
    {
      provide: UNIT_OF_WORK,
      useFactory: (pool: Pool, logger: Logger) => new PgUnitOfWork(pool, 'media', logger),
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
      provide: OBJECT_STORAGE,
      useFactory: (config: MediaConfig) =>
        new S3ObjectStorage({
          endpoint: config.S3_ENDPOINT,
          region: config.S3_REGION,
          accessKey: config.S3_ACCESS_KEY,
          secretKey: config.S3_SECRET_KEY,
          forcePathStyle: config.S3_FORCE_PATH_STYLE,
          defaultTtlSeconds: config.S3_PRESIGN_TTL_SECONDS,
        }),
      inject: [CONFIG],
    },
    {
      // El mismo adaptador implementa los dos puertos, pero se inyecta por
      // tokens distintos: quien lee un prefijo no necesita -ni debe- poder
      // borrar objetos.
      provide: PREFIX_READER,
      useFactory: (storage: S3ObjectStorage) => storage,
      inject: [OBJECT_STORAGE],
    },
    { provide: CONTENT_SNIFFER, useValue: new MagicBytesSniffer() },
    {
      provide: THUMBNAILER,
      useFactory: (storage: S3ObjectStorage, logger: Logger) =>
        new SharpThumbnailer(storage, logger),
      inject: [OBJECT_STORAGE, LOGGER],
    },
    {
      provide: VIDEO_PROVIDER,
      useFactory: (config: MediaConfig, storage: S3ObjectStorage, logger: Logger): VideoProvider =>
        config.VIDEO_PROVIDER_URL && config.VIDEO_PROVIDER_API_KEY
          ? new HttpVideoProvider(config.VIDEO_PROVIDER_URL, config.VIDEO_PROVIDER_API_KEY, logger)
          : new ObjectStorageVideoProvider(storage, config.S3_PRESIGN_TTL_SECONDS),
      inject: [CONFIG, OBJECT_STORAGE, LOGGER],
    },

    {
      provide: BUCKETS,
      useFactory: (config: MediaConfig): BucketMap => ({
        media: config.S3_BUCKET_MEDIA,
        documents: config.S3_BUCKET_DOCUMENTS,
        evidence: config.S3_BUCKET_EVIDENCE,
        certificates: config.S3_BUCKET_CERTIFICATES,
      }),
      inject: [CONFIG],
    },
    {
      provide: PRESIGN_TTL,
      useFactory: (config: MediaConfig) => config.S3_PRESIGN_TTL_SECONDS,
      inject: [CONFIG],
    },

    {
      provide: MEDIA_REPOSITORY,
      useFactory: (read: Pool) => new PgMediaAssetRepository(read),
      inject: [DB_READ_POOL],
    },

    {
      provide: RequestUploadUseCase,
      useFactory: (...args: ConstructorParameters<typeof RequestUploadUseCase>) =>
        new RequestUploadUseCase(...args),
      inject: [
        MEDIA_REPOSITORY,
        OBJECT_STORAGE,
        UNIT_OF_WORK,
        BUCKETS,
        PRESIGN_TTL,
        CLOCK,
        SECURE_RANDOM,
        LOGGER_PORT,
      ],
    },
    {
      provide: ConfirmUploadUseCase,
      useFactory: (...args: ConstructorParameters<typeof ConfirmUploadUseCase>) =>
        new ConfirmUploadUseCase(...args),
      inject: [
        MEDIA_REPOSITORY,
        OBJECT_STORAGE,
        PREFIX_READER,
        CONTENT_SNIFFER,
        THUMBNAILER,
        VIDEO_PROVIDER,
        UNIT_OF_WORK,
        CLOCK,
        LOGGER_PORT,
      ],
    },
    {
      provide: IssueDownloadUrlUseCase,
      useFactory: (...args: ConstructorParameters<typeof IssueDownloadUrlUseCase>) =>
        new IssueDownloadUrlUseCase(...args),
      inject: [MEDIA_REPOSITORY, OBJECT_STORAGE, VIDEO_PROVIDER, PRESIGN_TTL],
    },

    {
      provide: MediaController,
      useFactory: (...args: ConstructorParameters<typeof MediaController>) =>
        new MediaController(...args),
      inject: [RequestUploadUseCase, ConfirmUploadUseCase, IssueDownloadUrlUseCase],
    },

    {
      provide: JWT_VERIFY_OPTIONS,
      useFactory: (config: MediaConfig) => ({
        secret: config.JWT_ACCESS_SECRET,
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
      }),
      inject: [CONFIG],
    },

    // Por defecto TODO exige autenticacion; lo publico se marca con @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [CONFIG, LOGGER, LOGGER_PORT, DB_WRITE_POOL, DB_READ_POOL, REDIS_CLIENT, OBJECT_STORAGE],
})
export class MediaModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}

export type { MediaAssetRepository };
