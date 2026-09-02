import { newUuid } from './identifier';

/**
 * Metadatos de un evento de dominio.
 *
 * Un evento es un hecho consumado (nombre en pasado) propiedad del contexto que
 * lo emite. Es el UNICO contrato que otros microservicios pueden observar:
 * nunca exponemos entidades ni tablas, para que cada servicio pueda cambiar su
 * modelo interno sin romper a nadie.
 */
export interface DomainEventMetadata {
  /** Id unico del evento. Los consumidores lo usan para deduplicar, porque
   *  JetStream garantiza at-least-once y un mismo evento puede llegar dos veces. */
  readonly eventId: string;
  /** Nombre estable y versionado: identity.user.registered.v1 */
  readonly eventName: string;
  /** Momento en que ocurrio el hecho, UTC ISO-8601. */
  readonly occurredAt: string;
  /** Id del agregado que lo produjo. */
  readonly aggregateId: string;
  /** Tipo de agregado, para enrutar y depurar. */
  readonly aggregateType: string;
  /** Version del agregado tras aplicar el evento. Permite a un consumidor
   *  detectar y descartar eventos que llegan fuera de orden. */
  readonly aggregateVersion: number;
  /** Id de correlacion que atraviesa toda la peticion original del usuario. */
  readonly correlationId?: string;
  /** Id del comando o evento que lo causo, para reconstruir la cadena completa. */
  readonly causationId?: string;
  /** Actor responsable del cambio, para auditoria. */
  readonly actorId?: string;
  /** Institucion afectada cuando aplica; permite particionar por tenant. */
  readonly tenantId?: string;
}

export type DomainEventContext = Partial<
  Pick<DomainEventMetadata, 'correlationId' | 'causationId' | 'actorId' | 'tenantId'>
>;

export abstract class DomainEvent<Payload = unknown> {
  readonly metadata: DomainEventMetadata;

  protected constructor(
    eventName: string,
    aggregateType: string,
    aggregateId: string,
    aggregateVersion: number,
    readonly payload: Payload,
    context: DomainEventContext = {},
  ) {
    this.metadata = {
      eventId: newUuid(),
      eventName,
      occurredAt: new Date().toISOString(),
      aggregateId,
      aggregateType,
      aggregateVersion,
      ...context,
    };
  }

  /** Forma serializada que viaja por NATS y se guarda en la tabla outbox. */
  toIntegrationEvent(): IntegrationEvent<Payload> {
    return { metadata: this.metadata, payload: this.payload };
  }
}

export interface IntegrationEvent<Payload = unknown> {
  readonly metadata: DomainEventMetadata;
  readonly payload: Payload;
}

/**
 * Evento reconstruido a partir de la outbox o del bus, cuando el consumidor no
 * conoce (ni debe conocer) la clase concreta del productor.
 */
export class GenericDomainEvent<P = unknown> extends DomainEvent<P> {
  constructor(metadata: DomainEventMetadata, payload: P) {
    super(
      metadata.eventName,
      metadata.aggregateType,
      metadata.aggregateId,
      metadata.aggregateVersion,
      payload,
    );
    Object.assign(this, { metadata });
  }
}
