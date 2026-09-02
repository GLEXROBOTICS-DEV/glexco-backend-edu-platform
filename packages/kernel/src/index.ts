// Bloques de construccion compartidos por todos los microservicios.
// Este paquete NO depende de Nest, Express, Drizzle ni ninguna libreria de
// infraestructura: solo define el lenguaje comun del dominio y sus puertos.

export * from './domain/identifier';
export * from './domain/value-object';
export * from './domain/entity';
export * from './domain/domain-event';
export * from './domain/guard';

export * from './application/ports';
export * from './application/use-case';
export * from './application/pagination';

export * from './errors/domain-error';
