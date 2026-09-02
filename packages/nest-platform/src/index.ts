// Infraestructura NestJS compartida por los microservicios: adaptadores para
// los puertos definidos en @glexco/kernel, mas el arranque comun.

export * from './bootstrap';

export * from './http/domain-exception.filter';
export * from './http/correlation.middleware';
export * from './http/zod-validation.pipe';

export * from './auth/jwt.types';
export * from './auth/guards';
export * from './auth/internal.guard';

export * from './redis/redis.provider';
export * from './redis/redis-cache.store';
export * from './redis/redis-lock';
export * from './redis/rate-limiter';

export * from './database/database.provider';
export * from './database/unit-of-work';

export * from './messaging/nats.client';
export * from './messaging/outbox-relay';

export * from './resilience/circuit-breaker';

export * from './health/health.controller';
