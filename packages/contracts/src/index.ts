// Contratos compartidos: vocabulario de dominio, autorizacion, nombres de
// eventos y esquemas de validacion. Backend y frontend importan de aqui, de modo
// que un cambio de contrato rompe la compilacion en vez de romper produccion.

export * from './authorization/roles';
export * from './domain/vocabulary';
export * from './events/event-names';
export * from './schemas/common';
export * from './schemas/auth';
export * from './schemas/institutions';
export * from './schemas/catalog';
