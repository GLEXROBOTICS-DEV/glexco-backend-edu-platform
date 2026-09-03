import type { DomainEvent, IntegrationEvent } from '../domain/domain-event';

/**
 * Puertos de la arquitectura hexagonal.
 *
 * Cada puerto es una interfaz que el dominio y los casos de uso declaran segun
 * lo que NECESITAN, no segun lo que una libreria ofrece. Los adaptadores
 * (Postgres, Redis, NATS, S3, SMTP) los implementan en la capa de
 * infraestructura. Consecuencia practica: los tests de casos de uso corren en
 * memoria, sin Docker, en milisegundos.
 */

/** Reloj inyectable: ninguna regla de negocio llama a `new Date()` directamente,
 *  porque eso hace imposible testear caducidades y ventanas de tiempo. */
export interface Clock {
  now(): Date;
  /** Instante actual en milisegundos, para medir duraciones. */
  timestamp(): number;
}

/** Generador de identificadores, inyectable para obtener ids deterministas en tests. */
export interface IdGenerator {
  generate(): string;
}

/** Generador criptografico para codigos de activacion, tokens y sales. */
export interface SecureRandom {
  /** Bytes aleatorios en hexadecimal. */
  hex(bytes: number): string;
  /** Cadena aleatoria sobre un alfabeto dado (usado en codigos de libro). */
  fromAlphabet(alphabet: string, length: number): string;
  /**
   * UUID v4 para identificar un agregado nuevo.
   *
   * Existe aparte de `hex` porque no son intercambiables: `hex(16)` da 32
   * caracteres sin guiones, que `Identifier` rechaza y la columna `uuid` de
   * PostgreSQL tampoco acepta. Tenerlo en el puerto evita que cada caso de uso
   * improvise su propia conversion.
   */
  uuid(): string;
}

/** Publicador de eventos de integracion hacia el bus. */
export interface EventPublisher {
  publish(events: readonly (DomainEvent | IntegrationEvent)[]): Promise<void>;
}

/**
 * Unidad de trabajo. Agrupa varias escrituras y la insercion en la outbox en una
 * sola transaccion de base de datos.
 *
 * Es lo que hace segura la mensajeria: o se guardan el cambio de estado y el
 * evento, o no se guarda ninguno de los dos.
 */
export interface UnitOfWork {
  run<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T>;
}

/**
 * Handle opaco de transaccion que los repositorios reciben y propagan.
 *
 * La capa de aplicacion no sabe que hay dentro (es un cliente de PostgreSQL,
 * pero podria ser otra cosa): solo lo recibe de la unidad de trabajo y se lo
 * pasa a los repositorios. La marca opcional existe para documentar la intencion
 * sin obligar a los adaptadores a fabricar un simbolo.
 */
export interface TransactionContext {
  readonly __transactionBrand?: 'transaction';
}

/**
 * Cache distribuida (Redis). Patron cache-aside: el caso de uso pregunta a la
 * cache, y si falla va al repositorio y rellena.
 *
 * Se expone `withTags` porque en catalogo necesitamos invalidar en bloque
 * (por ejemplo, "todo lo del curso X") cuando un administrador GLEXCO edita
 * contenido base, sin recorrer claves una por una.
 */
export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number, tags?: readonly string[]): Promise<void>;
  delete(...keys: string[]): Promise<void>;
  invalidateTag(tag: string): Promise<void>;
  /** Cache-aside en una sola llamada, con proteccion contra estampida. */
  wrap<T>(
    key: string,
    ttlSeconds: number,
    producer: () => Promise<T>,
    tags?: readonly string[],
  ): Promise<T>;
}

/** Cerrojo distribuido, para tareas que solo una replica debe ejecutar. */
export interface DistributedLock {
  acquire(key: string, ttlMs: number): Promise<LockHandle | null>;
  withLock<T>(key: string, ttlMs: number, work: () => Promise<T>): Promise<T | null>;
}

export interface LockHandle {
  release(): Promise<void>;
  extend(ttlMs: number): Promise<boolean>;
}

/** Hasher de contrasenas. La implementacion (argon2id o bcrypt) se elige por
 *  configuracion, y `needsRehash` permite migrar de algoritmo sin pedir al
 *  usuario que cambie su contrasena. */
export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
  needsRehash(hash: string): boolean;
}

/** Almacenamiento de objetos. Todos los buckets son privados: el acceso se da
 *  con URLs prefirmadas de vida corta, nunca con enlaces publicos. */
export interface ObjectStorage {
  presignUpload(input: PresignUploadInput): Promise<PresignedUpload>;
  presignDownload(bucket: string, key: string, ttlSeconds?: number): Promise<string>;
  delete(bucket: string, key: string): Promise<void>;
  head(bucket: string, key: string): Promise<ObjectMetadata | null>;
}

export interface PresignUploadInput {
  bucket: string;
  key: string;
  contentType: string;
  maxSizeBytes: number;
  ttlSeconds?: number;
  metadata?: Record<string, string>;
}

export interface PresignedUpload {
  url: string;
  fields: Record<string, string>;
  key: string;
  expiresAt: string;
}

export interface ObjectMetadata {
  size: number;
  contentType: string;
  etag: string;
  lastModified: string;
}

/** Envio de correo transaccional (verificacion, recuperacion, invitaciones). */
export interface Mailer {
  send(message: OutgoingMail): Promise<void>;
}

export interface OutgoingMail {
  to: string;
  /** Plantilla registrada, no HTML suelto: garantiza que exista en es y en. */
  template: string;
  locale: 'es' | 'en';
  variables: Record<string, string | number>;
  subjectVariables?: Record<string, string | number>;
}

/** Logger estructurado con contexto de correlacion ya inyectado. */
export interface LoggerPort {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: unknown, context?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): LoggerPort;
}
