import {
  ForbiddenError,
  NotFoundError,
  type Clock,
  type ExecutionContext,
  type SecureRandom,
  type UnitOfWork,
  type UseCase,
} from '@glexco/kernel';
import {
  Announcement,
  AnnouncementBody,
  AnnouncementId,
  AnnouncementTitle,
} from '../domain/announcement.aggregate';
import type { AnnouncementRepository, ClassroomDirectory } from '../domain/repositories';

/**
 * Anuncios de salon.
 *
 * El alcance se comprueba DOS veces y las dos hacen falta. El guard dice si el
 * actor puede publicar anuncios; estos casos de uso dicen si puede hacerlo sobre
 * ESE salon. Sin la segunda, cualquier docente publicaria en el salon de
 * cualquier colegio conociendo su identificador.
 *
 * El salon se resuelve contra el directorio propio de engagement, alimentado por
 * eventos. Llamar a instituciones en cada publicacion ataria escribir un anuncio
 * a que el otro servicio este arriba, y esto ocurre en mitad de una clase.
 */

export interface PublishAnnouncementInput {
  classroomId: string;
  title: string;
  body: string;
  pinned?: boolean;
}

export interface AnnouncementView {
  announcementId: string;
  classroomId: string;
  title: string;
  body: string;
  pinned: boolean;
  publishedAt: string;
  authorId: string;
}

export class PublishAnnouncementUseCase
  implements UseCase<PublishAnnouncementInput, { announcementId: string }>
{
  constructor(
    private readonly announcements: AnnouncementRepository,
    private readonly classrooms: ClassroomDirectory,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: SecureRandom,
  ) {}

  async execute(
    input: PublishAnnouncementInput,
    context: ExecutionContext,
  ): Promise<{ announcementId: string }> {
    const actor = context.actor!;
    const classroom = await this.classrooms.find(input.classroomId);

    if (!classroom || classroom.archived) {
      throw new NotFoundError('CLASSROOM_NOT_FOUND', 'Ese salon no esta disponible.');
    }

    // El docente del salon, o un administrador de SU institucion. Un director
    // puede escribir a cualquier salon de su colegio -un aviso de cierre por
    // lluvia sale de direccion, no del docente-, pero nunca a los de otro.
    const isTeacher = classroom.teacherId === actor.userId;
    const isTheirInstitution =
      actor.institutionId !== null &&
      actor.institutionId !== undefined &&
      actor.institutionId === classroom.institutionId;

    if (!isTeacher && !isTheirInstitution) {
      // Mismo error que si el salon no existiera: distinguirlos permitiria
      // sondear que identificadores de salon son reales en otros colegios.
      throw new NotFoundError('CLASSROOM_NOT_FOUND', 'Ese salon no esta disponible.');
    }

    const now = this.clock.now();
    const announcement = Announcement.publish({
      id: AnnouncementId.create(this.ids.uuid()),
      classroomId: classroom.classroomId,
      institutionId: classroom.institutionId,
      authorId: actor.userId,
      title: AnnouncementTitle.create(input.title),
      body: AnnouncementBody.create(input.body),
      pinned: input.pinned ?? false,
      now,
    });

    await this.unitOfWork.run(async (tx) => {
      await this.announcements.save(announcement, tx);
      (tx as { enqueue(...events: unknown[]): void }).enqueue(...announcement.pullDomainEvents());
    });

    return { announcementId: announcement.id.value };
  }
}

/**
 * Los anuncios que le tocan a quien pregunta.
 *
 * Un alumno recibe los de SUS salones y nada mas; el `studentId` sale del token
 * y nunca de un parametro. Un docente recibe los de los salones que da.
 */
export class ListMyAnnouncementsUseCase
  implements UseCase<{ classroomId?: string }, { items: AnnouncementView[] }>
{
  constructor(
    private readonly announcements: AnnouncementRepository,
    private readonly classrooms: ClassroomDirectory,
  ) {}

  async execute(
    input: { classroomId?: string },
    context: ExecutionContext,
  ): Promise<{ items: AnnouncementView[] }> {
    const actor = context.actor!;
    const scope = await this.classrooms.classroomsFor(actor.userId);

    // Sin salones no hay anuncios. Es el caso del alumno independiente, que es
    // la mitad del modelo de negocio: se devuelve vacio, no un error.
    if (scope.length === 0) return { items: [] };

    const classroomIds = input.classroomId
      ? scope.filter((id) => id === input.classroomId)
      : scope;

    if (classroomIds.length === 0) {
      throw new ForbiddenError('CLASSROOM_NOT_YOURS', 'Ese salon no es tuyo.');
    }

    return { items: await this.announcements.listActive(classroomIds) };
  }
}

export class ArchiveAnnouncementUseCase implements UseCase<{ announcementId: string }, void> {
  constructor(
    private readonly announcements: AnnouncementRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: { announcementId: string }, context: ExecutionContext): Promise<void> {
    const announcement = await this.announcements.findById(input.announcementId);
    if (!announcement) {
      throw new NotFoundError('ANNOUNCEMENT_NOT_FOUND', 'Ese anuncio no existe.');
    }

    announcement.assertEditableBy(context.actor!.userId);
    announcement.archive(this.clock.now());

    // `save` sale antes si el agregado no cambio, asi que archivar dos veces no
    // provoca un conflicto de concurrencia inventado.
    await this.unitOfWork.run(async (tx) => {
      await this.announcements.save(announcement, tx);
    });
  }
}
