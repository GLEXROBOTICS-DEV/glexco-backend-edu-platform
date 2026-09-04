import {
  AggregateRoot,
  BusinessRuleError,
  DomainEvent,
  ValueObject,
  defineId,
  type DomainEventContext,
} from '@glexco/kernel';
import { EVENTS } from '@glexco/contracts';

const AGGREGATE = 'Announcement';

export class AnnouncementId extends defineId('Announcement') {}

/**
 * Titulo de un anuncio.
 *
 * Corto a proposito. Un anuncio de salon se lee en la lista sin abrirlo, y un
 * titulo de doscientos caracteres convierte la lista en un muro de texto donde
 * ya no se distingue lo urgente.
 */
export class AnnouncementTitle extends ValueObject<{ value: string }> {
  static create(raw: string): AnnouncementTitle {
    const value = raw.trim();
    if (value.length < 3) {
      throw new BusinessRuleError('TITLE_TOO_SHORT', 'El titulo es demasiado corto.', {
        field: 'title',
      });
    }
    if (value.length > 120) {
      throw new BusinessRuleError('TITLE_TOO_LONG', 'El titulo no puede pasar de 120 caracteres.', {
        field: 'title',
      });
    }
    return new AnnouncementTitle({ value });
  }

  get value(): string {
    return this.props.value;
  }
}

export class AnnouncementBody extends ValueObject<{ value: string }> {
  static create(raw: string): AnnouncementBody {
    const value = raw.trim();
    if (value.length < 1) {
      throw new BusinessRuleError('BODY_REQUIRED', 'El anuncio no puede ir vacio.', {
        field: 'body',
      });
    }
    if (value.length > 4000) {
      throw new BusinessRuleError('BODY_TOO_LONG', 'El anuncio es demasiado largo.', {
        field: 'body',
      });
    }
    return new AnnouncementBody({ value });
  }

  get value(): string {
    return this.props.value;
  }
}

export interface AnnouncementPublishedPayload {
  announcementId: string;
  classroomId: string;
  institutionId: string;
  authorId: string;
  title: string;
  publishedAt: string;
}

export class AnnouncementPublished extends DomainEvent<AnnouncementPublishedPayload> {
  constructor(payload: AnnouncementPublishedPayload, version: number, context?: DomainEventContext) {
    super(
      EVENTS.ANNOUNCEMENT_PUBLISHED,
      AGGREGATE,
      payload.announcementId,
      version,
      payload,
      context,
    );
  }
}

/**
 * Que es cada publicacion del muro.
 *
 * `announcement` lo escribe el docente y es informacion; `question` la escribe
 * un alumno y espera respuesta. Se distinguen porque **se ordenan distinto y se
 * moderan distinto**: un aviso fijado encabeza la lista, y una pregunta sin
 * responder es trabajo pendiente para el docente.
 */
export const POST_KINDS = { ANNOUNCEMENT: 'announcement', QUESTION: 'question' } as const;
export type PostKind = (typeof POST_KINDS)[keyof typeof POST_KINDS];

interface AnnouncementState {
  kind: PostKind;
  classroomId: string;
  institutionId: string;
  authorId: string;
  title: AnnouncementTitle;
  body: AnnouncementBody;
  pinned: boolean;
  publishedAt: Date;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Anuncio de salon.
 *
 * El cliente decidio **anuncios asincronos, sin WebSockets**: el docente escribe
 * y el alumno lo ve la proxima vez que entra. Nada de este agregado presupone un
 * transporte, asi que anadir tiempo real despues es anadir otro consumidor del
 * evento y no reescribir el dominio.
 *
 * **No se borra, se archiva.** Un anuncio que desaparece deja al alumno sin
 * poder comprobar lo que se le pidio, y al docente sin poder demostrar que lo
 * dijo. Los dos casos acaban en la misma discusion, y la unica forma de cerrarla
 * es que el mensaje siga existiendo.
 */
export class Announcement extends AggregateRoot<AnnouncementId> {
  private constructor(
    id: AnnouncementId,
    private state: AnnouncementState,
  ) {
    super(id);
  }

  static publish(input: {
    id: AnnouncementId;
    classroomId: string;
    institutionId: string;
    authorId: string;
    title: AnnouncementTitle;
    body: AnnouncementBody;
    pinned: boolean;
    /** Por defecto, aviso del docente: es lo que habia antes de existir el muro. */
    kind?: PostKind;
    now: Date;
  }): Announcement {
    // Una PREGUNTA no se puede fijar. Fijar es una herramienta del docente para
    // que un aviso encabece la lista; si un alumno pudiera fijar la suya, el
    // muro seria una carrera por quedarse arriba.
    const kind = input.kind ?? POST_KINDS.ANNOUNCEMENT;
    const pinned = kind === POST_KINDS.QUESTION ? false : input.pinned;

    const announcement = new Announcement(input.id, {
      kind,
      classroomId: input.classroomId,
      institutionId: input.institutionId,
      authorId: input.authorId,
      title: input.title,
      body: input.body,
      pinned,
      publishedAt: input.now,
      archivedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    });

    announcement.record(
      (version) =>
        new AnnouncementPublished(
          {
            announcementId: input.id.value,
            classroomId: input.classroomId,
            institutionId: input.institutionId,
            authorId: input.authorId,
            title: input.title.value,
            publishedAt: input.now.toISOString(),
          },
          version,
        ),
    );

    return announcement;
  }

  static rehydrate(id: AnnouncementId, state: AnnouncementState, version: number): Announcement {
    const announcement = new Announcement(id, state);
    announcement.setVersion(version);
    return announcement;
  }

  /**
   * Solo el autor puede tocar su anuncio.
   *
   * Ni siquiera otro docente del mismo salon: un anuncio lleva la firma de quien
   * lo escribio, y permitir que un tercero lo edite convierte esa firma en una
   * afirmacion que no se sostiene.
   */
  assertEditableBy(userId: string): void {
    if (this.state.authorId !== userId) {
      throw new BusinessRuleError(
        'NOT_THE_AUTHOR',
        'Solo quien escribio el anuncio puede modificarlo.',
      );
    }
  }

  edit(input: { title: AnnouncementTitle; body: AnnouncementBody; pinned: boolean; now: Date }): void {
    if (this.state.archivedAt) {
      throw new BusinessRuleError(
        'ANNOUNCEMENT_ARCHIVED',
        'Un anuncio archivado ya no se puede editar. Publica uno nuevo.',
      );
    }

    // Salir sin cambios cuando no hay ninguno. Sin esto, `hasChanges` seguiria
    // en falso, el repositorio saldria antes y el `UPDATE ... WHERE version <`
    // no encontraria fila: un conflicto de concurrencia inventado sobre una
    // operacion que en realidad no queria cambiar nada.
    const same =
      this.state.title.value === input.title.value &&
      this.state.body.value === input.body.value &&
      this.state.pinned === input.pinned;
    if (same) return;

    this.state.title = input.title;
    this.state.body = input.body;
    this.state.pinned = input.pinned;
    this.state.updatedAt = input.now;
    this.touch();
  }

  archive(now: Date): void {
    // Idempotente: archivar lo ya archivado no es un error, y tratarlo como tal
    // hace que un doble clic o un reintento de red parezca un fallo.
    if (this.state.archivedAt) return;

    this.state.archivedAt = now;
    this.state.updatedAt = now;
    this.touch();
  }

  get kind(): PostKind {
    return this.state.kind;
  }
  get classroomId(): string {
    return this.state.classroomId;
  }
  get institutionId(): string {
    return this.state.institutionId;
  }
  get authorId(): string {
    return this.state.authorId;
  }
  get title(): string {
    return this.state.title.value;
  }
  get body(): string {
    return this.state.body.value;
  }
  get pinned(): boolean {
    return this.state.pinned;
  }
  get publishedAt(): Date {
    return this.state.publishedAt;
  }
  get archivedAt(): Date | null {
    return this.state.archivedAt;
  }
  get createdAt(): Date {
    return this.state.createdAt;
  }
  get updatedAt(): Date {
    return this.state.updatedAt;
  }
}
