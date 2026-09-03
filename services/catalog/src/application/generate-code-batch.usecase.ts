import {
  BusinessRuleError,
  NotFoundError,
  type Clock,
  type CursorPage,
  type CursorQuery,
  type ExecutionContext,
  type LoggerPort,
  type SecureRandom,
  type UnitOfWork,
  type UseCase,
} from '@glexco/kernel';
import { MAX_CODE_BATCH_SIZE } from '@glexco/contracts';
import { generateBatch } from '../domain/activation-code/code-generator';
import { CodeBatchGenerated } from '../domain/activation-code/code-batch.events';
import type {
  ActivationCodeRepository,
  CodeBatchSummary,
  KitRepository,
} from '../domain/repositories';

export interface GenerateCodeBatchInput {
  kitId: string;
  size: number;
  distributedTo?: string | undefined;
  reference?: string | undefined;
  expiresAt?: string | undefined;
}

export interface GenerateCodeBatchOutput {
  batchId: string;
  kitId: string;
  kitName: string;
  grade: string;
  total: number;
  createdAt: string;
  /**
   * Los codigos EN CLARO.
   *
   * Es la unica vez que existen. Quien llama los exporta para la imprenta y no
   * vuelven a estar disponibles: en la base solo queda el hash.
   */
  codes: string[];
}

/**
 * Genera una tirada de codigos de activacion.
 *
 * Es la operacion que fabrica valor economico: cada codigo de este lote acaba
 * impreso dentro de un libro y equivale a un acceso vendible. De ahi las tres
 * decisiones que la gobiernan:
 *
 * 1. **Los codigos se devuelven una sola vez.** En la base se guarda unicamente
 *    su hash con pimienta, asi que no hay forma de reconstruir el fichero mas
 *    tarde ni aunque se robe la base entera. No existe -ni debe existir- un
 *    endpoint para volver a descargar el CSV de un lote.
 *
 * 2. **Generacion e insercion van en la MISMA transaccion.** Si se confirmara el
 *    lote y fallara la insercion de los codigos, quedaria una tirada fantasma; y
 *    al reves, codigos huerfanos sin lote al que rendir cuentas. El indice unico
 *    sobre el hash es la ultima red: una colision -astronomicamente improbable-
 *    aborta la transaccion entera en vez de emitir dos codigos identicos.
 *
 * 3. **El kit tiene que existir y estar publicado.** Imprimir cien mil codigos
 *    contra un kit en borrador produce libros cuyo codigo no abre nada, y el
 *    error se descubre cuando el libro ya esta en manos de un nino.
 */
export class GenerateCodeBatchUseCase
  implements UseCase<GenerateCodeBatchInput, GenerateCodeBatchOutput>
{
  constructor(
    private readonly codes: ActivationCodeRepository,
    private readonly kits: KitRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly logger: LoggerPort,
    private readonly pepper: string,
    private readonly ids: SecureRandom,
  ) {}

  async execute(
    input: GenerateCodeBatchInput,
    context: ExecutionContext,
  ): Promise<GenerateCodeBatchOutput> {
    const operatorId = context.actor?.userId;
    if (!operatorId) {
      throw new BusinessRuleError(
        'ACTOR_REQUIRED',
        'La generacion de lotes exige un operador identificado.',
      );
    }

    if (input.size > MAX_CODE_BATCH_SIZE) {
      throw new BusinessRuleError(
        'BATCH_TOO_LARGE',
        `Un lote no puede superar los ${MAX_CODE_BATCH_SIZE} codigos.`,
        { field: 'size', max: MAX_CODE_BATCH_SIZE },
      );
    }

    const kit = await this.kits.findById(input.kitId);
    if (!kit) {
      throw new NotFoundError('KIT_NOT_FOUND', 'El kit indicado no existe.', {
        kitId: input.kitId,
      });
    }

    if (kit.status !== 'published') {
      throw new BusinessRuleError(
        'KIT_NOT_PUBLISHED',
        'Solo se pueden imprimir codigos de un kit publicado. Publicalo antes de generar la tirada.',
        { kitId: kit.id, status: kit.status },
      );
    }

    const now = this.clock.now();
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;

    if (expiresAt && expiresAt.getTime() <= now.getTime()) {
      throw new BusinessRuleError(
        'BATCH_EXPIRY_IN_THE_PAST',
        'La fecha de caducidad del lote ya paso.',
        { field: 'expiresAt' },
      );
    }

    // La generacion ocurre ANTES de abrir la transaccion: para cien mil codigos
    // son varios segundos de CPU, y tener una transaccion abierta mientras tanto
    // retendria una conexion y bloquearia el vacuum sin necesidad ninguna.
    const generated = generateBatch(input.size, this.pepper);
    const batchId = this.ids.uuid();

    await this.unitOfWork.run(async (tx) => {
      await this.codes.createBatch(
        {
          id: batchId,
          kitId: kit.id,
          grade: kit.grade,
          total: input.size,
          distributedTo: input.distributedTo ?? null,
          reference: input.reference ?? null,
          createdBy: operatorId,
        },
        tx,
      );

      await this.codes.insertBatch(
        batchId,
        generated.map((item) => ({
          id: this.ids.uuid(),
          codeHash: item.hash,
          codeSuffix: item.suffix,
          kitId: kit.id,
          grade: kit.grade,
          expiresAt,
        })),
        tx,
      );

      // El evento NO lleva los codigos, ni sus hashes. Vive dias en la outbox y
      // en el stream, y ningun consumidor los necesita: lo que interesa aguas
      // abajo es que se fabrico una tirada de tantas unidades para tal kit.
      (tx as { enqueue(...events: unknown[]): void }).enqueue(
        new CodeBatchGenerated(
          {
            batchId,
            kitId: kit.id,
            grade: kit.grade,
            total: input.size,
            distributedTo: input.distributedTo ?? null,
            reference: input.reference ?? null,
            expiresAt: expiresAt?.toISOString() ?? null,
          },
          {
            correlationId: context.correlationId,
            actorId: operatorId,
            ...(input.distributedTo ? { tenantId: input.distributedTo } : {}),
          },
        ),
      );
    });

    // Se registra el lote, nunca un codigo: los logs se conservan y se exportan
    // a un agregador, y una sola linea con codigos en claro arruinaria la razon
    // de guardarlos hasheados.
    this.logger.info('Lote de codigos generado', {
      batchId,
      kitId: kit.id,
      total: input.size,
      operatorId,
      correlationId: context.correlationId,
    });

    return {
      batchId,
      kitId: kit.id,
      kitName: kit.name,
      grade: kit.grade,
      total: input.size,
      createdAt: now.toISOString(),
      codes: generated.map((item) => item.code.value),
    };
  }
}

// ---------------------------------------------------------------------------
// Consultas del panel
// ---------------------------------------------------------------------------

/**
 * Estado de una tirada: cuantos codigos se emitieron y cuantos se han activado.
 *
 * Es la pregunta comercial de verdad -"de los mil libros del San Juan, cuantos
 * ninos entraron"- y por eso el resumen se calcula con `count(*) FILTER` en una
 * sola consulta en vez de traer los codigos: un lote son decenas de miles de
 * filas que nadie va a mirar una por una.
 */
export class GetCodeBatchUseCase implements UseCase<{ batchId: string }, CodeBatchSummary> {
  constructor(private readonly codes: ActivationCodeRepository) {}

  async execute(input: { batchId: string }): Promise<CodeBatchSummary> {
    const summary = await this.codes.batchSummary(input.batchId);

    if (!summary) {
      throw new NotFoundError('CODE_BATCH_NOT_FOUND', 'El lote indicado no existe.', {
        batchId: input.batchId,
      });
    }

    return summary;
  }
}

export class ListCodeBatchesUseCase implements UseCase<CursorQuery, CursorPage<CodeBatchSummary>> {
  constructor(private readonly codes: ActivationCodeRepository) {}

  async execute(page: CursorQuery): Promise<CursorPage<CodeBatchSummary>> {
    return this.codes.listBatches(page);
  }
}
