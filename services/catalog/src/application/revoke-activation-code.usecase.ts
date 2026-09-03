import {
  BusinessRuleError,
  NotFoundError,
  type Clock,
  type CursorPage,
  type CursorQuery,
  type ExecutionContext,
  type LoggerPort,
  type UnitOfWork,
  type UseCase,
} from '@glexco/kernel';
import { ACTIVATION_CODE_STATUS } from '@glexco/contracts';
import type {
  ActivationCodeRepository,
  BatchCodeSummary,
  EntitlementRepository,
} from '../domain/repositories';

export interface RevokeActivationCodeInput {
  activationCodeId: string;
  reason: string;
}

export interface RevokeActivationCodeOutput {
  activationCodeId: string;
  codeSuffix: string;
  /** `true` si el codigo ya estaba canjeado y ademas se retiro el acceso. */
  entitlementRevoked: boolean;
  previouslyRedeemedBy: string | null;
}

/**
 * Anula un codigo de activacion y, si ya estaba canjeado, retira el acceso que
 * concedio.
 *
 * **Las dos cosas van juntas y en la misma transaccion.** Anular el codigo sin
 * retirar el derecho deja al alumno viendo contenido de un libro devuelto, y
 * retirar el derecho sin anular el codigo permite volver a canjearlo. Separarlo
 * en dos operaciones -aunque se llamen seguidas- abre una ventana en la que el
 * sistema queda en uno de esos dos estados.
 *
 * Se anula por tres motivos reales: error de imprenta (un lote mal generado),
 * devolucion del libro, o fraude. No es una operacion rutinaria: la tiene
 * `platform_admin` y nadie mas, porque retira acceso ya pagado.
 *
 * El codigo se carga con `SELECT ... FOR UPDATE` igual que en el canje, y por el
 * mismo motivo: si un alumno esta canjeandolo en este instante, una de las dos
 * operaciones tiene que esperar a la otra. Sin el bloqueo, la anulacion podria
 * colarse entre la lectura y la escritura del canje y el alumno acabaria con un
 * acceso que nadie puede retirar, porque el codigo ya figura anulado.
 */
export class RevokeActivationCodeUseCase
  implements UseCase<RevokeActivationCodeInput, RevokeActivationCodeOutput>
{
  constructor(
    private readonly codes: ActivationCodeRepository,
    private readonly entitlements: EntitlementRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly logger: LoggerPort,
  ) {}

  async execute(
    input: RevokeActivationCodeInput,
    context: ExecutionContext,
  ): Promise<RevokeActivationCodeOutput> {
    const operatorId = context.actor?.userId;
    if (!operatorId) {
      throw new BusinessRuleError(
        'ACTOR_REQUIRED',
        'La anulacion de un codigo exige un operador identificado.',
      );
    }

    const now = this.clock.now();

    return this.unitOfWork.run(async (tx) => {
      const code = await this.codes.findByIdForUpdate(input.activationCodeId, tx);

      if (!code) {
        throw new NotFoundError('ACTIVATION_CODE_NOT_FOUND', 'El codigo indicado no existe.', {
          activationCodeId: input.activationCodeId,
        });
      }

      const previouslyRedeemedBy = code.redeemedBy;

      // Idempotente: anular dos veces no es un error. Soporte puede reintentar
      // sin miedo, y un reintento de red no debe devolver un fallo que invite a
      // investigar algo que ya esta hecho.
      //
      // Se sale ANTES de guardar, no despues. El agregado ya no cambia de estado
      // al reanular, asi que su version tampoco avanza, y el UPDATE optimista
      // -que exige version < la nueva- no encontraria fila y lanzaria un
      // conflicto de concurrencia que aqui no existe.
      if (code.status === ACTIVATION_CODE_STATUS.REVOKED) {
        return {
          activationCodeId: code.id.value,
          codeSuffix: code.codeSuffix,
          entitlementRevoked: false,
          previouslyRedeemedBy,
        };
      }

      code.revoke(input.reason, operatorId, now);
      await this.codes.save(code, tx);

      let entitlementRevoked = false;

      if (previouslyRedeemedBy) {
        const entitlement = await this.entitlements.findByActivationCode(code.id.value);

        // Un codigo canjeado sin derecho asociado no deberia existir -se crean en
        // la misma transaccion-, pero si ocurriera, anular el codigo sigue siendo
        // lo correcto: no hay acceso que retirar.
        if (entitlement?.isActive) {
          entitlement.revoke(`activation_code_revoked: ${input.reason}`, now);
          await this.entitlements.save(entitlement, tx);
          entitlementRevoked = true;

          (tx as { enqueue(...events: unknown[]): void }).enqueue(
            ...entitlement.pullDomainEvents(),
          );
        }
      }

      (tx as { enqueue(...events: unknown[]): void }).enqueue(...code.pullDomainEvents());

      this.logger.warn('Codigo de activacion anulado', {
        activationCodeId: code.id.value,
        codeSuffix: code.codeSuffix,
        reason: input.reason,
        operatorId,
        entitlementRevoked,
        previouslyRedeemedBy,
        correlationId: context.correlationId,
      });

      return {
        activationCodeId: code.id.value,
        codeSuffix: code.codeSuffix,
        entitlementRevoked,
        previouslyRedeemedBy,
      };
    });
  }
}

/**
 * Codigos de un lote, para que soporte encuentre el que hay que anular.
 *
 * Devuelve el sufijo -los cuatro ultimos caracteres- y nunca el codigo, que no
 * existe en la base. Con el sufijo, el cliente al telefono confirma cual es el
 * suyo y soporte identifica la fila sin que nadie pueda reconstruir codigos
 * ajenos recorriendo el listado.
 */
export class ListBatchCodesUseCase
  implements UseCase<{ batchId: string; page: CursorQuery }, CursorPage<BatchCodeSummary>>
{
  constructor(private readonly codes: ActivationCodeRepository) {}

  async execute(input: { batchId: string; page: CursorQuery }): Promise<CursorPage<BatchCodeSummary>> {
    return this.codes.listCodesByBatch(input.batchId, input.page);
  }
}
