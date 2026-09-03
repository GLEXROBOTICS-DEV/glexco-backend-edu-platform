import {
  BusinessRuleError,
  NotFoundError,
  type CacheStore,
  type Clock,
  type ExecutionContext,
  type LoggerPort,
  type UnitOfWork,
  type UseCase,
} from '@glexco/kernel';
import type { PublicationStatus } from '@glexco/contracts';
import { CachedContentRepository } from '../infrastructure/persistence/cached-content.repository';
import type { ContentRepository } from '../domain/repositories';

export interface PublishContentInput {
  target: 'course' | 'asset';
  id: string;
  status: PublicationStatus;
}

export interface PublishContentOutput {
  target: 'course' | 'asset';
  id: string;
  kitId: string;
  previousStatus: PublicationStatus;
  status: PublicationStatus;
}

/**
 * Transiciones permitidas del estado de publicacion.
 *
 * Se escribe como tabla explicita en vez de dejar que cualquier estado vaya a
 * cualquier otro. Lo que impide de verdad es el salto de `draft` a `published`
 * sin pasar por revision: este contenido lo ven ninos de seis anos, y la
 * revision es el unico punto donde alguien distinto del autor lo mira antes de
 * que llegue a un aula.
 *
 * `archived -> draft` existe para poder retomar material retirado sin duplicarlo,
 * y vuelve a exigir revision porque el motivo por el que se archivo pudo ser
 * precisamente su contenido.
 */
const ALLOWED_TRANSITIONS: Record<PublicationStatus, readonly PublicationStatus[]> = {
  draft: ['in_review', 'archived'],
  in_review: ['published', 'draft', 'archived'],
  published: ['archived', 'in_review'],
  archived: ['draft'],
};

/**
 * Cambia el estado de publicacion de un contenido e invalida la cache del kit.
 *
 * **El orden importa y no es intercambiable.** La escritura va dentro de la
 * transaccion; la invalidacion, DESPUES de que confirme. Invalidar antes -o
 * dentro- deja la cache vacia y la base sin cambiar si la transaccion acaba en
 * rollback: el siguiente lector recargaria el contenido viejo y lo volveria a
 * cachear, con lo que la invalidacion habria servido para nada y ademas habria
 * costado una estampida.
 *
 * **Si la invalidacion falla, la operacion falla.** Es lo contrario de lo que
 * hace la lectura de cache, que se degrada en silencio. El motivo es concreto:
 * si alguien archiva un contenido y la cache sigue sirviendolo, la plataforma
 * esta mostrando material que un administrador retiro a proposito, y quien lo
 * retiro cree que ya no se ve. Un error visible es mucho mejor que eso.
 */
export class PublishContentUseCase implements UseCase<PublishContentInput, PublishContentOutput> {
  constructor(
    private readonly content: ContentRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly cache: CacheStore,
    private readonly clock: Clock,
    private readonly logger: LoggerPort,
  ) {}

  async execute(
    input: PublishContentInput,
    context: ExecutionContext,
  ): Promise<PublishContentOutput> {
    const now = this.clock.now();

    const current =
      input.target === 'course'
        ? await this.content.findCourse(input.id)
        : await this.content.findAsset(input.id);

    if (!current) {
      throw new NotFoundError('CONTENT_NOT_FOUND', 'El contenido indicado no existe.', {
        target: input.target,
        id: input.id,
      });
    }

    const previousStatus = current.status;

    // Idempotente: dejar algo en el estado en que ya esta no es un error. Un
    // doble clic en el panel no debe devolver un fallo que invite a investigar.
    if (previousStatus === input.status) {
      return {
        target: input.target,
        id: input.id,
        kitId: current.kitId,
        previousStatus,
        status: input.status,
      };
    }

    if (!ALLOWED_TRANSITIONS[previousStatus].includes(input.status)) {
      throw new BusinessRuleError(
        'INVALID_PUBLICATION_TRANSITION',
        `Un contenido en "${previousStatus}" no puede pasar a "${input.status}".`,
        { from: previousStatus, to: input.status, allowed: ALLOWED_TRANSITIONS[previousStatus] },
      );
    }

    await this.unitOfWork.run(async (tx) => {
      if (input.target === 'course') {
        await this.content.saveCourse(
          { ...current, status: input.status, updatedAt: now.toISOString() } as never,
          tx,
        );
      } else {
        await this.content.saveAsset(
          { ...current, status: input.status, updatedAt: now.toISOString() } as never,
          tx,
        );
      }
    });

    // Fuera de la transaccion, ya confirmada.
    await this.cache.invalidateTag(CachedContentRepository.kitTag(current.kitId));

    this.logger.info('Contenido publicado o retirado', {
      target: input.target,
      id: input.id,
      kitId: current.kitId,
      from: previousStatus,
      to: input.status,
      actorId: context.actor?.userId,
      correlationId: context.correlationId,
    });

    return {
      target: input.target,
      id: input.id,
      kitId: current.kitId,
      previousStatus,
      status: input.status,
    };
  }
}
