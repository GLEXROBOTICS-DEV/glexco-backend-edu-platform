import {
  BusinessRuleError,
  NotFoundError,
  type Clock,
  type ExecutionContext,
  type LoggerPort,
  type SecureRandom,
  type UnitOfWork,
  type UseCase,
} from '@glexco/kernel';
import { ActivationCodeValue } from '../domain/activation-code/activation-code.aggregate';
import { hashActivationCode } from '../domain/activation-code/code-generator';
import type {
  ActivationCodeRepository,
  EntitlementRepository,
  KitRepository,
} from '../domain/repositories';
import { Entitlement, EntitlementId } from '../domain/entitlement/entitlement.aggregate';

export interface RedeemActivationCodeInput {
  code: string;
  studentId: string;
  institutionId?: string;
}

export interface RedeemActivationCodeOutput {
  kitId: string;
  kitName: string;
  program: string;
  grade: string;
  /** `false` si el codigo ya lo habia canjeado ESTE mismo alumno. Permite a
   *  quien llama distinguir un alta nueva de un reintento sin tratar el segundo
   *  como error. */
  firstRedemption: boolean;
}

/**
 * Canje del codigo de activacion del libro.
 *
 * Es la operacion mas delicada de la plataforma: convierte un objeto con valor
 * economico en acceso permanente al contenido de un kit, y es irreversible.
 *
 * **La garantia de un solo uso se apoya en tres piezas, y las tres hacen falta:**
 *
 * 1. Todo ocurre dentro de UNA transaccion.
 * 2. El codigo se carga con `SELECT ... FOR UPDATE`, de modo que dos peticiones
 *    simultaneas con el mismo codigo se serializan: la segunda espera y ve el
 *    estado ya actualizado.
 * 3. El agregado rechaza canjear lo ya canjeado.
 *
 * Quitar cualquiera de las tres reabre la carrera. La mas facil de olvidar es la
 * segunda, porque sin ella todo "funciona" en desarrollo -donde nunca hay dos
 * peticiones a la vez- y falla el primer dia de clase, cuando treinta alumnos
 * activan en el mismo minuto.
 *
 * El derecho de acceso (`Entitlement`) se crea en la MISMA transaccion. Si se
 * crease despues, un fallo entre ambos pasos dejaria al alumno con el codigo
 * quemado y sin acceso: el peor resultado posible, porque el codigo ya no
 * volveria a servir.
 */
export class RedeemActivationCodeUseCase
  implements UseCase<RedeemActivationCodeInput, RedeemActivationCodeOutput>
{
  constructor(
    private readonly codes: ActivationCodeRepository,
    private readonly kits: KitRepository,
    private readonly entitlements: EntitlementRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly logger: LoggerPort,
    /** Pimienta con la que se hashean los codigos. Vive en configuracion y no en
     *  la base, para que robar la base no baste para reconstruir hashes. */
    private readonly pepper: string,
    private readonly ids: SecureRandom,
  ) {}

  async execute(
    input: RedeemActivationCodeInput,
    context: ExecutionContext,
  ): Promise<RedeemActivationCodeOutput> {
    const now = this.clock.now();

    // La normalizacion y el formato se validan antes de tocar la base: un codigo
    // mal transcrito no debe consumir una conexion ni un bloqueo.
    const code = ActivationCodeValue.create(input.code);
    const codeHash = hashActivationCode(code, this.pepper);

    return this.unitOfWork.run(async (tx) => {
      const activationCode = await this.codes.findByHashForUpdate(codeHash, tx);

      if (!activationCode) {
        // Mismo error que para un codigo revocado o caducado: distinguirlos
        // permitiria a quien sondea saber que ha acertado un codigo real.
        throw new BusinessRuleError(
          'ACTIVATION_CODE_INVALID',
          'El codigo del libro no es valido. Revisa que lo hayas copiado correctamente.',
          { field: 'activationCode' },
        );
      }

      const alreadyMine =
        activationCode.status === 'redeemed' && activationCode.redeemedBy === input.studentId;

      // Lanza si el codigo no es canjeable; es idempotente si lo canjeo el mismo
      // alumno, lo que cubre el reintento de red y el evento entregado dos veces.
      activationCode.redeem({
        studentId: input.studentId,
        institutionId: input.institutionId,
        now,
      });

      const kit = await this.kits.findById(activationCode.kitId);
      if (!kit) {
        // El codigo apunta a un kit que ya no existe. Es un fallo nuestro, no del
        // usuario: se aborta la transaccion para no quemar su codigo por un error
        // de datos que podemos arreglar.
        throw new NotFoundError(
          'KIT_NOT_FOUND',
          'El contenido asociado a este codigo no esta disponible. Contacta con soporte.',
          { kitId: activationCode.kitId },
        );
      }

      await this.codes.save(activationCode, tx);

      // El derecho de acceso, en la MISMA transaccion que el canje.
      const entitlement = Entitlement.grant({
        id: EntitlementId.create(this.ids.hex(16).slice(0, 32)),
        studentId: input.studentId,
        kitId: kit.id,
        grade: activationCode.grade,
        institutionId: input.institutionId ?? null,
        sourceActivationCodeId: activationCode.id.value,
        now,
      });

      await this.entitlements.save(entitlement, tx);

      (tx as { enqueue(...events: unknown[]): void }).enqueue(
        ...activationCode.pullDomainEvents(),
        ...entitlement.pullDomainEvents(),
      );

      this.logger.info('Codigo de activacion canjeado', {
        studentId: input.studentId,
        kitId: kit.id,
        // El sufijo, nunca el codigo completo: los logs se conservan y se
        // exportan a un agregador.
        codeSuffix: activationCode.codeSuffix,
        correlationId: context.correlationId,
      });

      return {
        kitId: kit.id,
        kitName: kit.name,
        program: kit.program,
        grade: activationCode.grade,
        firstRedemption: !alreadyMine,
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Comprobacion previa
// ---------------------------------------------------------------------------

export interface PrecheckActivationCodeOutput {
  valid: boolean;
  reason?: 'not_found' | 'already_redeemed' | 'revoked' | 'expired';
  kitId?: string;
  kitName?: string;
  grade?: string;
  program?: 'discover' | 'academy';
}

/**
 * Comprobacion previa que consulta el servicio de identidad durante el registro.
 *
 * Es una LECTURA sin bloqueo, a proposito. Bloquear la fila en cada pulsacion
 * del formulario serializaria todos los registros que comparten lote y
 * convertiria una comprobacion de comodidad en un cuello de botella.
 *
 * El canje real vuelve a comprobarlo todo dentro de la transaccion, asi que una
 * carrera entre esta lectura y el canje no otorga acceso indebido: solo hace que
 * el usuario vea el error un paso mas tarde.
 */
export class PrecheckActivationCodeUseCase
  implements UseCase<{ code: string }, PrecheckActivationCodeOutput>
{
  constructor(
    private readonly codes: ActivationCodeRepository,
    private readonly kits: KitRepository,
    private readonly clock: Clock,
    private readonly pepper: string,
  ) {}

  async execute(input: { code: string }): Promise<PrecheckActivationCodeOutput> {
    let code: ActivationCodeValue;
    try {
      code = ActivationCodeValue.create(input.code);
    } catch {
      // Un formato invalido no llega siquiera a la base.
      return { valid: false, reason: 'not_found' };
    }

    const activationCode = await this.codes.findByHash(hashActivationCode(code, this.pepper));
    if (!activationCode) return { valid: false, reason: 'not_found' };

    const check = activationCode.redeemabilityAt(this.clock.now());
    if (!check.ok) return { valid: false, reason: check.reason };

    const kit = await this.kits.findById(activationCode.kitId);
    if (!kit) return { valid: false, reason: 'not_found' };

    return {
      valid: true,
      kitId: kit.id,
      kitName: kit.name,
      grade: activationCode.grade,
      program: kit.program,
    };
  }
}
