import type { Identifier } from './identifier';
import type { DomainEvent } from './domain-event';

export abstract class Entity<Id extends Identifier> {
  protected constructor(public readonly id: Id) {}

  equals(other?: Entity<Id> | null): boolean {
    if (other === null || other === undefined) return false;
    if (other.constructor !== this.constructor) return false;
    return this.id.equals(other.id);
  }
}

/**
 * Raiz de agregado: unica puerta de entrada a un grupo de objetos que cambian
 * juntos y comparten invariante. Un caso de uso carga una raiz, la muta y la
 * persiste completa; nunca modifica entidades internas por separado.
 *
 * Los eventos se acumulan en memoria y el repositorio los vuelca a la tabla
 * `outbox` DENTRO de la misma transaccion que el cambio de estado. Asi el dato
 * y el evento no pueden desincronizarse aunque NATS este caido: un publicador
 * en segundo plano drena la outbox cuando el bus vuelve.
 */
export abstract class AggregateRoot<Id extends Identifier> extends Entity<Id> {
  private domainEventBuffer: DomainEvent[] = [];
  private currentVersion = 0;

  /** Version optimista. El UPDATE incluye `WHERE version = :expected` para que
   *  dos replicas que editan la misma raiz no se pisen silenciosamente. */
  get version(): number {
    return this.currentVersion;
  }

  /** Fija la version leida de la base al rehidratar el agregado. */
  protected setVersion(version: number): void {
    this.currentVersion = version;
  }

  get domainEvents(): readonly DomainEvent[] {
    return this.domainEventBuffer;
  }

  /** Registra un hecho y avanza la version del agregado. */
  protected record(build: (nextVersion: number) => DomainEvent): void {
    this.currentVersion += 1;
    this.domainEventBuffer.push(build(this.currentVersion));
  }

  /** El repositorio la invoca tras escribir los eventos en la outbox. */
  pullDomainEvents(): DomainEvent[] {
    const events = this.domainEventBuffer;
    this.domainEventBuffer = [];
    return events;
  }
}
