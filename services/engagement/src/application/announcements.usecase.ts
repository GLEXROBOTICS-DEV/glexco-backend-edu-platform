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
import type { PostKind } from '../domain/announcement.aggregate';
import type {
  AnnouncementRepository,
  ClassroomDirectory,
  ReplyRecord,
  ReplyRepository,
} from '../domain/repositories';

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
  /** `announcement` lo escribio el docente; `question`, un alumno. */
  kind: PostKind;
  classroomId: string;
  title: string;
  body: string;
  pinned: boolean;
  publishedAt: string;
  authorId: string;
  /** Vacio en la consulta del repositorio; lo rellena el caso de uso. */
  replies?: ReplyRecord[];
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
    private readonly replies: ReplyRepository,
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

    const items = await this.announcements.listActive(classroomIds);

    // Las respuestas de TODOS los hilos en una sola consulta y se reparten aqui.
    // Pedirlas hilo a hilo serian veinte viajes a la base cada vez que un alumno
    // abre el muro, que es de las pantallas que mas se abren.
    const all = await this.replies.listFor(items.map((item) => item.announcementId));
    const byPost = new Map<string, typeof all>();
    for (const reply of all) {
      byPost.set(reply.announcementId, [...(byPost.get(reply.announcementId) ?? []), reply]);
    }

    return {
      items: items.map((item) => ({ ...item, replies: byPost.get(item.announcementId) ?? [] })),
    };
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

// ---------------------------------------------------------------------------
// El muro del salon
// ---------------------------------------------------------------------------

export interface AskQuestionInput {
  classroomId: string;
  title: string;
  body: string;
}

/**
 * Un alumno pregunta a su salon.
 *
 * **Publico para todo el salon, nunca privado.** Es lo que pidio el cliente y
 * ademas lo mas seguro que se puede construir: no se abre ningun canal privado
 * entre un adulto y un menor. Todo lo que se escribe aqui lo ve la clase entera
 * -incluido su docente-, que es la mejor moderacion que existe y no cuesta nada
 * mantener.
 *
 * Y tiene el efecto que buscaba el cliente: la duda de uno le sirve al resto, y
 * ver que otros preguntan anima a preguntar.
 *
 * **Solo en SU salon.** Se comprueba contra la matricula, no contra el permiso:
 * un alumno tiene permiso de escribir preguntas, pero solo donde esta.
 */
export class AskQuestionUseCase implements UseCase<AskQuestionInput, { announcementId: string }> {
  constructor(
    private readonly announcements: AnnouncementRepository,
    private readonly classrooms: ClassroomDirectory,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: SecureRandom,
  ) {}

  async execute(
    input: AskQuestionInput,
    context: ExecutionContext,
  ): Promise<{ announcementId: string }> {
    const actor = context.actor!;
    const classroom = await this.classrooms.find(input.classroomId);

    if (!classroom || classroom.archived) {
      throw new NotFoundError('CLASSROOM_NOT_FOUND', 'Ese salon no esta disponible.');
    }

    const mine = await this.classrooms.classroomsFor(actor.userId);
    if (!mine.includes(classroom.classroomId)) {
      // Mismo error que si no existiera: distinguirlos permitiria sondear que
      // identificadores de salon son reales.
      throw new NotFoundError('CLASSROOM_NOT_FOUND', 'Ese salon no esta disponible.');
    }

    const now = this.clock.now();
    const question = Announcement.publish({
      id: AnnouncementId.create(this.ids.uuid()),
      kind: 'question',
      classroomId: classroom.classroomId,
      institutionId: classroom.institutionId,
      authorId: actor.userId,
      title: AnnouncementTitle.create(input.title),
      body: AnnouncementBody.create(input.body),
      // Una pregunta no se fija: fijar es la herramienta del docente para que un
      // aviso encabece la lista, y si un alumno pudiera hacerlo el muro seria una
      // carrera por quedarse arriba.
      pinned: false,
      now,
    });

    await this.unitOfWork.run(async (tx) => {
      await this.announcements.save(question, tx);
      (tx as { enqueue(...events: unknown[]): void }).enqueue(...question.pullDomainEvents());
    });

    return { announcementId: question.id.value };
  }
}

export interface ReplyInput {
  announcementId: string;
  body: string;
}

/**
 * Responder en el muro.
 *
 * Responde cualquiera del salon: el docente y los demas alumnos. Es justo el
 * punto de todo esto -que un companero conteste tambien ensena, y al que
 * contesta el que mas-, y por eso no se reserva al docente.
 */
export class ReplyToPostUseCase implements UseCase<ReplyInput, { replyId: string }> {
  constructor(
    private readonly announcements: AnnouncementRepository,
    private readonly replies: ReplyRepository,
    private readonly classrooms: ClassroomDirectory,
    private readonly clock: Clock,
    private readonly ids: SecureRandom,
  ) {}

  async execute(input: ReplyInput, context: ExecutionContext): Promise<{ replyId: string }> {
    const actor = context.actor!;

    const post = await this.announcements.findById(input.announcementId);
    if (!post || post.archivedAt) {
      throw new NotFoundError('ANNOUNCEMENT_NOT_FOUND', 'Esa publicacion no esta disponible.');
    }

    // Del salon, o de la direccion de su colegio. Se comprueba sobre el RECURSO
    // y no solo por permiso: el permiso dice que clase de cosa puede hacer, y
    // esto dice sobre cual.
    const mine = await this.classrooms.classroomsFor(actor.userId);
    const sameInstitution =
      actor.institutionId != null && actor.institutionId === post.institutionId;

    if (!mine.includes(post.classroomId) && !sameInstitution) {
      throw new NotFoundError('ANNOUNCEMENT_NOT_FOUND', 'Esa publicacion no esta disponible.');
    }

    const body = AnnouncementBody.create(input.body);
    const reply = {
      id: this.ids.uuid(),
      announcementId: post.id.value,
      authorId: actor.userId,
      body: body.value,
      createdAt: this.clock.now().toISOString(),
    };

    await this.replies.add(reply);
    return { replyId: reply.id };
  }
}
