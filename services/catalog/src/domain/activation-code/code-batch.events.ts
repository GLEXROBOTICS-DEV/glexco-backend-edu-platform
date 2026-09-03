import { DomainEvent, type DomainEventContext } from '@glexco/kernel';
import { EVENTS } from '@glexco/contracts';

/**
 * Hecho: se fabrico una tirada de codigos para un kit.
 *
 * `CodeBatch` no es un agregado con comportamiento -no tiene invariantes
 * propias mas alla de "se creo y no cambia"-, asi que el evento vive aqui y no
 * dentro de una clase agregada que solo existiria para emitirlo.
 *
 * La carga util NO lleva los codigos ni sus hashes, a proposito. Este evento
 * permanece dias en la outbox y en el stream, y lo que interesa aguas abajo
 * -inventario, facturacion, panel comercial- es cuantas unidades se fabricaron
 * y para que kit, nunca cuales.
 */
export interface CodeBatchGeneratedPayload {
  batchId: string;
  kitId: string;
  grade: string;
  total: number;
  distributedTo: string | null;
  reference: string | null;
  expiresAt: string | null;
}

export class CodeBatchGenerated extends DomainEvent<CodeBatchGeneratedPayload> {
  constructor(payload: CodeBatchGeneratedPayload, context?: DomainEventContext) {
    super(EVENTS.ACTIVATION_CODE_BATCH_GENERATED, 'CodeBatch', payload.batchId, 1, payload, context);
  }
}
