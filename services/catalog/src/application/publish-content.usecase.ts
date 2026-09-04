import {
  BusinessRuleError,
  DomainEvent,
  NotFoundError,
  type CacheStore,
  type Clock,
  type ExecutionContext,
  type LoggerPort,
  type UnitOfWork,
  type UseCase,
} from '@glexco/kernel';
import { EVENTS, type PublicationStatus } from '@glexco/contracts';
import { CachedContentRepository } from '../infrastructure/persistence/cached-content.repository';
import type { ContentRepository, Kit, KitRepository } from '../domain/repositories';

export interface PublishContentInput {
  target: 'course' | 'asset' | 'kit';
  id: string;
  status: PublicationStatus;
}

export interface PublishContentOutput {
  target: 'course' | 'asset' | 'kit';
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
    private readonly kits: KitRepository,
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

    // Un kit es su propio kit: `kitId` apunta a si mismo para que la
    // invalidacion de cache por etiqueta y el registro funcionen sin ramas.
    const current =
      input.target === 'kit'
        ? await this.kits.findById(input.id).then((kit) => (kit ? { ...kit, kitId: kit.id } : null))
        : input.target === 'course'
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

    // Las lecciones se leen ANTES de la transaccion porque viajan en el evento.
    // Van dentro y no como un evento por leccion a proposito: publicar un curso
    // es UN hecho del negocio -"este curso ya se puede dar"- y trocearlo en
    // quince eventos obliga a quien lo consuma a adivinar cuando termino la
    // tanda. Ademas `learning` necesita el total de lecciones para decir "3 de
    // 12", y con eventos sueltos ese numero esta mal hasta que llega el ultimo.
    const lessons =
      input.target === 'course' && input.status === 'published'
        ? await this.content.listLessonsByCourse(input.id, true)
        : [];

    await this.unitOfWork.run(async (tx) => {
      if (input.target === 'kit') {
        await this.kits.save({ ...(current as unknown as Kit), status: input.status }, tx);
      } else if (input.target === 'course') {
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

      // Publicar un curso SE ANUNCIA. Sin esto, `learning` nunca sabe que
      // lecciones existen: su directorio se queda vacio, `locateLesson` no
      // encuentra nada y el progreso por contenido no puede registrarse. El
      // evento estaba en el catalogo desde el principio y no lo emitia nadie,
      // asi que la funcion entera estaba muerta sin dar ningun error.
      // Publicar un KIT tambien se anuncia, y por el mismo motivo que el curso:
      // el evento estaba en el catalogo desde el principio y no lo emitia nadie,
      // asi que la analitica listaba la cartera de kits por UUID -"a3f1e2c8… ·
      // 40 alumnos"- en la pantalla que usa el equipo de contenidos para decidir
      // que kit hay que rehacer. Un identificador no le dice nada a nadie.
      if (input.target === 'kit' && input.status === 'published') {
        const kit = current as unknown as {
          code: string;
          name: string;
          program: string;
          grade: string;
        };

        (tx as { enqueue(...events: unknown[]): void }).enqueue(
          new KitPublished(
            {
              kitId: input.id,
              code: kit.code,
              name: kit.name,
              program: kit.program,
              grade: kit.grade,
            },
            1,
            { correlationId: context.correlationId },
          ),
        );
      }

      if (input.target === 'course' && input.status === 'published') {
        (tx as { enqueue(...events: unknown[]): void }).enqueue(
          new CoursePublished(
            {
              courseId: input.id,
              kitId: current.kitId,
              title: (current as { title?: string }).title ?? '',
              lessonCount: lessons.length,
              lessons: lessons.map((lesson, index) => ({
                lessonId: lesson.id,
                title: lesson.title,
                orderIndex: lesson.orderIndex ?? index,
              })),
            },
            1,
            { correlationId: context.correlationId },
          ),
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

// ---------------------------------------------------------------------------

interface CoursePublishedPayload {
  courseId: string;
  kitId: string;
  title: string;
  lessonCount: number;
  lessons: { lessonId: string; title: string; orderIndex: number }[];
}

/**
 * Un curso ya se puede dar.
 *
 * Lleva sus lecciones dentro. Ver la nota del caso de uso: un evento por leccion
 * dejaria a quien lo consume sin saber cuando termino la tanda, y el total de
 * lecciones -que es lo que permite decir "3 de 12"- estaria mal hasta el ultimo.
 */
class CoursePublished extends DomainEvent<CoursePublishedPayload> {
  constructor(payload: CoursePublishedPayload, version: number, context?: { correlationId?: string }) {
    super(EVENTS.COURSE_PUBLISHED, 'Course', payload.courseId, version, payload, context);
  }
}

// ---------------------------------------------------------------------------

interface KitPublishedPayload {
  kitId: string;
  code: string;
  name: string;
  program: string;
  grade: string;
}

/**
 * Un kit ya esta disponible.
 *
 * Lleva el NOMBRE, que es todo lo que se le pedia: quien lo consume necesita
 * poder escribir "uKit Explore 3.º" en una pantalla sin preguntarle al catalogo
 * por cada fila de una tabla. El codigo y el grado van con el porque ordenan y
 * agrupan esa misma tabla, y pedirlos despues seria otra llamada por fila.
 */
class KitPublished extends DomainEvent<KitPublishedPayload> {
  constructor(payload: KitPublishedPayload, version: number, context?: { correlationId?: string }) {
    super(EVENTS.KIT_PUBLISHED, 'Kit', payload.kitId, version, payload, context);
  }
}
