import type { Pool, PoolClient } from 'pg';
import type { PostKind } from '../../domain/announcement.aggregate';
import type { ReplyRecord, ReplyRepository } from '../../domain/repositories';
import { ConflictError, type TransactionContext } from '@glexco/kernel';
import {
  Announcement,
  AnnouncementBody,
  AnnouncementId,
  AnnouncementTitle,
} from '../../domain/announcement.aggregate';
import type {
  AnnouncementRepository,
  ClassroomDirectory,
  ClassroomRecord,
} from '../../domain/repositories';
import type { AnnouncementView } from '../../application/announcements.usecase';
import type { EmailDeliveryLog } from '../../application/ports';

interface PgTransaction extends TransactionContext {
  client: PoolClient;
}

export class PgAnnouncementRepository implements AnnouncementRepository {
  constructor(
    private readonly writePool: Pool,
    private readonly readPool: Pool,
  ) {}

  async save(announcement: Announcement, tx: TransactionContext): Promise<void> {
    // Un agregado sin cambios no se escribe. Sin esta salida, archivar dos veces
    // -que es idempotente a proposito- dejaria la version igual, el UPDATE no
    // encontraria fila y se lanzaria un conflicto de concurrencia inventado.
    if (!announcement.hasChanges) return;

    const client = (tx as PgTransaction).client;

    const { rowCount } = await client.query(
      `INSERT INTO engagement.announcements
         (id, kind, classroom_id, institution_id, author_id, title, body, pinned,
          published_at, archived_at, version, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE
          SET title       = EXCLUDED.title,
              body        = EXCLUDED.body,
              pinned      = EXCLUDED.pinned,
              archived_at = EXCLUDED.archived_at,
              version     = EXCLUDED.version,
              updated_at  = EXCLUDED.updated_at
        WHERE engagement.announcements.version < EXCLUDED.version`,
      [
        announcement.id.value,
        announcement.kind,
        announcement.classroomId,
        announcement.institutionId,
        announcement.authorId,
        announcement.title,
        announcement.body,
        announcement.pinned,
        announcement.publishedAt,
        announcement.archivedAt,
        announcement.version,
        announcement.createdAt,
        announcement.updatedAt,
      ],
    );

    if (rowCount === 0) {
      throw new ConflictError(
        'ANNOUNCEMENT_CONFLICT',
        'Alguien modifico este anuncio mientras lo editabas. Vuelve a cargarlo.',
      );
    }
  }

  async findById(announcementId: string): Promise<Announcement | null> {
    // Del pool de ESCRITURA: quien lee un anuncio para modificarlo tiene que ver
    // su propia escritura anterior, y una replica con retraso devolveria la
    // version vieja y provocaria un conflicto falso.
    const { rows } = await this.writePool.query(
      `SELECT * FROM engagement.announcements WHERE id = $1`,
      [announcementId],
    );

    const row = rows[0];
    if (!row) return null;

    return Announcement.rehydrate(
      AnnouncementId.create(row.id),
      {
        kind: (row.kind ?? 'announcement') as PostKind,
        classroomId: row.classroom_id,
        institutionId: row.institution_id,
        authorId: row.author_id,
        title: AnnouncementTitle.create(row.title),
        body: AnnouncementBody.create(row.body),
        pinned: row.pinned,
        publishedAt: row.published_at,
        archivedAt: row.archived_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
      row.version,
    );
  }

  async listActive(classroomIds: string[]): Promise<AnnouncementView[]> {
    if (classroomIds.length === 0) return [];

    // Lectura pesada y de solo lectura: va al pool de replicas.
    const { rows } = await this.readPool.query(
      // El nombre viene EN la misma consulta. Resolverlo despues, llamando a
      // otro servicio, es lo que hacia la primera version del muro y fallaba con
      // "permisos insuficientes" para cualquier alumno.
      `SELECT a.id, a.kind, a.classroom_id, a.author_id, a.title, a.body, a.pinned,
              a.published_at, d.full_name AS author_name
         FROM engagement.announcements a
         LEFT JOIN engagement.author_directory d ON d.user_id = a.author_id
        WHERE a.classroom_id = ANY($1::uuid[]) AND a.archived_at IS NULL
        ORDER BY a.pinned DESC, a.published_at DESC
        LIMIT 100`,
      [classroomIds],
    );

    return rows.map((row) => ({
      announcementId: row.id,
      kind: (row.kind ?? 'announcement') as PostKind,
      classroomId: row.classroom_id,
      title: row.title,
      body: row.body,
      pinned: row.pinned,
      publishedAt: (row.published_at as Date).toISOString(),
      authorId: row.author_id,
      authorName: row.author_name ?? null,
    }));
  }
}

export class PgClassroomDirectory implements ClassroomDirectory {
  constructor(private readonly readPool: Pool) {}

  async find(classroomId: string): Promise<ClassroomRecord | null> {
    const { rows } = await this.readPool.query(
      `SELECT classroom_id, institution_id, teacher_id, name, grade, archived
         FROM engagement.classroom_directory WHERE classroom_id = $1`,
      [classroomId],
    );

    const row = rows[0];
    if (!row) return null;

    return {
      classroomId: row.classroom_id,
      institutionId: row.institution_id,
      teacherId: row.teacher_id,
      name: row.name,
      grade: row.grade,
      archived: row.archived,
    };
  }

  async classroomsFor(userId: string): Promise<string[]> {
    // Las dos vias en una consulta: el alumno por matricula y el docente por
    // asignacion. Con dos consultas habria que decidir fuera cual toca, y eso
    // significa que el llamante tiene que saber el rol -que es justo lo que no
    // debe saber para responder "mis anuncios"-.
    const { rows } = await this.readPool.query(
      `SELECT classroom_id FROM engagement.classroom_members
        WHERE student_id = $1 AND active
       UNION
       SELECT classroom_id FROM engagement.classroom_directory
        WHERE teacher_id = $1 AND NOT archived`,
      [userId],
    );

    return rows.map((row) => row.classroom_id as string);
  }
}

export class PgEmailDeliveryLog implements EmailDeliveryLog {
  constructor(private readonly writePool: Pool) {}

  async record(entry: {
    id: string;
    userId: string;
    kind: string;
    recipient: string;
    locale: string;
    status: 'sent' | 'failed';
    failureReason?: string | null;
    providerRef?: string | null;
  }): Promise<void> {
    // Se guarda QUE se envio, nunca QUE decia. El cuerpo de un correo de
    // recuperacion contiene el enlace con el token: escribirlo aqui
    // reintroduciria por la puerta de atras el problema que se evita al no
    // meterlo en el evento.
    await this.writePool.query(
      `INSERT INTO engagement.email_deliveries
         (id, user_id, kind, recipient, locale, status, failure_reason, provider_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        entry.id,
        entry.userId,
        entry.kind,
        entry.recipient,
        entry.locale,
        entry.status,
        entry.failureReason ?? null,
        entry.providerRef ?? null,
      ],
    );
  }
}

/**
 * Respuestas del muro.
 *
 * Sin agregado propio a proposito: una respuesta no tiene invariantes -es un
 * texto, un autor y una fecha- y montarle un agregado con version optimista
 * seria maquinaria para proteger algo que nadie modifica despues de escribirlo.
 */
export class PgReplyRepository implements ReplyRepository {
  constructor(
    private readonly writePool: Pool,
    private readonly readPool: Pool,
  ) {}

  async add(reply: ReplyRecord): Promise<void> {
    await this.writePool.query(
      `INSERT INTO engagement.announcement_replies (id, announcement_id, author_id, body, created_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [reply.id, reply.announcementId, reply.authorId, reply.body, reply.createdAt],
    );
  }

  async listFor(announcementIds: readonly string[]): Promise<ReplyRecord[]> {
    if (announcementIds.length === 0) return [];

    // UNA consulta para todos los hilos, no una por hilo. El muro pinta veinte
    // publicaciones de golpe: con una consulta por hilo serian veinte viajes a
    // la base cada vez que un alumno abre la pantalla.
    const { rows } = await this.readPool.query<{
      id: string;
      announcement_id: string;
      author_id: string;
      author_name: string | null;
      body: string;
      created_at: Date;
    }>(
      `SELECT r.id, r.announcement_id, r.author_id, r.body, r.created_at,
              d.full_name AS author_name
         FROM engagement.announcement_replies r
         LEFT JOIN engagement.author_directory d ON d.user_id = r.author_id
        WHERE r.announcement_id = ANY($1::uuid[]) AND r.archived_at IS NULL
        ORDER BY r.created_at`,
      [[...announcementIds]],
    );

    return rows.map((row) => ({
      id: row.id,
      announcementId: row.announcement_id,
      authorId: row.author_id,
      authorName: row.author_name ?? null,
      body: row.body,
      createdAt: row.created_at.toISOString(),
    }));
  }

  async archive(replyId: string, actorId: string, canModerate: boolean): Promise<boolean> {
    // Cada uno retira lo SUYO; el docente y la direccion, cualquiera. La
    // comprobacion va dentro del `WHERE` y no en una consulta previa: hacerlo en
    // dos pasos deja una ventana entre comprobar y borrar.
    const { rowCount } = await this.writePool.query(
      `UPDATE engagement.announcement_replies
          SET archived_at = now()
        WHERE id = $1 AND archived_at IS NULL AND ($3 OR author_id = $2)`,
      [replyId, actorId, canModerate],
    );
    return (rowCount ?? 0) > 0;
  }
}
