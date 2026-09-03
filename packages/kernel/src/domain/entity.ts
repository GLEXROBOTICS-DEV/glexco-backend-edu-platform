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
  private changed = false;

  /**
   * Si el agregado cambio desde que se cargo.
   *
   * Existe para cerrar una clase entera de error que ya aparecio tres veces en
   * este proyecto. El patron es siempre el mismo: una operacion idempotente
   * -reanular, reentregar, reconfirmar- sale sin tocar nada, la version no
   * avanza, y el `UPDATE ... WHERE version < :nueva` no encuentra fila. El
   * repositorio interpreta eso como escritura concurrente y lanza un conflicto
   * que no existe, justo en el camino que deberia ser el mas inofensivo.
   *
   * Con esto, un `save` sobre un agregado sin cambios no hace nada, que es
   * exactamente lo correcto. El error deja de poder cometerse en vez de tener
   * que recordarlo en cada caso de uso.
   */
  get hasChanges(): boolean {
    return this.changed;
  }

  /** Version optimista. El UPDATE incluye `WHERE version = :expected` para que
   *  dos replicas que editan la misma raiz no se pisen silenciosamente. */
  get version(): number {
    return this.currentVersion;
  }

  /**
   * Fija la version leida de la base al rehidratar el agregado.
   *
   * Marca el agregado como limpio: acaba de salir de la base, asi que por
   * definicion todavia no ha cambiado nada.
   */
  protected setVersion(version: number): void {
    this.currentVersion = version;
    this.changed = false;
  }

  get domainEvents(): readonly DomainEvent[] {
    return this.domainEventBuffer;
  }

  /**
   * Avanza la version SIN emitir evento de dominio.
   *
   * Existe para los cambios de estado que deliberadamente no son un hecho que
   * otro servicio deba conocer: un inicio de sesion correcto, un intento
   * fallido, un rehasheo de contrasena. Sin esto, la version no avanza, el
   * `UPDATE ... WHERE version < :nueva` no encuentra fila y la escritura muere
   * con un conflicto de concurrencia inventado -aunque no haya concurrencia
   * ninguna-. Es decir: emitir evento y avanzar version son dos cosas
   * distintas, y confundirlas rompe justo las operaciones mas frecuentes.
   */
  protected touch(): void {
    this.currentVersion += 1;
    this.changed = true;
  }

  /** Registra un hecho y avanza la version del agregado. */
  protected record(build: (nextVersion: number) => DomainEvent): void {
    this.currentVersion += 1;
    this.changed = true;
    this.domainEventBuffer.push(build(this.currentVersion));
  }

  /** El repositorio la invoca tras escribir los eventos en la outbox. */
  pullDomainEvents(): DomainEvent[] {
    const events = this.domainEventBuffer;
    this.domainEventBuffer = [];
    return events;
  }
}
