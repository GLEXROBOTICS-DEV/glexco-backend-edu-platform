import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import type { CacheStore, Clock, SecureRandom, UnitOfWork } from '@glexco/kernel';
import {
  authEnvSchema,
  baseEnvSchema,
  loadEnv,
  optionalEnv,
  storageEnvSchema,
  withServiceDatabaseUrl,
} from '@glexco/config';
import {
  CONFIG,
  LOGGER,
  LOGGER_PORT,
  CLOCK,
  SECURE_RANDOM,
  UNIT_OF_WORK,
  ACTIVATION_CODE_REPOSITORY,
  KIT_REPOSITORY,
  ENTITLEMENT_REPOSITORY,
  CONTENT_REPOSITORY,
  CODE_PEPPER,
  CACHE_STORE,
  OBJECT_STORAGE,
  VIDEO_PLAYBACK,
} from './tokens';
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
  RedisCacheStore,
  S3ObjectStorage,
  createReadPool,
  createRedisClient,
  createWritePool,
} from '@glexco/nest-platform';
import { createLogger, toLoggerPort, type Logger } from '@glexco/observability';

import {
  CatalogController,
  ActivationCodesController,
  CodeBatchesController,
  ContentPublicationController,
  InternalActivationCodesController,
} from './interface/http/controllers';
import {
  PrecheckActivationCodeUseCase,
  RedeemActivationCodeUseCase,
} from './application/redeem-activation-code.usecase';
import { OpenLibraryAssetUseCase } from './application/open-library-asset.usecase';
import {
  GenerateCodeBatchUseCase,
  GetCodeBatchUseCase,
  ListCodeBatchesUseCase,
} from './application/generate-code-batch.usecase';
import {
  ListBatchCodesUseCase,
  RevokeActivationCodeUseCase,
} from './application/revoke-activation-code.usecase';
import { PublishContentUseCase } from './application/publish-content.usecase';
import { CachedContentRepository } from './infrastructure/persistence/cached-content.repository';
import type { ActivationCodeRepository } from './domain/repositories';
import { PgActivationCodeRepository } from './infrastructure/persistence/pg-activation-code.repository';
import {
  PgContentRepository,
  PgEntitlementRepository,
  PgKitRepository,
} from './infrastructure/persistence/pg-catalog.repositories';

/**
 * Configuracion del catalogo.
 *
 * `ACTIVATION_CODE_PEPPER` es obligatorio y sin valor por defecto. Es
 * deliberado: si tuviera uno, un despliegue descuidado usaria la pimienta de
 * ejemplo y los hashes de los codigos serian reproducibles por cualquiera que
 * conozca el repositorio.
 *
 * Cambiarla invalida TODOS los codigos ya emitidos, porque su hash deja de
 * coincidir. Es un secreto que se fija una vez y no se rota.
 */
const catalogEnvSchema = baseEnvSchema
  .merge(authEnvSchema.pick({ JWT_ACCESS_SECRET: true, JWT_ISSUER: true, JWT_AUDIENCE: true }))
  // Catalogo firma la descarga del material del kit, asi que necesita las
  // credenciales del almacen. Solo firma LECTURAS: no sube ni borra nada.
  .merge(storageEnvSchema)
  .extend({
    SERVICE_NAME: z.string().default('catalog'),
    PORT: z.coerce.number().int().default(3103),
    DATABASE_READ_URLS: z
      .string()
      .optional()
      .transform((value) =>
        (value ?? '').split(',').map((url) => url.trim()).filter(Boolean),
      ),
    ACTIVATION_CODE_PEPPER: z
      .string()
      .min(32, 'La pimienta de los codigos debe tener al menos 32 caracteres'),
    INTERNAL_SERVICE_TOKEN: z.string().min(32).optional(),
    /** Proveedor de video. Vacio en desarrollo: el video se sirve del bucket
     *  propio, igual que en media y con el mismo aviso -no vale para
     *  produccion, donde el ancho de banda lo paga la factura de salida-. */
    VIDEO_PROVIDER_URL: optionalEnv(z.string().url()),
  });

export type CatalogConfig = z.infer<typeof catalogEnvSchema>;

export function loadCatalogConfig(): CatalogConfig {
  const config = loadEnv(catalogEnvSchema, withServiceDatabaseUrl('catalog'));

  // El mismo corte que hace media, y por la misma razon: sin proveedor de
  // video, catalogo serviria los tutoriales del kit desde nuestro propio bucket.
  // Un video de clase son cientos de megas y lo abren aulas enteras a la vez;
  // el primer aviso de que se olvido configurarlo seria la factura de salida.
  if (config.NODE_ENV === 'production' && !config.VIDEO_PROVIDER_URL) {
    process.stderr.write(
      [
        '',
        'Falta VIDEO_PROVIDER_URL en produccion: el video del kit no puede',
        'salir de nuestro bucket.',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  return config;
}

// Los tokens viven en ./tokens para que los controladores puedan importarlos
// sin crear un ciclo con este modulo. Se reexportan para no romper a quien ya
// los importaba de aqui.
export {
  CONFIG,
  LOGGER,
  LOGGER_PORT,
  CLOCK,
  SECURE_RANDOM,
  UNIT_OF_WORK,
  ACTIVATION_CODE_REPOSITORY,
  KIT_REPOSITORY,
  ENTITLEMENT_REPOSITORY,
  CONTENT_REPOSITORY,
  CODE_PEPPER,
  CACHE_STORE,
} from './tokens';

@Module({
  controllers: [
    ActivationCodesController,
    CatalogController,
    CodeBatchesController,
    ContentPublicationController,
    InternalActivationCodesController,
    HealthController,
  ],
  providers: [
    Reflector,
    InternalOnlyGuard,

    { provide: CONFIG, useFactory: (): CatalogConfig => loadCatalogConfig() },

    {
      provide: LOGGER,
      useFactory: (config: CatalogConfig): Logger =>
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
      useFactory: (config: CatalogConfig, logger: Logger): Pool =>
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
      useFactory: (config: CatalogConfig, logger: Logger): Pool =>
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
      useFactory: (config: CatalogConfig, logger: Logger): Redis =>
        createRedisClient(config.REDIS_URL, config.REDIS_KEY_PREFIX, logger),
      inject: [CONFIG, LOGGER],
    },
    {
      provide: UNIT_OF_WORK,
      useFactory: (pool: Pool, logger: Logger): UnitOfWork =>
        new PgUnitOfWork(pool, 'catalog', logger),
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
      provide: CODE_PEPPER,
      useFactory: (config: CatalogConfig) => config.ACTIVATION_CODE_PEPPER,
      inject: [CONFIG],
    },

    {
      provide: ACTIVATION_CODE_REPOSITORY,
      useFactory: (read: Pool) => new PgActivationCodeRepository(read),
      inject: [DB_READ_POOL],
    },
    {
      provide: KIT_REPOSITORY,
      useFactory: (read: Pool) => new PgKitRepository(read),
      inject: [DB_READ_POOL],
    },
    {
      provide: ENTITLEMENT_REPOSITORY,
      useFactory: (read: Pool) => new PgEntitlementRepository(read),
      inject: [DB_READ_POOL],
    },
    {
      provide: CACHE_STORE,
      useFactory: (redis: Redis, config: CatalogConfig, logger: Logger) =>
        new RedisCacheStore(redis, config.CACHE_DEFAULT_TTL_SECONDS, logger),
      inject: [REDIS_CLIENT, CONFIG, LOGGER],
    },
    {
      // El repositorio de contenido va SIEMPRE envuelto en cache: la biblioteca
      // de un kit es la consulta mas repetida de la plataforma y su contenido
      // cambia una vez al trimestre. Envolverlo aqui, y no en el controlador,
      // hace que la cache cubra a cualquiera que lea contenido.
      provide: CONTENT_REPOSITORY,
      useFactory: (read: Pool, cache: CacheStore) =>
        new CachedContentRepository(new PgContentRepository(read), cache),
      inject: [DB_READ_POOL, CACHE_STORE],
    },

    {
      provide: RedeemActivationCodeUseCase,
      useFactory: (...args: ConstructorParameters<typeof RedeemActivationCodeUseCase>) =>
        new RedeemActivationCodeUseCase(...args),
      inject: [
        ACTIVATION_CODE_REPOSITORY,
        KIT_REPOSITORY,
        ENTITLEMENT_REPOSITORY,
        UNIT_OF_WORK,
        CLOCK,
        LOGGER_PORT,
        CODE_PEPPER,
        SECURE_RANDOM,
      ],
    },
    {
      provide: GenerateCodeBatchUseCase,
      useFactory: (...args: ConstructorParameters<typeof GenerateCodeBatchUseCase>) =>
        new GenerateCodeBatchUseCase(...args),
      inject: [
        ACTIVATION_CODE_REPOSITORY,
        KIT_REPOSITORY,
        UNIT_OF_WORK,
        CLOCK,
        LOGGER_PORT,
        CODE_PEPPER,
        SECURE_RANDOM,
      ],
    },
    {
      provide: GetCodeBatchUseCase,
      useFactory: (codes: ActivationCodeRepository) => new GetCodeBatchUseCase(codes),
      inject: [ACTIVATION_CODE_REPOSITORY],
    },
    {
      provide: ListCodeBatchesUseCase,
      useFactory: (codes: ActivationCodeRepository) => new ListCodeBatchesUseCase(codes),
      inject: [ACTIVATION_CODE_REPOSITORY],
    },
    {
      provide: PublishContentUseCase,
      useFactory: (...args: ConstructorParameters<typeof PublishContentUseCase>) =>
        new PublishContentUseCase(...args),
      inject: [CONTENT_REPOSITORY, UNIT_OF_WORK, CACHE_STORE, CLOCK, LOGGER_PORT],
    },
    {
      provide: RevokeActivationCodeUseCase,
      useFactory: (...args: ConstructorParameters<typeof RevokeActivationCodeUseCase>) =>
        new RevokeActivationCodeUseCase(...args),
      inject: [
        ACTIVATION_CODE_REPOSITORY,
        ENTITLEMENT_REPOSITORY,
        UNIT_OF_WORK,
        CLOCK,
        LOGGER_PORT,
      ],
    },
    {
      provide: ListBatchCodesUseCase,
      useFactory: (codes: ActivationCodeRepository) => new ListBatchCodesUseCase(codes),
      inject: [ACTIVATION_CODE_REPOSITORY],
    },
    {
      provide: PrecheckActivationCodeUseCase,
      useFactory: (...args: ConstructorParameters<typeof PrecheckActivationCodeUseCase>) =>
        new PrecheckActivationCodeUseCase(...args),
      inject: [ACTIVATION_CODE_REPOSITORY, KIT_REPOSITORY, CLOCK, CODE_PEPPER],
    },

    {
      provide: CatalogController,
      useFactory: (...args: ConstructorParameters<typeof CatalogController>) =>
        new CatalogController(...args),
      inject: [
        RedeemActivationCodeUseCase,
        ENTITLEMENT_REPOSITORY,
        KIT_REPOSITORY,
        CONTENT_REPOSITORY,
      ],
    },
    {
      provide: InternalActivationCodesController,
      useFactory: (...args: ConstructorParameters<typeof InternalActivationCodesController>) =>
        new InternalActivationCodesController(...args),
      inject: [PrecheckActivationCodeUseCase],
    },

    {
      provide: OBJECT_STORAGE,
      useFactory: (config: CatalogConfig) =>
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
      provide: VIDEO_PLAYBACK,
      // Sin proveedor contratado, la referencia guardada es "bucket:clave" y se
      // firma contra el bucket propio. Es el mismo sustituto que usa media y
      // vale exactamente para lo mismo: desarrollar. En produccion la URL la da
      // el proveedor, que es quien aplica la restriccion de dominio.
      useFactory: (config: CatalogConfig, storage: S3ObjectStorage) => {
        const base = config.VIDEO_PROVIDER_URL;
        if (base) {
          return async (ref: string): Promise<string> =>
            `${base}/play/${encodeURIComponent(ref)}`;
        }
        return async (ref: string): Promise<string> => {
          const separator = ref.indexOf(':');
          if (separator < 0) {
            throw new Error(`Referencia de video sin bucket: ${ref}`);
          }
          return storage.presignDownload(
            ref.slice(0, separator),
            ref.slice(separator + 1),
            config.S3_PRESIGN_TTL_SECONDS,
          );
        };
      },
      inject: [CONFIG, OBJECT_STORAGE],
    },
    {
      provide: OpenLibraryAssetUseCase,
      useFactory: (
        content: ConstructorParameters<typeof OpenLibraryAssetUseCase>[0],
        entitlements: ConstructorParameters<typeof OpenLibraryAssetUseCase>[1],
        storage: ConstructorParameters<typeof OpenLibraryAssetUseCase>[2],
        playback: ConstructorParameters<typeof OpenLibraryAssetUseCase>[3],
        config: CatalogConfig,
      ) =>
        new OpenLibraryAssetUseCase(
          content,
          entitlements,
          storage,
          playback,
          Boolean(config.VIDEO_PROVIDER_URL),
          config.S3_PRESIGN_TTL_SECONDS,
        ),
      inject: [CONTENT_REPOSITORY, ENTITLEMENT_REPOSITORY, OBJECT_STORAGE, VIDEO_PLAYBACK, CONFIG],
    },

    {
      provide: JWT_VERIFY_OPTIONS,
      useFactory: (config: CatalogConfig) => ({
        secret: config.JWT_ACCESS_SECRET,
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
      }),
      inject: [CONFIG],
    },
    {
      provide: INTERNAL_SERVICE_TOKEN,
      useFactory: (config: CatalogConfig) => config.INTERNAL_SERVICE_TOKEN,
      inject: [CONFIG],
    },

    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [CONFIG, LOGGER, DB_WRITE_POOL, DB_READ_POOL, REDIS_CLIENT],
})
export class CatalogModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
